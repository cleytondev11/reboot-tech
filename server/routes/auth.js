const express = require('express');
const tenants = require('../tenants');

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

module.exports = router;
