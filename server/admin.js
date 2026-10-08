// ---------- PAINEL DO DONO (cadastro de clientes) ----------
// Página /admin do próprio servidor: você cadastra um cliente informando só o
// nome, um login e uma senha. O sistema cria o banco novo dele e o usuário
// administrador — sem criar outro site. Só funciona se ADMIN_SENHA estiver
// definida no servidor (a senha que protege este painel).
const crypto = require('crypto');
const express = require('express');
const tenants = require('./tenants');
const turso = require('./turso');
const push = require('./push');

const router = express.Router();
router.use(express.json());

function iguais(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Central de Acessos: entra com USUÁRIO + SENHA. A senha é a ADMIN_SENHA do servidor; o usuário é
// ADMIN_USUARIO (se não estiver definido, o usuário é "admin").
function exigirAdmin(req, res, next) {
  const senha = process.env.ADMIN_SENHA;
  if (!senha) return res.status(404).json({ ok: false, error: 'Painel desativado. Defina ADMIN_SENHA no servidor.' });
  const usuario = process.env.ADMIN_USUARIO || 'admin';
  const ok = iguais(String(req.headers['x-admin-usuario'] || '').trim().toLowerCase(), usuario.trim().toLowerCase()) && iguais(req.headers['x-admin-senha'], senha);
  if (!ok) return setTimeout(() => res.status(401).json({ ok: false, error: 'Usuário ou senha incorretos.' }), 800);
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

router.post('/clientes/:id/dados', rota(async (req) => ({ cliente: await tenants.atualizarCliente(Number(req.params.id), req.body || {}) })));

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
router.post('/clientes/:id/renovar', rota(async (req) => ({ plano: await tenants.renovarPlano(Number(req.params.id), Math.min(366, Math.max(1, parseInt((req.body || {}).dias, 10) || 30))) })));

router.post('/clientes/:id/excluir', rota(async (req) => ({ excluido: await tenants.excluirCliente(Number(req.params.id)) })));

// Notificações no celular do dono (aparelhos inscritos pela própria Central).
router.get('/push/chave', rota(async () => ({ chave: await push.chavePublica() })));
router.post('/push/inscrever', rota(async (req) => { await push.inscreverAdmin((req.body || {}).subscription); return {}; }));
router.post('/push/remover', rota(async (req) => { await push.removerAdmin((req.body || {}).endpoint); return {}; }));
router.post('/push/testar', rota(async () => ({ aparelhos: await push.avisarDono('🔔 Teste da Central de Acessos', 'As notificações estão funcionando neste aparelho.') })));

router.post('/clientes/:id/sincronizar', rota(async (req) => ({ sincronizado: await tenants.sincronizarCliente(Number(req.params.id)) })));

const PAGINA = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Central de Acessos</title>
<style>
  :root{--bg:#12101c;--card:#1b1829;--card2:#221e33;--bd:#2d2842;--tx:#ecebf3;--mut:#9a96b0;--pri:#3b82f6;--ok:#34c38f;--warn:#f0a93b;--bad:#ef5a5a}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 'Segoe UI',system-ui,sans-serif}
  main{max-width:1320px;margin:0 auto;padding:26px 18px 70px}
  .topo{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:22px}
  h1{font-size:28px;margin:0;font-family:Georgia,'Times New Roman',serif;display:flex;align-items:center;gap:10px}
  .btn{padding:11px 18px;border:1px solid var(--bd);border-radius:10px;background:transparent;color:var(--tx);font:inherit;font-weight:600;cursor:pointer}
  .btn:hover{background:var(--card2)}.btn.pri{background:var(--pri);border-color:var(--pri);color:#fff}.btn.pri:hover{filter:brightness(1.08)}
  .btn.ok{background:var(--ok);border-color:var(--ok);color:#06281c}.btn.sm{padding:8px 13px;font-size:14px}.btn:disabled{opacity:.6;cursor:wait}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-bottom:22px}
  .kpi{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:18px 20px}
  .kpi .t{font-size:12.5px;letter-spacing:.04em;color:var(--mut);text-transform:uppercase;font-weight:600}
  .kpi .v{font-size:34px;font-family:Georgia,serif;font-weight:700;margin:6px 0 2px}.kpi .s{font-size:13.5px;color:var(--mut)}
  .c-ok{color:var(--ok)}.c-warn{color:var(--warn)}.c-bad{color:var(--bad)}
  .filtros{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:18px}
  .chip{padding:10px 17px;border-radius:999px;border:1px solid var(--bd);background:transparent;color:var(--mut);font:inherit;cursor:pointer}
  .chip.on{background:var(--pri);border-color:var(--pri);color:#fff;font-weight:600}
  .busca{flex:1;min-width:220px;padding:13px 16px;border-radius:12px;border:1px solid var(--bd);background:var(--card);color:var(--tx);font:inherit}
  .lista{display:flex;flex-direction:column;gap:14px}
  .ass{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:20px 22px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .av{width:54px;height:54px;border-radius:14px;background:#3a2740;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;flex-shrink:0}
  .info{flex:1;min-width:240px}.nome{font-size:18px;font-weight:700;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .tag{font-size:12.5px;padding:3px 11px;border-radius:99px;font-weight:600}
  .tag.ativa{background:rgba(52,195,143,.16);color:var(--ok)}.tag.avencer{background:rgba(240,169,59,.16);color:var(--warn)}
  .tag.vencida,.tag.bloqueada{background:rgba(239,90,90,.16);color:var(--bad)}
  .l2{color:var(--mut);font-size:14.5px;margin-top:3px}.l2 b{color:var(--tx)}
  .acoes{display:flex;gap:8px;align-items:center;position:relative}
  .menu{position:absolute;right:0;top:46px;background:var(--card2);border:1px solid var(--bd);border-radius:12px;min-width:190px;padding:6px;z-index:20;box-shadow:0 10px 30px rgba(0,0,0,.45)}
  .menu button{display:block;width:100%;text-align:left;background:none;border:0;color:var(--tx);padding:10px 12px;border-radius:8px;font:inherit;cursor:pointer}
  .menu button:hover{background:var(--card)}.menu .perigo{color:var(--bad)}
  .vazio{padding:50px 10px;text-align:center;color:var(--mut)}
  .fundo{position:fixed;inset:0;background:rgba(0,0,0,.65);display:none;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 14px;z-index:50}
  .fundo.on{display:flex}.modal{background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:24px;width:100%;max-width:560px}
  .modal h2{margin:0 0 6px;font-size:21px;font-family:Georgia,serif}label{display:block;font-size:13px;color:var(--mut);margin:12px 0 5px}
  input,select{width:100%;padding:11px 12px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--tx);font:inherit}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){.row{grid-template-columns:1fr}}
  .rod{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.msg{margin-top:12px;padding:10px 12px;border-radius:9px;font-size:14px;display:none}
  .msg.ok{display:block;background:rgba(52,195,143,.14);color:var(--ok)}.msg.erro{display:block;background:rgba(239,90,90,.14);color:var(--bad)}
  .mut{color:var(--mut);font-size:13px}details summary{cursor:pointer;color:var(--mut);font-size:13.5px;margin-top:14px}
  #login{max-width:400px;margin:14vh auto 0;background:var(--card);border:1px solid var(--bd);border-radius:18px;padding:28px}
  #login h1{font-size:24px;margin-bottom:6px}
  #toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:var(--card2);border:1px solid var(--bd);padding:12px 18px;border-radius:12px;display:none;z-index:80}
</style></head><body><main>

<div id="login">
  <h1>🛡️ Central de Acessos</h1>
  <p class="mut" style="margin:0 0 6px">Entre com seu usuário e senha de administrador.</p>
  <label>Usuário</label><input id="usuAdmin" autocomplete="username" autocapitalize="none">
  <label>Senha</label><input id="senhaAdmin" type="password" autocomplete="current-password">
  <p><button id="entrar" class="btn pri" style="width:100%">Entrar</button></p><div id="msgLogin" class="msg"></div>
</div>

<div id="painel" style="display:none">
  <div class="topo">
    <h1>🛡️ Central de Acessos</h1>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn" id="btNotif">🔔 Ativar notificações</button>
      <button class="btn" id="btImportar">Importar banco</button>
      <button class="btn pri" id="btNovo">+ Novo assinante</button>
      <button class="btn" id="btSair">Sair</button>
    </div>
  </div>
  <div class="kpis" id="kpis"></div>
  <div class="filtros" id="filtros"></div>
  <div class="lista" id="lista"></div>
</div>

<!-- Novo assinante -->
<div class="fundo" id="mNovo"><div class="modal">
  <h2>Novo assinante</h2><p class="mut" style="margin:0">Cria o banco do cliente e o usuário administrador dele.</p>
  <div class="row"><div><label>Nome do cliente / loja</label><input id="nNome" placeholder="Ex.: Paulo Silva Celulares"></div>
  <div><label>Nome do usuário (opcional)</label><input id="nNomeUsu" placeholder="Ex.: Paulo Silva"></div></div>
  <div class="row"><div><label>Login do cliente</label><input id="nLogin" placeholder="Ex.: paulo.silva" autocapitalize="none" autocomplete="off"></div>
  <div><label>Senha (mín. 6)</label><input id="nSenha" type="text" autocomplete="off"></div></div>
  <div class="row"><div><label>Contato (responsável)</label><input id="nContato" placeholder="Ex.: Paulo"></div>
  <div><label>WhatsApp / telefone</label><input id="nTel" placeholder="61999999999"></div></div>
  <div class="row"><div><label>Mensalidade (R$)</label><input id="nValor" inputmode="decimal" placeholder="49,90"></div><div></div></div>
  <div class="row"><div><label>Data contratada</label><input id="nContratada" type="date"></div>
  <div><label>Vencimento (30 dias)</label><input id="nVenc" type="date"></div></div>
  <details id="manual"><summary>Já criei o banco no Turso (informar URL e token)</summary>
    <label>URL do banco</label><input id="nDbUrl" placeholder="libsql://nome-do-banco-sua-conta.turso.io">
    <label>Token do banco</label><input id="nDbToken"></details>
  <p class="mut" id="dicaAuto"></p>
  <div id="msgNovo" class="msg"></div>
  <div class="rod"><button class="btn" data-fechar="mNovo">Cancelar</button><button class="btn pri" id="criar">Criar assinante</button></div>
</div></div>

<!-- Editar -->
<div class="fundo" id="mEditar"><div class="modal">
  <h2 id="eTitulo">Editar</h2>
  <label>Nome do cliente / loja</label><input id="eNome">
  <div class="row"><div><label>Contato (responsável)</label><input id="eContato"></div><div><label>WhatsApp / telefone</label><input id="eTel"></div></div>
  <div class="row"><div><label>Mensalidade (R$)</label><input id="eValor" inputmode="decimal"></div><div></div></div>
  <div class="row"><div><label>Data contratada</label><input id="eContratada" type="date"></div><div><label>Vencimento</label><input id="eVenc" type="date"></div></div>
  <div id="msgEditar" class="msg"></div>
  <div class="rod"><button class="btn" data-fechar="mEditar">Cancelar</button><button class="btn pri" id="salvarEd">Salvar</button></div>
</div></div>

<!-- Importar -->
<div class="fundo" id="mImportar"><div class="modal">
  <h2>Importar um banco que já existe</h2>
  <p class="mut" style="margin:0">Traz para este site um cliente que já tinha o próprio sistema (copie TURSO_DATABASE_URL e TURSO_AUTH_TOKEN do Render antigo dele).</p>
  <div class="row"><div><label>Nome do cliente</label><input id="iNome"></div><div><label>URL do banco</label><input id="iUrl" placeholder="libsql://..."></div></div>
  <label>Token do banco</label><input id="iToken">
  <div class="row"><div><label>Data contratada (opcional)</label><input id="iContratada" type="date"></div><div><label>Vencimento (opcional)</label><input id="iVenc" type="date"></div></div>
  <div id="msgImp" class="msg"></div>
  <div class="rod"><button class="btn" data-fechar="mImportar">Cancelar</button><button class="btn pri" id="importar">Importar</button></div>
</div></div>

<div id="toast"></div>

<script>
var $ = function (id) { return document.getElementById(id); };
var usuario = sessionStorage.getItem('admU') || '';
var senha = sessionStorage.getItem('adm') || '';
var dados = [], filtro = 'todas', termo = '', menuAberto = null, editando = null;

function pad(n) { return String(n).padStart(2, '0'); }
function hojeIso() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function somarDias(iso, n) { var p = iso.split('-').map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10); }
function diasAte(iso) { var p = iso.split('-').map(Number); var h = hojeIso().split('-').map(Number); return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(h[0], h[1] - 1, h[2])) / 86400000); }
function fmt(iso) { return iso ? iso.split('-').reverse().join('/') : '—'; }
function brl(n) { return 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ','); }
function msg(id, tipo, texto) { var e = $(id); e.className = 'msg ' + tipo; e.textContent = texto; }
function toast(t) { var e = $('toast'); e.textContent = t; e.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(function () { e.style.display = 'none'; }, 3500); }
function h(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }

async function api(metodo, caminho, corpo) {
  var r = await fetch('/api/admin' + caminho, { method: metodo, headers: { 'Content-Type': 'application/json', 'x-admin-usuario': usuario, 'x-admin-senha': senha }, body: corpo ? JSON.stringify(corpo) : undefined });
  var j = await r.json().catch(function () { return { ok: false, error: 'Resposta inválida do servidor.' }; });
  if (!j.ok) throw new Error(j.error || 'Erro');
  return j;
}

function situacao(c) {
  if (!c.ativo) return { chave: 'bloqueada', texto: 'Bloqueada', dias: null };
  if (!c.dataVencimento) return { chave: 'ativa', texto: 'Ativa', dias: null };
  var d = diasAte(c.dataVencimento);
  if (c.teste) return d < 0 ? { chave: 'bloqueada', texto: 'Teste encerrado', dias: d } : { chave: 'avencer', texto: 'Teste grátis', dias: d };
  if (d < 0 && !c.principal) return { chave: 'bloqueada', texto: 'Vencida (bloqueada)', dias: d };
  if (d < 0) return { chave: 'vencida', texto: 'Vencida', dias: d };
  if (d <= 5) return { chave: 'avencer', texto: 'A vencer', dias: d };
  return { chave: 'ativa', texto: 'Ativa', dias: d };
}

function desenharKpis() {
  var ativos = 0, receita = 0, vencem = 0, ruins = 0;
  dados.forEach(function (c) {
    var s = situacao(c);
    if (s.chave === 'ativa' || s.chave === 'avencer') { ativos++; receita += c.valorMensal || 0; }
    if (s.chave === 'avencer') vencem++;
    if (s.chave === 'vencida' || s.chave === 'bloqueada') ruins++;
  });
  var itens = [
    ['Assinantes ativos', String(ativos), 'de ' + dados.length + ' cadastrados', 'c-ok'],
    ['Receita mensal', brl(receita), 'soma dos ativos', ''],
    ['Vencem em 5 dias', String(vencem), 'hora de cobrar', 'c-warn'],
    ['Vencidos / bloqueados', String(ruins), 'sem acesso ou em atraso', 'c-bad']
  ];
  $('kpis').innerHTML = '';
  itens.forEach(function (k) {
    var d = h('div', 'kpi'); d.appendChild(h('div', 't', k[0])); d.appendChild(h('div', 'v ' + k[3], k[1])); d.appendChild(h('div', 's', k[2])); $('kpis').appendChild(d);
  });
}

function desenharFiltros() {
  var f = [['todas', 'Todas'], ['ativa', 'Ativa'], ['avencer', 'A vencer'], ['vencida', 'Vencida'], ['bloqueada', 'Bloqueada']];
  $('filtros').innerHTML = '';
  f.forEach(function (x) {
    var b = h('button', 'chip' + (filtro === x[0] ? ' on' : ''), x[1]);
    b.onclick = function () { filtro = x[0]; desenharFiltros(); desenharLista(); };
    $('filtros').appendChild(b);
  });
  var i = h('input', 'busca'); i.placeholder = 'Buscar nome, login, telefone…'; i.value = termo;
  i.oninput = function () { termo = i.value; desenharLista(); };
  $('filtros').appendChild(i);
}

function linkWhats(c, texto) {
  var n = String(c.contatoTelefone || '').replace(/[^0-9]/g, '');
  if (!n) return null;
  if (n.length <= 11) n = '55' + n;
  return 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto);
}

function desenharLista() {
  var q = termo.trim().toLowerCase();
  var lista = dados.filter(function (c) {
    if (filtro !== 'todas' && situacao(c).chave !== filtro) return false;
    if (!q) return true;
    return [c.nome, c.login, c.contatoNome, c.contatoTelefone, c.banco].join(' ').toLowerCase().indexOf(q) >= 0;
  });
  var box = $('lista'); box.innerHTML = '';
  if (!lista.length) { box.appendChild(h('div', 'vazio', 'Nenhum assinante encontrado.')); return; }
  lista.forEach(function (c) {
    var s = situacao(c);
    var card = h('div', 'ass');
    card.appendChild(h('div', 'av', (c.nome || '?').trim().charAt(0).toUpperCase()));
    var info = h('div', 'info');
    var n = h('div', 'nome'); n.appendChild(document.createTextNode(c.nome)); n.appendChild(h('span', 'tag ' + s.chave, s.texto)); info.appendChild(n);
    var l1 = h('div', 'l2'); var partes = [];
    if (c.login) partes.push('login <b></b>');
    var t1 = []; if (c.contatoNome) t1.push(c.contatoNome); if (c.contatoTelefone) t1.push(c.contatoTelefone);
    l1.textContent = ''; 
    if (c.login) { l1.appendChild(document.createTextNode('login ')); l1.appendChild(h('b', '', c.login)); }
    if (t1.length) l1.appendChild(document.createTextNode((c.login ? ' · ' : '') + t1.join(' · ')));
    if (!c.login && !t1.length) l1.textContent = c.banco;
    info.appendChild(l1);
    var l2 = h('div', 'l2'); var txt = '';
    if (c.dataVencimento) {
      txt = s.chave === 'bloqueada' ? 'vencimento ' + fmt(c.dataVencimento) : s.dias < 0 ? 'venceu em ' + fmt(c.dataVencimento) + ' (há ' + (-s.dias) + ' dia' + (s.dias === -1 ? '' : 's') + ')' : s.dias === 0 ? 'vence hoje (' + fmt(c.dataVencimento) + ')' : 'vence ' + fmt(c.dataVencimento) + ' (' + s.dias + ' dia' + (s.dias === 1 ? '' : 's') + ')';
    } else txt = 'sem datas cadastradas';
    txt += ' · ' + (c.valorMensal != null ? brl(c.valorMensal) + '/mês' : 'sem mensalidade') + ' · ' + c.usuarios + ' usuário' + (c.usuarios === 1 ? '' : 's');
    l2.textContent = txt; info.appendChild(l2); card.appendChild(info);

    var ac = h('div', 'acoes');
    var br = h('button', 'btn ok sm', 'Renovar'); br.onclick = function () { renovar(c); }; ac.appendChild(br);
    var be = h('button', 'btn sm', 'Editar'); be.onclick = function () { abrirEditar(c); }; ac.appendChild(be);
    var bm = h('button', 'btn sm', '···'); bm.onclick = function (ev) { ev.stopPropagation(); menuAberto = menuAberto === c.id ? null : c.id; desenharLista(); }; ac.appendChild(bm);
    if (menuAberto === c.id) {
      var m = h('div', 'menu');
      var add = function (rot, fn, cls) { var b = h('button', cls || '', rot); b.onclick = function (ev) { ev.stopPropagation(); menuAberto = null; fn(); desenharLista(); }; m.appendChild(b); };
      add('📅 Renovar por 60 dias', function () { renovar(c, 60); });
      add('📅 Renovar por 365 dias', function () { renovar(c, 365); });
      add('🔑 Nova senha do cliente', function () { novaSenha(c); });
      var lk = linkWhats(c, 'Olá' + (c.contatoNome ? ', ' + c.contatoNome : '') + '! Passando para lembrar do vencimento do seu sistema' + (c.dataVencimento ? ' (' + fmt(c.dataVencimento) + ')' : '') + '. Posso gerar o Pix para renovar? 🙏');
      if (lk) add('💬 Cobrar no WhatsApp', function () { window.open(lk, '_blank'); });
      if (!c.principal) add('🗑️ Excluir cadastro', function () { excluir(c); }, 'perigo');
      add(c.ativo ? '⛔ Bloquear acesso' : '✅ Liberar acesso', function () { alternar(c); }, c.ativo ? 'perigo' : '');
      ac.appendChild(m);
    }
    card.appendChild(ac); box.appendChild(card);
  });
}
document.addEventListener('click', function () { if (menuAberto !== null) { menuAberto = null; desenharLista(); } });

async function renovar(c, dias) {
  dias = dias || 30;
  try { var r = await api('POST', '/clientes/' + c.id + '/renovar', { dias: dias }); toast(c.nome + ' renovado até ' + fmt(r.plano.dataVencimento) + '.'); carregar(); } catch (e) { toast(e.message); }
}
async function alternar(c) {
  if (c.ativo && !confirm('Bloquear o acesso de ' + c.nome + '?')) return;
  try { await api('POST', '/clientes/' + c.id + '/ativo', { ativo: !c.ativo }); toast(c.ativo ? 'Acesso bloqueado.' : 'Acesso liberado.'); carregar(); } catch (e) { toast(e.message); }
}
async function excluir(c) {
  if (!confirm('EXCLUIR o cadastro de "' + c.nome + '"?\\n\\nO cliente perde o acesso na hora e o banco de dados dele pode ser apagado. Isso não pode ser desfeito.')) return;
  var conf = prompt('Para confirmar, digite EXCLUIR:'); if (conf === null) return;
  if (String(conf).trim().toUpperCase() !== 'EXCLUIR') { toast('Exclusão cancelada.'); return; }
  try { await api('POST', '/clientes/' + c.id + '/excluir', {}); toast('Cadastro de ' + c.nome + ' excluído.'); carregar(); } catch (e) { toast(e.message); }
}
async function novaSenha(c) {
  var nova = prompt('Nova senha para o administrador de ' + c.nome + ' (mín. 6):'); if (!nova) return;
  try { var r = await api('POST', '/clientes/' + c.id + '/senha', { senha: nova }); toast('Senha de "' + r.senhaRedefinida.usuario + '" alterada.'); } catch (e) { toast(e.message); }
}

function abrirEditar(c) {
  editando = c; $('eTitulo').textContent = 'Editar — ' + c.nome;
  $('eNome').value = c.nome; $('eContato').value = c.contatoNome || ''; $('eTel').value = c.contatoTelefone || '';
  $('eValor').value = c.valorMensal != null ? String(c.valorMensal).replace('.', ',') : '';
  $('eContratada').value = c.dataContratada || ''; $('eVenc').value = c.dataVencimento || '';
  $('msgEditar').className = 'msg'; $('mEditar').classList.add('on');
}
$('eContratada').onchange = function () { if ($('eContratada').value && !$('eVenc').value) $('eVenc').value = somarDias($('eContratada').value, 30); };
$('salvarEd').onclick = async function () {
  $('salvarEd').disabled = true;
  try {
    await api('POST', '/clientes/' + editando.id + '/dados', { nome: $('eNome').value, valorMensal: $('eValor').value, contatoNome: $('eContato').value, contatoTelefone: $('eTel').value });
    await api('POST', '/clientes/' + editando.id + '/plano', { dataContratada: $('eContratada').value, dataVencimento: $('eVenc').value });
    $('mEditar').classList.remove('on'); toast('Dados salvos.'); carregar();
  } catch (e) { msg('msgEditar', 'erro', e.message); } finally { $('salvarEd').disabled = false; }
};

async function carregar() {
  var j = await api('GET', '/clientes');
  $('login').style.display = 'none'; $('painel').style.display = 'block';
  dados = j.clientes;
  $('dicaAuto').textContent = j.criacaoAutomatica ? 'O banco novo é criado automaticamente no Turso.' : 'Criação automática desativada (faltam TURSO_API_TOKEN e TURSO_ORG no servidor): abra "Já criei o banco no Turso" e informe a URL e o token.';
  if (!j.criacaoAutomatica) $('manual').open = true;
  desenharKpis(); desenharFiltros(); desenharLista();
}
async function entrar() {
  usuario = $('usuAdmin').value.trim(); senha = $('senhaAdmin').value; $('entrar').disabled = true;
  try { sessionStorage.setItem('admU', usuario); sessionStorage.setItem('adm', senha); await carregar(); }
  catch (e) { sessionStorage.removeItem('adm'); sessionStorage.removeItem('admU'); msg('msgLogin', 'erro', e.message); } finally { $('entrar').disabled = false; }
}
$('entrar').onclick = entrar; $('senhaAdmin').onkeydown = function (e) { if (e.key === 'Enter') entrar(); }; $('usuAdmin').onkeydown = function (e) { if (e.key === 'Enter') $('senhaAdmin').focus(); };

// ---- Notificações no celular (Web Push) ----
var swReg = null;
function b64ParaBytes(s) { var p = '='.repeat((4 - s.length % 4) % 4); var b = (s + p).replace(/-/g, '+').replace(/_/g, '/'); var raw = atob(b); var o = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) o[i] = raw.charCodeAt(i); return o; }
async function estadoNotif() {
  var b = $('btNotif');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { b.textContent = '🔔 Sem suporte neste navegador'; b.disabled = true; return; }
  try {
    swReg = swReg || await navigator.serviceWorker.register('/admin-sw.js');
    var sub = await swReg.pushManager.getSubscription();
    b.textContent = sub ? '🔕 Desativar notificações' : '🔔 Ativar notificações';
    b.dataset.ativo = sub ? '1' : '';
  } catch (e) { b.textContent = '🔔 Ativar notificações'; }
}
async function alternarNotif() {
  var b = $('btNotif'); b.disabled = true;
  try {
    swReg = swReg || await navigator.serviceWorker.register('/admin-sw.js');
    var sub = await swReg.pushManager.getSubscription();
    if (sub) {
      await api('POST', '/push/remover', { endpoint: sub.endpoint }); await sub.unsubscribe(); toast('Notificações desativadas neste aparelho.');
    } else {
      var perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Permita as notificações no navegador para ativar.'); return; }
      var chave = (await api('GET', '/push/chave')).chave;
      sub = await swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ParaBytes(chave) });
      await api('POST', '/push/inscrever', { subscription: sub.toJSON() });
      var r = await api('POST', '/push/testar', {});
      toast('Notificações ativadas! Enviei um aviso de teste.');
    }
  } catch (e) { toast('Não foi possível: ' + e.message); } finally { b.disabled = false; estadoNotif(); }
}
$('btNotif').onclick = alternarNotif;
estadoNotif();

