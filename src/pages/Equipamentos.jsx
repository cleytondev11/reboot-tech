import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';

const EMPTY = {
  id: null, cliente_id: '', marca: '', modelo: '', imei: '', numero_serie: '', cor: '',
  senha_desbloqueio: '', capacidade: '', operadora: '', estado_conservacao: '', acessorios: '', fotos: [],
};

const ACESSORIOS_OPCOES = ['Capinha', 'Película', 'Cartão SIM', 'Cartão SD', 'Carregador', 'Fone de ouvido', 'Caixa/embalagem'];

export default function Equipamentos() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [clientes, setClientes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  async function load(t) {
    const res = await window.api.equipamentos.list(t);
    setList(res);
  }

  async function loadClientes() {
    const res = await window.api.clientes.list();
    setClientes(res);
  }

  useEffect(() => { load(); loadClientes(); }, []);
  useEffect(() => {
    const t = setTimeout(() => load(termo), 250);
    return () => clearTimeout(t);
  }, [termo]);

  function openNew() {
    setForm({ ...EMPTY, acessorios_arr: [] });
    setModalOpen(true);
  }

  function openEdit(eq) {
    let fotos = [];
    try { fotos = JSON.parse(eq.fotos || '[]'); } catch { fotos = []; }
    setForm({ ...eq, fotos, acessorios_arr: (eq.acessorios || '').split(',').filter(Boolean) });
    setModalOpen(true);
  }

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function toggleAcessorio(a) {
    setForm((f) => {
      const arr = f.acessorios_arr || [];
      const has = arr.includes(a);
      return { ...f, acessorios_arr: has ? arr.filter((x) => x !== a) : [...arr, a] };
    });
  }

  function handleFotos(e) {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setForm((f) => ({ ...f, fotos: [...(f.fotos || []), reader.result] }));
      };
      reader.readAsDataURL(file);
    });
  }

  function removeFoto(idx) {
    setForm((f) => ({ ...f, fotos: f.fotos.filter((_, i) => i !== idx) }));
  }

  async function save(e) {
    e.preventDefault();
    if (!form.cliente_id) return showToast('Selecione o cliente proprietário.', 'error');
    if (!form.marca.trim()) return showToast('Informe a marca do equipamento.', 'error');
    try {
      const payload = { ...form, acessorios: (form.acessorios_arr || []).join(',') };
      await window.api.equipamentos.save(user, payload);
      showToast('Equipamento salvo com sucesso.');
      setModalOpen(false);
      load(termo);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(eq) {
    if (!confirm(`Excluir o equipamento "${eq.marca} ${eq.modelo || ''}" de ${eq.cliente_nome || 'cliente'}? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.equipamentos.delete(user, eq.id);
      showToast('Equipamento excluído.');
      load(termo);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar por marca, modelo, IMEI ou cliente..." value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Novo Equipamento</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Cliente</th><th>Marca</th><th>Modelo</th><th>IMEI</th><th>Cor</th><th>Estado</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((eq) => (
              <tr key={eq.id}>
                <td>{eq.cliente_nome || '-'}</td>
                <td>{eq.marca}</td>
                <td>{eq.modelo}</td>
                <td>{eq.imei || '-'}</td>
                <td>{eq.cor || '-'}</td>
                <td>{eq.estado_conservacao || '-'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="icon-btn" title="Editar" onClick={() => openEdit(eq)}>✏️</button>
                  {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir" onClick={() => excluir(eq)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhum equipamento cadastrado.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? 'Editar Equipamento' : 'Novo Equipamento'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div className="form-grid">
              <div className="field span-2">
                <label>Cliente Proprietário *</label>
                <select value={form.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                  <option value="">Selecione...</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div className="field"><label>Marca *</label><input value={form.marca} onChange={(e) => set('marca', e.target.value)} /></div>
              <div className="field"><label>Modelo</label><input value={form.modelo} onChange={(e) => set('modelo', e.target.value)} /></div>

              <div className="field"><label>IMEI</label><input value={form.imei} onChange={(e) => set('imei', e.target.value)} /></div>
              <div className="field"><label>Número de Série</label><input value={form.numero_serie} onChange={(e) => set('numero_serie', e.target.value)} /></div>

              <div className="field"><label>Cor</label><input value={form.cor} onChange={(e) => set('cor', e.target.value)} /></div>
              <div className="field"><label>Senha / Padrão</label><input value={form.senha_desbloqueio} onChange={(e) => set('senha_desbloqueio', e.target.value)} /></div>

              <div className="field"><label>Capacidade</label><input placeholder="Ex: 128GB" value={form.capacidade} onChange={(e) => set('capacidade', e.target.value)} /></div>
              <div className="field"><label>Operadora</label><input value={form.operadora} onChange={(e) => set('operadora', e.target.value)} /></div>

              <div className="field span-2">
                <label>Estado de Conservação</label>
                <select value={form.estado_conservacao} onChange={(e) => set('estado_conservacao', e.target.value)}>
                  <option value="">Selecione...</option>
                  <option>Excelente</option>
                  <option>Bom</option>
                  <option>Regular</option>
                  <option>Ruim</option>
                </select>
              </div>

              <div className="field span-2">
                <label>Acessórios entregues</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {ACESSORIOS_OPCOES.map((a) => (
                    <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, background: 'var(--bg-elev-2)', border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 999 }}>
                      <input type="checkbox" checked={(form.acessorios_arr || []).includes(a)} onChange={() => toggleAcessorio(a)} />
                      {a}
                    </label>
                  ))}
                </div>
              </div>

              <div className="field span-2">
                <label>Fotos do aparelho</label>
                <input type="file" accept="image/*" multiple onChange={handleFotos} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {(form.fotos || []).map((f, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      <img src={f} style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                      <button type="button" onClick={() => removeFoto(i)} style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Equipamento</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
