// ---------- PAINEL DO DONO (cadastro de clientes) ----------
// Página /admin do próprio servidor: você cadastra um cliente informando só o
// nome, um login e uma senha. O sistema cria o banco novo dele e o usuário
// administrador — sem criar outro site. Só funciona se ADMIN_SENHA estiver
// definida no servidor (a senha que protege este painel).
const crypto = require('crypto');
const express = require('express');
const tenants = require('./tenants');
const turso = require('./turso');

const router = express.Router();
router.use(express.json());

function exigirAdmin(req, res, next) {
  const senha = process.env.ADMIN_SENHA;
  if (!senha) return res.status(404).json({ ok: false, error: 'Painel desativado. Defina ADMIN_SENHA no servidor.' });
  const enviada = Buffer.from(String(req.headers['x-admin-senha'] || ''));
  const esperada = Buffer.from(senha);
  const ok = enviada.length === esperada.length && crypto.timingSafeEqual(enviada, esperada);
  if (!ok) return setTimeout(() => res.status(401).json({ ok: false, error: 'Senha do painel incorreta.' }), 800);
  next();
}
router.use(exigirAdmin);

const rota = (fn) => async (req, res) => {
  try {
    res.json({ ok: true, ...(await fn(req)) });
  } catch (err) {
    console.error('[Admin]', err && err.message);
    res.status(err.status || 500).json({ ok: false, error: (err && err.message) || 'Erro no servidor.' });
  }
};

router.get('/clientes', rota(async () => ({
  clientes: await tenants.listarClientes(),
  criacaoAutomatica: turso.configurado(),
})));

router.post('/clientes', rota(async (req) => ({ cliente: await tenants.criarCliente(req.body || {}) })));

router.post('/clientes/importar', rota(async (req) => ({ importado: await tenants.importarCliente(req.body || {}) })));

router.post('/clientes/:id/ativo', rota(async (req) => {
  await tenants.definirAtivo(Number(req.params.id), !!(req.body || {}).ativo);
  return {};
}));

router.post('/clientes/:id/senha', rota(async (req) => ({
  senhaRedefinida: await tenants.redefinirSenha(Number(req.params.id), (req.body || {}).login, (req.body || {}).senha),
})));

// Plano do cliente (aparece em "Meu Plano" no sistema dele): data contratada e data de vencimento.
router.post('/clientes/:id/plano', rota(async (req) => ({
  plano: await tenants.definirPlano(Number(req.params.id), { dataContratada: (req.body || {}).dataContratada, dataVencimento: (req.body || {}).dataVencimento }),
})));

// Renovação rápida: +30 dias a partir do vencimento atual (ou de hoje, se já venceu).
router.post('/clientes/:id/renovar', rota(async (req) => ({ plano: await tenants.renovarPlano(Number(req.params.id), 30) })));

router.post('/clientes/:id/sincronizar', rota(async (req) => ({ sincronizado: await tenants.sincronizarCliente(Number(req.params.id)) })));

