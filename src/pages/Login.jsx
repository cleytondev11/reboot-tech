import React, { useState } from 'react';
import { useApp } from '../context.jsx';

export default function Login() {
  const { setUser } = useApp();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await window.api.auth.login(usuario.trim(), senha);
      if (res.ok) {
        setUser(res.user);
      } else {
        setError(res.error || 'Falha ao entrar.');
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="./logo.png" alt="Reboot Tech" onError={(e) => (e.target.style.display = 'none')} />
        <h2>Reboot Tech</h2>
        <p className="sub">Sistema de Gestão de Assistência Técnica</p>

        <div className="field">
          <label>Usuário</label>
          <input autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="admin" />
        </div>
        <div className="field">
          <label>Senha</label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  );
}
