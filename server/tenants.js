// ---------- VÁRIOS CLIENTES NO MESMO SITE (multi-empresa) ----------
// Um único site e um único servidor atendem todos os clientes. Cada cliente tem o
// seu PRÓPRIO banco de dados (os dados nunca se misturam) e entra só com
// login e senha: o sistema descobre de qual cliente é o login e abre o banco certo.
//
// O cadastro fica no banco principal (TURSO_DATABASE_URL), em duas tabelas:
//   rt_clientes  um registro por cliente (nome, endereço do banco dele, ativo/bloqueado)
//   rt_logins    "login -> cliente" (por isso o login é único em todo o sistema)
// O próprio banco principal também é um cliente (id 1), então instalações que já
// existiam continuam funcionando sem nenhuma mudança.
const bcrypt = require('bcryptjs');
const dbPrincipal = require('./db');
const turso = require('./turso');
const { gerarToken } = require('./auth');

const ID_PRINCIPAL = 1;
const TTL_CACHE_MS = 60 * 1000; // bloquear/liberar um cliente vale em até 1 minuto
const MAX_ABERTOS = Math.max(3, Number(process.env.MAX_BANCOS_ABERTOS) || 30);
const OCIOSO_MS = 60 * 1000;

const dataIsoValida = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
function hojeIso() { return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); } // dia no Brasil (UTC-3)
function somarDiasIso(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

function erro(msg, status = 400) {
  const e = new Error(msg);
  e.status = status;
  return e;
}

function agoraIso() {
  return new Date().toISOString();
}

// ---------- cadastro (tabelas no banco principal) ----------
async function iniciarRegistro() {
  await dbPrincipal.run(`CREATE TABLE IF NOT EXISTS rt_clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    db_url TEXT,
    db_token TEXT,
    db_nome TEXT,
    ativo INTEGER NOT NULL DEFAULT 1,
    principal INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
  )`);
  await dbPrincipal.run(`CREATE TABLE IF NOT EXISTS rt_logins (
    login TEXT PRIMARY KEY COLLATE NOCASE,
    cliente_id INTEGER NOT NULL
  )`);
  // Plano do cliente (Meu Plano): data contratada e data de vencimento (30 dias). Preenchidas no /admin.
  for (const col of ['data_contratada', 'data_vencimento', 'valor_mensal', 'contato_nome', 'contato_telefone']) {
    try { await dbPrincipal.run(`ALTER TABLE rt_clientes ADD COLUMN ${col} ${col === 'valor_mensal' ? 'REAL' : 'TEXT'}`); } catch (e) { /* coluna já existe */ }
  }
  let nome = 'Banco principal';
  try {
    const emp = await dbPrincipal.get('SELECT nome FROM configuracoes_empresa WHERE id = 1');
    if (emp && emp.nome) nome = emp.nome;
  } catch (e) { /* segue com o nome padrão */ }
  await dbPrincipal.run(
    `INSERT OR IGNORE INTO rt_clientes (id, nome, db_url, db_token, db_nome, ativo, principal, criado_em) VALUES (?, ?, NULL, NULL, NULL, 1, 1, ?)`,
    [ID_PRINCIPAL, nome, agoraIso()]
  );
  // Usuários que já existiam no banco principal passam a ser clientes do id 1.
  await dbPrincipal.run(`INSERT OR IGNORE INTO rt_logins (login, cliente_id) SELECT usuario, ? FROM usuarios`, [ID_PRINCIPAL]);
}

const cache = new Map(); // id -> { row, em }

async function buscarCliente(id) {
  const c = cache.get(id);
  if (c && Date.now() - c.em < TTL_CACHE_MS) return c.row;
  const row = await dbPrincipal.get('SELECT * FROM rt_clientes WHERE id = ?', [id]);
  if (row) cache.set(id, { row, em: Date.now() });
  else cache.delete(id);
  return row;
}

function invalidar(id) {
  if (id === undefined) cache.clear();
  else cache.delete(id);
}

function clienteIdDe(req) {
  return (req && req.usuario && req.usuario.cid) || ID_PRINCIPAL;
}

// ---------- conexões com os bancos dos clientes ----------
const abertos = new Map(); // id -> { db, promessa, url, token, usadoEm }

async function inicializarComTentativas(db, tentativas = 5) {
  let ultimo;
  for (let i = 1; i <= tentativas; i++) {
    try { await db.initSchema(); return; } catch (err) {
      ultimo = err;
      // um banco recém-criado no Turso pode levar alguns segundos para ficar pronto
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw ultimo;
}

function limparExcedentes() {
  if (abertos.size <= MAX_ABERTOS) return;
  const candidatos = [...abertos.entries()]
    .filter(([, e]) => Date.now() - e.usadoEm > OCIOSO_MS)
    .sort((a, b) => a[1].usadoEm - b[1].usadoEm);
  for (const [id, e] of candidatos) {
    if (abertos.size <= MAX_ABERTOS) break;
    abertos.delete(id);
    e.db.fechar();
  }
}

function fecharAberto(id) {
  const e = abertos.get(id);
  if (e) {
    abertos.delete(id);
    e.db.fechar();
  }
}

// Devolve o banco do cliente (abre e atualiza as tabelas na primeira vez).
function bancoDoCliente(cliente) {
  if (cliente.principal) return Promise.resolve(dbPrincipal);
  const existente = abertos.get(cliente.id);
  if (existente && existente.url === cliente.db_url && existente.token === cliente.db_token) {
    existente.usadoEm = Date.now();
    return existente.promessa;
  }
  if (existente) fecharAberto(cliente.id); // endereço/token mudou
  const db = dbPrincipal.criarBanco({ url: cliente.db_url, authToken: cliente.db_token });
  const promessa = inicializarComTentativas(db)
    .then(() => db)
    .catch((err) => {
      abertos.delete(cliente.id);
      db.fechar();
      throw err;
    });
  abertos.set(cliente.id, { db, promessa, url: cliente.db_url, token: cliente.db_token, usadoEm: Date.now() });
  limparExcedentes();
  return promessa;
}

// ---------- logins (únicos em todo o sistema) ----------
async function garantirLoginLivre(login, clienteId) {
  const r = await dbPrincipal.get('SELECT cliente_id FROM rt_logins WHERE login = ?', [login]);
  if (r && r.cliente_id !== clienteId) {
    throw erro('Esse login já está em uso. Escolha outro (por exemplo, acrescente o nome da loja ao login).');
  }
}

async function registrarLogin(login, clienteId) {
  await garantirLoginLivre(login, clienteId);
  await dbPrincipal.run('INSERT OR REPLACE INTO rt_logins (login, cliente_id) VALUES (?, ?)', [login, clienteId]);
}

async function removerLogin(login, clienteId) {
  await dbPrincipal.run('DELETE FROM rt_logins WHERE login = ? AND cliente_id = ?', [login, clienteId]);
}

// Reconstrói o "login -> cliente" a partir dos usuários do banco do cliente.
async function sincronizarLogins(clienteId, db) {
  const usuarios = await db.all('SELECT usuario FROM usuarios');
  const conflitos = [];
  let adicionados = 0;
  for (const u of usuarios) {
    const r = await dbPrincipal.get('SELECT cliente_id FROM rt_logins WHERE login = ?', [u.usuario]);
    if (!r) {
      await dbPrincipal.run('INSERT INTO rt_logins (login, cliente_id) VALUES (?, ?)', [u.usuario, clienteId]);
      adicionados++;
    } else if (r.cliente_id !== clienteId) {
      conflitos.push(u.usuario);
    }
  }
  const existentes = new Set(usuarios.map((u) => String(u.usuario).toLowerCase()));
  const meus = await dbPrincipal.all('SELECT login FROM rt_logins WHERE cliente_id = ?', [clienteId]);
  for (const m of meus) {
    if (!existentes.has(String(m.login).toLowerCase())) await removerLogin(m.login, clienteId);
  }
  return { adicionados, conflitos };
}

// ---------- login ----------
// Retorna { cliente, user, token }, ou null se usuário/senha estiverem errados.
async function autenticar(usuario, senha) {
  const login = String(usuario || '').trim();
  const reg = await dbPrincipal.get('SELECT cliente_id FROM rt_logins WHERE login = ?', [login]);
  let cliente = reg ? await buscarCliente(reg.cliente_id) : null;
  let autoCura = false;
  if (!cliente) {
    // Login ainda não registrado (ex.: usuário criado fora do sistema): procura no principal.
    cliente = await buscarCliente(ID_PRINCIPAL);
    autoCura = true;
  }
  if (!cliente) return null;

  const db = await bancoDoCliente(cliente);
  const row = await db.get('SELECT * FROM usuarios WHERE usuario = ?', [login]);
  if (!row || !row.ativo || !bcrypt.compareSync(String(senha || ''), row.senha_hash)) return null;
  if (!cliente.ativo) throw erro('O acesso desta empresa está bloqueado. Entre em contato com o suporte.', 403);
  if (autoCura) { try { await registrarLogin(login, cliente.id); } catch (e) { /* ignora */ } }

  const user = { id: row.id, nome: row.nome, usuario: row.usuario, papel: row.papel };
  return { cliente, user, token: gerarToken(user, cliente.id) };
}

// ---------- painel do dono (veja admin.js) ----------
function validarUrlBanco(url) {
  if (!/^(libsql|https?|wss?):\/\/\S+$/i.test(String(url || '').trim())) {
    throw erro('Endereço do banco inválido. Deve começar com libsql://');
  }
}

async function garantirBancoNaoCadastrado(url) {
  const principalUrl = process.env.TURSO_DATABASE_URL;
  if (principalUrl && String(url).trim() === principalUrl.trim()) throw erro('Esse é o banco principal do sistema — ele já está cadastrado.');
  const dup = await dbPrincipal.get('SELECT nome FROM rt_clientes WHERE db_url = ?', [String(url).trim()]);
  if (dup) throw erro(`Esse banco já está cadastrado para o cliente "${dup.nome}".`);
}

async function removerRegistro(id) {
  await dbPrincipal.run('DELETE FROM rt_logins WHERE cliente_id = ?', [id]);
  await dbPrincipal.run('DELETE FROM rt_clientes WHERE id = ?', [id]);
  fecharAberto(id);
  invalidar(id);
}

// Cria um cliente novo: banco novo (automático no Turso, ou o endereço informado)
// + o usuário administrador com o login e a senha informados.
async function criarCliente({ nome, login, senha, nomeUsuario, dbUrl, dbToken, dataContratada, dataVencimento, valorMensal, contatoNome, contatoTelefone }) {
  nome = String(nome || '').trim();
  login = String(login || '').trim();
  senha = String(senha || '');
  if (nome.length < 2) throw erro('Informe o nome do cliente.');
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(login)) throw erro('O login deve ter de 3 a 60 caracteres, sem espaços (letras, números, ponto, hífen, _ ou @).');
  if (senha.length < 6) throw erro('A senha deve ter pelo menos 6 caracteres.');
  await garantirLoginLivre(login, -1);
  const plano = normalizarPlano(dataContratada, dataVencimento, true);

  let info;
  let criadoAuto = false;
  if (dbUrl && String(dbUrl).trim()) {
    await garantirBancoNaoCadastrado(dbUrl);
    validarUrlBanco(dbUrl);
    info = { nome: null, url: String(dbUrl).trim(), token: dbToken ? String(dbToken).trim() : null };
  } else {
    if (!turso.configurado()) {
      throw erro('Criação automática de banco não configurada. Defina TURSO_API_TOKEN e TURSO_ORG no servidor, ou informe a URL e o token de um banco criado no Turso.');
    }
    info = await turso.criarBancoParaCliente(nome);
    criadoAuto = true;
  }

  let id = null;
  try {
    id = await dbPrincipal.insert(
      `INSERT INTO rt_clientes (nome, db_url, db_token, db_nome, ativo, principal, criado_em, data_contratada, data_vencimento, valor_mensal, contato_nome, contato_telefone) VALUES (?,?,?,?,1,0,?,?,?,?,?,?)`,
      [nome, info.url, info.token, info.nome, agoraIso(), plano.dataContratada, plano.dataVencimento, numeroOuNulo(valorMensal), textoOuNulo(contatoNome), textoOuNulo(contatoTelefone)]
    );
    const cliente = await buscarCliente(id);
    const db = await bancoDoCliente(cliente);
    await db.run(
      `INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
      [String(nomeUsuario || '').trim() || 'Administrador', login, bcrypt.hashSync(senha, 10), 'Administrador', 1, agoraIso()]
    );
    await db.run(
      `UPDATE configuracoes_empresa SET nome = ?, nome_fantasia = ?, atualizado_em = ? WHERE id = 1 AND (nome IS NULL OR nome = '')`,
      [nome, nome, agoraIso()]
    );
    await registrarLogin(login, id);
    return { id, nome, login, banco: info.nome || info.url };
  } catch (err) {
    if (id) await removerRegistro(id).catch(() => {});
    if (criadoAuto) await turso.excluirBanco(info.nome);
    throw err;
  }
}

// Cadastra um banco que já existe (ex.: o de uma instalação antiga de um cliente).
async function importarCliente({ nome, dbUrl, dbToken, dataContratada, dataVencimento }) {
  nome = String(nome || '').trim();
  if (nome.length < 2) throw erro('Informe o nome do cliente.');
  await garantirBancoNaoCadastrado(dbUrl);
  validarUrlBanco(dbUrl);
  const plano = normalizarPlano(dataContratada, dataVencimento, true);
  const id = await dbPrincipal.insert(
    `INSERT INTO rt_clientes (nome, db_url, db_token, db_nome, ativo, principal, criado_em, data_contratada, data_vencimento) VALUES (?,?,?,?,1,0,?,?,?)`,
    [nome, String(dbUrl).trim(), dbToken ? String(dbToken).trim() : null, null, agoraIso(), plano.dataContratada, plano.dataVencimento]
  );
  try {
    const cliente = await buscarCliente(id);
    const db = await bancoDoCliente(cliente);
    const sync = await sincronizarLogins(id, db);
    return { id, nome, ...sync };
  } catch (err) {
    await removerRegistro(id).catch(() => {});
    throw erro('Não foi possível conectar nesse banco: ' + ((err && err.message) || err));
  }
}

async function sincronizarCliente(id) {
  const cliente = await buscarCliente(id);
  if (!cliente) throw erro('Cliente não encontrado.', 404);
  return sincronizarLogins(id, await bancoDoCliente(cliente));
}

async function definirAtivo(id, ativo) {
  const cliente = await buscarCliente(id);
  if (!cliente) throw erro('Cliente não encontrado.', 404);
  await dbPrincipal.run('UPDATE rt_clientes SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  invalidar(id);
}

async function redefinirSenha(id, login, senha) {
  if (String(senha || '').length < 6) throw erro('A senha deve ter pelo menos 6 caracteres.');
  const cliente = await buscarCliente(id);
  if (!cliente) throw erro('Cliente não encontrado.', 404);
  const db = await bancoDoCliente(cliente);
  const usuario = login
    ? await db.get('SELECT id, usuario FROM usuarios WHERE usuario = ?', [String(login).trim()])
    : await db.get(`SELECT id, usuario FROM usuarios WHERE papel = 'Administrador' AND ativo = 1 ORDER BY id LIMIT 1`);
  if (!usuario) throw erro('Usuário não encontrado nesse cliente.');
  await db.run('UPDATE usuarios SET senha_hash = ?, ativo = 1 WHERE id = ?', [bcrypt.hashSync(String(senha), 10), usuario.id]);
  return { usuario: usuario.usuario };
}

// Valida as datas do plano. Com `padrao`, quem não informou recebe: contratada = hoje, vencimento = contratada + 30 dias.
// Datas vazias (sem padrão) significam "plano sem datas cadastradas".
function numeroOuNulo(v) {
  const n = parseFloat(String(v === undefined || v === null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function textoOuNulo(v) { const t = String(v || '').trim(); return t ? t.slice(0, 120) : null; }

function normalizarPlano(dataContratada, dataVencimento, padrao) {
  let c = String(dataContratada || '').trim().slice(0, 10);
  let v = String(dataVencimento || '').trim().slice(0, 10);
  if (c && !dataIsoValida(c)) throw erro('Data contratada inválida.');
  if (v && !dataIsoValida(v)) throw erro('Data de vencimento inválida.');
  if (padrao) {
    if (!c) c = hojeIso();
    if (!v) v = somarDiasIso(c, 30);
  }
  if (c && v && v < c) throw erro('O vencimento não pode ser antes da data contratada.');
  return { dataContratada: c || null, dataVencimento: v || null };
}

async function definirPlano(id, { dataContratada, dataVencimento }) {
  const cliente = await buscarCliente(id);
  if (!cliente) throw erro('Cliente não encontrado.', 404);
  const plano = normalizarPlano(dataContratada, dataVencimento, false);
  await dbPrincipal.run('UPDATE rt_clientes SET data_contratada = ?, data_vencimento = ? WHERE id = ?', [plano.dataContratada, plano.dataVencimento, id]);
  invalidar(id);
  return plano;
}

// Renovação rápida: soma `dias` (30) a partir do vencimento atual (ou de hoje, se já venceu ou está sem data).
async function renovarPlano(id, dias = 30) {
  const cliente = await buscarCliente(id);
  if (!cliente) throw erro('Cliente não encontrado.', 404);
  const hoje = hojeIso();
  const atual = cliente.data_vencimento && dataIsoValida(cliente.data_vencimento) ? cliente.data_vencimento : null;
  const base = atual && atual > hoje ? atual : hoje;
  const novoVenc = somarDiasIso(base, dias);
  const contratada = cliente.data_contratada || hoje;
  await dbPrincipal.run('UPDATE rt_clientes SET data_contratada = ?, data_vencimento = ? WHERE id = ?', [contratada, novoVenc, id]);
  invalidar(id);
  return { dataContratada: contratada, dataVencimento: novoVenc };
}

function hostDe(url) {
  return String(url || '').replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, '');
}

// Edita os dados cadastrais do assinante (nome, valor da mensalidade e contato).
async function atualizarCliente(id, { nome, valorMensal, contatoNome, contatoTelefone }) {
  const cliente = await buscarCliente(id);
  if (!cliente) throw erro('Cliente não encontrado.', 404);
  const n = String(nome || '').trim();
  if (n.length < 2) throw erro('Informe o nome do cliente.');
  await dbPrincipal.run('UPDATE rt_clientes SET nome = ?, valor_mensal = ?, contato_nome = ?, contato_telefone = ? WHERE id = ?',
    [n, numeroOuNulo(valorMensal), textoOuNulo(contatoNome), textoOuNulo(contatoTelefone), id]);
  invalidar(id);
  return { id };
}

async function listarClientes() {
  const linhas = await dbPrincipal.all(
    `SELECT c.id, c.nome, c.ativo, c.principal, c.db_nome, c.db_url, c.criado_em, c.data_contratada, c.data_vencimento, c.valor_mensal, c.contato_nome, c.contato_telefone,
            (SELECT login FROM rt_logins l2 WHERE l2.cliente_id = c.id ORDER BY l2.rowid LIMIT 1) AS login,
            (SELECT COUNT(*) FROM rt_logins l WHERE l.cliente_id = c.id) AS usuarios
     FROM rt_clientes c ORDER BY c.id`
  );
  return linhas.map((c) => ({
    id: c.id, nome: c.nome, ativo: !!c.ativo, principal: !!c.principal, criado_em: c.criado_em,
    dataContratada: c.data_contratada || '', dataVencimento: c.data_vencimento || '',
    valorMensal: c.valor_mensal == null ? null : Number(c.valor_mensal), contatoNome: c.contato_nome || '', contatoTelefone: c.contato_telefone || '', login: c.login || '',
    usuarios: c.usuarios, banco: c.principal ? 'banco principal' : (c.db_nome || hostDe(c.db_url)),
  }));
}

async function listarClientesAtivos() {
  return dbPrincipal.all('SELECT * FROM rt_clientes WHERE ativo = 1 ORDER BY id');
}

module.exports = {
  ID_PRINCIPAL,
  iniciarRegistro,
  buscarCliente,
  bancoDoCliente,
  clienteIdDe,
  autenticar,
  garantirLoginLivre,
  registrarLogin,
  removerLogin,
  sincronizarLogins,
  criarCliente,
  importarCliente,
  sincronizarCliente,
  definirAtivo,
  redefinirSenha,
  definirPlano,
  renovarPlano,
  atualizarCliente,
  listarClientes,
  listarClientesAtivos,
};
