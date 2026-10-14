import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.jsx';

// Soluções de bancada: o técnico registra o defeito, o que fez e a solução, para consultar quando
// chegar outro aparelho com o mesmo problema. Já vem com uma base de defeitos comuns e crônicos.
const TIPOS = ['Não liga', 'Não carrega', 'Bateria', 'Tela / Display', 'Touch', 'Áudio', 'Câmera', 'Sinal / Rede', 'Software', 'Aquecimento', 'Botões', 'Biometria', 'Líquido / Oxidação', 'Outros'];
const MARCAS = ['Todas', 'Apple', 'Samsung', 'Motorola', 'Xiaomi', 'LG', 'Asus', 'Realme', 'Positivo', 'Multilaser'];
const NIVEIS = ['Iniciante', 'Intermediário', 'Avançado'];
const COR_NIVEL = { Iniciante: 'var(--success)', Intermediário: 'var(--warning)', Avançado: 'var(--danger)' };
const EMPTY = { id: null, marca: 'Todas', modelo: '', tipo: 'Tela / Display', defeito: '', passos: '', solucao: '', nivel: 'Iniciante', pecas: '' };

export default function Solucoes() {
  const { showToast } = useApp();
  const [lista, setLista] = useState(null);
  const [termo, setTermo] = useState('');
  const [marca, setMarca] = useState('');
  const [tipo, setTipo] = useState('');
  const [nivel, setNivel] = useState('');
  const [origem, setOrigem] = useState('');
  const [aberto, setAberto] = useState(null);
  const [form, setForm] = useState(null);

  async function carregar() {
    try { setLista(await window.api.solucoes.list({ termo, marca, tipo, nivel, origem })); } catch (e) { showToast(String((e && e.message) || e), 'error'); setLista([]); }
  }
  useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [termo, marca, tipo, nivel, origem]);

  const marcasUsadas = useMemo(() => [...new Set([...MARCAS, ...(lista || []).map((s) => s.marca).filter(Boolean)])], [lista]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  async function salvar(e) {
    e.preventDefault();
    try { await window.api.solucoes.save(form); showToast('Solução salva.'); setForm(null); carregar(); } catch (err) { showToast(String((err && err.message) || err), 'error'); }
  }
  async function excluir(s) {
    if (!window.confirm(`Excluir esta solução?\n\n${s.defeito}`)) return;
    try { await window.api.solucoes.delete(s.id); showToast('Solução excluída.'); carregar(); } catch (err) { showToast(String((err && err.message) || err), 'error'); }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left" style={{ flex: 1 }}>
          <input className="search-input" style={{ flex: 1, minWidth: 260 }} placeholder="Buscar defeito ou aparelho…" value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}>＋ Nova solução</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '0 0 12px' }}>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Todos os problemas</option>
          {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={marca} onChange={(e) => setMarca(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">Todas as marcas</option>
          {marcasUsadas.filter((m) => m !== 'Todas').map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={nivel} onChange={(e) => setNivel(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">Qualquer nível</option>
          {NIVEIS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={origem} onChange={(e) => setOrigem(e.target.value)} style={{ minWidth: 150 }}>
          <option value="">Minhas + base pronta</option>
          <option value="proprio">Só as minhas</option>
          <option value="base">Só a base pronta</option>
        </select>
      </div>

      {lista === null && <div className="muted">Carregando…</div>}
      {lista && lista.length === 0 && (
        <div className="card muted">Nenhuma solução encontrada. Tente outra palavra ou cadastre a sua em “＋ Nova solução”.</div>
      )}

      {(lista || []).map((s) => {
        const ab = aberto === s.id;
        return (
          <div className="card" key={s.id} style={{ marginBottom: 10, padding: 0 }}>
            <button type="button" onClick={() => setAberto(ab ? null : s.id)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box', padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{s.defeito}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                    {[s.marca && s.marca !== 'Todas' ? s.marca : 'Qualquer aparelho', s.modelo].filter(Boolean).join(' · ')} · {s.tipo}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 'none' }}>
                  {s.origem === 'proprio' && <span className="badge" style={{ fontSize: 10.5 }}>Minha</span>}
                  <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 99, border: `1px solid ${COR_NIVEL[s.nivel] || 'var(--border)'}`, color: COR_NIVEL[s.nivel] || 'inherit' }}>{s.nivel}</span>
                  <span className="muted">{ab ? '▲' : '▼'}</span>
                </div>
              </div>
              {!ab && s.solucao && <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>✅ {s.solucao}</div>}
            </button>
            {ab && (
              <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
                {s.passos && (<><div className="section-title" style={{ marginTop: 12 }}>🔧 O que fazer / o que foi feito</div><div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.5 }}>{s.passos}</div></>)}
                {s.solucao && (<><div className="section-title" style={{ marginTop: 12 }}>✅ Solução</div><div style={{ fontSize: 13.5 }}>{s.solucao}</div></>)}
                {s.pecas && (<><div className="section-title" style={{ marginTop: 12 }}>📦 Peças</div><div style={{ fontSize: 13.5 }}>{s.pecas}</div></>)}
                <div className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
                  {s.origem === 'base' ? 'Base pronta do sistema — confira antes de aplicar e edite se tiver um jeito melhor.' : `Cadastrada por ${s.usuario_nome || '—'}`}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...EMPTY, ...s })}>✏️ Editar</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => setForm({ ...EMPTY, ...s, id: null, origem: 'proprio' })}>📄 Duplicar como minha</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => excluir(s)}>🗑️ Excluir</button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {form && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setForm(null)}>
          <form className="modal" style={{ width: 640 }} onSubmit={salvar}>
            <div className="modal-header">
              <h3>{form.id ? 'Editar solução' : 'Nova solução'}</h3>
              <button type="button" className="icon-btn" onClick={() => setForm(null)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Marca</label>
                <input list="sol-marcas" value={form.marca} onChange={(e) => set('marca', e.target.value)} placeholder="Todas (vale para qualquer)" />
                <datalist id="sol-marcas">{marcasUsadas.map((m) => <option key={m} value={m} />)}</datalist>
              </div>
              <div className="field"><label>Modelo (opcional)</label><input value={form.modelo} onChange={(e) => set('modelo', e.target.value)} placeholder="Ex.: Galaxy A12, iPhone 7" /></div>
              <div className="field">
                <label>Tipo do problema</label>
                <input list="sol-tipos" value={form.tipo} onChange={(e) => set('tipo', e.target.value)} />
                <datalist id="sol-tipos">{TIPOS.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
              <div className="field">
                <label>Nível de dificuldade</label>
                <select value={form.nivel} onChange={(e) => set('nivel', e.target.value)}>{NIVEIS.map((n) => <option key={n} value={n}>{n}</option>)}</select>
              </div>
              <div className="field span-2"><label>Defeito (o que o aparelho apresentava) *</label><input value={form.defeito} onChange={(e) => set('defeito', e.target.value)} placeholder="Ex.: Não carrega, só funciona com o cabo torto" autoFocus /></div>
              <div className="field span-2"><label>O que você fez (passo a passo)</label><textarea rows={5} value={form.passos} onChange={(e) => set('passos', e.target.value)} placeholder={'1) Testei outro cabo…\n2) Limpei o conector…\n3) Troquei a sub-placa…'} /></div>
              <div className="field span-2"><label>Solução (o que resolveu)</label><input value={form.solucao} onChange={(e) => set('solucao', e.target.value)} placeholder="Ex.: Troca da sub-placa de carga" /></div>
              <div className="field span-2"><label>Peças usadas (opcional)</label><input value={form.pecas} onChange={(e) => set('pecas', e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar solução</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
