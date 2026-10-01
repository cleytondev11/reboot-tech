// ---------- NOTIFICAÇÕES PUSH (celular/navegador) ----------
// Usa o padrão Web Push (VAPID). Cada aparelho que ativar as notificações
// guarda uma "inscrição" na tabela push_subscricoes, junto com as preferências
// dele (avisar quando uma OS ficar pronta / quando um orçamento virar OS).
//
// As chaves VAPID podem vir das variáveis de ambiente VAPID_PUBLIC_KEY e
// VAPID_PRIVATE_KEY. Se não existirem, são geradas automaticamente na primeira
// vez e guardadas no próprio banco (tabela push_config) — então funciona sem
// nenhuma configuração extra, mesmo no Render (cujo disco é apagado a cada deploy).
const webpush = require('web-push');
const db = require('./db');

let pronto = null; // { publicKey } depois de inicializado

async function inicializar() {
  if (pronto) return pronto;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    const salvo = await db.get(`SELECT valor FROM push_config WHERE chave = 'vapid'`);
    if (salvo) {
      try { ({ publicKey, privateKey } = JSON.parse(salvo.valor)); } catch (e) { publicKey = privateKey = null; }
    }
    if (!publicKey || !privateKey) {
      const novas = webpush.generateVAPIDKeys();
      publicKey = novas.publicKey;
      privateKey = novas.privateKey;
      await db.run(
        `INSERT INTO push_config (chave, valor) VALUES ('vapid', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`,
        [JSON.stringify({ publicKey, privateKey })]
      );
    }
  }

  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contato@reboottech.com.br', publicKey, privateKey);
  pronto = { publicKey };
  return pronto;
}

async function chavePublica() {
  return (await inicializar()).publicKey;
}

async function enviarParaInscricao(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 } // se o celular estiver sem internet, tenta entregar por até 24h
    );
    return true;
  } catch (err) {
    // 404/410 = o aparelho cancelou a permissão ou desinstalou o app: limpa a inscrição.
    if (err && (err.statusCode === 404 || err.statusCode === 410)) {
      await db.run('DELETE FROM push_subscricoes WHERE id = ?', [sub.id]).catch(() => {});
    } else {
      console.error('[Push] falha ao enviar:', err && (err.statusCode || err.message));
    }
    return false;
  }
}

// evento: 'os_pronta' | 'orc_convertido'. Nunca lança erro (uma falha na
// notificação jamais pode atrapalhar o salvamento da OS/orçamento).
async function notificar(evento, payload) {
  try {
    const coluna = evento === 'os_pronta' ? 'notif_os_pronta' : evento === 'orc_convertido' ? 'notif_orc_convertido' : null;
    if (!coluna) return;
    await inicializar();
    const subs = await db.all(`SELECT * FROM push_subscricoes WHERE ${coluna} = 1`);
    await Promise.allSettled(subs.map((s) => enviarParaInscricao(s, payload)));
  } catch (err) {
    console.error('[Push] erro ao notificar:', err && err.message);
  }
}

// Dispara sem esperar (não atrasa a resposta pro usuário).
function notificarSemEsperar(evento, payload) {
  notificar(evento, payload).catch(() => {});
}

async function dadosDaOs(osId) {
  return db.get(
    `SELECT os.numero, c.nome AS cliente, e.marca, e.modelo
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos e ON e.id = os.equipamento_id
     WHERE os.id = ?`,
    [osId]
  );
}

function nomeEquip(d) {
  return [d && d.marca, d && d.modelo].filter(Boolean).join(' ');
}

async function avisarOsPronta(osId) {
  const d = await dadosDaOs(osId);
  if (!d) return;
  const equip = nomeEquip(d);
  notificarSemEsperar('os_pronta', {
    titulo: `✅ OS ${d.numero} pronta!`,
    corpo: `${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''} está pronto para retirada.`,
    url: './',
    tag: `os-pronta-${osId}`,
  });
}

async function avisarOrcamentoConvertido(orcNumero, osId) {
  const d = await dadosDaOs(osId);
  if (!d) return;
  const equip = nomeEquip(d);
  notificarSemEsperar('orc_convertido', {
    titulo: `🔄 Orçamento ${orcNumero} virou OS ${d.numero}`,
    corpo: `${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''}`,
    url: './',
    tag: `orc-convertido-${osId}`,
  });
}

module.exports = { chavePublica, enviarParaInscricao, avisarOsPronta, avisarOrcamentoConvertido };
