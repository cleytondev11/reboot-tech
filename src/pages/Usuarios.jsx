import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { PAPEIS, formatDateTime } from '../utils.js';

const EMPTY_FORM = { id: null, nome: '', usuario: '', senha: '', papel: 'Atendente' };

export default function Usuarios() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [senhaModal, setSenhaModal] = useState(null); // usuário selecionado para trocar a senha
  const [novaSenha, setNovaSenha] = useState('');

  async function load() { setList(await window.api.usuarios.list()); }
  useEffect(() => { load(); }, []);

  function openNew() {
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(u) {
    setForm({ id: u.id, nome: u.nome, usuario: u.usuario, senha: '', papel: u.papel });
    setModalOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.nome || !form.usuario) return showToast('Preencha nome e usuário.', 'error');
    if (!form.id && !form.senha) return showToast('Defina uma senha para o novo usuário.', 'error');
    try {
      if (form.id) {
        await window.api.usuarios.update(user, form.id, form.nome, form.usuario, form.papel);
        showToast('Usuário atualizado com sucesso.');
      } else {
        await window.api.usuarios.create(user, form.nome, form.usuario, form.senha, form.papel);
        showToast('Usuário criado com sucesso.');
      }
      setModalOpen(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function toggle(u) {
    try {
      await window.api.usuarios.toggleAtivo(user, u.id, !u.ativo);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(u) {
    if (!confirm(`Excluir definitivamente o usuário "${u.nome}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.usuarios.delete(user, u.id);
      showToast('Usuário excluído.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  function abrirTrocarSenha(u) {
    setSenhaModal(u);
    setNovaSenha('');
  }

  async function salvarNovaSenha(e) {
    e.preventDefault();
    if (!novaSenha || novaSenha.length < 4) return showToast('A nova senha deve ter pelo menos 4 caracteres.', 'error');
    try {
      await window.api.usuarios.changePassword(user, senhaModal.id, novaSenha);
      showToast(`Senha de ${senhaModal.nome} alterada com sucesso.`);
      setSenhaModal(null);
      setNovaSenha('');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  if (user.papel !== 'Administrador') {
    return <div className="empty-state">Apenas administradores podem acessar esta área.</div>;
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left"><span className="muted">Gerencie os usuários e níveis de acesso do sistema.</span></div>
        <div className="toolbar-right"><button className="btn btn-primary" onClick={openNew}>+ Novo Usuário</button></div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Nome</th><th>Usuário</th><th>Papel</th><th>Status</th><th>Criado em</th><th></th></tr></thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>{u.nome}</td>
                <td>{u.usuario}</td>
                <td><span className="pill">{u.papel}</span></td>
                <td>{u.ativo ? <span style={{ color: 'var(--success)' }}>Ativo</span> : <span style={{ color: 'var(--danger)' }}>Inativo</span>}</td>
                <td>{formatDateTime(u.criado_em)}</td>
                <td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button className="icon-btn" title="Editar" onClick={() => openEdit(u)}>✏️</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => abrirTrocarSenha(u)}>🔑 Alterar Senha</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => toggle(u)}>{u.ativo ? 'Desativar' : 'Ativar'}</button>
                  {u.id !== user.id && <button className="icon-btn" title="Excluir" onClick={() => excluir(u)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6}><div className="empty-state">Nenhum usuário cadastrado.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 420 }} onSubmit={save}>
            <div className="modal-header"><h3>{form.id ? 'Editar Usuário' : 'Novo Usuário'}</h3><button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Nome</label><input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} autoFocus /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Usuário (login)</label><input value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} /></div>
            {!form.id && (
              <div className="field" style={{ marginBottom: 12 }}><label>Senha</label><input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} /></div>
            )}
            {form.id && (
              <p className="muted" style={{ fontSize: 11.5, marginTop: -6, marginBottom: 12 }}>Para alterar a senha deste usuário, use o botão "🔑 Alterar Senha" na listagem.</p>
            )}
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Papel</label>
              <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
                {PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">{form.id ? 'Salvar Alterações' : 'Criar Usuário'}</button>
            </div>
          </form>
        </div>
      )}

      {senhaModal && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setSenhaModal(null)}>
          <form className="modal" style={{ width: 400 }} onSubmit={salvarNovaSenha}>
            <div className="modal-header"><h3>Alterar Senha — {senhaModal.nome}</h3><button type="button" className="icon-btn" onClick={() => setSenhaModal(null)}>✕</button></div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Nova Senha</label>
              <input type="password" autoFocus value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="Mínimo 4 caracteres" />
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              O usuário passará a usar esta nova senha no próximo login.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setSenhaModal(null)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Senha</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
