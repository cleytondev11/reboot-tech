// Cadastro público (site de vendas): cria uma conta de TESTE GRÁTIS.
// POST /api/cadastro  { nome, email, loja, login, senha, hp }
const express = require('express');
const tenants = require('./tenants');

const router = express.Router();
const TESTE_DIAS = Math.max(1, parseInt(process.env.TESTE_DIAS, 10) || 7);

// limite simples por IP: 5 cadastros por hora
const tentativas = new Map();
function limitado(ip) {
  const agora = Date.now();
  const lista = (tentativas.get(ip) || []).filter((t) => agora - t < 3600 * 1000);
  if (lista.length >= 5) { tentativas.set(ip, lista); return true; }
  lista.push(agora); tentativas.set(ip, lista);
  return false;
}

function hojeBr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
function somarDias(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (b.hp) return res.json({ ok: true, login: '', diasTeste: TESTE_DIAS }); // robô
    const ip = req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.ip;
    if (limitado(ip)) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Tente novamente mais tarde.' });

    const nome = String(b.nome || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    const loja = String(b.loja || '').trim();
    const login = String(b.login || '').trim();
    const senha = String(b.senha || '');
    if (nome.length < 3) return res.status(400).json({ ok: false, error: 'Informe seu nome completo.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return res.status(400).json({ ok: false, error: 'E-mail inválido.' });
    if (loja.length < 2) return res.status(400).json({ ok: false, error: 'Informe o nome da loja.' });
    if (!/^[A-Za-z0-9._@-]{3,60}$/.test(login)) return res.status(400).json({ ok: false, error: 'Login: 3 a 60 caracteres, sem espaços (letras, números, . _ - @).' });
    if (senha.length < 6) return res.status(400).json({ ok: false, error: 'A senha precisa ter ao menos 6 caracteres.' });

    const hoje = hojeBr();
    await tenants.criarCliente({
      nome: loja, login, senha, nomeUsuario: nome,
      contatoNome: nome, contatoEmail: email,
      dataContratada: hoje, dataVencimento: somarDias(hoje, TESTE_DIAS),
    });
    res.json({ ok: true, login, diasTeste: TESTE_DIAS });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : 'Não foi possível criar a conta agora.' });
  }
});

module.exports = router;
