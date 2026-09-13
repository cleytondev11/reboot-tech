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

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN, // pode ficar vazio em bancos locais de teste
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

  const existeEmpresa = await get('SELECT id FROM configuracoes_empresa WHERE id = 1');
  if (!existeEmpresa) {
    await run(
      `INSERT INTO configuracoes_empresa (id, nome, nome_fantasia, logo, cnpj, ie, endereco, numero, bairro, cidade, uf, cep, telefone, whatsapp, email, site, redes_sociais, atualizado_em) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', new Date().toISOString()]
    );
  }
}

module.exports = { all, get, run, insert, initSchema, client };
