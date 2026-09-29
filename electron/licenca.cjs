const https = require('https');

// ============================================================================
// CONFIGURAÇÃO DA LICENÇA
// ----------------------------------------------------------------------------
// Preencha SUPABASE_URL e SUPABASE_ANON_KEY com os dados do SEU projeto
// Supabase (gratuito). O passo a passo completo está em LICENCA-SETUP.md,
// na raiz do projeto.
//
// Enquanto isso não for preenchido, o sistema funciona normalmente sem
// nenhuma verificação online (modo "não configurado").
// ============================================================================
const SUPABASE_URL = 'https://jmdjuvrlkeazgckdrwxy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_nbOZHr5ku6mraEdLjf18Dg__mdAgWbv';

// Quantos dias o sistema pode funcionar sem conseguir confirmar a licença
// online (ex.: cliente ficou sem internet por alguns dias) antes de passar
// a exigir uma conexão para continuar sendo usado.
const DIAS_TOLERANCIA_OFFLINE = 7;

const TIMEOUT_MS = 6000;

function estaConfigurado() {
  return !!SUPABASE_URL && !SUPABASE_URL.includes('SEU-PROJETO') &&
         !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('SUA-CHAVE');
}

// Consulta o status de uma chave de licença na tabela `licencas` do Supabase.
// Nunca lança exceção: sempre resolve com { ok, status? , motivo? }.
function consultarStatusOnline(chave) {
  return new Promise((resolve) => {
    if (!chave) return resolve({ ok: false, motivo: 'sem_chave' });
    if (!estaConfigurado()) return resolve({ ok: false, motivo: 'nao_configurado' });

    const url = `${SUPABASE_URL}/rest/v1/licencas?chave=eq.${encodeURIComponent(chave)}&select=status`;

    let finished = false;
    const req = https.get(
      url,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        timeout: TIMEOUT_MS,
      },
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

module.exports = { consultarStatusOnline, estaConfigurado, DIAS_TOLERANCIA_OFFLINE };
