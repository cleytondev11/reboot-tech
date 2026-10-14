import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { fotoDoProduto } from '../imagem.js';
import { formatCurrency, sanitizeDecimalInput, parseDecimal } from '../utils.js';

// Insumos (material de consumo da bancada) e peças de sucata (aproveitadas de aparelhos sem conserto).
const CATS_INSUMO = ['Solda', 'Limpeza', 'Fitas/Colas', 'Ferramentas', 'Embalagem', 'Outros'];
const UNIDADES = ['un', 'rolo', 'L', 'ml', 'kg', 'g', 'm', 'cx', 'pç'];
const PECAS = ['Tela / display', 'Bateria', 'Conector de carga', 'Câmera traseira', 'Câmera frontal', 'Alto-falante', 'Auricular', 'Microfone', 'Placa-mãe', 'Sub-placa', 'Flex', 'Botões', 'Tampa / carcaça', 'Outros'];
const ESTADOS = ['Testada', 'Não testada', 'Defeituosa'];
const COR_EST = { Testada: 'var(--success)', 'Não testada': 'var(--warning)', Defeituosa: 'var(--danger)' };
const COR_SIT = { 'Disponível': 'var(--success)', Reservada: 'var(--info)', Usada: 'var(--text-dim, #888)', Descartada: 'var(--text-dim, #888)' };
const EMPTY_I = { id: null, nome: '', categoria: 'Solda', unidade: 'un', quantidade: '', minimo: '1', custo: '', fornecedor: '' };
const EMPTY_S = { id: null, peca: 'Tela / display', quantidade: '1', aparelho: '', estado: 'Testada', local: '', valor: '', foto: '', obs: '' };

const pill = (cor, txt) => <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 99, background: `color-mix(in srgb, ${cor} 18%, transparent)`, color: cor, whiteSpace: 'nowrap' }}>{txt}</span>;
const nf = (n) => String(Math.round((Number(n) || 0) * 100) / 100).replace('.', ',');

function Resumo({ itens }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
      {itens.map(([l, v, c]) => (
        <div className="card" key={l} style={{ padding: '10px 14px' }}>
          <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{l}</div>
          <b style={{ fontSize: 19, color: c }}>{v}</b>
        </div>
      ))}
    </div>
  );
}

export default function InsumosSucata({ modo }) {
  return modo === 'insumos' ? <Insumos /> : <Sucata />;
}

