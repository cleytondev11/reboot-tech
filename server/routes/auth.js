const express = require('express');
const tenants = require('../tenants');
const push = require('../push');
const dbPrincipal = require('../db');

const router = express.Router();

// Login único para todos os clientes: o sistema descobre pelo login de qual
// cliente é o usuário e abre o banco certo (veja tenants.js).
router.post('/login', async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ ok: false, error: 'Informe usuário e senha.' });
  try {
    const r = await tenants.autenticar(usuario, senha);
    if (!r) return res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos.' });
    res.json({ ok: true, user: r.user, token: r.token });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ ok: false, error: err.message });
    console.error('[Login] erro:', err);
    res.status(500).json({ ok: false, error: 'Erro interno ao autenticar.' });
  }
});

// "Esqueci minha senha": o cliente informa o login e o dono recebe um aviso no celular
// (e vê o pedido na Central de Acessos para definir uma nova senha). A resposta é sempre a
// mesma, exista o login ou não, para ninguém descobrir quais logins existem.
const pedidos = new Map();
function limitado(chave, max) {
  const agora = Date.now();
  const lista = (pedidos.get(chave) || []).filter((t) => agora - t < 3600 * 1000);
  if (lista.length >= max) { pedidos.set(chave, lista); return true; }
  lista.push(agora); pedidos.set(chave, lista);
  return false;
}
router.post('/esqueci', async (req, res) => {
  const login = String((req.body || {}).login || '').trim().slice(0, 60);
  if (!login) return res.status(400).json({ ok: false, error: 'Informe o seu usuário (login).' });
  const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.ip;
  if (limitado('ip:' + ip, 8) || limitado('login:' + login.toLowerCase(), 3)) {
    return res.status(429).json({ ok: false, error: 'Muitos pedidos. Aguarde um pouco ou chame no WhatsApp.' });
  }
  try {
    const reg = await dbPrincipal.get('SELECT cliente_id FROM rt_logins WHERE login = ?', [login]);
    if (reg) {
      const c = await tenants.buscarCliente(reg.cliente_id);
      if (c) {
        const zap = c.contato_telefone ? '\nWhatsApp: ' + c.contato_telefone : '';
        push.avisarDono('🔑 Pedido de nova senha', `Loja: ${c.nome}\nLogin: ${login}${zap}\nDefina a nova senha na Central de Acessos (··· > Nova senha).`).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Esqueci] erro:', err && err.message);
  }
  res.json({ ok: true });
});

module.exports = router;
