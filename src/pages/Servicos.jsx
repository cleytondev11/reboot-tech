import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, sanitizeDecimalInput, parseDecimal, CATEGORIAS_PRODUTO } from '../utils.js';

const EMPTY = { id: null, nome: '', descricao: '', categoria: '', valor_padrao: 0 };

export default function Servicos() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  async function load(t) { setList(await window.api.servicos.list(t)); }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(termo), 250);
    return () => clearTimeout(t);
  }, [termo]);

  function openNew() { setForm(EMPTY); setModalOpen(true); }
  function openEdit(s) { setForm({ ...s, valor_padrao: s.valor_padrao ?? 0 }); setModalOpen(true); }
  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  async function save(e) {
    e.preventDefault();
    if (!form.nome.trim()) return showToast('Informe o nome do serviço.', 'error');
    try {
      const payload = { ...form, valor_padrao: parseDecimal(form.valor_padrao) };
      await window.api.servicos.save(user, payload);
      showToast('Serviço salvo com sucesso.');
      setModalOpen(false);
      load(termo);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function remove(s) {
    if (!confirm(`Excluir o serviço "${s.nome}"?`)) return;
    try {
      await window.api.servicos.delete(user, s.id);
      showToast('Serviço excluído.');
      load(termo);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar por nome ou categoria..." value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Novo Serviço</button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
        Cadastre aqui os serviços mais realizados (ex: Troca de Tela, Troca de Bateria, Formatação). Eles ficam disponíveis para seleção rápida ao criar um Orçamento ou Ordem de Serviço.
      </p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Serviço</th><th>Categoria</th><th>Descrição</th><th>Valor Padrão</th><th></th></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td><b>{s.nome}</b></td>
                <td>{s.categoria ? <span className="pill">{s.categoria}</span> : '-'}</td>
                <td className="muted">{s.descricao || '-'}</td>
                <td>{formatCurrency(s.valor_padrao)}</td>
                <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" title="Editar" onClick={() => openEdit(s)}>✏️</button>
                  {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir" onClick={() => remove(s)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhum serviço cadastrado ainda.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 480 }} onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? 'Editar Serviço' : 'Novo Serviço'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field span-2"><label>Nome do Serviço *</label><input value={form.nome} onChange={(e) => set('nome', e.target.value)} /></div>
              <div className="field">
                <label>Categoria</label>
                <select value={form.categoria} onChange={(e) => set('categoria', e.target.value)}>
                  <option value="">Selecione...</option>
                  {CATEGORIAS_PRODUTO.map((c) => <option key={c} value={c}>{c}</option>)}
                  <option value="Mão de Obra">Mão de Obra</option>
                  <option value="Software">Software</option>
                </select>
              </div>
              <div className="field"><label>Valor Padrão (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={form.valor_padrao} onChange={(e) => set('valor_padrao', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field span-2"><label>Descrição</label><textarea value={form.descricao} onChange={(e) => set('descricao', e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Serviço</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
