// ---------- BANCO DE DADOS NA NUVEM (Turso / libSQL) ----------
// Reaproveita exatamente o mesmo esquema (tabelas) usado no aplicativo desktop —
// já que o libSQL (usado pelo Turso) é compatível com a sintaxe do SQLite, o
// mesmo SCHEMA definido em electron/db.cjs funciona aqui sem alterações.
const path = require('path');
const { createClient } = require('@libsql/client');
const { SCHEMA } = require(path.join(__dirname, '..', 'shared', 'schema.cjs'));

if (!process.env.TURSO_DATABASE_URL) {
  console.error('[Banco] Variável de ambiente TURSO_DATABASE_URL não definida. Veja server/DEPLOY.md.');
}

// Cria uma conexão com UM banco. O sistema agora atende vários clientes no mesmo
// site: cada cliente tem o seu próprio banco (veja tenants.js), então tudo que
// mexe no banco é criado por esta função — uma instância por cliente.
function criarBanco({ url, authToken }) {
  const client = createClient({
    url,
    authToken, // pode ficar vazio em bancos locais de teste
  });


function linhaParaObjeto(row) {
  // O driver do libSQL já retorna cada linha como um objeto com as colunas como
  // chaves (além de acesso posicional) — este helper só garante um objeto "puro".
  return { ...row };
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows.map(linhaParaObjeto);
}

async function get(sql, args = []) {
  const linhas = await all(sql, args);
  return linhas[0] || null;
}

async function run(sql, args = []) {
  await client.execute({ sql, args });
}

async function insert(sql, args = []) {
  const res = await client.execute({ sql, args });
  return Number(res.lastInsertRowid);
}

async function initSchema() {
  await client.executeMultiple(SCHEMA);
  await migrate();
}

async function migrate() {
  const tryAdd = async (sql) => {
    try { await client.execute(sql); } catch (e) { /* coluna já existe, ignora */ }
  };
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN itens_pecas TEXT`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN estoque_baixado INTEGER DEFAULT 0`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN forma_pagamento TEXT`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN financeiro_lancado INTEGER DEFAULT 0`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN despesa_pecas_lancada INTEGER DEFAULT 0`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN tecnico_id INTEGER`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN termos_aceite TEXT`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN senha_tipo TEXT`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN senha_valor TEXT`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN checklist_acessorios TEXT`);
  await tryAdd(`ALTER TABLE ordens_servico ADD COLUMN financeiro_receber_lancado INTEGER DEFAULT 0`);
  await tryAdd(`ALTER TABLE clientes ADD COLUMN data_nascimento TEXT`);
  await tryAdd(`ALTER TABLE vendas ADD COLUMN garantia_dias INTEGER DEFAULT 90`);
  // Venda a prazo / cobrança: de quem é a parcela, qual parcela é (ex.: 2/3) e quando foi cobrada por último.
  await tryAdd(`ALTER TABLE lancamentos_financeiros ADD COLUMN cliente_id INTEGER`);
  await tryAdd(`ALTER TABLE lancamentos_financeiros ADD COLUMN parcela TEXT`);
  await tryAdd(`ALTER TABLE lancamentos_financeiros ADD COLUMN cobrado_em TEXT`);
  await tryAdd(`ALTER TABLE configuracoes_rede ADD COLUMN servidor_url TEXT`);
  await tryAdd(`ALTER TABLE configuracoes_rede ADD COLUMN token_nuvem TEXT`);
  await tryAdd(`ALTER TABLE configuracoes_rede ADD COLUMN usuario_nuvem TEXT`);
  await tryAdd(`ALTER TABLE configuracoes_impressao ADD COLUMN formato TEXT DEFAULT 'termica'`);

  // Notificações push (celular): inscrições dos aparelhos + chaves VAPID.
  await client.execute(`CREATE TABLE IF NOT EXISTS push_subscricoes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    notif_os_pronta INTEGER DEFAULT 1,
    notif_orc_convertido INTEGER DEFAULT 1,
    notif_os_nova INTEGER DEFAULT 1,
    notif_os_status INTEGER DEFAULT 1,
    notif_orc_novo INTEGER DEFAULT 1,
    notif_orc_status INTEGER DEFAULT 1,
    notif_venda INTEGER DEFAULT 1,
    notif_estoque_baixo INTEGER DEFAULT 1,
    notif_contas_pagar INTEGER DEFAULT 1,
    criado_em TEXT
  )`);
  // Bancos que já existiam antes das novas opções de notificação.
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_os_nova INTEGER DEFAULT 1`);
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_os_status INTEGER DEFAULT 1`);
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_orc_novo INTEGER DEFAULT 1`);
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_orc_status INTEGER DEFAULT 1`);
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_venda INTEGER DEFAULT 1`);
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_estoque_baixo INTEGER DEFAULT 1`);
  await tryAdd(`ALTER TABLE push_subscricoes ADD COLUMN notif_contas_pagar INTEGER DEFAULT 1`);
  // Controle dos avisos diários (evita mandar o mesmo resumo duas vezes no dia).
  await client.execute(`CREATE TABLE IF NOT EXISTS push_avisos (chave TEXT PRIMARY KEY, criado_em TEXT)`);
  await client.execute(`CREATE TABLE IF NOT EXISTS push_config (chave TEXT PRIMARY KEY, valor TEXT)`);

  const existeEmpresa = await get('SELECT id FROM configuracoes_empresa WHERE id = 1');
  if (!existeEmpresa) {
    await run(
      `INSERT INTO configuracoes_empresa (id, nome, nome_fantasia, logo, cnpj, ie, endereco, numero, bairro, cidade, uf, cep, telefone, whatsapp, email, site, redes_sociais, atualizado_em) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', new Date().toISOString()]
    );
  }
}

  return { all, get, run, insert, initSchema, client, fechar: () => { try { client.close(); } catch (e) { /* ignora */ } } };
}

// Banco "principal" (variáveis TURSO_DATABASE_URL / TURSO_AUTH_TOKEN): guarda o
// cadastro dos clientes (tabelas rt_clientes e rt_logins) e também pode ser o
// banco de um cliente.
const principal = criarBanco({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

module.exports = { ...principal, criarBanco, principal };
