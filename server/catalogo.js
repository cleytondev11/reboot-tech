// ---------- CATÁLOGO ONLINE (página pública da loja, sem login) ----------
// Cada loja tem um link próprio: <endereço>/loja/<código>. O código é "<empresa>-<assinatura>" (HMAC com o
// segredo do servidor), então ninguém adivinha o link de outra loja. O cliente final vê os produtos que a
// loja publicou, monta o carrinho no celular, finaliza o pedido e paga pelo Pix da própria loja (QR Code e
// copia e cola gerados aqui) — o pedido também vai pronto para o WhatsApp da loja.
// Preço e estoque vêm SEMPRE do banco da loja; o navegador só diz o que quer e quanto.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const tenants = require('./tenants');
const push = require('./push');
const { QRCode, QRErrorCorrectLevel } = require('./qr-lib.cjs');

const SEGREDO = process.env.JWT_SECRET || 'reboot-tech-dev';
const PAGINA = fs.readFileSync(path.join(__dirname, 'pages', 'loja.html'), 'utf8');

function assinar(clienteId) { return crypto.createHmac('sha256', SEGREDO).update(`loja:${clienteId}`).digest('hex').slice(0, 12); }
function gerarCodigo(clienteId) { return `${clienteId}-${assinar(clienteId)}`; }
function lerCodigo(codigo) {
  const m = /^(\d{1,9})-([a-f0-9]{12})$/.exec(String(codigo || ''));
  if (!m) return null;
  const clienteId = Number(m[1]);
  const a = Buffer.from(assinar(clienteId)); const b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? clienteId : null;
}
function baseUrl(req) {
  const fixa = process.env.PUBLIC_URL;
  if (fixa) return fixa.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
function linkDaLoja(req) { return `${baseUrl(req)}/loja/${gerarCodigo(tenants.clienteIdDe(req))}`; }

// ----- Pix copia e cola (padrão EMV do Banco Central) -----
function crc16(texto) {
  let crc = 0xFFFF;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function campo(id, valor) { const v = String(valor); return id + String(v.length).padStart(2, '0') + v; }
function semAcento(t) { return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim(); }
function pixPayload({ chave, nome, cidade, valor, txid }) {
  const conta = campo('00', 'BR.GOV.BCB.PIX') + campo('01', String(chave).trim());
  const adicional = campo('05', (String(txid || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25)) || '***');
  let corpo = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
  if (valor && valor > 0) corpo += campo('54', Number(valor).toFixed(2));
  corpo += campo('58', 'BR') + campo('59', semAcento(nome).slice(0, 25).toUpperCase() || 'LOJA') + campo('60', semAcento(cidade).slice(0, 15).toUpperCase() || 'BRASIL') + campo('62', adicional);
  corpo += '6304';
  return corpo + crc16(corpo);
}
function qrSvg(texto) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M); qr.addData(String(texto)); qr.make();
  const n = qr.getModuleCount(); const m = 4; const total = n + m * 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// ----- limites contra abuso -----
const hits = new Map();
function limitar(max, janelaMs) {
  return (req, res, next) => {
    const ip = req.ip || 'x'; const agora = Date.now();
    const chave = ip + req.path.split('/')[1];
    const h = (hits.get(chave) || []).filter((t) => agora - t < janelaMs); h.push(agora); hits.set(chave, h);
    if (hits.size > 8000) hits.clear();
    if (h.length > max) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde um pouco e tente de novo.' });
    next();
  };
}

async function carregarLoja(codigo) {
  const clienteId = lerCodigo(codigo);
  if (!clienteId) return null;
  const cliente = await tenants.buscarCliente(clienteId);
  if (!cliente || !cliente.ativo || tenants.planoVencido(cliente)) return null;
  const db = await tenants.bancoDoCliente(cliente);
  const cfg = await db.get('SELECT * FROM configuracoes_catalogo WHERE id = 1').catch(() => null);
  if (!cfg || !cfg.ativo) return null;
  const emp = (await db.get('SELECT nome, nome_fantasia, telefone, whatsapp, endereco, numero, bairro, cidade, uf, logo FROM configuracoes_empresa WHERE id = 1').catch(() => null)) || {};
  return { clienteId, cliente, db, cfg, emp };
}
const so = (t) => String(t || '').replace(/\D/g, '');
function nomeLoja(l) { return l.emp.nome_fantasia || l.emp.nome || l.cliente.nome || 'Loja'; }
function zap(l) { let n = so(l.emp.whatsapp || l.emp.telefone); if (n && n.length <= 11) n = '55' + n; return n; }

const router = express.Router();
router.use(express.json({ limit: '30kb' }));

router.get('/:codigo', limitar(120, 60000), async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const l = await carregarLoja(req.params.codigo);
    if (!l) return res.status(404).json({ ok: false, error: 'Este catálogo não está disponível no momento.' });
    const produtos = await l.db.all(
      `SELECT id, nome, categoria, descricao, valor_venda, quantidade,
              CASE WHEN imagem_mini IS NOT NULL AND imagem_mini <> '' THEN 1 ELSE 0 END AS foto
       FROM produtos WHERE ativo = 1 AND catalogo = 1 AND valor_venda > 0 AND quantidade > 0 ORDER BY categoria, nome LIMIT 500`
    );
    res.json({
      ok: true,
      loja: { nome: nomeLoja(l), whatsapp: zap(l), cidade: [l.emp.cidade, l.emp.uf].filter(Boolean).join(' - '), mensagem: l.cfg.mensagem || '', entregaInfo: l.cfg.entrega_info || '', logo: l.emp.logo && /^data:image\//.test(l.emp.logo) && l.emp.logo.length < 400000 ? l.emp.logo : '', pix: !!l.cfg.chave_pix },
      produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, categoria: p.categoria || '', descricao: p.descricao || '', preco: p.valor_venda, estoque: p.quantidade, foto: !!p.foto })),
    });
  } catch (err) { console.error('[Catalogo] lista:', err && err.message); res.status(500).json({ ok: false, error: 'Não foi possível carregar o catálogo.' }); }
});

