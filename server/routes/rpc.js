const express = require('express');
const tenants = require('../tenants');
const { authMiddleware } = require('../auth');
const { handlers } = require('../handlers');

const router = express.Router();
router.use(authMiddleware);

router.post('/:canal', async (req, res) => {
  const canal = req.params.canal;
  const handler = handlers[canal];
  if (!handler) {
    return res.status(404).json({ ok: false, error: `Este recurso ainda não está disponível na versão web/nuvem: ${canal}` });
  }
  try {
    // Cada requisição usa SEMPRE o banco do cliente que está no token (nunca o que vier no corpo).
    const cliente = await tenants.buscarCliente(tenants.clienteIdDe(req));
    if (!cliente) return res.status(401).json({ ok: false, error: 'Sessão inválida. Faça login novamente.' });
    if (!cliente.ativo) return res.status(403).json({ ok: false, error: 'O acesso desta empresa está bloqueado. Entre em contato com o suporte.' });
    if (tenants.planoVencido(cliente)) return res.status(403).json({ ok: false, error: tenants.mensagemVencido(cliente) });
    const db = await tenants.bancoDoCliente(cliente);
    const resultado = await handler(db, req.body || {}, req);
    res.json({ ok: true, data: resultado === undefined ? null : resultado });
  } catch (err) {
    res.status(err.status || 200).json({ ok: false, error: (err && err.message) || 'Erro desconhecido no servidor.' });
  }
});

module.exports = router;
