// ---------- ACOMPANHAMENTO DA OS PELO CLIENTE (página pública, sem login) ----------
// O link vai impresso em QR code na OS e também na mensagem de WhatsApp. O código do link é
// "<empresa>-<os>-<assinatura>"; a assinatura é um HMAC com o segredo do servidor, então ninguém
// consegue adivinhar o link de outra OS (e não precisa guardar nada no banco). A página só mostra o
// essencial: status, aparelho, datas e contato da loja — nunca senha, CPF ou dados financeiros detalhados.
const crypto = require('crypto');
const express = require('express');
const tenants = require('./tenants');

const SEGREDO = process.env.JWT_SECRET || 'reboot-tech-dev';

function assinar(clienteId, osId) {
  return crypto.createHmac('sha256', SEGREDO).update(`acomp:${clienteId}:${osId}`).digest('hex').slice(0, 16);
}
function gerarCodigo(clienteId, osId) {
  return `${clienteId}-${osId}-${assinar(clienteId, osId)}`;
}
function lerCodigo(codigo) {
  const m = /^(\d{1,9})-(\d{1,9})-([a-f0-9]{16})$/.exec(String(codigo || ''));
  if (!m) return null;
  const clienteId = Number(m[1]); const osId = Number(m[2]);
  const esperado = Buffer.from(assinar(clienteId, osId));
  const recebido = Buffer.from(m[3]);
  if (esperado.length !== recebido.length || !crypto.timingSafeEqual(esperado, recebido)) return null;
  return { clienteId, osId };
}
function baseUrl(req) {
  const fixa = process.env.PUBLIC_URL;
  if (fixa) return fixa.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}
function linkDaOs(req, osId) {
  return `${baseUrl(req)}/acompanhar/${gerarCodigo(tenants.clienteIdDe(req), osId)}`;
}

// limitador simples por IP (60 consultas por minuto)
const hits = new Map();
function limitar(req, res, next) {
  const ip = req.ip || 'x';
  const agora = Date.now();
  const h = (hits.get(ip) || []).filter((t) => agora - t < 60000);
  h.push(agora); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  if (h.length > 60) return res.status(429).json({ ok: false, error: 'Muitas consultas. Aguarde um minuto.' });
  next();
}

const router = express.Router();

