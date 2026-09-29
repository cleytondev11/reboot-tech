const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { SCHEMA } = require('../shared/schema.cjs');

class Database {
  constructor(filePath) {
    this.filePath = filePath;
    this.SQL = null;
    this.db = null;
  }

  async init() {
    const wasmCandidates = [
      path.join(process.resourcesPath || '', 'sql-wasm.wasm'),
      path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    ];
    let wasmPath = wasmCandidates.find((p) => p && fs.existsSync(p));

    this.SQL = await initSqlJs({
      locateFile: () => wasmPath,
    });

    if (fs.existsSync(this.filePath)) {
      const buf = fs.readFileSync(this.filePath);
      this.db = new this.SQL.Database(buf);
    } else {
      this.db = new this.SQL.Database();
      this.db.run(SCHEMA);
      this.persist();
    }
    // Ensure schema (idempotent) in case of upgrades
    this.db.run(SCHEMA);
    this.migrate();
    this.persist();
    return this;
  }

  migrate() {
    const tryAdd = (sql) => {
      try { this.db.run(sql); } catch (e) { /* coluna já existe, ignora */ }
    };
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN itens_pecas TEXT`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN estoque_baixado INTEGER DEFAULT 0`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN forma_pagamento TEXT`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN financeiro_lancado INTEGER DEFAULT 0`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN despesa_pecas_lancada INTEGER DEFAULT 0`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN tecnico_id INTEGER`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN termos_aceite TEXT`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN senha_tipo TEXT`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN senha_valor TEXT`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN checklist_acessorios TEXT`);
    tryAdd(`ALTER TABLE ordens_servico ADD COLUMN financeiro_receber_lancado INTEGER DEFAULT 0`);
    tryAdd(`ALTER TABLE clientes ADD COLUMN data_nascimento TEXT`);
    tryAdd(`ALTER TABLE vendas ADD COLUMN garantia_dias INTEGER DEFAULT 90`);
    tryAdd(`ALTER TABLE configuracoes_rede ADD COLUMN servidor_url TEXT`);
    tryAdd(`ALTER TABLE configuracoes_rede ADD COLUMN token_nuvem TEXT`);
    tryAdd(`ALTER TABLE configuracoes_rede ADD COLUMN usuario_nuvem TEXT`);
    tryAdd(`ALTER TABLE configuracoes_impressao ADD COLUMN formato TEXT DEFAULT 'termica'`);

    // Garante que sempre exista uma linha de configurações da empresa (id fixo = 1)
    const existeEmpresa = this.db.exec('SELECT id FROM configuracoes_empresa WHERE id = 1');
    if (!existeEmpresa.length || !existeEmpresa[0].values.length) {
      this.db.run(
        `INSERT INTO configuracoes_empresa (id, nome, nome_fantasia, logo, cnpj, ie, endereco, numero, bairro, cidade, uf, cep, telefone, whatsapp, email, site, redes_sociais, atualizado_em) VALUES (1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', new Date().toISOString()]
      );
    }

    // Garante que sempre exista uma linha de licença local (id fixo = 1)
    const existeLicenca = this.db.exec('SELECT id FROM licenca_local WHERE id = 1');
    if (!existeLicenca.length || !existeLicenca[0].values.length) {
      this.db.run(
        `INSERT INTO licenca_local (id, chave, status_cache, ultima_verificacao_ok, instalado_em) VALUES (1, NULL, 'pendente', NULL, ?)`,
        [new Date().toISOString()]
      );
    }

    // Garante que sempre exista uma linha de configuração de rede (id fixo = 1).
    // Por padrão o sistema roda "standalone" (sozinho, sem multi-PC).
    const existeRede = this.db.exec('SELECT id FROM configuracoes_rede WHERE id = 1');
    if (!existeRede.length || !existeRede[0].values.length) {
      this.db.run(
        `INSERT INTO configuracoes_rede (id, modo, servidor_ip, porta, chave_rede, atualizado_em) VALUES (1, 'standalone', '', 4653, '', ?)`,
        [new Date().toISOString()]
      );
    }

    // Garante que sempre exista uma linha de configuração de impressora térmica (id fixo = 1)
    const existeImpressao = this.db.exec('SELECT id FROM configuracoes_impressao WHERE id = 1');
    if (!existeImpressao.length || !existeImpressao[0].values.length) {
      this.db.run(
        `INSERT INTO configuracoes_impressao (id, impressora_padrao, largura_papel, copias, atualizado_em) VALUES (1, '', 80, 1, ?)`,
        [new Date().toISOString()]
      );
    }
  }

  persist() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, buffer);
  }

  backupTo(destPath) {
    this.persist();
    fs.copyFileSync(this.filePath, destPath);
  }

  run(sql, params = []) {
    this.db.run(sql, params);
    this.persist();
  }

  insert(sql, params = []) {
    this.db.run(sql, params);
    const res = this.db.exec('SELECT last_insert_rowid() as id');
    this.persist();
    return res[0].values[0][0];
  }

  all(sql, params = []) {
    const stmt = this.db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  get(sql, params = []) {
    const rows = this.all(sql, params);
    return rows[0] || null;
  }
}

module.exports = { Database, SCHEMA };
