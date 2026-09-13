// ---------- ESQUEMA DO BANCO DE DADOS (compartilhado) ----------
// Usado tanto pelo app desktop (electron/db.cjs, via sql.js) quanto pelo
// backend na nuvem (server/db.js, via Turso/libSQL) — sem depender de nenhum
// dos dois (arquivo puro, sem requires).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'Atendente', -- Administrador, Atendente, Tecnico, Financeiro
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL DEFAULT 'PF', -- PF ou PJ
  nome TEXT NOT NULL,
  cpf_cnpj TEXT,
  rg_ie TEXT,
  telefone TEXT,
  whatsapp TEXT,
  email TEXT,
  cep TEXT,
  endereco TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  observacoes TEXT,
  data_nascimento TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS equipamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL,
  marca TEXT,
  modelo TEXT,
  imei TEXT,
  numero_serie TEXT,
  cor TEXT,
  senha_desbloqueio TEXT,
  capacidade TEXT,
  operadora TEXT,
  estado_conservacao TEXT,
  acessorios TEXT, -- csv
  fotos TEXT, -- JSON array de base64
  criado_em TEXT NOT NULL,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS ordens_servico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL,
  equipamento_id INTEGER NOT NULL,
  defeito_informado TEXT,
  diagnostico TEXT,
  servicos_executados TEXT,
  pecas_utilizadas TEXT,
  valor_mao_obra REAL DEFAULT 0,
  valor_pecas REAL DEFAULT 0,
  desconto REAL DEFAULT 0,
  valor_total REAL DEFAULT 0,
  garantia_dias INTEGER DEFAULT 90,
  data_entrada TEXT NOT NULL,
  previsao TEXT,
  data_saida TEXT,
  status TEXT NOT NULL DEFAULT 'Recebido',
  observacoes TEXT,
  assinatura_cliente TEXT, -- dataURL base64
  checklist TEXT, -- JSON
  usuario_id INTEGER,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(equipamento_id) REFERENCES equipamentos(id)
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  usuario_nome TEXT,
  acao TEXT NOT NULL,
  entidade TEXT NOT NULL,
  entidade_id INTEGER,
  detalhes TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj_cpf TEXT,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  observacoes TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  categoria TEXT,
  fabricante TEXT,
  fornecedor_id INTEGER,
  codigo_interno TEXT,
  codigo_barras TEXT,
  quantidade REAL NOT NULL DEFAULT 0,
  estoque_minimo REAL NOT NULL DEFAULT 0,
  valor_compra REAL DEFAULT 0,
  valor_venda REAL DEFAULT 0,
  localizacao TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  FOREIGN KEY(fornecedor_id) REFERENCES fornecedores(id)
);

CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  produto_id INTEGER NOT NULL,
  tipo TEXT NOT NULL, -- entrada, saida, ajuste
  quantidade REAL NOT NULL,
  motivo TEXT,
  referencia TEXT, -- ex: OS-000012, Compra #4
  usuario_id INTEGER,
  usuario_nome TEXT,
  criado_em TEXT NOT NULL,
  FOREIGN KEY(produto_id) REFERENCES produtos(id)
);

CREATE TABLE IF NOT EXISTS orcamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  cliente_id INTEGER NOT NULL,
  equipamento_id INTEGER,
  descricao TEXT,
  itens TEXT, -- JSON array [{tipo, produto_id, descricao, quantidade, valor_unit}]
  valor_servicos REAL DEFAULT 0,
  desconto REAL DEFAULT 0,
  valor_total REAL DEFAULT 0,
  validade_dias INTEGER DEFAULT 7,
  data_orcamento TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pendente', -- Pendente, Enviado, Aprovado, Recusado, Expirado, Convertido
  observacoes TEXT,
  os_id INTEGER, -- preenchido quando convertido em OS
  usuario_id INTEGER,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id),
  FOREIGN KEY(equipamento_id) REFERENCES equipamentos(id)
);