router.get('/:codigo/foto/:id', limitar(600, 60000), async (req, res) => {
  try {
    const l = await carregarLoja(req.params.codigo);
    if (!l) return res.status(404).end();
    const p = await l.db.get('SELECT imagem_mini FROM produtos WHERE id = ? AND ativo = 1 AND catalogo = 1', [Number(req.params.id) || 0]);
    const m = p && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p.imagem_mini || '');
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]); res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(m[2], 'base64'));
  } catch (err) { res.status(404).end(); }
});

router.post('/:codigo/pedido', limitar(10, 3600000), async (req, res) => {
  try {
    const l = await carregarLoja(req.params.codigo);
    if (!l) return res.status(404).json({ ok: false, error: 'Este catálogo não está disponível no momento.' });
    const b = req.body || {};
    const nome = String(b.nome || '').trim().slice(0, 80);
    const whats = so(b.whatsapp);
    if (nome.length < 2) return res.status(400).json({ ok: false, error: 'Informe o seu nome.' });
    if (whats.length < 10 || whats.length > 13) return res.status(400).json({ ok: false, error: 'Informe o seu WhatsApp com DDD.' });
    const entrega = b.entrega === 'entrega' ? 'entrega' : 'retirada';
    const endereco = String(b.endereco || '').trim().slice(0, 200);
    if (entrega === 'entrega' && endereco.length < 6) return res.status(400).json({ ok: false, error: 'Informe o endereço de entrega.' });
    const pedidos = Array.isArray(b.itens) ? b.itens.slice(0, 30) : [];
    if (!pedidos.length) return res.status(400).json({ ok: false, error: 'O carrinho está vazio.' });

    const itens = []; let total = 0;
    for (const it of pedidos) {
      const id = Number(it && it.id); const qtd = Math.floor(Number(it && it.qtd));
      if (!id || !(qtd >= 1) || qtd > 99) return res.status(400).json({ ok: false, error: 'Item inválido no carrinho.' });
      const p = await l.db.get('SELECT id, nome, valor_venda, quantidade FROM produtos WHERE id = ? AND ativo = 1 AND catalogo = 1 AND valor_venda > 0', [id]);
      if (!p) return res.status(409).json({ ok: false, error: 'Um dos produtos não está mais disponível. Atualize a página.' });
      if (p.quantidade < qtd) return res.status(409).json({ ok: false, error: `Só temos ${p.quantidade} unidade(s) de "${p.nome}".` });
      itens.push({ produto_id: p.id, descricao: p.nome, quantidade: qtd, valor_unit: p.valor_venda });
      total += qtd * p.valor_venda;
    }
    total = Math.round(total * 100) / 100;
    const agora = new Date().toISOString();
    const ult = await l.db.get('SELECT COUNT(*) AS n FROM pedidos_catalogo');
    const numero = 'PC-' + String((ult ? Number(ult.n) : 0) + 1).padStart(5, '0');
    const id = await l.db.insert(
      `INSERT INTO pedidos_catalogo (numero, cliente_nome, cliente_whatsapp, entrega, endereco, observacoes, itens, valor_total, status, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [numero, nome, whats, entrega, endereco, String(b.obs || '').trim().slice(0, 300), JSON.stringify(itens), total, 'Novo', agora]
    );
    try { await push.avisarPedidoCatalogo(l.db, { id, numero, nome, total, itens }); } catch (e) { /* aviso é opcional */ }
    const linhas = itens.map((i) => `• ${i.quantidade}x ${i.descricao} — R$ ${(i.quantidade * i.valor_unit).toFixed(2).replace('.', ',')}`);
    const msg = [`Olá! Fiz o pedido ${numero} pelo catálogo:`, ...linhas, `Total: R$ ${total.toFixed(2).replace('.', ',')}`, entrega === 'entrega' ? `Entrega em: ${endereco}` : 'Vou retirar na loja.', `Nome: ${nome}`].join('\n');
    let pix = null;
    if (l.cfg.chave_pix) {
      const codigo = pixPayload({ chave: l.cfg.chave_pix, nome: l.cfg.nome_pix || nomeLoja(l), cidade: l.cfg.cidade_pix || l.emp.cidade || 'BRASIL', valor: total, txid: numero.replace('-', '') });
      pix = { codigo, qr: qrSvg(codigo) };
    }
    res.json({ ok: true, numero, total, pix, whatsapp: zap(l), mensagem: msg });
  } catch (err) { console.error('[Catalogo] pedido:', err && err.message); res.status(500).json({ ok: false, error: 'Não foi possível enviar o pedido agora. Tente de novo.' }); }
});

function pagina(req, res) {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(PAGINA);
}

module.exports = { router, pagina, gerarCodigo, lerCodigo, linkDaLoja, pixPayload, crc16, qrSvg };
