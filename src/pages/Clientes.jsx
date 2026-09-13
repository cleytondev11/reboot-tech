import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { maskCpfCnpj, maskPhone, formatDateTime, statusClass } from '../utils.js';

const EMPTY = {
  id: null, tipo: 'PF', nome: '', cpf_cnpj: '', rg_ie: '', telefone: '', whatsapp: '',
  email: '', cep: '', endereco: '', numero: '', bairro: '', cidade: '', uf: '', observacoes: '', data_nascimento: '',
};

export default function Clientes() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [historico, setHistorico] = useState(null);

  async function load(t) {
    const res = await window.api.clientes.list(t);
    setList(res);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(termo), 250);
    return () => clearTimeout(t);
  }, [termo]);

  function openNew() {
    setForm(EMPTY);
    setModalOpen(true);
  }

  function openEdit(c) {
    setForm({ ...EMPTY, ...c, data_nascimento: c.data_nascimento || '' });
    setModalOpen(true);
  }

  async function openHistorico(c) {
    const hist = await window.api.clientes.historico(c.id);
    setHistorico({ cliente: c, os: hist });
  }

  async function save(e) {
    e.preventDefault();
    if (!form.nome.trim()) return showToast('Informe o nome do cliente.', 'error');
    try {
      await window.api.clientes.save(user, form);
      showToast('Cliente salvo com sucesso.');
      setModalOpen(false);
      load(termo);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function remove(c) {
    if (!confirm(`Excluir o cliente "${c.nome}"?`)) return;
    try {
      await window.api.clientes.delete(user, c.id);
      showToast('Cliente excluído.');
      load(termo);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail..." value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Novo Cliente</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nome</th><th>Tipo</th><th>CPF/CNPJ</th><th>Telefone</th><th>E-mail</th><th>Cidade/UF</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td><b>{c.nome}</b></td>
                <td><span className="pill">{c.tipo}</span></td>
                <td>{c.cpf_cnpj || '-'}</td>
                <td>{c.telefone || c.whatsapp || '-'}</td>
                <td>{c.email || '-'}</td>
                <td>{c.cidade ? `${c.cidade}/${c.uf}` : '-'}</td>
                <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" title="Histórico" onClick={() => openHistorico(c)}>🕘</button>
                  <button className="icon-btn" title="Editar" onClick={() => openEdit(c)}>✏️</button>
                  {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir" onClick={() => remove(c)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7}><div className="empty-state">Nenhum cliente encontrado.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? 'Editar Cliente' : 'Novo Cliente'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Tipo</label>
                <select value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
                  <option value="PF">Pessoa Física</option>
                  <option value="PJ">Pessoa Jurídica</option>
                </select>
              </div>
              <div className="field">
                <label>{form.tipo === 'PJ' ? 'Razão Social' : 'Nome Completo'} *</label>
                <input value={form.nome} onChange={(e) => set('nome', e.target.value)} required />
              </div>

              <div className="field">
                <label>{form.tipo === 'PJ' ? 'CNPJ' : 'CPF'}</label>
                <input value={form.cpf_cnpj} onChange={(e) => set('cpf_cnpj', maskCpfCnpj(e.target.value, form.tipo))} />
              </div>
              <div className="field">
                <label>{form.tipo === 'PJ' ? 'Inscrição Estadual' : 'RG'}</label>
                <input value={form.rg_ie} onChange={(e) => set('rg_ie', e.target.value)} />
              </div>

              <div className="field">
                <label>Telefone</label>
                <input value={form.telefone} onChange={(e) => set('telefone', maskPhone(e.target.value))} />
              </div>
              <div className="field">
                <label>WhatsApp</label>
                <input value={form.whatsapp} onChange={(e) => set('whatsapp', maskPhone(e.target.value))} />
              </div>

              <div className="field span-2">
                <label>E-mail</label>
                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </div>

              <div className="field">
                <label>Data de Nascimento</label>
                <input type="date" value={form.data_nascimento} onChange={(e) => set('data_nascimento', e.target.value)} />
              </div>

              <div className="field">
                <label>CEP</label>
                <input value={form.cep} onChange={(e) => set('cep', e.target.value)} />
              </div>
              <div className="field">
                <label>Endereço</label>
                <input value={form.endereco} onChange={(e) => set('endereco', e.target.value)} />
              </div>

              <div className="field">
                <label>Número</label>
                <input value={form.numero} onChange={(e) => set('numero', e.target.value)} />
              </div>
              <div className="field">
                <label>Bairro</label>
                <input value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
              </div>

              <div className="field">
                <label>Cidade</label>
                <input value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
              </div>
              <div className="field">
                <label>UF</label>
                <input maxLength={2} style={{ textTransform: 'uppercase' }} value={form.uf} onChange={(e) => set('uf', e.target.value.toUpperCase())} />
              </div>

              <div className="field span-2">
                <label>Observações</label>
                <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Cliente</button>
            </div>
          </form>
        </div>
      )}

      {historico && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setHistorico(null)}>
          <div className="modal">
            <div className="modal-header">
              <h3>Histórico — {historico.cliente.nome}</h3>
              <button type="button" className="icon-btn" onClick={() => setHistorico(null)}>✕</button>
            </div>
            {historico.os.length === 0 && <div className="empty-state">Nenhuma ordem de serviço para este cliente.</div>}
            {historico.os.map((o) => (
              <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{o.numero} — {o.marca} {o.modelo}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{formatDateTime(o.criado_em)}</div>
                </div>
                <span className={`badge ${statusClass(o.status)}`}>{o.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