CREATE TABLE IF NOT EXISTS lancamentos_financeiros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, -- receita, despesa
  categoria TEXT,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  forma_pagamento TEXT, -- Dinheiro, PIX, Cartão Débito, Cartão Crédito, Boleto, Transferência
  status TEXT NOT NULL DEFAULT 'Pendente', -- Pendente, Pago, Cancelado
  data_vencimento TEXT,
  data_pagamento TEXT,
  referencia TEXT, -- ex: OS-000001
  os_id INTEGER,
  observacoes TEXT,
  origem_automatica INTEGER NOT NULL DEFAULT 0,
  usuario_id INTEGER,
  usuario_nome TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS caixa_sessoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data_abertura TEXT NOT NULL,
  valor_abertura REAL NOT NULL DEFAULT 0,
  usuario_abertura_id INTEGER,
  usuario_abertura_nome TEXT,
  data_fechamento TEXT,
  valor_fechamento_informado REAL,
  valor_fechamento_calculado REAL,
  usuario_fechamento_id INTEGER,
  usuario_fechamento_nome TEXT,
  status TEXT NOT NULL DEFAULT 'Aberto', -- Aberto, Fechado
  observacoes TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS caixa_movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessao_id INTEGER NOT NULL,
  tipo TEXT NOT NULL, -- suprimento, sangria, entrada, saida
  valor REAL NOT NULL,
  forma_pagamento TEXT,
  descricao TEXT,
  referencia TEXT,
  usuario_id INTEGER,
  usuario_nome TEXT,
  criado_em TEXT NOT NULL,
  FOREIGN KEY(sessao_id) REFERENCES caixa_sessoes(id)
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  fornecedor_id INTEGER NOT NULL,
  itens TEXT, -- JSON array [{produto_id, descricao, quantidade, valor_unit}]
  valor_total REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pendente', -- Pendente (rascunho/a enviar), Enviado, Recebido, Cancelado
  data_pedido TEXT NOT NULL,
  data_prevista TEXT,
  data_recebimento TEXT,
  observacoes TEXT,
  estoque_lancado INTEGER NOT NULL DEFAULT 0,
  despesa_lancada INTEGER NOT NULL DEFAULT 0,
  usuario_id INTEGER,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT,
  FOREIGN KEY(fornecedor_id) REFERENCES fornecedores(id)
);

CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  descricao TEXT,
  categoria TEXT,
  valor_padrao REAL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS vendas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  numero TEXT NOT NULL UNIQUE,
  cliente_id INTEGER,
  itens TEXT, -- JSON array [{produto_id, descricao, quantidade, valor_unit}]
  valor_itens REAL DEFAULT 0,
  desconto REAL DEFAULT 0,
  valor_total REAL DEFAULT 0,
  forma_pagamento TEXT,
  status TEXT NOT NULL DEFAULT 'Concluída', -- Concluída, Cancelada
  observacoes TEXT,
  usuario_id INTEGER,
  criado_em TEXT NOT NULL,
  FOREIGN KEY(cliente_id) REFERENCES clientes(id)
);

CREATE TABLE IF NOT EXISTS metas_financeiras (
  mes TEXT PRIMARY KEY, -- formato 'YYYY-MM'
  meta_lucro REAL NOT NULL DEFAULT 0,
  usuario_id INTEGER,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS configuracoes_empresa (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nome TEXT,
  nome_fantasia TEXT,
  logo TEXT, -- data URL base64
  cnpj TEXT,
  ie TEXT,
  endereco TEXT,
  numero TEXT,
  bairro TEXT,
  cidade TEXT,
  uf TEXT,
  cep TEXT,
  telefone TEXT,
  whatsapp TEXT,
  email TEXT,
  site TEXT,
  redes_sociais TEXT,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS licenca_local (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  chave TEXT,
  status_cache TEXT NOT NULL DEFAULT 'pendente', -- pendente, ativa, bloqueada
  ultima_verificacao_ok TEXT,
  instalado_em TEXT
);

CREATE TABLE IF NOT EXISTS seguranca_acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispositivo_serial TEXT,
  dispositivo_modelo TEXT,
  pacote TEXT,
  acao TEXT NOT NULL, -- analise, parar, remover_admin, desativar, reativar, desinstalar
  nivel_risco TEXT,
  resultado TEXT,
  cliente_id INTEGER,
  equipamento_id INTEGER,
  usuario_id INTEGER,
  usuario_nome TEXT,
  criado_em TEXT
);

CREATE TABLE IF NOT EXISTS configuracoes_rede (
  id INTEGER PRIMARY KEY,
  modo TEXT NOT NULL DEFAULT 'standalone', -- standalone, servidor, cliente
  servidor_ip TEXT,
  porta INTEGER DEFAULT 4653,
  chave_rede TEXT,
  atualizado_em TEXT
);

CREATE TABLE IF NOT EXISTS configuracoes_impressao (
  id INTEGER PRIMARY KEY,
  impressora_padrao TEXT,
  largura_papel INTEGER DEFAULT 80, -- 58 ou 80 (mm)
  copias INTEGER DEFAULT 1,
  atualizado_em TEXT
);
`;

module.exports = { SCHEMA };