$('btSair').onclick = function () { sessionStorage.removeItem('adm'); sessionStorage.removeItem('admU'); location.reload(); };

function iniciarDatas() { $('nContratada').value = hojeIso(); $('nVenc').value = somarDias(hojeIso(), 30); }
$('nContratada').onchange = function () { if ($('nContratada').value) $('nVenc').value = somarDias($('nContratada').value, 30); };
$('btNovo').onclick = function () { iniciarDatas(); $('msgNovo').className = 'msg'; $('mNovo').classList.add('on'); };
$('btImportar').onclick = function () { $('msgImp').className = 'msg'; $('mImportar').classList.add('on'); };
document.querySelectorAll('[data-fechar]').forEach(function (b) { b.onclick = function () { $(b.getAttribute('data-fechar')).classList.remove('on'); }; });

$('criar').onclick = async function () {
  $('criar').disabled = true; msg('msgNovo', 'ok', 'Criando o banco e o usuário... pode levar alguns segundos.');
  try {
    var j = await api('POST', '/clientes', { nome: $('nNome').value, nomeUsuario: $('nNomeUsu').value, login: $('nLogin').value, senha: $('nSenha').value, dbUrl: $('nDbUrl').value, dbToken: $('nDbToken').value, dataContratada: $('nContratada').value, dataVencimento: $('nVenc').value, valorMensal: $('nValor').value, contatoNome: $('nContato').value, contatoTelefone: $('nTel').value });
    $('mNovo').classList.remove('on'); toast('Assinante criado! Login: ' + j.cliente.login + ' — já pode entrar no sistema.');
    ['nNome', 'nNomeUsu', 'nLogin', 'nSenha', 'nDbUrl', 'nDbToken', 'nContato', 'nTel', 'nValor'].forEach(function (i) { $(i).value = ''; }); carregar();
  } catch (e) { msg('msgNovo', 'erro', e.message); } finally { $('criar').disabled = false; }
};
$('importar').onclick = async function () {
  $('importar').disabled = true; msg('msgImp', 'ok', 'Conectando...');
  try {
    var j = await api('POST', '/clientes/importar', { nome: $('iNome').value, dbUrl: $('iUrl').value, dbToken: $('iToken').value, dataContratada: $('iContratada').value, dataVencimento: $('iVenc').value });
    var i = j.importado; var t = 'Importado! ' + i.adicionados + ' login(s) liberado(s) para entrar no site.';
    if (i.conflitos.length) t += ' ATENÇÃO: estes logins já existem em outro cliente e não vão funcionar até serem renomeados: ' + i.conflitos.join(', ') + '.';
    msg('msgImp', i.conflitos.length ? 'erro' : 'ok', t); ['iNome', 'iUrl', 'iToken'].forEach(function (x) { $(x).value = ''; }); carregar();
  } catch (e) { msg('msgImp', 'erro', e.message); } finally { $('importar').disabled = false; }
};
if (senha) carregar().catch(function () { sessionStorage.removeItem('adm'); sessionStorage.removeItem('admU'); });
</script></main></body></html>
`;

// Service worker da Central (recebe as notificações no celular do dono).
function swAdmin(req, res) {
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  res.send([
    "self.addEventListener('install', function () { self.skipWaiting(); });",
    "self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });",
    "self.addEventListener('push', function (e) {",
    "  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) {}",
    "  e.waitUntil(self.registration.showNotification(d.titulo || 'Reboot Tech', { body: d.corpo || '', tag: d.tag, data: { url: d.url || '/admin' } }));",
    "});",
    "self.addEventListener('notificationclick', function (e) {",
    "  e.notification.close();",
    "  e.waitUntil(self.clients.openWindow((e.notification.data && e.notification.data.url) || '/admin'));",
    "});",
  ].join('\n'));
}

function pagina(req, res) {
  res.set('Cache-Control', 'no-store').type('html').send(PAGINA);
}

module.exports = { router, pagina, swAdmin };
