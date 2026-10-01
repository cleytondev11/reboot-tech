// ---------- NOTIFICAÇÕES PUSH (celular/navegador) ----------
// Usa o padrão Web Push (VAPID). Cada aparelho que ativar as notificações
// guarda uma "inscrição" na tabela push_subscricoes, junto com as preferências
// dele (nova OS, mudanças de status de OS e orçamento, venda realizada etc.).
// Todas as notificações de OS, orçamento e venda mostram o valor.
//
// As chaves VAPID podem vir das variáveis de ambiente VAPID_PUBLIC_KEY e
// VAPID_PRIVATE_KEY. Se não existirem, são geradas automaticamente na primeira
// vez e guardadas no próprio banco (tabela push_config) — então funciona sem
// nenhuma configuração extra, mesmo no Render (cujo disco é apagado a cada deploy).
const webpush = require('web-push');
const db = require('./db');

let pronto = null; // { publicKey } depois de inicializado

// Preferência (nome usado no app) -> coluna da tabela push_subscricoes.
const PREFS = {
  os_nova: 'notif_os_nova',
  os_status: 'notif_os_status',
  os_pronta: 'notif_os_pronta',
  orc_novo: 'notif_orc_novo',
  orc_status: 'notif_orc_status',
  orc_convertido: 'notif_orc_convertido',
  venda: 'notif_venda',
};

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

// Envia para todos os aparelhos que ativaram QUALQUER uma das preferências
// informadas (cada aparelho recebe no máximo uma notificação por evento, mesmo
// que tenha mais de uma preferência ligada). Nunca lança erro (uma falha na
// notificação jamais pode atrapalhar o salvamento da OS/orçamento/venda).
async function notificar(chaves, payload) {
  try {
    const colunas = chaves.map((k) => PREFS[k]).filter(Boolean);
    if (!colunas.length) return;
    await inicializar();
    const where = colunas.map((c) => `${c} = 1`).join(' OR ');
    const subs = await db.all(`SELECT * FROM push_subscricoes WHERE ${where}`);
    await Promise.allSettled(subs.map((s) => enviarParaInscricao(s, payload)));
  } catch (err) {
    console.error('[Push] erro ao notificar:', err && err.message);
  }
}

// Dispara sem esperar (não atrasa a resposta pro usuário).
function notificarSemEsperar(chaves, payload) {
  notificar(chaves, payload).catch(() => {});
}

// "R$ 1.234,50" (formatação manual: não depende do suporte a idiomas do Node).
function brl(valor) {
  const n = Number(valor) || 0;
  const [inteiro, dec] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}

// Orçamento/OS recém-criados podem ainda estar sem valor definido.
function textoValor(valor) {
  return Number(valor) > 0 ? `💰 ${brl(valor)}` : '💰 Valor a definir';
}

const EMOJI_STATUS_OS = {
  'Recebido': '📥', 'Em análise': '🔍', 'Aguardando orçamento': '📝', 'Orçamento enviado': '📤',
  'Aguardando aprovação': '⏳', 'Aguardando peça': '📦', 'Em manutenção': '🔧', 'Teste': '🧪',
  'Pronto': '✅', 'Entregue': '🏁', 'Cancelado': '❌',
};
const EMOJI_STATUS_ORC = {
  'Pendente': '⏳', 'Enviado': '📤', 'Aprovado': '✅', 'Recusado': '❌', 'Expirado': '⌛', 'Convertido': '🔄',
};

async function dadosDaOs(osId) {
  return db.get(
    `SELECT os.numero, os.valor_total, c.nome AS cliente, e.marca, e.modelo
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos e ON e.id = os.equipamento_id
     WHERE os.id = ?`,
    [osId]
  );
}

async function dadosDoOrcamento(orcId) {
  return db.get(
    `SELECT o.numero, o.valor_total, c.nome AS cliente, e.marca, e.modelo
     FROM orcamentos o
     LEFT JOIN clientes c ON c.id = o.cliente_id
     LEFT JOIN equipamentos e ON e.id = o.equipamento_id
     WHERE o.id = ?`,
    [orcId]
  );
}

async function dadosDaVenda(vendaId) {
  return db.get(
    `SELECT v.numero, v.valor_total, v.forma_pagamento, v.itens, c.nome AS cliente
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.id = ?`,
    [vendaId]
  );
}

function nomeEquip(d) {
  return [d && d.marca, d && d.modelo].filter(Boolean).join(' ');
}

// "💰 R$ 250,00 · João — iPhone 11"
function corpoOs(d) {
  const equip = nomeEquip(d);
  return `${textoValor(d.valor_total)} · ${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''}`;
}

