// Renovação do plano por Pix pelo Asaas (cobrança única por cliente, confirmação automática).
//
// Variáveis: ASAAS_API_KEY (chave de API da conta Asaas), ASAAS_WEBHOOK_TOKEN (senha do webhook),
// ASAAS_AMBIENTE=sandbox (opcional, para testar sem dinheiro de verdade) e PUBLIC_URL (opcional).
//
// Fluxo: tela de login bloqueada (ou "Renovar plano" dentro do sistema) → POST /api/pagamento/pix
//        → Asaas cria cliente + cobrança Pix → QR Code e copia e cola
//        → Asaas avisa em POST /api/pagamento/webhook (e a tela também consulta GET /api/pagamento/status/:id)
//        → pagamento recebido renova o plano na hora, uma única vez.
const crypto = require('crypto');
const express = require('express');
const tenants = require('./tenants');
const push = require('./push');
const { authMiddleware } = require('./auth');

const router = express.Router();
const UA = 'RebootTechSystem/1.0';
function apiBase() { return process.env.ASAAS_AMBIENTE === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3'; }

// Planos (o valor é definido AQUI, nunca pelo navegador).
const PLANOS = {
  mensal: { nome: 'Mensal', valor: 39.9, dias: 30 },
  trimestral: { nome: 'Trimestral', valor: 99.7, dias: 90 },
  anual: { nome: 'Anual', valor: 319.99, dias: 365 },
};

function token() { return process.env.ASAAS_API_KEY || ''; }
function ativo() { return !!token(); }

async function asaas(metodo, caminho, corpo) {
  const resp = await fetch(apiBase() + caminho, {
    method: metodo,
    headers: { access_token: token(), 'Content-Type': 'application/json', 'User-Agent': UA },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const desc = json && Array.isArray(json.errors) && json.errors[0] && json.errors[0].description;
    const e = new Error(desc || ('Asaas respondeu ' + resp.status));
    // erro de dados (ex.: CPF inválido) volta para o cliente; erro de chave/servidor vira mensagem genérica
    e.status = resp.status === 400 ? 400 : 502; e.detalhe = json; throw e;
  }
  return json;
}

function baseUrl(req) {
  const fixa = process.env.PUBLIC_URL;
  if (fixa) return fixa.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

// Assinatura do id do pagamento: só quem criou o Pix consegue consultar o status.
function assinar(id) {
  const chave = process.env.ADMIN_SENHA || process.env.JWT_SECRET || token() || 'reboot';
  return crypto.createHmac('sha256', chave).update('pag:' + id).digest('hex').slice(0, 24);
}

// limite por IP: 10 pagamentos gerados por hora
const tentativas = new Map();
function limitado(ip) {
  const agora = Date.now();
  const lista = (tentativas.get(ip) || []).filter((t) => agora - t < 3600 * 1000);
  if (lista.length >= 10) { tentativas.set(ip, lista); return true; }
  lista.push(agora); tentativas.set(ip, lista);
  return false;
}

const CICLOS = { mensal: 'MONTHLY', trimestral: 'QUARTERLY', anual: 'YEARLY' };
const PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];

// Aplica um pagamento aprovado: renova o plano uma única vez e avisa o dono.
async function aplicarPagamento(pagamento) {
  if (!pagamento || !PAGO.includes(pagamento.status)) return { aplicado: false, motivo: 'nao_aprovado' };
  let ref = String(pagamento.externalReference || '');
  // Cobrança de assinatura (cartão recorrente): a referência pode estar só na assinatura.
  if (!/^rt:/.test(ref) && pagamento.subscription) {
    try { const ass = await asaas('GET', '/subscriptions/' + encodeURIComponent(pagamento.subscription)); ref = String((ass && ass.externalReference) || ''); } catch (e) { /* segue sem referência */ }
  }
  const m = ref.match(/^rt:(\d+):(mensal|trimestral|anual):/);
  if (!m) return { aplicado: false, motivo: 'referencia' };
  const clienteId = Number(m[1]); const plano = PLANOS[m[2]];
  if (Math.abs(Number(pagamento.value) - plano.valor) > 0.009) return { aplicado: false, motivo: 'valor' };
  const novo = await tenants.registrarPagamento(pagamento.id, clienteId, m[2], plano.valor, pagamento.billingType);
  if (!novo) return { aplicado: false, motivo: 'ja_processado' };
  const r = await tenants.renovarPlano(clienteId, plano.dias);
  try { await tenants.marcarPagamentoAte(pagamento.id, r.dataVencimento); } catch (e) { /* só para o histórico */ }
  try {
    const c = await tenants.buscarCliente(clienteId);
    push.avisarDono('💰 Pagamento recebido: ' + (c ? c.nome : 'cliente ' + clienteId), 'Plano ' + plano.nome + ' · R$ ' + plano.valor.toFixed(2).replace('.', ',') + ' · acesso liberado até ' + r.dataVencimento.split('-').reverse().join('/')).catch(() => {});
  } catch (e) { /* aviso é opcional */ }
  return { aplicado: true, dataVencimento: r.dataVencimento };
}

router.get('/config', (req, res) => {
  res.json({ ok: true, ativo: ativo(), planos: Object.entries(PLANOS).map(([id, p]) => ({ id, nome: p.nome, valor: p.valor, dias: p.dias })) });
});

function limparDoc(v) { return String(v || '').replace(/\D/g, ''); }

function hojeBrasil() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Acha (ou cria) o cliente no Asaas. O CPF/CNPJ é exigido por eles para gerar a cobrança.
async function clienteAsaas(cliente, doc) {
  const ext = 'rt:' + cliente.id;
  const achados = await asaas('GET', '/customers?externalReference=' + encodeURIComponent(ext) + '&limit=1');
  if (achados && achados.data && achados.data[0]) {
    const c = achados.data[0];
    if (doc && limparDoc(c.cpfCnpj) !== doc) { try { await asaas('PUT', '/customers/' + c.id, { cpfCnpj: doc }); } catch (e) { /* segue com o cadastro atual */ } }
    return c.id;
  }
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cliente.contato_email || '') ? cliente.contato_email : undefined;
  const novo = await asaas('POST', '/customers', { name: cliente.nome || ('Cliente ' + cliente.id), cpfCnpj: doc, email, externalReference: ext, notificationDisabled: true });
  return novo.id;
}

// Cria a cobrança no Asaas para um cliente já identificado.
// metodo: 'pix' (QR Code), 'cartao' (cartão avulso) ou 'recorrente' (cartão, renova sozinho a cada ciclo).
// No cartão, quem digita os dados é o cliente, na página segura do Asaas (nunca passamos pelo nosso servidor).
async function criarPix(req, cliente, planoId, docInformado, metodo = 'pix') {
  const plano = PLANOS[planoId];
  const doc = limparDoc(docInformado) || limparDoc(cliente.cpf_cnpj);
  if (doc.length !== 11 && doc.length !== 14) throw Object.assign(new Error('Informe o CPF ou CNPJ de quem vai pagar (somente números).'), { status: 400 });
  const customer = await clienteAsaas(cliente, doc);
  const descricao = `Reboot Tech System - plano ${plano.nome.toLowerCase()}`;
  const referencia = `rt:${cliente.id}:${planoId}:${Date.now()}`;
  const salvarDoc = async () => { if (doc !== limparDoc(cliente.cpf_cnpj)) { try { await tenants.salvarCpfCnpj(cliente.id, doc); } catch (e) { /* opcional */ } } };
  const base = { ok: true, valor: plano.valor, plano: plano.nome, cpfCnpj: doc, metodo };

  if (metodo === 'recorrente') {
    const ass = await asaas('POST', '/subscriptions', {
      customer, billingType: 'CREDIT_CARD', value: plano.valor, nextDueDate: hojeBrasil(), cycle: CICLOS[planoId],
      description: descricao, externalReference: referencia,
    });
    let cobr = null;
    for (let i = 0; i < 4 && !cobr; i++) {
      const lista = await asaas('GET', '/subscriptions/' + encodeURIComponent(ass.id) + '/payments');
      cobr = lista && lista.data && lista.data[0];
      if (!cobr) await new Promise((r) => setTimeout(r, 800));
    }
    if (!cobr || !cobr.invoiceUrl) throw Object.assign(new Error('O Asaas não devolveu a página de pagamento.'), { status: 502 });
    await salvarDoc();
    return { ...base, id: String(cobr.id), t: assinar(cobr.id), url: cobr.invoiceUrl };
  }

  const pag = await asaas('POST', '/payments', {
    customer, billingType: metodo === 'cartao' ? 'CREDIT_CARD' : 'PIX', value: plano.valor, dueDate: hojeBrasil(),
    description: descricao, externalReference: referencia,
  });
  if (metodo === 'cartao') {
    if (!pag.invoiceUrl) throw Object.assign(new Error('O Asaas não devolveu a página de pagamento.'), { status: 502 });
    await salvarDoc();
    return { ...base, id: String(pag.id), t: assinar(pag.id), url: pag.invoiceUrl };
  }
  const qr = await asaas('GET', '/payments/' + encodeURIComponent(pag.id) + '/pixQrCode');
  if (!qr || !qr.payload) throw Object.assign(new Error('O Asaas não devolveu o código Pix.'), { status: 502 });
  await salvarDoc();
  return { ...base, id: String(pag.id), t: assinar(pag.id), qrCode: qr.payload, qrBase64: qr.encodedImage || '' };
}

function ipDe(req) {
  return req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.ip;
}

function erroPix(res, err, rotulo) {
  console.error('[Pagamento] ' + rotulo + ':', err && err.message, err && err.detalhe ? JSON.stringify(err.detalhe).slice(0, 400) : '');
  res.status(err.status || 500).json({ ok: false, error: err.status && err.status < 500 ? err.message : 'Não foi possível gerar o pagamento agora. Tente de novo ou use o Pix pelo site.' });
}

// Gera o Pix de renovação na tela de login. Exige login e senha corretos (o plano pode estar vencido).
router.post('/pix', async (req, res) => {
  try {
    if (!ativo()) return res.status(503).json({ ok: false, error: 'Pagamento automático indisponível no momento.' });
    const b = req.body || {};
    if (limitado(ipDe(req))) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tente novamente mais tarde.' });
    if (!PLANOS[b.plano]) return res.status(400).json({ ok: false, error: 'Plano inválido.' });
    const cliente = await tenants.identificarCliente(b.usuario, b.senha);
    if (!cliente) return res.status(401).json({ ok: false, error: 'Usuário ou senha incorretos.' });
    res.json(await criarPix(req, cliente, b.plano, b.cpfCnpj, ['cartao', 'recorrente'].includes(b.metodo) ? b.metodo : 'pix'));
  } catch (err) { erroPix(res, err, 'pix'); }
});

// Gera o Pix de renovação para quem já está dentro do sistema (usa a sessão, sem pedir a senha).
router.post('/pix-logado', authMiddleware, async (req, res) => {
  try {
    if (!ativo()) return res.status(503).json({ ok: false, error: 'Pagamento automático indisponível no momento.' });
    const b = req.body || {};
    if (limitado(ipDe(req))) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tente novamente mais tarde.' });
    if (!PLANOS[b.plano]) return res.status(400).json({ ok: false, error: 'Plano inválido.' });
    const cliente = await tenants.buscarCliente(tenants.clienteIdDe(req));
    if (!cliente) return res.status(404).json({ ok: false, error: 'Cliente não encontrado.' });
    if (cliente.principal) return res.status(400).json({ ok: false, error: 'Este acesso não tem plano a renovar.' });
    res.json(await criarPix(req, cliente, b.plano, b.cpfCnpj, ['cartao', 'recorrente'].includes(b.metodo) ? b.metodo : 'pix'));
  } catch (err) { erroPix(res, err, 'pix-logado'); }
});

// ---------- assinatura no cartão: ver e cancelar (quem já está dentro do sistema) ----------
const CICLO_NOME = { MONTHLY: 'mensal', QUARTERLY: 'trimestral', YEARLY: 'anual' };

async function assinaturaAtiva(cliente) {
  const achados = await asaas('GET', '/customers?externalReference=' + encodeURIComponent('rt:' + cliente.id) + '&limit=1');
  const cus = achados && achados.data && achados.data[0];
  if (!cus) return null;
  const lista = await asaas('GET', '/subscriptions?customer=' + encodeURIComponent(cus.id) + '&status=ACTIVE&limit=10');
  return ((lista && lista.data) || []).find((a) => /^rt:/.test(String(a.externalReference || ''))) || null;
}

async function clienteLogado(req) {
  const cliente = await tenants.buscarCliente(tenants.clienteIdDe(req));
  return cliente && !cliente.principal ? cliente : null;
}

// Histórico de pagamentos do cliente que está logado.
router.get('/historico', authMiddleware, async (req, res) => {
  try {
    const cliente = await clienteLogado(req);
    const linhas = cliente ? await tenants.listarPagamentos(cliente.id) : [];
    res.json({ ok: true, pagamentos: linhas.map((l) => ({
      id: l.id, plano: PLANOS[l.plano] ? PLANOS[l.plano].nome : (l.plano || ''), valor: Number(l.valor) || 0,
      data: l.criado_em || '', forma: l.forma === 'CREDIT_CARD' ? 'Cartão' : l.forma === 'PIX' ? 'Pix' : '', ate: l.ate || '',
    })) });
  } catch (err) {
    console.error('[Pagamento] historico:', err && err.message);
    res.json({ ok: true, pagamentos: [] });
  }
});

router.get('/assinatura', authMiddleware, async (req, res) => {
  try {
    if (!ativo()) return res.json({ ok: true, ativa: false });
    const cliente = await clienteLogado(req);
    const a = cliente ? await assinaturaAtiva(cliente) : null;
    if (!a) return res.json({ ok: true, ativa: false });
    res.json({ ok: true, ativa: true, ciclo: CICLO_NOME[a.cycle] || '', valor: a.value, proximoVencimento: a.nextDueDate || '' });
  } catch (err) {
    console.error('[Pagamento] assinatura:', err && err.message);
    res.json({ ok: true, ativa: false });
  }
});

router.post('/assinatura/cancelar', authMiddleware, async (req, res) => {
  try {
    if (!ativo()) return res.status(503).json({ ok: false, error: 'Pagamento automático indisponível no momento.' });
    const cliente = await clienteLogado(req);
    const a = cliente ? await assinaturaAtiva(cliente) : null;
    if (!a) return res.status(404).json({ ok: false, error: 'Nenhuma assinatura ativa encontrada.' });
    await asaas('DELETE', '/subscriptions/' + encodeURIComponent(a.id));
    try { push.avisarDono('🔁 Assinatura cancelada: ' + (cliente.nome || 'cliente ' + cliente.id), 'O cliente cancelou a cobrança recorrente no cartão.').catch(() => {}); } catch (e) { /* aviso é opcional */ }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Pagamento] cancelar:', err && err.message);
    res.status(500).json({ ok: false, error: 'Não foi possível cancelar agora. Tente de novo ou fale com o suporte.' });
  }
});