const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Painel — Clientes</title>
<style>
  :root{color-scheme:light dark;--bg:#f5f6f8;--card:#fff;--tx:#1b1f27;--mut:#6b7280;--bd:#dfe3ea;--pri:#2563eb;--ok:#15803d;--bad:#b91c1c}
  @media (prefers-color-scheme:dark){:root{--bg:#0f1218;--card:#181d27;--tx:#e8ebf1;--mut:#9aa3b2;--bd:#2a3140;--pri:#4c8dff;--ok:#4ade80;--bad:#f87171}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,sans-serif}
  main{max-width:880px;margin:0 auto;padding:20px 14px 60px}h1{font-size:20px;margin:6px 0 16px}h2{font-size:16px;margin:0 0 12px}
  .card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:16px;margin-bottom:16px}
  label{display:block;font-size:13px;color:var(--mut);margin:10px 0 4px}
  input{width:100%;padding:9px 10px;border:1px solid var(--bd);border-radius:7px;background:transparent;color:var(--tx);font:inherit}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){.row{grid-template-columns:1fr}}
  button{padding:9px 14px;border:0;border-radius:7px;background:var(--pri);color:#fff;font:inherit;cursor:pointer}
  button.sec{background:transparent;color:var(--tx);border:1px solid var(--bd)}button:disabled{opacity:.6;cursor:wait}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--bd);vertical-align:middle}
  th{font-size:12px;color:var(--mut);font-weight:600}td.acoes{white-space:nowrap;text-align:right}td.acoes button{margin-left:6px;padding:6px 10px;font-size:13px}
  .tag{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--bd)}.ativo{color:var(--ok)}.bloq{color:var(--bad)}
  .msg{margin:12px 0 0;padding:10px 12px;border-radius:7px;font-size:14px;display:none}.msg.ok{display:block;background:rgba(21,128,61,.12);color:var(--ok)}.msg.erro{display:block;background:rgba(185,28,28,.12);color:var(--bad)}
  .mut{color:var(--mut);font-size:13px}details summary{cursor:pointer;color:var(--mut);font-size:13px;margin-top:12px}
  #login{max-width:360px;margin:12vh auto}
  td.plano{min-width:250px}.plano .l{display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:12px;color:var(--mut)}.plano .l span{width:62px}.plano input{padding:5px 7px;font-size:13px}.plano .bt{display:flex;gap:6px;margin-top:6px}.plano .bt button{padding:5px 9px;font-size:12px}
  .venc-ok{color:var(--ok)}.venc-aviso{color:#b45309}.venc-ruim{color:var(--bad)}
</style></head><body><main>
<div id="login" class="card"><h1>Painel do sistema</h1>
  <label>Senha do painel</label><input id="senhaAdmin" type="password" autocomplete="current-password">
  <p><button id="entrar">Entrar</button></p><div id="msgLogin" class="msg"></div></div>

<div id="painel" style="display:none">
  <h1>Clientes do sistema</h1>
  <div class="card"><h2>Novo cliente</h2>
    <div class="row"><div><label>Nome do cliente / loja</label><input id="nome" placeholder="Ex.: Paulo Silva Celulares"></div>
    <div><label>Nome do usuário (opcional)</label><input id="nomeUsuario" placeholder="Ex.: Paulo Silva"></div></div>
    <div class="row"><div><label>Login</label><input id="login2" placeholder="Ex.: paulo.silva" autocapitalize="none" autocomplete="off"></div>
    <div><label>Senha (mín. 6)</label><input id="senha2" type="text" autocomplete="off"></div></div>
    <div class="row"><div><label>Data contratada (cadastro)</label><input id="dtContratada" type="date"></div>
    <div><label>Vencimento (30 dias)</label><input id="dtVenc" type="date"></div></div>
    <details id="manual"><summary>Já criei o banco no Turso (informar URL e token)</summary>
      <label>URL do banco</label><input id="dbUrl" placeholder="libsql://nome-do-banco-sua-conta.turso.io">
      <label>Token do banco</label><input id="dbToken"></details>
    <p><button id="criar">Criar cliente</button></p><div id="msgCriar" class="msg"></div>
    <p class="mut" id="dicaAuto"></p></div>

  <div class="card"><h2>Clientes cadastrados</h2><div style="overflow-x:auto"><table><thead><tr><th>Cliente</th><th>Banco</th><th>Usuários</th><th>Plano</th><th>Situação</th><th></th></tr></thead><tbody id="lista"></tbody></table></div><div id="msgLista" class="msg"></div></div>

  <div class="card"><h2>Importar um banco que já existe</h2>
    <p class="mut">Use para trazer para este site um cliente que já tinha o próprio sistema (copie TURSO_DATABASE_URL e TURSO_AUTH_TOKEN do Render antigo dele).</p>
    <div class="row"><div><label>Nome do cliente</label><input id="impNome"></div><div><label>URL do banco</label><input id="impUrl" placeholder="libsql://..."></div></div>
    <label>Token do banco</label><input id="impToken">
    <div class="row"><div><label>Data contratada (opcional)</label><input id="impContratada" type="date"></div><div><label>Vencimento (opcional)</label><input id="impVenc" type="date"></div></div>
    <p><button id="importar" class="sec">Importar</button></p><div id="msgImp" class="msg"></div></div>
</div>
<script>
const $ = (id) => document.getElementById(id);
let senha = sessionStorage.getItem('adm') || '';
function hojeIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function somarDias(iso, n) { const p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function diasAte(iso) { const p = iso.split('-').map(Number); const h = hojeIso().split('-').map(Number); return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(h[0], h[1] - 1, h[2])) / 86400000); }
function fmt(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }
function msg(id, tipo, texto) { const e = $(id); e.className = 'msg ' + tipo; e.textContent = texto; }
async function api(metodo, caminho, corpo) {
  const r = await fetch('/api/admin' + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', 'x-admin-senha': senha }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({ ok: false, error: 'Resposta inválida do servidor.' }));
  if (!j.ok) throw new Error(j.error || 'Erro');
  return j;
}
async function carregar() {
  const j = await api('GET', '/clientes');
  $('login').style.display = 'none'; $('painel').style.display = 'block';
  $('dicaAuto').textContent = j.criacaoAutomatica ? 'O banco novo é criado automaticamente no Turso.' : 'Criação automática desativada (faltam TURSO_API_TOKEN e TURSO_ORG no servidor): abra "Já criei o banco no Turso" e informe a URL e o token.';
  if (!j.criacaoAutomatica) $('manual').open = true;
  $('lista').innerHTML = '';
  for (const c of j.clientes) {
    const tr = document.createElement('tr');
    const cel = (t) => { const td = document.createElement('td'); td.textContent = t; return td; };
    tr.appendChild(cel(c.nome)); tr.appendChild(cel(c.banco)); tr.appendChild(cel(String(c.usuarios)));
    const pl = document.createElement('td'); pl.className = 'plano';
    const mk = (rot, val) => { const l = document.createElement('div'); l.className = 'l'; const sp = document.createElement('span'); sp.textContent = rot; const i = document.createElement('input'); i.type = 'date'; i.value = val || ''; l.appendChild(sp); l.appendChild(i); pl.appendChild(l); return i; };
    const inC = mk('Contratado', c.dataContratada); const inV = mk('Vence em', c.dataVencimento);
    inC.onchange = () => { if (inC.value && !inV.value) inV.value = somarDias(inC.value, 30); };
    const stt = document.createElement('div'); stt.style.fontSize = '12px';
    if (c.dataVencimento) { const d = diasAte(c.dataVencimento); stt.className = d < 0 ? 'venc-ruim' : d <= 5 ? 'venc-aviso' : 'venc-ok'; stt.textContent = d < 0 ? 'Vencido há ' + (-d) + ' dia(s)' : d === 0 ? 'Vence hoje' : 'Faltam ' + d + ' dia(s)'; } else { stt.className = 'mut'; stt.textContent = 'Sem datas cadastradas'; }
    pl.appendChild(stt);
    const bt = document.createElement('div'); bt.className = 'bt';
    const bs = document.createElement('button'); bs.textContent = 'Salvar datas';
    bs.onclick = async () => { try { await api('POST', '/clientes/' + c.id + '/plano', { dataContratada: inC.value, dataVencimento: inV.value }); msg('msgLista', 'ok', 'Datas de ' + c.nome + ' salvas.'); carregar(); } catch (e) { msg('msgLista', 'erro', e.message); } };
    const br = document.createElement('button'); br.className = 'sec'; br.textContent = '+30 dias';
    br.onclick = async () => { try { const r = await api('POST', '/clientes/' + c.id + '/renovar'); msg('msgLista', 'ok', c.nome + ' renovado até ' + fmt(r.plano.dataVencimento) + '.'); carregar(); } catch (e) { msg('msgLista', 'erro', e.message); } };
    bt.appendChild(bs); bt.appendChild(br); pl.appendChild(bt); tr.appendChild(pl);
    const sit = document.createElement('td'); const tag = document.createElement('span'); tag.className = 'tag ' + (c.ativo ? 'ativo' : 'bloq'); tag.textContent = c.ativo ? 'Ativo' : 'Bloqueado'; sit.appendChild(tag); tr.appendChild(sit);
    const ac = document.createElement('td'); ac.className = 'acoes';
    const b1 = document.createElement('button'); b1.className = 'sec'; b1.textContent = c.ativo ? 'Bloquear' : 'Liberar';
    b1.onclick = async () => { if (c.ativo && !confirm('Bloquear o acesso de ' + c.nome + '?')) return; try { await api('POST', '/clientes/' + c.id + '/ativo', { ativo: !c.ativo }); carregar(); } catch (e) { msg('msgLista', 'erro', e.message); } };
    const b2 = document.createElement('button'); b2.className = 'sec'; b2.textContent = 'Nova senha';
    b2.onclick = async () => { const nova = prompt('Nova senha para o administrador de ' + c.nome + ' (mín. 6):'); if (!nova) return; try { const r = await api('POST', '/clientes/' + c.id + '/senha', { senha: nova }); msg('msgLista', 'ok', 'Senha de "' + r.senhaRedefinida.usuario + '" alterada.'); } catch (e) { msg('msgLista', 'erro', e.message); } };
    ac.appendChild(b1); ac.appendChild(b2); tr.appendChild(ac); $('lista').appendChild(tr);
  }
}
async function entrar() {
  senha = $('senhaAdmin').value; $('entrar').disabled = true;
  try { sessionStorage.setItem('adm', senha); await carregar(); } catch (e) { sessionStorage.removeItem('adm'); msg('msgLogin', 'erro', e.message); } finally { $('entrar').disabled = false; }
}
$('entrar').onclick = entrar; $('senhaAdmin').onkeydown = (e) => { if (e.key === 'Enter') entrar(); };
$('criar').onclick = async () => {
  $('criar').disabled = true; msg('msgCriar', 'ok', 'Criando o banco e o usuário... pode levar alguns segundos.');
  try {
    const j = await api('POST', '/clientes', { nome: $('nome').value, nomeUsuario: $('nomeUsuario').value, login: $('login2').value, senha: $('senha2').value, dbUrl: $('dbUrl').value, dbToken: $('dbToken').value, dataContratada: $('dtContratada').value, dataVencimento: $('dtVenc').value });
    msg('msgCriar', 'ok', 'Cliente criado! Login: ' + j.cliente.login + ' — ele já pode entrar no site com esse login e a senha informada.');
    ['nome', 'nomeUsuario', 'login2', 'senha2', 'dbUrl', 'dbToken'].forEach((i) => ($(i).value = '')); iniciarDatas(); carregar();
  } catch (e) { msg('msgCriar', 'erro', e.message); } finally { $('criar').disabled = false; }
};
$('importar').onclick = async () => {
  $('importar').disabled = true; msg('msgImp', 'ok', 'Conectando...');
  try {
    const j = await api('POST', '/clientes/importar', { nome: $('impNome').value, dbUrl: $('impUrl').value, dbToken: $('impToken').value, dataContratada: $('impContratada').value, dataVencimento: $('impVenc').value });
    const i = j.importado; let t = 'Importado! ' + i.adicionados + ' login(s) liberado(s) para entrar no site.';
    if (i.conflitos.length) t += ' ATENÇÃO: estes logins já existem em outro cliente e não vão funcionar até serem renomeados: ' + i.conflitos.join(', ') + '.';
    msg('msgImp', i.conflitos.length ? 'erro' : 'ok', t); ['impNome', 'impUrl', 'impToken'].forEach((x) => ($(x).value = '')); carregar();
  } catch (e) { msg('msgImp', 'erro', e.message); } finally { $('importar').disabled = false; }
};
function iniciarDatas() { $('dtContratada').value = hojeIso(); $('dtVenc').value = somarDias(hojeIso(), 30); }
$('dtContratada').onchange = () => { if ($('dtContratada').value) $('dtVenc').value = somarDias($('dtContratada').value, 30); };
iniciarDatas();
if (senha) carregar().catch(() => { sessionStorage.removeItem('adm'); });
</script></main></body></html>`;

function pagina(req, res) {
  res.set('Cache-Control', 'no-store').type('html').send(PAGINA);
}

module.exports = { router, pagina };
