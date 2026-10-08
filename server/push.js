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
// O banco "principal" guarda só as chaves VAPID (iguais para todos os clientes,
// já que o site é um só). As inscrições dos aparelhos ficam no banco de CADA
// cliente — por isso todas as funções abaixo recebem o banco do cliente (db).
const dbPrincipal = require('./db');

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
  estoque_baixo: 'notif_estoque_baixo',
  contas_pagar: 'notif_contas_pagar',
};

async function inicializar() {
  if (pronto) return pronto;
  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicKey || !privateKey) {
    const salvo = await dbPrincipal.get(`SELECT valor FROM push_config WHERE chave = 'vapid'`);
    if (salvo) {
      try { ({ publicKey, privateKey } = JSON.parse(salvo.valor)); } catch (e) { publicKey = privateKey = null; }
    }
    if (!publicKey || !privateKey) {
      const novas = webpush.generateVAPIDKeys();
      publicKey = novas.publicKey;
      privateKey = novas.privateKey;
      await dbPrincipal.run(
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

async function enviarParaInscricao(db, sub, payload) {
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
async function notificar(db, chaves, payload) {
  try {
    const colunas = chaves.map((k) => PREFS[k]).filter(Boolean);
    if (!colunas.length) return;
    await inicializar();
    const where = colunas.map((c) => `${c} = 1`).join(' OR ');
    const subs = await db.all(`SELECT * FROM push_subscricoes WHERE ${where}`);
    await Promise.allSettled(subs.map((s) => enviarParaInscricao(db, s, payload)));
  } catch (err) {
    console.error('[Push] erro ao notificar:', err && err.message);
  }
}

// Dispara sem esperar (não atrasa a resposta pro usuário).
function notificarSemEsperar(db, chaves, payload) {
  notificar(db, chaves, payload).catch(() => {});
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

async function dadosDaOs(db, osId) {
  return db.get(
    `SELECT os.numero, os.valor_total, c.nome AS cliente, e.marca, e.modelo
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos e ON e.id = os.equipamento_id
     WHERE os.id = ?`,
    [osId]
  );
}

async function dadosDoOrcamento(db, orcId) {
  return db.get(
    `SELECT o.numero, o.valor_total, c.nome AS cliente, e.marca, e.modelo
     FROM orcamentos o
     LEFT JOIN clientes c ON c.id = o.cliente_id
     LEFT JOIN equipamentos e ON e.id = o.equipamento_id
     WHERE o.id = ?`,
    [orcId]
  );
}

async function dadosDaVenda(db, vendaId) {
  return db.get(
    `SELECT v.numero, v.valor_total, v.forma_pagamento, v.itens, c.nome AS cliente
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.id = ?`,
    [vendaId]
  );
}

// 2 -> "2", 1.5 -> "1,5"
function fmtQtd(n) {
  return String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');
}

// Uma linha por item vendido: "• 2x Película 3D — R$ 50,00" (até 5 itens).
function linhasItensVenda(itensJson) {
  let itens = [];
  try { itens = JSON.parse(itensJson || '[]') || []; } catch (e) { itens = []; }
  itens = itens.filter((i) => i && String(i.descricao || i.nome || '').trim());
  const MAX = 5;
  const linhas = itens.slice(0, MAX).map((i) => {
    const qtd = Number(i.quantidade) || 1;
    const total = qtd * (Number(i.valor_unit) || 0);
    const desc = String(i.descricao || i.nome).trim();
    return `• ${fmtQtd(qtd)}x ${desc}${total > 0 ? ' — ' + brl(total) : ''}`;
  });
  if (itens.length > MAX) {
    const resto = itens.length - MAX;
    linhas.push(`+ ${resto} ${resto === 1 ? 'item' : 'itens'}`);
  }
  return linhas;
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
async function avisarOsNova(db, osId, status) {
  try {
    const d = await dadosDaOs(db, osId);
    if (!d) return;
    const chaves = ['os_nova'];
    if (status === 'Pronto') chaves.push('os_pronta');
    const extra = status && status !== 'Recebido' ? ` • ${status}` : '';
    notificarSemEsperar(db, chaves, {
      titulo: `📥 ${d.numero} aberta${extra}`,
      corpo: corpoOs(d),
      url: './',
      tag: `os-${osId}`,
    });
  } catch (err) { console.error('[Push] avisarOsNova:', err && err.message); }
}

// Qualquer mudança de status da OS. Quem ligou "todas as mudanças" recebe
// sempre; quem ligou só "OS pronta" recebe apenas quando vira Pronto.
async function avisarOsStatus(db, osId, statusAnterior, statusNovo) {
  try {
    if (!statusNovo || statusAnterior === statusNovo) return;
    const d = await dadosDaOs(db, osId);
    if (!d) return;
    const chaves = ['os_status'];
    if (statusNovo === 'Pronto') chaves.push('os_pronta');
    const emoji = EMOJI_STATUS_OS[statusNovo] || '🔔';
    const titulo = statusNovo === 'Pronto'
      ? `✅ ${d.numero} pronta para retirada!`
      : `${emoji} ${d.numero}: ${statusNovo}`;
    notificarSemEsperar(db, chaves, {
      titulo,
      corpo: corpoOs(d),
      url: './',
      tag: `os-${osId}`,
      som: statusNovo === 'Pronto' ? 'pronta' : (statusNovo === 'Entregue' ? 'entregue' : undefined),
    });
  } catch (err) { console.error('[Push] avisarOsStatus:', err && err.message); }
}

// Orçamento novo.
async function avisarOrcamentoNovo(db, orcId) {
  try {
    const d = await dadosDoOrcamento(db, orcId);
    if (!d) return;
    const equip = nomeEquip(d);
    notificarSemEsperar(db, ['orc_novo'], {
      titulo: `📝 Novo orçamento ${d.numero}`,
      corpo: `${textoValor(d.valor_total)} · ${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''}`,
      url: './',
      tag: `orc-${orcId}`,
    });
  } catch (err) { console.error('[Push] avisarOrcamentoNovo:', err && err.message); }
}

// Qualquer mudança de status do orçamento (Enviado, Aprovado, Recusado, Expirado...).
async function avisarOrcamentoStatus(db, orcId, statusAnterior, statusNovo) {
  try {
    if (!statusNovo || statusAnterior === statusNovo) return;
    const d = await dadosDoOrcamento(db, orcId);
    if (!d) return;
    const equip = nomeEquip(d);
    notificarSemEsperar(db, ['orc_status'], {
      titulo: `${EMOJI_STATUS_ORC[statusNovo] || '🔔'} Orçamento ${d.numero}: ${statusNovo}`,
      corpo: `${textoValor(d.valor_total)} · ${d.cliente || 'Cliente'}${equip ? ' — ' + equip : ''}`,
      url: './',
      tag: `orc-${orcId}`,
    });
  } catch (err) { console.error('[Push] avisarOrcamentoStatus:', err && err.message); }
}

// Orçamento convertido em OS. Quem ligou "todas as mudanças de orçamento"
// também recebe (uma única notificação por aparelho).
async function avisarOrcamentoConvertido(db, orcId, osId) {
  try {
    const d = await dadosDaOs(db, osId);
    if (!d) return;
    const orc = await dadosDoOrcamento(db, orcId);
    const equip = nomeEquip(d);
    notificarSemEsperar(db, ['orc_convertido', 'orc_status'], {
      titulo: `🔄 Orçamento ${orc ? orc.numero + ' ' : ''}virou ${d.numero}`,
      corpo: corpoOs(d),
      url: './',
      tag: `orc-${orcId}`,
    });
  } catch (err) { console.error('[Push] avisarOrcamentoConvertido:', err && err.message); }
}

// Venda realizada: valor total + descrição (e valor) de cada item.
async function avisarVenda(db, vendaId) {
  try {
    const d = await dadosDaVenda(db, vendaId);
    if (!d) return;
    const linhas = linhasItensVenda(d.itens);
    const rodape = [d.cliente || 'Cliente não informado', d.forma_pagamento].filter(Boolean).join(' · ');
    notificarSemEsperar(db, ['venda'], {
      titulo: `💰 Venda ${d.numero}: ${brl(d.valor_total)}`,
      corpo: [...linhas, rodape].join('\n'),
      url: './',
      tag: `venda-${vendaId}`,
      som: 'venda',
    });
  } catch (err) { console.error('[Push] avisarVenda:', err && err.message); }
}

// Estoque: avisa só quando o produto CRUZA o mínimo (de acima para dentro/abaixo
// dele) ou acaba — não repete a cada venda enquanto continua baixo.
// Produto com mínimo 0 avisa quando zera.
async function avisarEstoqueBaixo(db, produtoId, qtdAnterior) {
  try {
    const p = await db.get('SELECT nome, quantidade, estoque_minimo, ativo FROM produtos WHERE id = ?', [produtoId]);
    if (!p || p.ativo === 0) return;
    const minimo = Number(p.estoque_minimo) || 0;
    const atual = Number(p.quantidade) || 0;
    const antes = Number(qtdAnterior) || 0;
    if (!(atual <= minimo && antes > minimo)) return;
    const acabou = atual <= 0;
    notificarSemEsperar(db, ['estoque_baixo'], {
      titulo: acabou ? `🚫 Sem estoque: ${p.nome}` : `⚠️ Estoque baixo: ${p.nome}`,
      corpo: acabou
        ? `Estoque zerado${atual < 0 ? ` (${fmtQtd(atual)})` : ''}${minimo > 0 ? ` · mínimo ${fmtQtd(minimo)}` : ''}`
        : `Restam ${fmtQtd(atual)} un. · mínimo ${fmtQtd(minimo)}`,
      url: './',
      tag: `estoque-${produtoId}`,
    });
  } catch (err) { console.error('[Push] avisarEstoqueBaixo:', err && err.message); }
}

// ---------- Contas a pagar (resumo diário) ----------
// Roda sozinho: uma vez por dia, a partir das AVISO_HORA (padrão 8h, horário
// de Brasília), avisa as despesas pendentes atrasadas, que vencem hoje ou amanhã.
const FUSO_HORAS = Number(process.env.FUSO_HORAS !== undefined ? process.env.FUSO_HORAS : -3);
const HORA_AVISO = Number(process.env.AVISO_HORA !== undefined ? process.env.AVISO_HORA : 8);

function dataLocal(deslocamentoDias = 0) {
  const d = new Date(Date.now() + FUSO_HORAS * 3600 * 1000 + deslocamentoDias * 86400000);
  return { iso: d.toISOString().slice(0, 10), hora: d.getUTCHours() };
}

async function verificarContasAPagar(db, { forcar = false } = {}) {
  try {
    const { iso: hoje, hora } = dataLocal(0);
    const amanha = dataLocal(1).iso;
    if (!forcar && hora < HORA_AVISO) return { enviado: false, motivo: 'ainda não é a hora do aviso' };
    const chave = `contas-pagar-${hoje}`;
    if (!forcar && await db.get('SELECT chave FROM push_avisos WHERE chave = ?', [chave])) {
      return { enviado: false, motivo: 'já avisado hoje' };
    }
    await db.run('INSERT OR REPLACE INTO push_avisos (chave, criado_em) VALUES (?, ?)', [chave, new Date().toISOString()]);

    const contas = await db.all(
      `SELECT descricao, valor, substr(data_vencimento, 1, 10) AS venc
       FROM lancamentos_financeiros
       WHERE tipo = 'despesa' AND status = 'Pendente'
         AND data_vencimento IS NOT NULL AND data_vencimento <> ''
         AND substr(data_vencimento, 1, 10) <= ?
       ORDER BY venc ASC, id ASC`,
      [amanha]
    );
    if (!contas.length) return { enviado: false, motivo: 'nenhuma conta para avisar' };

    const atrasadas = contas.filter((c) => c.venc < hoje);
    const deHoje = contas.filter((c) => c.venc === hoje);
    const deAmanha = contas.filter((c) => c.venc === amanha);
    const partes = [];
    if (atrasadas.length) partes.push(`${atrasadas.length} atrasada${atrasadas.length > 1 ? 's' : ''}`);
    if (deHoje.length) partes.push(`${deHoje.length} ${deHoje.length > 1 ? 'vencem' : 'vence'} hoje`);
    if (deAmanha.length) partes.push(`${deAmanha.length} ${deAmanha.length > 1 ? 'vencem' : 'vence'} amanhã`);

    const quando = (venc) => {
      if (venc === hoje) return 'hoje';
      if (venc === amanha) return 'amanhã';
      const dias = Math.round((Date.parse(hoje) - Date.parse(venc)) / 86400000);
      return `atrasada há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    };
    const MAX = 5;
    const linhas = contas.slice(0, MAX).map((c) => `• ${c.descricao} — ${brl(c.valor)} (${quando(c.venc)})`);
    if (contas.length > MAX) linhas.push(`+ ${contas.length - MAX} ${contas.length - MAX === 1 ? 'conta' : 'contas'}`);
    const total = contas.reduce((soma, c) => soma + (Number(c.valor) || 0), 0);
    linhas.push(`Total: ${brl(total)}`);

    await notificar(db, ['contas_pagar'], {
      titulo: `💸 Contas a pagar: ${partes.join(' · ')}`,
      corpo: linhas.join('\n'),
      url: './',
      tag: 'contas-pagar',
    });
    return { enviado: true, contas: contas.length, total };
  } catch (err) {
    console.error('[Push] verificarContasAPagar:', err && err.message);
    return { enviado: false, motivo: 'erro: ' + (err && err.message) };
  }
}

// Confere TODOS os clientes ativos. `listarBancos` é uma função que devolve
// [{ id, abrir: () => Promise<db> }] (veja index.js). Cada cliente é avisado no
// máximo uma vez por dia; a memória abaixo evita nem consultar o banco de quem
// já foi avisado hoje.
const avisadosHoje = new Map(); // clienteId -> 'YYYY-MM-DD'

async function verificarTodosOsClientes(listarBancos, { forcar = false } = {}) {
  const hoje = dataLocal(0).iso;
  const resultado = { clientes: 0, enviados: 0 };
  try {
    const lista = await listarBancos();
    for (const c of lista) {
      if (!forcar && avisadosHoje.get(c.id) === hoje) continue;
      try {
        const db = await c.abrir();
        const r = await verificarContasAPagar(db, { forcar });
        resultado.clientes++;
        if (r.enviado) resultado.enviados++;
        // "já avisado hoje" ou "sem contas" = nada mais a fazer hoje para esse cliente
        if (r.enviado || r.motivo === 'já avisado hoje' || r.motivo === 'nenhuma conta para avisar') avisadosHoje.set(c.id, hoje);
      } catch (err) {
        console.error(`[Push] cliente ${c.id}:`, err && err.message);
      }
    }
  } catch (err) {
    console.error('[Push] verificarTodosOsClientes:', err && err.message);
  }
  return resultado;
}

// Confere ao ligar o servidor e depois a cada 30 minutos (o aviso do dia só sai uma vez).
function iniciarAvisosFinanceiros(listarBancos) {
  const rodar = () => { verificarTodosOsClientes(listarBancos).catch(() => {}); };
  const t1 = setTimeout(rodar, 60 * 1000);
  const t2 = setInterval(rodar, 30 * 60 * 1000);
  if (t1.unref) t1.unref();
  if (t2.unref) t2.unref();
}

// ---- Aparelhos do DONO inscritos pela Central de Acessos (/admin) ----
async function garantirTabelaAdmin() {
  await dbPrincipal.run(`CREATE TABLE IF NOT EXISTS push_admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    criado_em TEXT
  )`);
}
async function inscreverAdmin(sub) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) throw Object.assign(new Error('Inscrição inválida.'), { status: 400 });
  await garantirTabelaAdmin();
  await dbPrincipal.run(
    `INSERT INTO push_admin (endpoint, p256dh, auth, criado_em) VALUES (?,?,?,?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, new Date().toISOString()]
  );
}
async function removerAdmin(endpoint) {
  await garantirTabelaAdmin();
  await dbPrincipal.run('DELETE FROM push_admin WHERE endpoint = ?', [String(endpoint || '')]);
}

// Avisa o DONO: aparelhos inscritos na Central de Acessos + administradores do banco principal
// que ativaram as notificações no app. Nunca lança erro. Retorna quantos aparelhos receberam.
async function avisarDono(titulo, corpo) {
  try {
    await inicializar();
    await garantirTabelaAdmin();
    const payload = { titulo, corpo, url: './', tag: 'dono-' + Date.now() };
    let ok = 0;
    const adm = await dbPrincipal.all('SELECT * FROM push_admin');
    await Promise.allSettled(adm.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...payload, url: '/admin' }), { TTL: 60 * 60 * 24 });
        ok++;
      } catch (err) {
        if (err && (err.statusCode === 404 || err.statusCode === 410)) await dbPrincipal.run('DELETE FROM push_admin WHERE id = ?', [s.id]).catch(() => {});
        else console.error('[Push] admin:', err && (err.statusCode || err.message));
      }
    }));
    let subs = [];
    try {
      subs = await dbPrincipal.all(`SELECT s.* FROM push_subscricoes s JOIN usuarios u ON u.id = s.usuario_id WHERE u.papel = 'Administrador'`);
    } catch (e) { /* sem usuários no principal */ }
    const vistos = new Set(adm.map((a) => a.endpoint));
    const outros = subs.filter((s) => !vistos.has(s.endpoint));
    const r = await Promise.all(outros.map((s) => enviarParaInscricao(dbPrincipal, s, payload)));
    ok += r.filter(Boolean).length;
    return ok;
  } catch (err) {
    console.error('[Push] avisarDono:', err && err.message);
    return 0;
  }
}

