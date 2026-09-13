const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { gerarToken } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ ok: false, error: 'Informe usuário e senha.' });
  try {
    const row = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (!row || !row.ativo || !bcrypt.compareSync(senha, row.senha_hash)) {
      return res.status(401).json({ ok: false, error: 'Usuário ou senha inválidos.' });
    }
    const usuarioSemSenha = { id: row.id, nome: row.nome, usuario: row.usuario, papel: row.papel };
    const token = gerarToken(usuarioSemSenha);
    res.json({ ok: true, user: usuarioSemSenha, token });
  } catch (err) {
    console.error('[Login] erro:', err);
    res.status(500).json({ ok: false, error: 'Erro interno ao autenticar.' });
  }
});

module.exports = router;