// A tela consulta de tempos em tempos; se o Asaas já recebeu, libera na hora.
router.get('/status/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').replace(/[^A-Za-z0-9_]/g, '');
    const t = String(req.query.t || '');
    const esperado = Buffer.from(assinar(id)); const recebido = Buffer.from(t);
    if (!id || esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return res.status(403).json({ ok: false, error: 'Consulta inválida.' });
    const pag = await asaas('GET', '/payments/' + id);
    const r = await aplicarPagamento(pag);
    res.json({ ok: true, status: pag.status, liberado: PAGO.includes(pag.status) && (r.aplicado || r.motivo === 'ja_processado') });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Não foi possível consultar o pagamento.' });
  }
});

// Aviso do Asaas. Confere a senha do webhook e busca o pagamento direto na API (não confia no corpo).
router.post('/webhook', async (req, res) => {
  try {
    const esperado = process.env.ASAAS_WEBHOOK_TOKEN || '';
    const recebido = String(req.headers['asaas-access-token'] || '');
    const okToken = !esperado || (Buffer.byteLength(esperado) === Buffer.byteLength(recebido) && crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido)));
    const b = req.body || {};
    const id = b.payment && b.payment.id;
    if (ativo() && okToken && /^PAYMENT_(RECEIVED|CONFIRMED)$/.test(String(b.event || '')) && id) {
      const pag = await asaas('GET', '/payments/' + encodeURIComponent(id));
      await aplicarPagamento(pag);
    }
  } catch (err) {
    console.error('[Pagamento] webhook:', err && err.message);
  }
  res.status(200).json({ ok: true }); // sempre 200, para o Asaas não pausar a fila de avisos
});

module.exports = { router, aplicarPagamento, PLANOS };
