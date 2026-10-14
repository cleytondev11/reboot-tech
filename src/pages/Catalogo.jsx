import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.jsx';
import { qrSvg } from '../qr.js';
import { formatCurrency, formatDateTime } from '../utils.js';

// Catálogo Online: o link público da loja, o que está publicado e os pedidos que chegam por ele.
const STATUS = ['Novo', 'Pago', 'Enviado', 'Entregue', 'Cancelado'];

export default function Catalogo() {
  const { user, showToast } = useApp();
  const admin = user && user.papel === 'Administrador';
  const [aba, setAba] = useState('pedidos');
  const [dados, setDados] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [produtos, setProdutos] = useState([]);
  const [busca, setBusca] = useState('');
  const [pedidos, setPedidos] = useState([]);
  const [filtro, setFiltro] = useState('');

  async function carregar() {
    try {
      const d = await window.api.catalogo.get();
      setDados(d); setCfg((c) => c || d.config);
    } catch (e) { showToast(String((e && e.message) || e), 'error'); }
  }
  async function carregarProdutos() { try { setProdutos(await window.api.catalogo.produtos()); } catch (e) { showToast(String((e && e.message) || e), 'error'); } }
  async function carregarPedidos() { try { setPedidos(await window.api.catalogo.pedidos(filtro || undefined)); } catch (e) { showToast(String((e && e.message) || e), 'error'); } }

  useEffect(() => { carregar(); carregarProdutos(); }, []);
  useEffect(() => { carregarPedidos(); }, [filtro]);

  const qr = useMemo(() => (dados ? qrSvg(dados.link, { tamanho: 130 }) : ''), [dados]);

  async function salvarCfg(novo) {
    try { await window.api.catalogo.save(novo); showToast('Catálogo salvo.'); setCfg(novo); carregar(); } catch (e) { showToast(String((e && e.message) || e), 'error'); }
  }
  async function copiar() { try { await navigator.clipboard.writeText(dados.link); showToast('Link copiado.'); } catch { showToast('Não foi possível copiar.', 'error'); } }
  async function publicar(ids, pub) { try { await window.api.catalogo.publicar(ids, pub); await carregarProdutos(); carregar(); } catch (e) { showToast(String((e && e.message) || e), 'error'); } }
  async function status(p, s) { try { await window.api.catalogo.pedidoStatus(p.id, s); carregarPedidos(); } catch (e) { showToast(String((e && e.message) || e), 'error'); } }
  async function virarVenda(p) {
    try { const r = await window.api.catalogo.pedidoVenda(p.id, 'PIX'); showToast(`Venda ${r.numero} criada.`); carregarPedidos(); carregarProdutos(); } catch (e) { showToast(String((e && e.message) || e), 'error'); }
  }
  function chamar(p) {
    const n = String(p.cliente_whatsapp || '').replace(/\D/g, '');
    const t = `Olá, ${p.cliente_nome}! Sobre o seu pedido ${p.numero}: `;
    window.api.whatsapp.abrirConversa(n.length <= 11 ? '55' + n : n, t).catch((e) => showToast(String((e && e.message) || e), 'error'));
  }

  if (!dados || !cfg) return <div className="muted">Carregando…</div>;
  const lista = produtos.filter((p) => !busca || (p.nome + ' ' + (p.categoria || '')).toLowerCase().includes(busca.toLowerCase()));
  const novos = pedidos.filter((p) => p.status === 'Novo').length;

  return (
    <div>
      <div className="card" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <div dangerouslySetInnerHTML={{ __html: qr }} style={{ flex: '0 0 130px', width: 130, height: 130, borderRadius: 8, overflow: 'hidden' }} />
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ margin: '0 0 4px' }}>🛍️ Seu catálogo online</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{cfg.ativo ? 'No ar — qualquer pessoa com o link vê os produtos publicados.' : 'Desativado — o link ainda não abre para os clientes.'}</div>
          <input readOnly value={dados.link} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button className="btn btn-primary" onClick={copiar}>📋 Copiar link</button>
            <a className="btn btn-secondary" href={dados.link} target="_blank" rel="noreferrer">👁️ Abrir</a>
            <button className="btn btn-secondary" onClick={() => window.api.whatsapp.abrirConversa('', `Veja nossos produtos e peça pelo celular: ${dados.link}`).catch(() => {})}>💬 Divulgar no WhatsApp</button>
          </div>
        </div>
      </div>

      <div className="tabs" style={{ display: 'flex', gap: 8, margin: '16px 0', flexWrap: 'wrap', position: 'relative' }}>
        {[['pedidos', `Pedidos${novos ? ` (${novos})` : ''}`], ['produtos', `Produtos (${dados.publicados})`], ['config', 'Configurar']].map(([k, t]) => (
          <button key={k} className={`btn ${aba === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAba(k)}>{t}</button>
        ))}
      </div>

      {aba === 'pedidos' && (
        <div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {['', ...STATUS].map((s) => <button key={s || 'todos'} className={`btn btn-sm ${filtro === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFiltro(s)}>{s || 'Todos'}</button>)}
          </div>
          {!pedidos.length && <div className="card muted">Nenhum pedido ainda. Divulgue o link para receber.</div>}
          {pedidos.map((p) => (
            <div className="card" key={p.id} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <b>{p.numero} · {p.cliente_nome}</b>
                <span><b>{formatCurrency(p.valor_total)}</b> · {p.status}</span>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>{formatDateTime(p.criado_em)} · {p.cliente_whatsapp} · {p.entrega === 'entrega' ? `Entrega: ${p.endereco}` : 'Retirada na loja'}</div>
              <ul style={{ margin: '8px 0', paddingLeft: 18 }}>{p.itens.map((i, k) => <li key={k}>{i.quantidade}x {i.descricao} — {formatCurrency(i.quantidade * i.valor_unit)}</li>)}</ul>
              {p.observacoes ? <div className="muted" style={{ fontSize: 13 }}>Obs.: {p.observacoes}</div> : null}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn btn-sm btn-secondary" onClick={() => chamar(p)}>💬 WhatsApp</button>
                {!p.venda_id && p.status !== 'Cancelado' && <button className="btn btn-sm btn-primary" onClick={() => virarVenda(p)}>✅ Pagou — virar venda</button>}
                {p.venda_id ? <span className="muted" style={{ alignSelf: 'center', fontSize: 12 }}>Já virou venda</span> : null}
                {STATUS.filter((s) => s !== p.status && (s !== 'Pago' || p.venda_id)).map((s) => <button key={s} className="btn btn-sm btn-secondary" onClick={() => status(p, s)}>{s}</button>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {aba === 'produtos' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
            <button className="btn btn-secondary" onClick={() => publicar(lista.filter((p) => !p.catalogo).map((p) => p.id), true)}>Publicar todos da lista</button>
            <button className="btn btn-secondary" onClick={() => publicar(lista.filter((p) => p.catalogo).map((p) => p.id), false)}>Retirar todos da lista</button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Só aparecem para o cliente produtos publicados, com preço de venda e estoque. A foto vem do cadastro do produto (Estoque).</div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>No catálogo</th><th>Produto</th><th>Preço</th><th>Estoque</th><th>Foto</th></tr></thead>
            <tbody>{lista.map((p) => (
              <tr key={p.id}>
                <td><input type="checkbox" checked={!!p.catalogo} onChange={(e) => publicar([p.id], e.target.checked)} /></td>
                <td>{p.nome}<div className="muted" style={{ fontSize: 11 }}>{p.categoria}</div></td>
                <td>{formatCurrency(p.valor_venda)}</td>
                <td>{p.quantidade}</td>
                <td>{p.foto ? '✓' : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}

      {aba === 'config' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={cfg.ativo} disabled={!admin} onChange={(e) => setCfg({ ...cfg, ativo: e.target.checked })} /> Catálogo ativo (link aberto ao público)</label>
          <div className="form-group"><label>Chave Pix da loja</label><input value={cfg.chave_pix} disabled={!admin} onChange={(e) => setCfg({ ...cfg, chave_pix: e.target.value })} placeholder="CPF/CNPJ, e-mail, celular ou chave aleatória" /></div>
          <div className="form-group"><label>Nome do recebedor (aparece no Pix)</label><input value={cfg.nome_pix} maxLength={25} disabled={!admin} onChange={(e) => setCfg({ ...cfg, nome_pix: e.target.value })} /></div>
          <div className="form-group"><label>Cidade do recebedor</label><input value={cfg.cidade_pix} maxLength={15} disabled={!admin} onChange={(e) => setCfg({ ...cfg, cidade_pix: e.target.value })} /></div>
          <div className="form-group"><label>Recado no topo do catálogo</label><input value={cfg.mensagem} maxLength={200} disabled={!admin} onChange={(e) => setCfg({ ...cfg, mensagem: e.target.value })} placeholder="Ex.: Aceitamos Pix e retirada em 1h" /></div>
          <div className="form-group"><label>Informação de entrega</label><input value={cfg.entrega_info} maxLength={200} disabled={!admin} onChange={(e) => setCfg({ ...cfg, entrega_info: e.target.value })} placeholder="Ex.: Entregamos no centro, taxa R$ 8" /></div>
          {admin ? <button className="btn btn-primary" onClick={() => salvarCfg(cfg)}>Salvar</button> : <div className="muted">Só o administrador altera estas opções.</div>}
          <p className="muted" style={{ fontSize: 12 }}>O cliente paga direto na sua conta pelo Pix; o sistema não vê o pagamento — confira no seu banco e use “Pagou — virar venda”.</p>
        </div>
      )}
    </div>
  );
}