function Insumos() {
  const { showToast } = useApp();
  const [dados, setDados] = useState(null);
  const [termo, setTermo] = useState('');
  const [categoria, setCategoria] = useState('');
  const [baixo, setBaixo] = useState(false);
  const [form, setForm] = useState(null);
  const [mov, setMov] = useState(null); // { item, tipo, qtd }
  const erro = (e) => showToast(String((e && e.message) || e), 'error');

  async function carregar() { try { setDados(await window.api.insumos.list({ termo, categoria, baixo })); } catch (e) { erro(e); setDados({ itens: [], resumo: {} }); } }
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [termo, categoria, baixo]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function salvar(e) {
    e.preventDefault();
    try {
      await window.api.insumos.save({ ...form, quantidade: parseDecimal(form.quantidade), minimo: parseDecimal(form.minimo), custo: parseDecimal(form.custo) });
      showToast('Insumo salvo.'); setForm(null); carregar();
    } catch (err) { erro(err); }
  }
  async function movimentar(e) {
    e.preventDefault();
    try { await window.api.insumos.mov(mov.item.id, mov.tipo, parseDecimal(mov.qtd)); showToast(mov.tipo === 'entrada' ? 'Entrada registrada.' : 'Baixa registrada.'); setMov(null); carregar(); } catch (err) { erro(err); }
  }
  async function excluir(i) {
    if (!window.confirm(`Excluir o insumo "${i.nome}"?`)) return;
    try { await window.api.insumos.delete(i.id); carregar(); } catch (err) { erro(err); }
  }

  const r = (dados && dados.resumo) || {};
  const itens = (dados && dados.itens) || [];
  const situ = (i) => (i.quantidade <= 0 ? pill('var(--danger)', 'Acabou') : i.quantidade < i.minimo ? pill('var(--danger)', 'Baixo') : i.quantidade === i.minimo ? pill('var(--warning)', 'No limite') : pill('var(--success)', 'OK'));

  return (
    <div>
      <Resumo itens={[['Itens cadastrados', r.total || 0], ['Estoque baixo', r.baixo || 0, r.baixo ? 'var(--danger)' : undefined], ['Valor em insumos', formatCurrency(r.valor || 0)], ['Gasto no mês', formatCurrency(r.gastoMes || 0)]]} />
      <div className="toolbar">
        <div className="toolbar-left" style={{ flex: 1 }}>
          <input className="search-input" style={{ flex: 1, minWidth: 200 }} placeholder="Buscar insumo ou fornecedor…" value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)}><option value="">Todas as categorias</option>{CATS_INSUMO.map((c) => <option key={c}>{c}</option>)}</select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}><input type="checkbox" checked={baixo} onChange={(e) => setBaixo(e.target.checked)} /> Só estoque baixo</label>
        </div>
        <div className="toolbar-right"><button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_I })}>＋ Novo insumo</button></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Insumo</th><th>Categoria</th><th>Quantidade</th><th>Mínimo</th><th>Custo unit.</th><th>Fornecedor</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {itens.map((i) => (
              <tr key={i.id}>
                <td><b>{i.nome}</b></td>
                <td>{i.categoria || '-'}</td>
                <td>{nf(i.quantidade)} {i.unidade}</td>
                <td>{nf(i.minimo)}</td>
                <td>{formatCurrency(i.custo)}</td>
                <td>{i.fornecedor || '-'}</td>
                <td>{situ(i)}</td>
                <td><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setMov({ item: i, tipo: 'saida', qtd: '' })}>− Usar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setMov({ item: i, tipo: 'entrada', qtd: '' })}>＋ Entrada</button>
                  <button className="icon-btn" title="Editar" onClick={() => setForm({ ...EMPTY_I, ...i, quantidade: String(i.quantidade).replace('.', ','), minimo: String(i.minimo).replace('.', ','), custo: String(i.custo || '').replace('.', ',') })}>✏️</button>
                  <button className="icon-btn" title="Excluir" onClick={() => excluir(i)}>🗑️</button>
                </div></td>
              </tr>
            ))}
            {dados && itens.length === 0 && <tr><td colSpan={8} className="muted" style={{ textAlign: 'center', padding: 24 }}>Nenhum insumo cadastrado. Clique em “＋ Novo insumo”.</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form className="modal" style={{ width: 600 }} onSubmit={salvar}>
            <div className="modal-header"><h3>{form.id ? 'Editar insumo' : 'Novo insumo'}</h3><button type="button" className="icon-btn" onClick={() => setForm(null)}>✕</button></div>
            <div className="form-grid">
              <div className="field span-2"><label>Nome *</label><input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Estanho 0,5mm 60/40" autoFocus /></div>
              <div className="field"><label>Categoria</label><input list="ins-cats" value={form.categoria} onChange={(e) => set('categoria', e.target.value)} /><datalist id="ins-cats">{CATS_INSUMO.map((c) => <option key={c} value={c} />)}</datalist></div>
              <div className="field"><label>Unidade</label><select value={form.unidade} onChange={(e) => set('unidade', e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select></div>
              {!form.id && <div className="field"><label>Quantidade inicial</label><input inputMode="decimal" value={form.quantidade} onChange={(e) => set('quantidade', sanitizeDecimalInput(e.target.value))} /></div>}
              <div className="field"><label>Estoque mínimo (alerta)</label><input inputMode="decimal" value={form.minimo} onChange={(e) => set('minimo', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field"><label>Custo unitário (R$)</label><input inputMode="decimal" value={form.custo} onChange={(e) => set('custo', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field"><label>Fornecedor</label><input value={form.fornecedor} onChange={(e) => set('fornecedor', e.target.value)} /></div>
            </div>
            {form.id && <p className="muted" style={{ fontSize: 11.5 }}>Para mudar a quantidade use os botões “− Usar” e “＋ Entrada”.</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      )}

      {mov && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMov(null)}>
          <form className="modal" style={{ width: 380 }} onSubmit={movimentar}>
            <div className="modal-header"><h3>{mov.tipo === 'entrada' ? '＋ Entrada' : '− Usar'}: {mov.item.nome}</h3><button type="button" className="icon-btn" onClick={() => setMov(null)}>✕</button></div>
            <p className="muted" style={{ fontSize: 12.5 }}>Em estoque: {nf(mov.item.quantidade)} {mov.item.unidade}</p>
            <div className="field"><label>Quantidade ({mov.item.unidade})</label><input inputMode="decimal" autoFocus value={mov.qtd} onChange={(e) => setMov({ ...mov, qtd: sanitizeDecimalInput(e.target.value) })} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMov(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Confirmar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Sucata() {
  const { showToast } = useApp();
  const [dados, setDados] = useState(null);
  const [termo, setTermo] = useState('');
  const [situacao, setSituacao] = useState('Disponível');
  const [form, setForm] = useState(null);
  const [uso, setUso] = useState(null); // { item, situacao, os }
  const erro = (e) => showToast(String((e && e.message) || e), 'error');

  async function carregar() { try { setDados(await window.api.sucata.list({ termo, situacao })); } catch (e) { erro(e); setDados({ itens: [], resumo: {} }); } }
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [termo, situacao]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function foto(arq) {
    if (!arq) return;
    try { const { imagem_mini } = await fotoDoProduto(arq); set('foto', imagem_mini); } catch (e) { erro(e); }
  }
  async function salvar(e) {
    e.preventDefault();
    try { await window.api.sucata.save({ ...form, valor: parseDecimal(form.valor), quantidade: parseInt(form.quantidade, 10) || 1 }); showToast('Peça salva.'); setForm(null); carregar(); } catch (err) { erro(err); }
  }
  async function aplicarSituacao(e) {
    e.preventDefault();
    try { if (uso.situacao === 'Usada' && (uso.item.situacao === 'Disponível' || uso.item.situacao === 'Reservada')) await window.api.sucata.usar(uso.item.id, parseInt(uso.qtd, 10) || 0, uso.os);
      else await window.api.sucata.situacao(uso.item.id, uso.situacao, uso.os); showToast('Situação atualizada.'); setUso(null); carregar(); } catch (err) { erro(err); }
  }
  async function excluir(s) {
    if (!window.confirm(`Excluir "${s.peca}" (${s.aparelho || 'sem aparelho'})?`)) return;
    try { await window.api.sucata.delete(s.id); carregar(); } catch (err) { erro(err); }
  }

  const r = (dados && dados.resumo) || {};
  const itens = (dados && dados.itens) || [];

  return (
    <div>
      <Resumo itens={[['Peças disponíveis (unid.)', r.disponiveis || 0], ['Aparelhos desmontados', r.aparelhos || 0], ["Valor estimado (disponíveis)", formatCurrency(r.valor || 0)], ['Já aproveitadas', r.usadas || 0]]} />
      <div className="toolbar">
        <div className="toolbar-left" style={{ flex: 1 }}>
          <input className="search-input" style={{ flex: 1, minWidth: 200 }} placeholder="Buscar peça, aparelho ou local…" value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={situacao} onChange={(e) => setSituacao(e.target.value)}><option value="">Todas as situações</option>{['Disponível', 'Reservada', 'Usada', 'Descartada'].map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="toolbar-right"><button className="btn btn-primary" onClick={() => setForm({ ...EMPTY_S })}>＋ Nova peça de sucata</button></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th></th><th>Peça</th><th>Qtd</th><th>Veio de</th><th>Estado</th><th>Local</th><th>Valor unit.</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {itens.map((s) => (
              <tr key={s.id}>
                <td>{s.foto ? <img className="prod-mini" src={s.foto} alt="" /> : <span className="prod-mini prod-mini-vazio">♻️</span>}</td>
                <td><b>{s.peca}</b>{s.obs ? <div className="muted" style={{ fontSize: 11 }}>{s.obs}</div> : null}</td>
                <td><b>{s.quantidade || 1}</b></td>
                <td>{s.aparelho || '-'}</td>
                <td>{pill(COR_EST[s.estado] || 'var(--warning)', s.estado)}</td>
                <td>{s.local || '-'}</td>
                <td>{formatCurrency(s.valor)}</td>
                <td>{pill(COR_SIT[s.situacao] || 'var(--info)', s.situacao + (s.os_ref ? ` · ${s.os_ref}` : ''))}</td>
                <td><div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  {s.situacao === 'Disponível' || s.situacao === 'Reservada'
                    ? <button className="btn btn-secondary btn-sm" onClick={() => setUso({ item: s, situacao: 'Usada', os: s.os_ref || '', qtd: '1' })}>Usar na OS</button>
                    : <button className="btn btn-secondary btn-sm" onClick={() => setUso({ item: s, situacao: 'Disponível', os: '' })}>Voltar p/ disponível</button>}
                  <button className="icon-btn" title="Editar" onClick={() => setForm({ ...EMPTY_S, ...s, valor: String(s.valor || '').replace('.', ','), quantidade: String(s.quantidade || 1) })}>✏️</button>
                  <button className="icon-btn" title="Excluir" onClick={() => excluir(s)}>🗑️</button>
                </div></td>
              </tr>
            ))}
            {dados && itens.length === 0 && <tr><td colSpan={9} className="muted" style={{ textAlign: 'center', padding: 24 }}>Nenhuma peça nesta lista. Clique em “＋ Nova peça de sucata”.</td></tr>}
          </tbody>
        </table>
      </div>

      {form && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form className="modal" style={{ width: 620 }} onSubmit={salvar}>
            <div className="modal-header"><h3>{form.id ? 'Editar peça de sucata' : '♻️ Nova peça de sucata'}</h3><button type="button" className="icon-btn" onClick={() => setForm(null)}>✕</button></div>
            <div className="form-grid">
              <div className="field"><label>Tipo da peça *</label><input list="suc-pecas" value={form.peca} onChange={(e) => set('peca', e.target.value)} /><datalist id="suc-pecas">{PECAS.map((p) => <option key={p} value={p} />)}</datalist></div>
              <div className="field"><label>Quantidade</label><input inputMode="numeric" value={form.quantidade} onChange={(e) => set('quantidade', e.target.value.replace(/\D/g, ''))} /></div>
              <div className="field"><label>Aparelho de origem</label><input value={form.aparelho} onChange={(e) => set('aparelho', e.target.value)} placeholder="Ex.: Samsung A12" /></div>
              <div className="field"><label>Estado</label><select value={form.estado} onChange={(e) => set('estado', e.target.value)}>{ESTADOS.map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="field"><label>Local onde guardou</label><input value={form.local} onChange={(e) => set('local', e.target.value)} placeholder="Ex.: Gaveta 2" /></div>
              <div className="field"><label>Valor estimado (R$)</label><input inputMode="decimal" value={form.valor} onChange={(e) => set('valor', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field">
                <label>Foto</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {form.foto && <img className="prod-mini" src={form.foto} alt="" />}
                  <input type="file" accept="image/*" onChange={(e) => foto(e.target.files && e.target.files[0])} />
                </div>
              </div>
              <div className="field span-2"><label>Observações</label><input value={form.obs} onChange={(e) => set('obs', e.target.value)} placeholder="Ex.: touch ok, sem manchas" /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      )}

      {uso && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setUso(null)}>
          <form className="modal" style={{ width: 400 }} onSubmit={aplicarSituacao}>
            <div className="modal-header"><h3>{uso.item.peca}</h3><button type="button" className="icon-btn" onClick={() => setUso(null)}>✕</button></div>
            <div className="field"><label>Situação</label><select value={uso.situacao} onChange={(e) => setUso({ ...uso, situacao: e.target.value })}>{['Disponível', 'Reservada', 'Usada', 'Descartada'].map((x) => <option key={x}>{x}</option>)}</select></div>
            {uso.situacao === 'Usada' && (uso.item.situacao === 'Disponível' || uso.item.situacao === 'Reservada') && <div className="field" style={{ marginTop: 10 }}><label>Quantidade usada (há {uso.item.quantidade})</label><input inputMode="numeric" value={uso.qtd} onChange={(e) => setUso({ ...uso, qtd: e.target.value.replace(/\D/g, '') })} /></div>}
            {uso.situacao !== 'Disponível' && <div className="field" style={{ marginTop: 10 }}><label>OS / observação (opcional)</label><input value={uso.os} onChange={(e) => setUso({ ...uso, os: e.target.value })} placeholder="Ex.: OS #1042" autoFocus /></div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setUso(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Confirmar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
