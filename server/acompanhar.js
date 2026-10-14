// ---------- ACOMPANHAMENTO DA OS PELO CLIENTE (página pública, sem login) ----------
// O link vai impresso em QR code na OS e também na mensagem de WhatsApp. O código do link é
// "<empresa>-<os>-<assinatura>"; a assinatura é um HMAC com o segredo do servidor, então ninguém
// consegue adivinhar o link de outra OS (e não precisa guardar nada no banco). A página só mostra o
// essencial: status, aparelho, datas e contato da loja — nunca senha, CPF ou dados financeiros detalhados.
const crypto = require('crypto');
const express = require('express');
const tenants = require('./tenants');
const termosOs = require('./termos-os');
const push = require('./push');

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

function itensDaOs(txt) {
  let arr = [];
  try { arr = JSON.parse(txt || '[]'); } catch (e) { arr = []; }
  return (Array.isArray(arr) ? arr : []).slice(0, 50).map((i) => ({
    descricao: String(i.descricao || '').slice(0, 120),
    quantidade: Number(i.quantidade) || 1,
    valor_unit: Number(i.valor_unit) || 0,
  })).filter((i) => i.descricao);
}

// limitador mais rígido para quem assina (10 por 10 minutos por IP)
const hitsAss = new Map();
function limitarAss(req, res, next) {
  const ip = req.ip || 'x';
  const agora = Date.now();
  const h = (hitsAss.get(ip) || []).filter((t) => agora - t < 600000);
  h.push(agora); hitsAss.set(ip, h);
  if (hitsAss.size > 5000) hitsAss.clear();
  if (h.length > 10) return res.status(429).json({ ok: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
  next();
}

const router = express.Router();

// O cliente autoriza (ou recusa) o serviço pelo link, com os termos aceitos e a assinatura.
router.post('/:codigo/autorizar', limitarAss, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const dec = lerCodigo(req.params.codigo);
  if (!dec) return res.status(404).json({ ok: false, error: 'Link inválido.' });
  try {
    const cliente = await tenants.buscarCliente(dec.clienteId);
    if (!cliente || !cliente.ativo || tenants.planoVencido(cliente)) return res.status(404).json({ ok: false, error: 'Indisponível no momento. Fale com a assistência.' });
    const db = await tenants.bancoDoCliente(cliente);
    const os = await db.get('SELECT id, numero, status FROM ordens_servico WHERE id = ?', [dec.osId]);
    if (!os) return res.status(404).json({ ok: false, error: 'Ordem de serviço não encontrada.' });
    if (os.status !== 'Aguardando aprovação') return res.status(409).json({ ok: false, error: 'Esta ordem de serviço não está aguardando aprovação.' });
    const b = req.body || {};
    const agora = new Date().toISOString();
    const ip = String(req.ip || '').slice(0, 64);
    if (b.decisao === 'recusar') {
      await db.run("UPDATE ordens_servico SET aprovacao_status = 'recusada', aprovacao_em = ?, aprovacao_ip = ?, atualizado_em = ? WHERE id = ?", [agora, ip, agora, os.id]);
      await db.run('INSERT INTO logs (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, criado_em) VALUES (?,?,?,?,?,?,?)', [null, 'Cliente (link)', 'RECUSAR', 'ordens_servico', os.id, 'Cliente não autorizou pelo link', agora]).catch(() => {});
      push.avisarAprovacaoOS(db, os.id, 'recusada');
      return res.json({ ok: true, decisao: 'recusada' });
    }
    if (b.aceite !== true) return res.status(400).json({ ok: false, error: 'Marque que leu e aceita os termos.' });
    const ass = String(b.assinatura || '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(ass) || ass.length < 1500 || ass.length > 400000) return res.status(400).json({ ok: false, error: 'Faça a sua assinatura no quadro.' });
    const termos = JSON.stringify(termosOs.ITENS.map(() => true));
    const r = await db.run("UPDATE ordens_servico SET status = 'Aprovado', assinatura_aprovacao = ?, aprovacao_status = 'aprovada', aprovacao_em = ?, aprovacao_ip = ?, termos_aceite = ?, atualizado_em = ? WHERE id = ? AND status = 'Aguardando aprovação'", [ass, agora, ip, termos, agora, os.id]);
    if (r && r.changes === 0) return res.status(409).json({ ok: false, error: 'Esta ordem de serviço já foi respondida.' });
    await db.run('INSERT INTO logs (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, criado_em) VALUES (?,?,?,?,?,?,?)', [null, 'Cliente (link)', 'MUDAR_STATUS', 'ordens_servico', os.id, 'Aguardando aprovação -> Aprovado', agora]).catch(() => {});
    push.avisarAprovacaoOS(db, os.id, 'aprovada');
    res.json({ ok: true, decisao: 'aprovada', em: agora });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Não foi possível registrar agora. Tente novamente.' });
  }
});

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
              os.data_entrada, os.previsao, os.data_saida, os.atualizado_em, os.diagnostico, os.valor_mao_obra, os.valor_pecas, os.desconto, os.itens_pecas,
              os.aprovacao_status, os.aprovacao_em, c.nome as cliente_nome,
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
      aprovacao: {
        aberta: os.status === 'Aguardando aprovação',
        status: os.aprovacao_status || '',
        em: os.aprovacao_em || '',
        termos: termosOs.ITENS,
        declaracao: termosOs.DECLARACAO,
        orcamento: {
          diagnostico: os.diagnostico || '',
          servicos: os.servicos_executados || '',
          itens: itensDaOs(os.itens_pecas),
          mao_obra: Number(os.valor_mao_obra) || 0,
          pecas: Number(os.valor_pecas) || 0,
          desconto: Number(os.desconto) || 0,
          total: Number(os.valor_total) || 0,
        },
      },
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
.tm{font-size:13px;color:#cfd5ea;line-height:1.5}.tm p{margin:0 0 9px}.decl{background:#2a2410;border:1px solid #5a4a14;border-radius:12px;padding:12px;margin-top:10px;font-size:12.5px;color:#f1dea0;line-height:1.5}
.ck{display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:14px;font-weight:600;cursor:pointer}.ck input{width:22px;height:22px;margin:0;flex:none;accent-color:#e0a526}
.pad{background:#fff;border:2px dashed #8a93b8;border-radius:12px;width:100%;height:160px;display:block;touch-action:none;cursor:crosshair}
.pbar{display:flex;justify-content:space-between;align-items:center;font-size:12.5px;color:#9aa3c0;margin-top:6px}.pbar button{background:none;border:1px solid #333b64;color:#cfd5ea;border-radius:8px;padding:5px 12px;font-size:12.5px;cursor:pointer}
button.btn2{display:block;width:100%;text-align:center;background:linear-gradient(135deg,#ffd666,#e0a526);color:#1a1a10;font-weight:800;border:0;padding:15px;border-radius:14px;margin-top:12px;font-size:16px;cursor:pointer}button.btn2[disabled]{opacity:.5}
button.btn3{display:block;width:100%;background:none;border:1px solid #4a3340;color:#ff9a9a;font-weight:700;padding:12px;border-radius:14px;margin-top:10px;font-size:14px;cursor:pointer}
.err{color:#ff8a8a;font-size:13.5px;margin-top:8px;min-height:18px}.okbox{text-align:center}.okbox .gg{font-size:40px}
.foot{text-align:center;color:#6e7699;font-size:12px;margin-top:20px}.hist{font-size:13.5px;color:#aab2d2}.hist div{padding:4px 0}
</style></head><body><div class="w" id="app"><div class="card">Carregando…</div></div>
<script>
(function(){
var cod=location.pathname.split('/').filter(Boolean).pop();
var ETAPAS=['Recebido','Em análise','Em manutenção','Teste','Pronto','Entregue'];
var TEXTO={'Recebido':['Recebemos o seu aparelho','Ele já está registrado e logo começa a ser analisado.'],
'Em análise':['Estamos analisando o aparelho','Nosso técnico está fazendo o diagnóstico.'],
'Aguardando aprovação':['Aguardando a sua aprovação','O orçamento está pronto. Leia abaixo e autorize o serviço com a sua assinatura.'],
'Aprovado':['Serviço autorizado ✅','Recebemos a sua autorização. Já vamos iniciar o conserto.'],
'Aguardando peça':['Aguardando a chegada da peça','Assim que a peça chegar, o conserto continua.'],
'Em manutenção':['Em manutenção','O seu aparelho está sendo consertado agora.'],
'Teste':['Em testes finais','O conserto terminou e estamos testando tudo.'],
'Pronto':['Pronto para retirada! 🎉','Pode vir buscar o seu aparelho. Leve o comprovante ou diga o número da OS.'],
'Entregue':['Aparelho entregue','Obrigado pela confiança! Qualquer dúvida, fale com a gente.'],
'Cancelado':['Ordem de serviço cancelada','Fale com a assistência se precisar de mais informações.']};
var MAPA={'Aguardando aprovação':1,'Aprovado':1,'Aguardando peça':2};
var trava=false;
var app=document.getElementById('app');
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function dt(s){if(!s)return '';var m=String(s).match(/^(\\d{4})-(\\d{2})-(\\d{2})/);if(!m)return '';
 var r=m[3]+'/'+m[2]+'/'+m[1];var h=String(s).match(/T(\\d{2}):(\\d{2})/);if(h&&String(s).indexOf('T')>0){var d=new Date(s);if(!isNaN(d)){return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}}return r}
function erro(msg){app.innerHTML='';var c=el('div','card');c.appendChild(el('div','big','Ops!'));c.appendChild(el('div','msg',msg));app.appendChild(c)}

function brl(n){return (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}
function cartaoAprovacao(d){
 var a=d.aprovacao,o=d.orcamento||a.orcamento,q=a.orcamento;
 var c=el('div','card');c.appendChild(el('div','st','ORÇAMENTO PARA AUTORIZAR'));
 function lin(x,y,forte){var r=el('div','row');r.appendChild(el('span','',x));r.appendChild(el('b','',y));c.appendChild(r)}
 if(q.diagnostico)lin('Diagnóstico',q.diagnostico);
 if(q.servicos)lin('Serviço',q.servicos);
 q.itens.forEach(function(i){lin((i.quantidade>1?i.quantidade+'x ':'')+i.descricao,brl(i.quantidade*i.valor_unit))});
 if(q.mao_obra>0)lin('Mão de obra',brl(q.mao_obra));
 if(q.desconto>0)lin('Desconto','- '+brl(q.desconto));
 var t=el('div','big',brl(q.total));t.style.textAlign='right';t.style.marginTop='10px';c.appendChild(t);
 return c;
}
function formAprovacao(d){
 trava=true;
 var a=d.aprovacao,box=el('div');
 box.appendChild(cartaoAprovacao(d));
 var ct=el('div','card');ct.appendChild(el('div','st','TERMOS E DECLARAÇÕES'));
 var tm=el('div','tm');tm.style.marginTop='8px';
 a.termos.forEach(function(x,i){tm.appendChild(el('p','',(i+1)+'. '+x))});ct.appendChild(tm);
 var dc=el('div','decl');var dt1=el('b','','⚠️ Declaração de Condição do Aparelho');dc.appendChild(dt1);dc.appendChild(el('div','',a.declaracao));ct.appendChild(dc);
 var lb=el('label','ck');var cb=el('input');cb.type='checkbox';lb.appendChild(cb);lb.appendChild(el('span','','Li e aceito os termos e declarações acima e autorizo a execução do serviço.'));ct.appendChild(lb);
 box.appendChild(ct);
 var cs=el('div','card');cs.appendChild(el('div','st','SUA ASSINATURA'));
 var cv=el('canvas','pad');cv.style.marginTop='8px';cs.appendChild(cv);
 var pb=el('div','pbar');pb.appendChild(el('span','','Assine com o dedo no quadro'));var lim=el('button','','Limpar');lim.type='button';pb.appendChild(lim);cs.appendChild(pb);
 var er=el('div','err');cs.appendChild(er);
 var bo=el('button','btn2','✔ Autorizar serviço');bo.type='button';cs.appendChild(bo);
 var bn=el('button','btn3','Não autorizar');bn.type='button';cs.appendChild(bn);
 box.appendChild(cs);
 setTimeout(function(){
  var dpr=window.devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;cv.width=w*dpr;cv.height=h*dpr;
  var g=cv.getContext('2d');g.scale(dpr,dpr);g.fillStyle='#fff';g.fillRect(0,0,w,h);g.lineWidth=2.6;g.lineCap='round';g.lineJoin='round';g.strokeStyle='#16171b';
  var down=false,pts=0,lx=0,ly=0;
  function pos(e){var r=cv.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]}
  cv.addEventListener('pointerdown',function(e){e.preventDefault();down=true;var p=pos(e);lx=p[0];ly=p[1];try{cv.setPointerCapture(e.pointerId)}catch(x){}g.beginPath();g.arc(lx,ly,1.2,0,6.3);g.fill()});
  cv.addEventListener('pointermove',function(e){if(!down)return;e.preventDefault();var p=pos(e);g.beginPath();g.moveTo(lx,ly);g.lineTo(p[0],p[1]);g.stroke();lx=p[0];ly=p[1];pts++});
  function fim(){down=false}cv.addEventListener('pointerup',fim);cv.addEventListener('pointercancel',fim);cv.addEventListener('pointerleave',fim);
  lim.onclick=function(){g.fillStyle='#fff';g.fillRect(0,0,w,h);pts=0};
  function enviar(decisao){
   er.textContent='';
   if(decisao==='aprovar'){
    if(!cb.checked){er.textContent='Marque que leu e aceita os termos.';return}
    if(pts<8){er.textContent='Faça a sua assinatura no quadro.';return}
   }else if(!confirm('Tem certeza que não quer autorizar este serviço?'))return;
   bo.disabled=true;bn.disabled=true;
   fetch('/api/acompanhar/'+encodeURIComponent(cod)+'/autorizar',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decisao:decisao,aceite:cb.checked,assinatura:decisao==='aprovar'?cv.toDataURL('image/png'):''})})
   .then(function(r){return r.json()}).then(function(j){
    if(!j.ok){er.textContent=j.error||'Não foi possível enviar.';bo.disabled=false;bn.disabled=false;return}
    trava=false;buscar(true);
   }).catch(function(){er.textContent='Sem conexão. Tente de novo.';bo.disabled=false;bn.disabled=false});
  }
  bo.onclick=function(){enviar('aprovar')};bn.onclick=function(){enviar('recusar')};
 },0);
 return box;
}
function cartaoResposta(d){
 var a=d.aprovacao;if(!a||a.aberta||!a.status)return null;
 var c=el('div','card okbox');
 if(a.status==='aprovada'){c.appendChild(el('div','gg','✅'));c.appendChild(el('div','big ok','Serviço autorizado!'));c.appendChild(el('div','msg','Recebemos a sua assinatura em '+dt(a.em)+'. Obrigado pela confiança!'))}
 else{c.appendChild(el('div','msg','Você informou que não autoriza o serviço ('+dt(a.em)+'). A assistência vai entrar em contato.'))}
 return c;
}
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
 if(d.aprovacao&&d.aprovacao.aberta){app.appendChild(formAprovacao(d))}else{trava=false;var rp=cartaoResposta(d);if(rp)app.appendChild(rp)}
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
  if(!d.ok){if(primeira)erro(d.error||'Não foi possível consultar.');return}if(!primeira&&trava&&d.aprovacao&&d.aprovacao.aberta)return;desenhar(d)}).catch(function(){if(primeira)erro('Sem conexão. Tente novamente.')});
}
buscar(true);setInterval(function(){buscar(false)},60000);
})();
</script></body></html>`;

function pagina(req, res) {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(PAGINA);
}

module.exports = { router, pagina, gerarCodigo, lerCodigo, linkDaOs };