router.get('/:codigo', limitar, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const dec = lerCodigo(req.params.codigo);
  if (!dec) return res.status(404).json({ ok: false, error: 'Link inválido. Confira o QR code do seu comprovante.' });
  try {
    const cliente = await tenants.buscarCliente(dec.clienteId);
    if (!cliente || !cliente.ativo || tenants.planoVencido(cliente)) {
      return res.status(404).json({ ok: false, error: 'Acompanhamento indisponível no momento. Fale com a assistência.' });
    }
    const db = await tenants.bancoDoCliente(cliente);
    const os = await db.get(
      `SELECT os.id, os.numero, os.status, os.defeito_informado, os.servicos_executados, os.valor_total, os.garantia_dias,
              os.data_entrada, os.previsao, os.data_saida, os.atualizado_em, c.nome as cliente_nome,
              eq.marca as equip_marca, eq.modelo as equip_modelo
       FROM ordens_servico os
       LEFT JOIN clientes c ON c.id = os.cliente_id
       LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
       WHERE os.id = ?`, [dec.osId]
    );
    if (!os) return res.status(404).json({ ok: false, error: 'Ordem de serviço não encontrada.' });
    const emp = (await db.get('SELECT nome, nome_fantasia, telefone, whatsapp, endereco, numero, bairro, cidade, uf, logo FROM configuracoes_empresa WHERE id = 1').catch(() => null)) || {};
    let historico = [];
    try {
      const logs = await db.all(`SELECT detalhes, criado_em FROM logs WHERE entidade = 'ordens_servico' AND entidade_id = ? AND acao = 'MUDAR_STATUS' ORDER BY id ASC`, [dec.osId]);
      historico = logs.map((l) => ({ para: String(l.detalhes || '').split('->').pop().trim(), em: l.criado_em })).filter((l) => l.para);
    } catch (e) { /* sem histórico: mostra só o status atual */ }
    res.json({
      ok: true,
      empresa: {
        nome: emp.nome_fantasia || emp.nome || cliente.nome || 'Assistência Técnica',
        telefone: emp.whatsapp || emp.telefone || '',
        endereco: [emp.endereco, emp.numero, emp.bairro, [emp.cidade, emp.uf].filter(Boolean).join('/')].filter(Boolean).join(', '),
        logo: emp.logo && String(emp.logo).length < 400000 ? emp.logo : '',
      },
      os: {
        numero: os.numero, status: os.status, cliente: String(os.cliente_nome || '').split(/\s+/)[0] || '',
        aparelho: [os.equip_marca, os.equip_modelo].filter(Boolean).join(' '),
        defeito: os.defeito_informado || '', servicos: os.servicos_executados || '',
        valor_total: Number(os.valor_total) || 0, garantia_dias: Number(os.garantia_dias) || 0,
        entrada: os.data_entrada || '', previsao: os.previsao || '', saida: os.data_saida || '', atualizado_em: os.atualizado_em || '',
      },
      historico,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Não foi possível consultar agora. Tente novamente em instantes.' });
  }
});

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Acompanhe seu conserto</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0d1020;color:#f2f4fa;min-height:100vh}
.w{max-width:520px;margin:0 auto;padding:20px 16px 40px}
.top{display:flex;align-items:center;gap:12px;margin-bottom:18px}.top img{width:48px;height:48px;border-radius:12px;object-fit:cover;background:#fff}
.top b{font-size:18px}.top small{display:block;color:#9aa3c0;font-size:12.5px}
.card{background:#171b30;border:1px solid #262c4a;border-radius:18px;padding:18px;margin-bottom:14px}
.st{font-size:12px;letter-spacing:1px;color:#9aa3c0;font-weight:700}.big{font-size:28px;font-weight:800;margin:6px 0 4px}
.msg{color:#cfd5ea;line-height:1.45;font-size:15px}
.badge{display:inline-block;padding:4px 12px;border-radius:99px;font-size:12.5px;font-weight:700;background:#2a2f52;color:#c9d0f2}
.ok{color:#5ee08f}.warn{color:#ffd166}.bad{color:#ff7b7b}
.steps{list-style:none;margin:0;padding:0}.steps li{position:relative;padding:0 0 18px 38px;color:#7c85a8;font-size:15px}
.steps li:last-child{padding-bottom:0}
.steps li:before{content:"";position:absolute;left:11px;top:24px;bottom:0;width:2px;background:#2b3152}.steps li:last-child:before{display:none}
.steps li i{position:absolute;left:0;top:0;width:24px;height:24px;border-radius:50%;background:#262c4a;border:2px solid #333b64;display:flex;align-items:center;justify-content:center;font-style:normal;font-size:12px}
.steps li.d{color:#e6e9f6}.steps li.d i{background:#1f9d57;border-color:#1f9d57;color:#fff}.steps li.d:before{background:#1f9d57}
.steps li.c{color:#fff;font-weight:700}.steps li.c i{background:#f7c948;border-color:#f7c948;color:#222;box-shadow:0 0 0 5px rgba(247,201,72,.2)}
.row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #232844;font-size:14.5px}.row:last-child{border:0}.row span{color:#9aa3c0}.row b{text-align:right}
a.btn{display:block;text-align:center;background:linear-gradient(135deg,#ffd666,#e0a526);color:#1a1a10;font-weight:800;text-decoration:none;padding:14px;border-radius:14px;margin-top:6px}
.foot{text-align:center;color:#6e7699;font-size:12px;margin-top:20px}.hist{font-size:13.5px;color:#aab2d2}.hist div{padding:4px 0}
</style></head><body><div class="w" id="app"><div class="card">Carregando…</div></div>
<script>
(function(){
var cod=location.pathname.split('/').filter(Boolean).pop();
var ETAPAS=['Recebido','Em análise','Em manutenção','Teste','Pronto','Entregue'];
var TEXTO={'Recebido':['Recebemos o seu aparelho','Ele já está registrado e logo começa a ser analisado.'],
'Em análise':['Estamos analisando o aparelho','Nosso técnico está fazendo o diagnóstico.'],
'Aguardando aprovação':['Aguardando a sua aprovação','O orçamento está pronto. Fale com a assistência para aprovar o serviço.'],
'Aguardando peça':['Aguardando a chegada da peça','Assim que a peça chegar, o conserto continua.'],
'Em manutenção':['Em manutenção','O seu aparelho está sendo consertado agora.'],
'Teste':['Em testes finais','O conserto terminou e estamos testando tudo.'],
'Pronto':['Pronto para retirada! 🎉','Pode vir buscar o seu aparelho. Leve o comprovante ou diga o número da OS.'],
'Entregue':['Aparelho entregue','Obrigado pela confiança! Qualquer dúvida, fale com a gente.'],
'Cancelado':['Ordem de serviço cancelada','Fale com a assistência se precisar de mais informações.']};
var MAPA={'Aguardando aprovação':1,'Aguardando peça':2};
var app=document.getElementById('app');
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function dt(s){if(!s)return '';var m=String(s).match(/^(\\d{4})-(\\d{2})-(\\d{2})/);if(!m)return '';
 var r=m[3]+'/'+m[2]+'/'+m[1];var h=String(s).match(/T(\\d{2}):(\\d{2})/);if(h&&String(s).indexOf('T')>0){var d=new Date(s);if(!isNaN(d)){return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}}return r}
function erro(msg){app.innerHTML='';var c=el('div','card');c.appendChild(el('div','big','Ops!'));c.appendChild(el('div','msg',msg));app.appendChild(c)}
function desenhar(d){
 app.innerHTML='';var o=d.os,e=d.empresa;
 var top=el('div','top');if(e.logo){var im=el('img');im.src=e.logo;im.alt='';top.appendChild(im)}
 var tt=el('div');tt.appendChild(el('b','',e.nome));tt.appendChild(el('small','','Acompanhamento da OS '+o.numero));top.appendChild(tt);app.appendChild(top);
 var t=TEXTO[o.status]||[o.status,''];
 var c=el('div','card');c.appendChild(el('div','st','SITUAÇÃO ATUAL'));
 var cls=o.status==='Pronto'||o.status==='Entregue'?'ok':(o.status==='Cancelado'?'bad':(o.status.indexOf('Aguardando')===0?'warn':''));
 c.appendChild(el('div','big '+cls,t[0]));c.appendChild(el('div','msg',(o.cliente?'Olá, '+o.cliente+'! ':'')+t[1]));
 if(o.previsao&&o.status!=='Pronto'&&o.status!=='Entregue'&&o.status!=='Cancelado'){c.appendChild(el('div','msg','Previsão: '+dt(o.previsao)))}
 app.appendChild(c);
 if(o.status!=='Cancelado'){
  var ci=ETAPAS.indexOf(o.status);if(ci<0)ci=MAPA[o.status]||0;
  var c2=el('div','card');var ul=el('ul','steps');
  ETAPAS.forEach(function(n,i){var li=el('li',i<ci||o.status==='Entregue'?'d':(i===ci?'c':''));li.appendChild(el('i','',i<ci||o.status==='Entregue'?'✓':String(i+1)));li.appendChild(document.createTextNode(n));ul.appendChild(li)});
  c2.appendChild(ul);app.appendChild(c2)}
 var c3=el('div','card');
 function row(a,b){if(!b)return;var r=el('div','row');r.appendChild(el('span','',a));r.appendChild(el('b','',b));c3.appendChild(r)}
 row('Aparelho',o.aparelho);row('Entrada',dt(o.entrada));row('Previsão',dt(o.previsao));row('Saída',dt(o.saida));
 if(o.defeito)row('Defeito informado',o.defeito);
 if((o.status==='Pronto'||o.status==='Entregue')&&o.valor_total>0)row('Valor total',o.valor_total.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}));
 if(o.status==='Entregue'&&o.garantia_dias)row('Garantia',o.garantia_dias+' dias');
 app.appendChild(c3);
 if(d.historico&&d.historico.length){var c4=el('div','card');c4.appendChild(el('div','st','HISTÓRICO'));var h=el('div','hist');
  d.historico.slice().reverse().forEach(function(x){var r=el('div','',dt(x.em)+' — '+x.para);h.appendChild(r)});c4.appendChild(h);app.appendChild(c4)}
 if(e.telefone){var dig=String(e.telefone).replace(/\\D/g,'');if(dig.length<=11)dig='55'+dig;
  var a=el('a','btn','💬 Falar com a assistência');a.href='https://wa.me/'+dig+'?text='+encodeURIComponent('Olá! Estou acompanhando a OS '+o.numero+'.');a.target='_blank';a.rel='noopener';app.appendChild(a)}
 if(e.endereco)app.appendChild(el('div','foot',e.endereco));
 app.appendChild(el('div','foot','Atualiza sozinho a cada 1 minuto'));
}
function buscar(primeira){
 fetch('/api/acompanhar/'+encodeURIComponent(cod),{cache:'no-store'}).then(function(r){return r.json()}).then(function(d){
  if(!d.ok){if(primeira)erro(d.error||'Não foi possível consultar.');return}desenhar(d)}).catch(function(){if(primeira)erro('Sem conexão. Tente novamente.')});
}
buscar(true);setInterval(function(){buscar(false)},60000);
})();
</script></body></html>`;

function pagina(req, res) {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(PAGINA);
}

module.exports = { router, pagina, gerarCodigo, lerCodigo, linkDaOs };