// Avisa o dono quando falta 5 dias (ou menos) para o vencimento de um cliente. Um aviso por vencimento.
// Roda de tempos em tempos (como o servidor pode dormir no plano grátis, vale de 5 a 1 dia antes).
async function verificarVencimentos(listarClientes) {
  try {
    const { iso: hoje, hora } = dataLocal(0);
    if (hora < HORA_AVISO) return 0;
    const clientes = await listarClientes();
    let enviados = 0;
    for (const c of clientes) {
      if (c.principal || !c.ativo || !c.dataVencimento) continue;
      const dias = Math.round((Date.parse(c.dataVencimento + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 86400000);
      if (dias < 1 || dias > 5) continue;
      const chave = `venc5-${c.id}-${c.dataVencimento}`;
      if (await dbPrincipal.get('SELECT chave FROM push_avisos WHERE chave = ?', [chave])) continue;
      await dbPrincipal.run('INSERT OR REPLACE INTO push_avisos (chave, criado_em) VALUES (?, ?)', [chave, new Date().toISOString()]);
      const [a, m, d] = c.dataVencimento.split('-');
      await avisarDono(
        `⏰ ${c.nome}: vence em ${dias} dia${dias === 1 ? '' : 's'}`,
        `${c.teste ? 'Teste grátis' : 'Plano'} vence em ${d}/${m}/${a}.${c.contatoTelefone ? '\nWhatsApp: ' + c.contatoTelefone : ''}\nO acesso é bloqueado depois dessa data.`
      );
      enviados++;
    }
    return enviados;
  } catch (err) {
    console.error('[Push] verificarVencimentos:', err && err.message);
    return 0;
  }
}

module.exports = {
  PREFS,
  avisarDono,
  inscreverAdmin,
  removerAdmin,
  verificarVencimentos,
  chavePublica,
  enviarParaInscricao,
  avisarOsNova,
  avisarOsStatus,
  avisarOrcamentoNovo,
  avisarOrcamentoStatus,
  avisarOrcamentoConvertido,
  avisarVenda,
  avisarEstoqueBaixo,
  verificarContasAPagar,
  verificarTodosOsClientes,
  iniciarAvisosFinanceiros,
};
