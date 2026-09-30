#!/usr/bin/env node
// Gera tudo o que você precisa para colocar um CLIENTE NOVO no ar:
// nomes sugeridos, JWT_SECRET, variáveis do Render, o SQL da licença (Supabase)
// e o SQL do primeiro usuário administrador (Turso) com a senha já criptografada.
//
// Uso (dentro da pasta "server", depois de rodar "npm install" uma vez):
//   node scripts/novo-cliente.js "Paulo Silva"
//   node scripts/novo-cliente.js "Paulo Silva" --dias 30 --usuario paulo --senha MinhaSenha123
//
// Opções:
//   --dias N       dias de acesso a partir de hoje (padrão 30)
//   --usuario X    login do administrador do cliente (padrão "admin")
//   --senha X      senha do administrador (se omitida, é gerada uma aleatória)
//
// Este script NÃO acessa nenhuma conta: ele só imprime o que você vai copiar e
// colar no Turso, no Render e no Supabase. Nada é gravado em lugar nenhum.
const crypto = require('crypto');

function arg(nome, padrao) {
  const i = process.argv.indexOf('--' + nome);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const nomeCliente = (process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '').trim();
if (!nomeCliente) {
  console.error('Informe o nome do cliente. Exemplo:\n  node scripts/novo-cliente.js "Paulo Silva"');
  process.exit(1);
}

const dias = parseInt(arg('dias', '30'), 10);
if (!(dias > 0)) { console.error('--dias precisa ser um número maior que zero.'); process.exit(1); }
const usuario = arg('usuario', 'admin').trim();

const slug = nomeCliente
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'cliente';
const chave = 'WEB-' + slug.toUpperCase();
const aspas = (t) => String(t).replace(/'/g, "''"); // protege aspas dentro do SQL

function hojeBrasilia() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); }
function somarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}
const inicio = hojeBrasilia();
const vencimento = somarDias(inicio, dias);

const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem letras que confundem (l, I, O, 0, 1)
function senhaAleatoria(tam = 10) {
  let s = '';
  for (let i = 0; i < tam; i++) s += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return s;
}
const senha = arg('senha', '') || senhaAleatoria();
const jwtSecret = crypto.randomBytes(32).toString('hex');

let hash;
try {
  hash = require('bcryptjs').hashSync(senha, 10);
} catch (e) {
  console.error('Não achei o bcryptjs. Rode "npm install" dentro da pasta server e tente de novo.');
  process.exit(1);
}

const linha = '─'.repeat(70);
console.log(`
${linha}
 CLIENTE NOVO: ${nomeCliente}
${linha}
 Nome do banco no Turso ....... rt-${slug}
 Nome do serviço (backend) .... rt-${slug}-api      (Render → Web Service)
 Nome do site (frontend) ...... rt-${slug}          (Render → Static Site)
 Chave de licença ............. ${chave}
 Acesso de ${inicio.split('-').reverse().join('/')} até ${vencimento.split('-').reverse().join('/')} (${dias} dias) — bloqueia no dia do vencimento

${linha}
 PASSO 1 — TURSO: criar o banco e pegar URL + token
${linha}
 Pelo terminal (Turso CLI):
   turso db create rt-${slug}
   turso db show rt-${slug} --url          # → vai em TURSO_DATABASE_URL
   turso db tokens create rt-${slug}       # → vai em TURSO_AUTH_TOKEN
 (ou pelo painel: turso.tech → Create Database → "rt-${slug}")

${linha}
 PASSO 2 — RENDER (backend): New → Web Service → mesmo repositório
${linha}
 Build Command:  cd server && npm install
 Start Command:  node server/index.js
 Variáveis de ambiente:

   TURSO_DATABASE_URL=<cole a URL do passo 1>
   TURSO_AUTH_TOKEN=<cole o token do passo 1>
   JWT_SECRET=${jwtSecret}
   SUPABASE_URL=<o mesmo de sempre>
   SUPABASE_ANON_KEY=<a mesma de sempre>
   LICENCA_CHAVE=${chave}

${linha}
 PASSO 3 — RENDER (site): New → Static Site → mesmo repositório
${linha}
 Build Command:      npm install && npm run build:vite
 Publish Directory:  dist
 Variável de ambiente:

   VITE_API_URL=<a URL do backend do passo 2, ex.: https://rt-${slug}-api.onrender.com>

${linha}
 PASSO 4 — SUPABASE (SQL Editor): cadastrar a licença do cliente
${linha}
insert into licencas (chave, cliente_nome, status, data_inicio, data_vencimento)
values ('${aspas(chave)}', '${aspas(nomeCliente)}', 'ativa', '${inicio}', '${vencimento}');

${linha}
 PASSO 5 — TURSO (Shell): criar o administrador do cliente
 (faça depois que o backend do passo 2 subir pela primeira vez — é ele que cria as tabelas)
${linha}
INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em)
VALUES ('${aspas(nomeCliente)}', '${aspas(usuario)}', '${hash}', 'Administrador', 1, datetime('now'));

${linha}
 ENTREGAR AO CLIENTE
${linha}
 Endereço: <URL do site do passo 3>
 Usuário:  ${usuario}
 Senha:    ${senha}     (peça para ele trocar depois do primeiro acesso)
${linha}
`);
