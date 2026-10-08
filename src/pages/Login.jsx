import React, { useState } from 'react';
import { useApp } from '../context.jsx';
import { SUPORTE_WHATSAPP } from '../utils.js';

export default function Login() {
  const { setUser } = useApp();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [esqueci, setEsqueci] = useState(false); // painel "Esqueci minha senha" (só na versão web)
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const podeEsquecer = !!window.api?.auth?.esqueciSenha;

  async function pedirNovaSenha() {
    setError('');
    if (!usuario.trim()) { setError('Digite o seu usuário (login) acima para pedir a nova senha.'); return; }
    setEnviando(true);
    try {
      const r = await window.api.auth.esqueciSenha(usuario.trim());
      if (r.ok) setPedidoEnviado(true);
      else setError(r.error || 'Não foi possível enviar o pedido.');
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setEnviando(false);
    }
  }

  const msgZap = encodeURIComponent('Olá! Esqueci a minha senha do Reboot Tech. Meu usuário (login) é: ' + usuario.trim());
  const linkZap = 'https://wa.me/' + String(SUPORTE_WHATSAPP || '').replace(/\D/g, '') + '?text=' + msgZap;

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
          <input data-sem-maiuscula autoFocus value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="admin" />
        </div>
        <div className="field">
          <label>Senha</label>
          <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="••••••••" />
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
        {error && <div className="login-error">{error}</div>}

        {podeEsquecer && !esqueci && (
          <button type="button" className="btn-link" style={{ marginTop: 14, background: 'none', border: 'none', color: 'var(--primary, #d4af37)', cursor: 'pointer', textDecoration: 'underline', fontSize: 13.5 }} onClick={() => { setEsqueci(true); setPedidoEnviado(false); }}>
            Esqueci minha senha
          </button>
        )}
        {podeEsquecer && esqueci && (
          <div style={{ marginTop: 16, padding: 14, border: '1px solid var(--border, #333)', borderRadius: 10, textAlign: 'left', fontSize: 13.5 }}>
            {!pedidoEnviado ? (
              <>
                <p style={{ margin: '0 0 10px' }}>Digite o seu usuário (login) no campo acima e clique em <b>Pedir nova senha</b>. Vamos avisar o suporte para definir uma nova senha para você.</p>
                <button type="button" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} disabled={enviando} onClick={pedirNovaSenha}>
                  {enviando ? 'Enviando...' : '🔑 Pedir nova senha'}
                </button>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 10px' }}>✅ <b>Pedido enviado!</b> O suporte vai definir uma nova senha. Para ser mais rápido, chame também no WhatsApp:</p>
                <a className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }} href={linkZap} target="_blank" rel="noopener noreferrer">💬 Chamar no WhatsApp</a>
              </>
            )}
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>Funcionário? Peça ao administrador da sua loja para trocar a sua senha em Usuários.</p>
            <button type="button" style={{ marginTop: 6, background: 'none', border: 'none', color: 'inherit', opacity: 0.7, cursor: 'pointer', textDecoration: 'underline', fontSize: 12.5 }} onClick={() => setEsqueci(false)}>Fechar</button>
          </div>
        )}
      </form>
    </div>
  );
}
