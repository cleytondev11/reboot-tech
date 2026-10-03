// ---------- CRIAÇÃO AUTOMÁTICA DE BANCOS (Turso Platform API) ----------
// Quando você cadastra um cliente novo no painel (/admin), o sistema cria um
// banco de dados novo e exclusivo para ele no Turso — sem você precisar abrir o
// site do Turso nem criar outro site no Render.
//
// Precisa de duas variáveis no servidor:
//   TURSO_API_TOKEN  token da API do Turso (turso auth api-tokens mint reboot-tech --org SUA_ORG)
//   TURSO_ORG        nome da sua conta/organização no Turso (turso org list)
// Opcional: TURSO_GROUP (padrão "default").
//
// Sem essas variáveis o painel continua funcionando: você cria o banco à mão no
// Turso e cola a URL e o token no cadastro do cliente.
const crypto = require('crypto');

const API = 'https://api.turso.tech/v1';

function configurado() {
  return !!(process.env.TURSO_API_TOKEN && process.env.TURSO_ORG);
}

async function chamar(metodo, caminho, corpo) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const resp = await fetch(API + caminho, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${process.env.TURSO_API_TOKEN}`,
        ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
    const texto = await resp.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch (e) { json = null; }
    if (!resp.ok) {
      const msg = (json && (json.error || json.message)) || texto || resp.statusText;
      throw new Error(`Turso (${resp.status}): ${msg}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// "Paulo Silva Celulares" -> "rt-paulo-silva-celulares-a1b2"
// (o Turso só aceita letras minúsculas, números e hífen, e o nome é único na conta)
function nomeBancoSeguro(nomeCliente) {
  const base = String(nomeCliente || 'cliente')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'cliente';
  return `rt-${base}-${crypto.randomBytes(2).toString('hex')}`;
}

// Cria o banco + um token de acesso total. Retorna { nome, url, token }.
async function criarBancoParaCliente(nomeCliente) {
  if (!configurado()) throw new Error('Criação automática de banco não configurada (TURSO_API_TOKEN e TURSO_ORG).');
  const org = process.env.TURSO_ORG;
  const group = process.env.TURSO_GROUP || 'default';
  const nome = nomeBancoSeguro(nomeCliente);

  const r = await chamar('POST', `/organizations/${org}/databases`, { name: nome, group });
  const d = (r && (r.database || r)) || {};
  const nomeFinal = d.Name || d.name || nome;
  const host = d.Hostname || d.hostname || `${nomeFinal}-${org}.turso.io`;

  try {
    const tk = await chamar('POST', `/organizations/${org}/databases/${nomeFinal}/auth/tokens?expiration=never&authorization=full-access`);
    if (!tk || !tk.jwt) throw new Error('O Turso não devolveu o token do banco.');
    return { nome: nomeFinal, url: `libsql://${host}`, token: tk.jwt };
  } catch (err) {
    await excluirBanco(nomeFinal); // não deixa banco "órfão" se a segunda etapa falhar
    throw err;
  }
}

async function excluirBanco(nome) {
  if (!configurado() || !nome) return;
  try { await chamar('DELETE', `/organizations/${process.env.TURSO_ORG}/databases/${nome}`); } catch (e) { /* melhor esforço */ }
}

module.exports = { configurado, criarBancoParaCliente, excluirBanco, nomeBancoSeguro };
