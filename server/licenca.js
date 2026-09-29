// ---------- LICENÇA (versão nuvem/web) ----------
// Mesma ideia da licença do app desktop (electron/licenca.cjs): uma chave é
// consultada na tabela `licencas` de um projeto Supabase. Se o status dessa
// chave estiver "bloqueada", o acesso a este servidor inteiro é recusado —
// útil, por exemplo, pra bloquear remotamente um cliente que parou de pagar
// ou pediu reembolso, sem precisar mexer em nada no Render.
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

function estaConfigurado() {
  return !!SUPABASE_URL && !!SUPABASE_ANON_KEY && !!LICENCA_CHAVE;
}

function consultarStatusOnline() {
  return new Promise((resolve) => {
    if (!estaConfigurado()) return resolve({ ok: false, motivo: 'nao_configurado' });

    const url = `${SUPABASE_URL}/rest/v1/licencas?chave=eq.${encodeURIComponent(LICENCA_CHAVE)}&select=status`;
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
            return resolve({ ok: false, motivo: 'erro_servidor_' + res.statusCode });
          }
          try {
            const json = JSON.parse(data);
            if (Array.isArray(json) && json.length > 0 && json[0].status) {
              resolve({ ok: true, status: String(json[0].status).trim().toLowerCase() });
            } else {
              resolve({ ok: true, status: 'nao_encontrada' });
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

// Estado em memória, atualizado periodicamente — evita consultar o Supabase a
// cada requisição recebida pelo servidor.
let cache = { estado: 'ativa', ultimaVerificacao: null };

async function verificar() {
  if (!estaConfigurado()) {
    cache = { estado: 'ativa', ultimaVerificacao: null };
    return cache;
  }

  const resultado = await consultarStatusOnline();

  if (resultado.ok) {
    cache = {
      estado: resultado.status === 'ativa' ? 'ativa' : 'bloqueada',
      ultimaVerificacao: new Date().toISOString(),
    };
    return cache;
  }

  // Não foi possível consultar agora (Supabase fora do ar, timeout, etc.):
  // mantém o último estado já confirmado, em vez de derrubar o sistema por
  // uma falha passageira. Se nunca conseguiu confirmar nenhuma vez, libera.
  if (!cache.ultimaVerificacao) {
    cache = { estado: 'ativa', ultimaVerificacao: null };
  }
  return cache;
}

function obterStatusCache() {
  return cache;
}

function iniciarVerificacaoPeriodica() {
  verificar();
  setInterval(verificar, INTERVALO_VERIFICACAO_MS);
}

module.exports = { verificar, obterStatusCache, iniciarVerificacaoPeriodica, estaConfigurado };