// OS nova (já criada com o status informado). Se já nasceu "Pronto", quem
// pediu o aviso de "OS pronta" também recebe.
async function avisarOsNova(osId, status) {
  try {
    const d = await dadosDaOs(osId);
    if (!d) return;
    const chaves = ['os_nova'];
    if (status === 'Pronto') chaves.push('os_pronta');
    const extra = status && status !== 'Recebido' ? ` • ${status}` : '';
    notificarSemEsperar(chaves, {
      titulo: `📥 ${d.numero} aberta${extra}`,
      corpo: corpoOs(d),
      url: './',
      tag: `os-${osId}`,
    });
  } catch (err) { console.error('[Push] avisarOsNova:', err && err.message); }
}

// Qualquer mudança de status da OS. Quem ligou "todas as mudanças" recebe
// sempre; quem ligou só "OS pronta" recebe apenas quando vira Pronto.
async function avisarOsStatus(osId, statusAnterior, statusNovo) {
  try {
    if (!statusNovo || statusAnterior === statusNovo) return;
    const d = await dadosDaOs(osId);
    if (!d) return;
    const chaves = ['os_status'];
    if (statusNovo === 'Pronto') chaves.push('os_pronta');
    const emoji = EMOJI_STATUS_OS[statusNovo] || '🔔';
    const titulo = statusNovo === 'Pronto'
      ? `✅ ${d.numero} pronta para retirada!`
      : `${emoji} ${d.numero}: ${statusNovo}`;
    notificarSemEsperar(chaves, {
      titulo,
      corpo: corpoOs(d),
      url: './',
      tag: `os-${osId}`,
    });
  } catch (err) { console.error('[Push] avisarOsStatus:', err && err.message); }
}

// Orçamento novo.
async function avisarOrcamentoNovo(orcId) {
  try {
    const d = await dadosDoOrcamento(orcId);
    if (!d) return;
    const equip = nomeEquip(d);
    notificarSemEsperar(['orc_novo'], {
      titulo: `📝 Novo orçamento ${d.numero}`,
      corpo: `${textoValor(d.valor_total)} · ${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''}`,
      url: './',
      tag: `orc-${orcId}`,
    });
  } catch (err) { console.error('[Push] avisarOrcamentoNovo:', err && err.message); }
}

// Qualquer mudança de status do orçamento (Enviado, Aprovado, Recusado, Expirado...).
async function avisarOrcamentoStatus(orcId, statusAnterior, statusNovo) {
  try {
    if (!statusNovo || statusAnterior === statusNovo) return;
    const d = await dadosDoOrcamento(orcId);
    if (!d) return;
    const equip = nomeEquip(d);
    notificarSemEsperar(['orc_status'], {
      titulo: `${EMOJI_STATUS_ORC[statusNovo] || '🔔'} Orçamento ${d.numero}: ${statusNovo}`,
      corpo: `${textoValor(d.valor_total)} · ${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''}`,
      url: './',
      tag: `orc-${orcId}`,
    });
  } catch (err) { console.error('[Push] avisarOrcamentoStatus:', err && err.message); }
}

// Orçamento convertido em OS. Quem ligou "todas as mudanças de orçamento"
// também recebe (uma única notificação por aparelho).
async function avisarOrcamentoConvertido(orcId, osId) {
  try {
    const d = await dadosDaOs(osId);
    if (!d) return;
    const orc = await dadosDoOrcamento(orcId);
    const equip = nomeEquip(d);
    notificarSemEsperar(['orc_convertido', 'orc_status'], {
      titulo: `🔄 Orçamento ${orc ? orc.numero + ' ' : ''}virou ${d.numero}`,
      corpo: corpoOs(d),
      url: './',
      tag: `orc-${orcId}`,
    });
  } catch (err) { console.error('[Push] avisarOrcamentoConvertido:', err && err.message); }
}

// Venda realizada, com o valor total.
async function avisarVenda(vendaId) {
  try {
    const d = await dadosDaVenda(vendaId);
    if (!d) return;
    let qtd = 0;
    try { qtd = (JSON.parse(d.itens || '[]') || []).length; } catch (e) { qtd = 0; }
    const partes = [d.cliente || 'Cliente não informado'];
    if (qtd) partes.push(`${qtd} ${qtd === 1 ? 'item' : 'itens'}`);
    if (d.forma_pagamento) partes.push(d.forma_pagamento);
    notificarSemEsperar(['venda'], {
      titulo: `💰 Venda ${d.numero}: ${brl(d.valor_total)}`,
      corpo: partes.join(' · '),
      url: './',
      tag: `venda-${vendaId}`,
    });
  } catch (err) { console.error('[Push] avisarVenda:', err && err.message); }
}

module.exports = {
  PREFS,
  chavePublica,
  enviarParaInscricao,
  avisarOsNova,
  avisarOsStatus,
  avisarOrcamentoNovo,
  avisarOrcamentoStatus,
  avisarOrcamentoConvertido,
  avisarVenda,
};
