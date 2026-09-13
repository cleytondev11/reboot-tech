const express = require('express');
const db = require('../db');
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
    const resultado = await handler(db, req.body || {}, req);
    res.json({ ok: true, data: resultado === undefined ? null : resultado });
  } catch (err) {
    res.status(err.status || 200).json({ ok: false, error: (err && err.message) || 'Erro desconhecido no servidor.' });
  }
});

module.exports = router;
