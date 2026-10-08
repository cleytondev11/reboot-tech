// ---------- LICENÇA (versão nuvem/web) ----------
// Mesma ideia da licença do app desktop (electron/licenca.cjs): uma chave é
// consultada na tabela `licencas` de um projeto Supabase. Se o status dessa
// chave estiver "bloqueada", o acesso a este servidor inteiro é recusado —
// útil, por exemplo, pra bloquear remotamente um cliente que parou de pagar
// ou pediu reembolso, sem precisar mexer em nada no Render.
//
// VENCIMENTO AUTOMÁTICO: cada linha da tabela também tem `data_inicio` e
// `data_vencimento`. A partir do dia do vencimento o acesso é bloqueado sozinho
// (o cliente vê "mensalidade vencida" e precisa falar com você para pagar).
// Quando ele pagar, é só empurrar a `data_vencimento` para a frente no Supabase.
//
// Configure as variáveis de ambiente SUPABASE_URL, SUPABASE_ANON_KEY e
// LICENCA_CHAVE (veja server/.env.example e server/DEPLOY.md). Enquanto
// LICENCA_CHAVE não estiver definida, o sistema libera o acesso normalmente
// (sem nenhum bloqueio) — assim o deploy nunca trava por falta de configuração.
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const LICENCA_CHAVE = process.env.LICENCA_CHAVE || '';

const INTERVALO_VERIFICACAO_MS = 10 * 60 * 1000; // reconsulta o Supabase a cada 10 min
const TIMEOUT_MS = 8000;

// Quantos dias DEPOIS da data de vencimento o acesso ainda continua liberado.
// 0 = bloqueia no próprio dia do vencimento. Coloque 1, 2, 3... para dar uma
// folguinha ao cliente antes de travar.
const DIAS_DE_TOLERANCIA = 0;

// A data "de hoje" é sempre a de Brasília, para o bloqueio virar à meia-noite daqui.
const FUSO = 'America/Sao_Paulo';

// DESATIVADA por padrão: o bloqueio por vencimento agora é feito pela Central de Acessos (/admin),
// sem consultar o Supabase. Para voltar a usar a licença do Supabase, defina LICENCA_ATIVA=1 no Render.
const LICENCA_ATIVA = String(process.env.LICENCA_ATIVA || '').trim() === '1';

function estaConfigurado() {
  return LICENCA_ATIVA && !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !!LICENCA_CHAVE;
}

function requisitar(select) {
  return new Promise((resolve) => {
    const url = `${SUPABASE_URL}/rest/v1/licencas?chave=eq.${encodeURIComponent(LICENCA_CHAVE)}&select=${select}`;
    let finished = false;

    const req = https.get(
      url,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }, timeout: TIMEOUT_MS },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (finished) return;
          finished = true;
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return resolve({ ok: false, codigo: res.statusCode, motivo: 'erro_servidor_' + res.statusCode });
          }
          try {
            const json = JSON.parse(data);
            if (Array.isArray(json) && json.length > 0 && json[0].status) {
              resolve({
                ok: true,
                status: String(json[0].status).trim().toLowerCase(),
                dataInicio: json[0].data_inicio || null,
                dataVencimento: json[0].data_vencimento || null,
              });
            } else {
              resolve({ ok: true, status: 'nao_encontrada', dataInicio: null, dataVencimento: null });
            }
          } catch (e) {
            resolve({ ok: false, motivo: 'resposta_invalida' });
          }
        });
      }
    );

    req.on('timeout', () => {
      if (finished) return;
      finished = true;
      req.destroy();
      resolve({ ok: false, motivo: 'timeout' });
    });

    req.on('error', () => {
      if (finished) return;
      finished = true;
      resolve({ ok: false, motivo: 'sem_conexao' });
    });
  });
}

async function consultarStatusOnline() {
  if (!estaConfigurado()) return { ok: false, motivo: 'nao_configurado' };
  const completa = await requisitar('status,data_inicio,data_vencimento');
  // HTTP 400 = a tabela ainda não tem as colunas de data (migração do Supabase
  // não foi feita). Nesse caso consulta só o status, como era antes.
  if (!completa.ok && completa.codigo === 400) return requisitar('status');
  return completa;
}

// ---------- Regra do vencimento (função pura, fácil de testar) ----------

function hojeBrasilia(agora = new Date()) {
  return agora.toLocaleDateString('en-CA', { timeZone: FUSO }); // AAAA-MM-DD
}

function diasEntre(deStr, ateStr) {
  const a = Date.UTC(...deStr.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  const b = Date.UTC(...ateStr.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))));
  return Math.round((b - a) / 86400000);
}

// remoto = { status, dataInicio, dataVencimento } vindo do Supabase.
function calcularEstado(remoto, hoje = hojeBrasilia()) {
  const base = { dataInicio: remoto.dataInicio || null, dataVencimento: remoto.dataVencimento || null, diasRestantes: null };

  if (remoto.status !== 'ativa') return { ...base, estado: 'bloqueada', motivo: 'bloqueada' };

  if (base.dataVencimento) {
    const venc = String(base.dataVencimento).slice(0, 10);
    const diasAteVencer = diasEntre(hoje, venc); // positivo = ainda falta; 0 = é hoje
    base.diasRestantes = diasAteVencer;
    if (diasAteVencer + DIAS_DE_TOLERANCIA <= 0) return { ...base, estado: 'bloqueada', motivo: 'vencida' };
  }
  return { ...base, estado: 'ativa', motivo: null };
}

// Guarda em memória o último retorno do Supabase (evita consultar a cada
// requisição). O ESTADO final é recalculado a cada leitura — assim o bloqueio
// por vencimento vale já à meia-noite, sem esperar a próxima consulta.
let cache = { remoto: null, ultimaVerificacao: null };

async function verificar() {
  if (!estaConfigurado()) {
    cache = { remoto: null, ultimaVerificacao: null };
    return obterStatusCache();
  }

  const resultado = await consultarStatusOnline();

  if (resultado.ok) {
    cache = {
      remoto: { status: resultado.status, dataInicio: resultado.dataInicio, dataVencimento: resultado.dataVencimento },
      ultimaVerificacao: new Date().toISOString(),
    };
  }
  // Se não deu pra consultar agora (Supabase fora do ar, timeout...), mantém o
  // último retorno confirmado em vez de derrubar o sistema por falha passageira.
  // Se nunca conseguiu confirmar nenhuma vez, libera.
  return obterStatusCache();
}

function obterStatusCache() {
  if (!estaConfigurado() || !cache.remoto) {
    return { estado: 'ativa', motivo: null, dataVencimento: null, diasRestantes: null, ultimaVerificacao: cache.ultimaVerificacao };
  }
  return { ...calcularEstado(cache.remoto), ultimaVerificacao: cache.ultimaVerificacao };
}

function iniciarVerificacaoPeriodica() {
  if (!estaConfigurado()) return; // licença do Supabase desativada: não consulta nada
  verificar();
  setInterval(verificar, INTERVALO_VERIFICACAO_MS);
}

module.exports = { verificar, obterStatusCache, iniciarVerificacaoPeriodica, estaConfigurado, calcularEstado, hojeBrasilia };
