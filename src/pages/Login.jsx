import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { SUPORTE_WHATSAPP } from '../utils.js';
import { PLANOS_PIX } from '../pix-planos.js';
import { qrSvg } from '../qr.js';

export default function Login() {
  const { setUser } = useApp();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [esqueci, setEsqueci] = useState(false); // painel "Esqueci minha senha" (só na versão web)
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [renovar, setRenovar] = useState(false); // painel "Renovar plano" (Pix)
  const [planoId, setPlanoId] = useState('mensal');
  const [copiado, setCopiado] = useState(false);
  const [mpAtivo, setMpAtivo] = useState(false); // Pix automático (Asaas) configurado no servidor?
  const [pix, setPix] = useState(null);          // Pix gerado: { id, t, valor, plano, qrCode, qrBase64 }
  const [cpf, setCpf] = useState(() => { try { return localStorage.getItem('rt-cpf') || ''; } catch { return ''; } });
  const [gerando, setGerando] = useState(false);
  const [pago, setPago] = useState(false);
  const [erroPix, setErroPix] = useState('');
  const podeEsquecer = !!window.api?.auth?.esqueciSenha;

  useEffect(() => {
    let vivo = true;
    if (window.api?.pagamento?.config) window.api.pagamento.config().then((c) => { if (vivo) setMpAtivo(!!(c && c.ativo)); });
    return () => { vivo = false; };
  }, []);

  // Depois de gerar o Pix, consulta a cada 4 segundos até o pagamento ser confirmado.
  useEffect(() => {
    if (!pix || pago) return undefined;
    const iv = setInterval(async () => {
      const r = await window.api.pagamento.status(pix.id, pix.t);
      if (r && r.liberado) setPago(true);
    }, 4000);
    return () => clearInterval(iv);
  }, [pix, pago]);

  async function gerarPix() {
    setErroPix(''); setGerando(true);
    try {
      const r = await window.api.pagamento.gerarPix(usuario.trim(), senha, planoId, cpf);
      if (r.ok) { setPix(r); try { localStorage.setItem('rt-cpf', cpf); } catch { /* sem armazenamento */ } } else setErroPix(r.error || 'Não foi possível gerar o Pix.');
    } finally { setGerando(false); }
  }

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

  // Acesso bloqueado (teste acabou, plano vencido ou bloqueio manual): mostra o botão de suporte com a mensagem pronta.
  const bloqueado = /terminou|venceu/i.test(error || '');
  const bloqueioManual = /bloquead|suspens/i.test(error || '');
  const plano = PLANOS_PIX.find((p) => p.id === planoId) || PLANOS_PIX[0];
  const linkPago = 'https://wa.me/' + String(SUPORTE_WHATSAPP || '').replace(/\D/g, '') + '?text=' + encodeURIComponent(
    'Olá! Acabei de pagar o Pix de ' + plano.valor + ' (plano ' + plano.nome.toLowerCase() + ') para renovar o Reboot Tech. Segue o comprovante.\nMeu usuário (login) é: ' + usuario.trim()
  );
  const linkSup = 'https://wa.me/' + String(SUPORTE_WHATSAPP || '').replace(/\D/g, '') + '?text=' + encodeURIComponent('Olá! O meu acesso ao Reboot Tech está bloqueado e eu preciso de ajuda para liberar.\nMeu usuário (login) é: ' + usuario.trim());
  const codigoAtual = pix ? pix.qrCode : plano.codigo;
  async function copiarPix() {
    try { await navigator.clipboard.writeText(codigoAtual); } catch (e) { /* o campo abaixo está selecionável */ }
    setCopiado(true); setTimeout(() => setCopiado(false), 2200);
  }

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
        {error && bloqueado && !renovar && (
          <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={() => setRenovar(true)}>
            💳 Renovar plano
          </button>
        )}
        {error && bloqueioManual && (
          <a className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', marginTop: 10 }} href={linkSup} target="_blank" rel="noopener noreferrer">💬 Contatar suporte</a>
        )}
        {error && bloqueado && renovar && (
          <div style={{ marginTop: 12, padding: 14, border: '1px solid var(--border, #333)', borderRadius: 10, textAlign: 'center', fontSize: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Renovar plano</div>
            <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>Escolha o plano e pague o Pix. Depois envie o comprovante: a gente libera o acesso <b>{usuario.trim()}</b>.</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {PLANOS_PIX.map((p) => (
                <button key={p.id} type="button" className={'btn ' + (p.id === planoId ? 'btn-primary' : 'btn-secondary')} style={{ flex: 1, justifyContent: 'center', padding: '8px 4px', flexDirection: 'column', lineHeight: 1.2 }} onClick={() => { if (!pix) { setPlanoId(p.id); setCopiado(false); } }}>
                  <span>{p.nome}</span><small style={{ fontWeight: 700 }}>{p.valor}</small>
                </button>
              ))}
            </div>
            {pago ? (
              <div style={{ padding: '10px 0' }}>
                <div style={{ fontSize: 40 }}>✅</div>
                <div style={{ fontWeight: 800, margin: '6px 0' }}>Pagamento confirmado!</div>
                <p className="muted" style={{ margin: '0 0 10px', fontSize: 12.5 }}>Seu acesso foi liberado. Toque em Entrar.</p>
                <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleSubmit}>Entrar agora</button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--primary, #d4af37)' }}>{plano.valor}</div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Cleyton de Souza Santos · {plano.periodo} de acesso</div>
                {mpAtivo && !pix && (
                  <>
                    <input inputMode="numeric" placeholder="CPF ou CNPJ de quem vai pagar" value={cpf} onChange={(e) => setCpf(e.target.value)} style={{ display: 'block', width: '100%', marginBottom: 8, fontSize: 13 }} />
                    <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={gerando || !senha || cpf.replace(/\D/g, '').length < 11} onClick={gerarPix}>
                      {gerando ? 'Gerando Pix...' : '⚡ Gerar Pix de ' + plano.valor}
                    </button>
                    {!senha && <p className="muted" style={{ margin: '8px 0 0', fontSize: 11.5 }}>Digite a sua senha acima e o CPF/CNPJ para gerar o Pix.</p>}
                    {erroPix && <div className="login-error">{erroPix}</div>}
                  </>
                )}
                {(!mpAtivo || pix) && (
                  <>
                    <div style={{ display: 'block', width: 'fit-content', margin: '0 auto', background: '#fff', borderRadius: 10, padding: 6 }}
                      dangerouslySetInnerHTML={{ __html: pix && pix.qrBase64 ? '<img alt="QR Code Pix" style="width:190px;height:190px;margin:0" src="data:image/png;base64,' + pix.qrBase64 + '" />' : qrSvg(codigoAtual, { tamanho: 190 }) }} />
                    <input readOnly value={codigoAtual} style={{ display: 'block', width: '100%', marginTop: 10, fontSize: 11 }} onFocus={(e) => e.target.select()} />
                    <button type="button" className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }} onClick={copiarPix}>{copiado ? '✅ Código copiado!' : '📋 Copiar código Pix'}</button>
                    {pix ? (
                      <p className="muted" style={{ margin: '10px 0 0', fontSize: 12.5 }}>⏳ Aguardando o pagamento... assim que o Pix cair, o acesso é liberado sozinho.</p>
                    ) : null}
                    <a className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', marginTop: 8 }} href={linkPago} target="_blank" rel="noopener noreferrer">{pix ? 'Problema? Enviar comprovante' : '📤 Já paguei, enviar comprovante'}</a>
                  </>
                )}
              </>
            )}
            <p className="muted" style={{ margin: '10px 0 0', fontSize: 11.5 }}>🛡️ Garantia de 7 dias: se não gostar, devolvemos o valor pago.</p>
          </div>
        )}

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
