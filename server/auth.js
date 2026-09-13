// ---------- AUTENTICAÇÃO (JWT) ----------
const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 16) {
  console.error('[Auth] Defina uma variável de ambiente JWT_SECRET forte (>=16 caracteres) antes de usar em produção. Veja server/DEPLOY.md.');
}

function gerarToken(usuario) {
  return jwt.sign(
    { id: usuario.id, nome: usuario.nome, usuario: usuario.usuario, papel: usuario.papel },
    SECRET || 'chave-temporaria-troque-isto',
    { expiresIn: '12h' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado. Faça login novamente.' });
  try {
    req.usuario = jwt.verify(token, SECRET || 'chave-temporaria-troque-isto');
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Sessão expirada. Faça login novamente.' });
  }
}

// Equivalente ao requirePapel(atual, papeis) do app desktop, mas usando sempre o
// usuário autenticado pelo token (nunca o que vier no corpo da requisição) —
// evita que alguém "finja" ser Administrador manipulando o payload.
function requirePapel(req, papeis) {
  if (!req.usuario || !papeis.includes(req.usuario.papel)) {
    const err = new Error('Permissão negada para esta operação.');
    err.status = 403;
    throw err;
  }
}

module.exports = { gerarToken, authMiddleware, requirePapel };
