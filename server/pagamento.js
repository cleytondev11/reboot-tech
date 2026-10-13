// Renovação do plano por Pix pelo Mercado Pago (cobrança única por cliente, confirmação automática).
//
// Precisa da variável MP_ACCESS_TOKEN (Access Token de PRODUÇÃO da conta Mercado Pago).
// Opcionais: PUBLIC_URL (endereço público do sistema, para o aviso do Mercado Pago) e MP_WEBHOOK_SECRET.
//
// Fluxo: tela de login bloqueada → POST /api/pagamento/pix (login+senha+plano) → Pix (QR + copia e cola)
//        → Mercado Pago avisa em POST /api/pagamento/webhook (e a tela também consulta GET /api/pagamento/status/:id)
//        → pagamento "approved" renova o plano na hora, uma única vez.
const crypto = require('crypto');
const express = require('express');
const tenants = require('./tenants');
const push = require('./push');

const router = express.Router();
const API = 'https://api.mercadopago.com';

// Planos (o valor é definido AQUI, nunca pelo navegador).
const PLANOS = {
  mensal: { nome: 'Mensal', valor: 39.9, dias: 30 },
  trimestral: { nome: 'Trimestral', valor: 99.7, dias: 90 },
  anual: { nome: 'Anual', valor: 319.99, dias: 365 },
};

function token() { return process.env.MP_ACCESS_TOKEN || ''; }
function ativo() { return !!token(); }

async function mp(metodo, caminho, corpo, extra = {}) {
  const resp = await fetch(API + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json', ...extra },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error((json && (json.message || json.error)) || ('Mercado Pago respondeu ' + resp.status));
    e.status = 502; e.detalhe = json; throw e;
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

// Aplica um pagamento aprovado: renova o plano uma única vez e avisa o dono.
async function aplicarPagamento(pagamento) {
  if (!pagamento || pagamento.status !== 'approved') return { aplicado: false, motivo: 'nao_aprovado' };
  const ref = String(pagamento.external_reference || '');
  const m = ref.match(/^rt:(\d+):(mensal|trimestral|anual):/);
  if (!m) return { aplicado: false, motivo: 'referencia' };
  const clienteId = Number(m[1]); const plano = PLANOS[m[2]];
  if (Math.abs(Number(pagamento.transaction_amount) - plano.valor) > 0.009) return { aplicado: false, motivo: 'valor' };
  const novo = await tenants.registrarPagamento(pagamento.id, clienteId, m[2], plano.valor);
  if (!novo) return { aplicado: false, motivo: 'ja_processado' };
  const r = await tenants.renovarPlano(clienteId, plano.dias);
  try {
    const c = await tenants.buscarCliente(clienteId);
    push.avisarDono('💰 Pagamento recebido: ' + (c ? c.nome : 'cliente ' + clienteId), 'Plano ' + plano.nome + ' · R$ ' + plano.valor.toFixed(2).replace('.', ',') + ' · acesso liberado até ' + r.dataVencimento.split('-').reverse().join('/')).catch(() => {});
  } catch (e) { /* aviso é opcional */ }
  return { aplicado: true, dataVencimento: r.dataVencimento };
}

router.get('/config', (req, res) => {
  res.json({ ok: true, ativo: ativo(), planos: Object.entries(PLANOS).map(([id, p]) => ({ id, nome: p.nome, valor: p.valor, dias: p.dias })) });
});

// Gera o Pix de renovação. Exige login e senha corretos (o plano pode estar vencido).
router.post('/pix', async (req, res) => {
  try {
    if (!ativo()) return res.status(503).json({ ok: false, error: 'Pagamento automático indisponível no momento.' });
    const b = req.body || {};
    const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.ip;
    if (limitado(ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tente novamente mais tarde.' });
    const plano = PLANOS[b.plano];
    if (!plano) return res.status(400).json({ ok: false, error: 'Plano inválido.' });
    const cliente = await tenants.identificarCliente(b.usuario, b.senha);
    if (!cliente) return res.status(401).json({ ok: false, error: 'Usuário ou senha incorretos.' });

    const email = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cliente.contato_email || '') ? cliente.contato_email : `cliente${cliente.id}@reboottechsystem.com`;
    const ref = `rt:${cliente.id}:${b.plano}:${Date.now()}`;
    const pag = await mp('POST', '/v1/payments', {
      transaction_amount: plano.valor,
      description: `Reboot Tech System - plano ${plano.nome.toLowerCase()}`,
      payment_method_id: 'pix',
      payer: { email },
      external_reference: ref,
      notification_url: baseUrl(req) + '/api/pagamento/webhook',
      date_of_expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString().replace('Z', '+00:00'),
    }, { 'X-Idempotency-Key': crypto.randomUUID() });

    const td = pag.point_of_interaction && pag.point_of_interaction.transaction_data;
    if (!td || !td.qr_code) throw Object.assign(new Error('O Mercado Pago não devolveu o código Pix.'), { status: 502 });
    res.json({ ok: true, id: String(pag.id), t: assinar(pag.id), valor: plano.valor, plano: plano.nome, qrCode: td.qr_code, qrBase64: td.qr_code_base64 || '' });
  } catch (err) {
    console.error('[Pagamento] pix:', err && err.message, err && err.detalhe ? JSON.stringify(err.detalhe).slice(0, 400) : '');
    res.status(err.status || 500).json({ ok: false, error: err.status && err.status < 500 ? err.message : 'Não foi possível gerar o Pix agora. Tente de novo ou use o Pix pelo site.' });
  }
});

// A tela consulta de tempos em tempos; se o Mercado Pago já aprovou, libera na hora.
router.get('/status/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').replace(/\D/g, '');
    const t = String(req.query.t || '');
    const esperado = Buffer.from(assinar(id)); const recebido = Buffer.from(t);
    if (!id || esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return res.status(403).json({ ok: false, error: 'Consulta inválida.' });
    const pag = await mp('GET', '/v1/payments/' + id);
    const r = await aplicarPagamento(pag);
    res.json({ ok: true, status: pag.status, liberado: pag.status === 'approved' && (r.aplicado || r.motivo === 'ja_processado') });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Não foi possível consultar o pagamento.' });
  }
});

// Aviso do Mercado Pago. Não confiamos no corpo: buscamos o pagamento direto na API deles.
router.post('/webhook', async (req, res) => {
  try {
    const q = req.query || {}; const b = req.body || {};
    const tipo = b.type || q.type || q.topic;
    const id = (b.data && b.data.id) || q['data.id'] || q.id;
    if (ativo() && String(tipo) === 'payment' && id) {
      const pag = await mp('GET', '/v1/payments/' + encodeURIComponent(id));
      await aplicarPagamento(pag);
    }
  } catch (err) {
    console.error('[Pagamento] webhook:', err && err.message);
  }
  res.status(200).json({ ok: true }); // sempre 200, para o Mercado Pago não ficar reenviando
});

module.exports = { router, aplicarPagamento, PLANOS };
