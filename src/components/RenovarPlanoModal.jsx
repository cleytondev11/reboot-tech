import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency } from '../utils.js';
import { qrSvg } from '../qr.js';
import { PIX_RENOVACAO, DADOS_PIX, enviarComprovantePeloWhatsapp } from '../plano.js';

// Renovar plano: mostra o QR Code e o Pix "copia e cola". Depois de pagar, o cliente toca em
// "Já fiz o pagamento" e aparece o botão para enviar o comprovante no WhatsApp do suporte.
function PixEstatico({ plano, onClose }) {
  const { user, showToast } = useApp();
  const [pago, setPago] = useState(false);
  const svg = useMemo(() => qrSvg(PIX_RENOVACAO, { tamanho: 232 }), []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(PIX_RENOVACAO);
      showToast('Código Pix copiado! Cole no app do seu banco.');
    } catch {
      showToast('Não foi possível copiar. Segure o texto do código para copiar manualmente.', 'error');
    }
  }

  function enviarComprovante() {
    // Chamado direto do toque no botão: assim o celular permite abrir o WhatsApp.
    enviarComprovantePeloWhatsapp(plano, user).catch((err) => showToast(String((err && err.message) || err), 'error'));
  }

  return (
    <div className="modal-backdrop" style={{ zIndex: 250 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(460px, 94vw)' }}>
        <div className="modal-header">
          <h3>🔄 Renovar plano</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        {!pago ? (
          <>
            <p className="muted" style={{ marginTop: 0, textAlign: 'center', fontSize: 13 }}>
              Pague pelo Pix: abra o app do seu banco e leia o QR Code, ou use o Pix copia e cola.
            </p>
            {DADOS_PIX.valor ? <div className="rn-valor">{formatCurrency(DADOS_PIX.valor)}</div> : null}
            <div className="rn-qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR Code do Pix" />
            {DADOS_PIX.nome && <div className="muted" style={{ textAlign: 'center', fontSize: 12.5 }}>Recebedor: <b>{DADOS_PIX.nome}</b></div>}

            <div className="field" style={{ marginTop: 14 }}>
              <label>Pix copia e cola</label>
              <textarea className="rn-codigo" readOnly rows={4} value={PIX_RENOVACAO} onFocus={(e) => e.target.select()} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={copiar}>📋 Copiar código Pix</button>
              <button type="button" className="btn btn-primary" onClick={() => setPago(true)}>✅ Já fiz o pagamento</button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 42 }}>🧾</div>
            <h3 style={{ margin: '4px 0 6px' }}>Envie o comprovante</h3>
            <p className="muted" style={{ fontSize: 13.5, margin: '0 0 14px' }}>
              Toque no botão abaixo para abrir o WhatsApp do suporte e anexe o comprovante do Pix (📎 › Documento ou Galeria). Assim que confirmarmos, o seu plano é renovado.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={enviarComprovante}>💬 Enviar comprovante no WhatsApp</button>
              <button type="button" className="btn btn-secondary" onClick={() => setPago(false)}>← Voltar ao QR Code</button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PLANOS_MP = [
  { id: 'mensal', nome: 'Mensal', valor: 39.9, rotulo: '30 dias' },
  { id: 'trimestral', nome: 'Trimestral', valor: 99.7, rotulo: '90 dias' },
  { id: 'anual', nome: 'Anual', valor: 319.99, rotulo: '365 dias' },
];

// Pix automático (Asaas): gera o QR Code, confere o pagamento sozinho e renova na hora.
function PixAutomatico({ plano, onClose, onPago, onFalha }) {
  const { user, showToast } = useApp();
  const [escolhido, setEscolhido] = useState('mensal');
  const [pix, setPix] = useState(null);
  const [cpf, setCpf] = useState(() => { try { return localStorage.getItem('rt-cpf') || ''; } catch { return ''; } });
  const [metodo, setMetodo] = useState('pix'); // pix | cartao | recorrente
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [liberado, setLiberado] = useState(false);
  const [vencimento, setVencimento] = useState('');
  const [comprovante, setComprovante] = useState(false);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  async function gerar() {
    setGerando(true); setErro('');
    const r = await window.api.pagamento.gerarPixLogado(escolhido, cpf, metodo);
    if (!vivo.current) return;
    setGerando(false);
    if (r && r.ok) { setPix(r); try { localStorage.setItem('rt-cpf', cpf); } catch { /* sem armazenamento */ } } else setErro((r && r.error) || 'Não foi possível gerar o Pix agora.');
  }

  useEffect(() => {
    if (!pix || liberado) return undefined;
    let parar = false;
    const t = setInterval(async () => {
      const r = await window.api.pagamento.status(pix.id, pix.t);
      if (parar || !vivo.current) return;
      if (r && r.liberado) {
        parar = true; setLiberado(true);
        try {
          const p = await window.api.plano.get();
          if (p && p.dataVencimento) setVencimento(p.dataVencimento.split('-').reverse().join('/'));
        } catch { /* a data é só um detalhe */ }
        if (onPago) onPago();
      }
    }, 4000);
    return () => { parar = true; clearInterval(t); };
  }, [pix, liberado]); // eslint-disable-line react-hooks/exhaustive-deps

  async function copiar() {
    try { await navigator.clipboard.writeText(pix.qrCode); showToast('Código Pix copiado! Cole no app do seu banco.'); }
    catch { showToast('Não foi possível copiar. Segure o texto do código para copiar manualmente.', 'error'); }
  }

  const sel = PLANOS_MP.find((p) => p.id === escolhido);
  return (
    <div className="modal-backdrop" style={{ zIndex: 250 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(460px, 94vw)' }}>
        <div className="modal-header">
          <h3>🔄 Renovar plano</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>

        {liberado ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 44 }}>✅</div>
            <h3 style={{ margin: '4px 0 6px' }}>Pagamento confirmado!</h3>
            <p className="muted" style={{ fontSize: 13.5, margin: '0 0 14px' }}>
              Seu plano foi renovado{vencimento ? <> até <b>{vencimento}</b></> : ''}. Obrigado!
            </p>
            <button type="button" className="btn btn-primary" onClick={onClose}>Fechar</button>
          </div>
        ) : comprovante ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 42 }}>🧾</div>
            <h3 style={{ margin: '4px 0 6px' }}>Enviar comprovante</h3>
            <p className="muted" style={{ fontSize: 13.5, margin: '0 0 14px' }}>
              Normalmente o plano é liberado sozinho em instantes. Se já pagou e não liberou, envie o comprovante ao suporte.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn btn-primary" onClick={() => enviarComprovantePeloWhatsapp(plano, user).catch((err) => showToast(String((err && err.message) || err), 'error'))}>💬 Enviar comprovante no WhatsApp</button>
              <button type="button" className="btn btn-secondary" onClick={() => setComprovante(false)}>← Voltar ao QR Code</button>
            </div>
          </div>
        ) : !pix ? (
          <>
            <p className="muted" style={{ marginTop: 0, textAlign: 'center', fontSize: 13 }}>Escolha o plano. O Pix é gerado na hora e o acesso é renovado automaticamente após o pagamento.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {PLANOS_MP.map((p) => (
                <button key={p.id} type="button" className={'btn ' + (escolhido === p.id ? 'btn-primary' : 'btn-secondary')} onClick={() => setEscolhido(p.id)} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.nome} · {p.rotulo}</span><b>{formatCurrency(p.valor)}</b>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              {[['pix', '⚡ Pix'], ['cartao', '💳 Cartão'], ['recorrente', '🔁 Recorrente']].map(([id, rot]) => (
                <button key={id} type="button" className={'btn ' + (metodo === id ? 'btn-primary' : 'btn-secondary')} style={{ flex: 1, justifyContent: 'center' }} onClick={() => setMetodo(id)}>{rot}</button>
              ))}
            </div>
            {metodo === 'recorrente' && <p className="muted" style={{ margin: '8px 0 0', fontSize: 12, textAlign: 'center' }}>O cartão é cobrado automaticamente a cada período do plano. Você cancela quando quiser.</p>}
            <div className="field" style={{ marginTop: 12 }}>
              <label>CPF ou CNPJ de quem vai pagar</label>
              <input inputMode="numeric" placeholder="Somente números" value={cpf} onChange={(e) => setCpf(e.target.value)} />
            </div>
            {erro && <div className="muted" style={{ color: 'var(--danger, #e5484d)', marginTop: 10, fontSize: 13, textAlign: 'center' }}>{erro}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <button type="button" className="btn btn-primary" disabled={gerando || cpf.replace(/\D/g, '').length < 11} onClick={gerar}>{gerando ? 'Gerando…' : (metodo === 'pix' ? 'Gerar Pix de ' : metodo === 'cartao' ? 'Pagar com cartão ' : 'Assinar no cartão ') + formatCurrency(sel.valor)}</button>
              {erro && <button type="button" className="btn btn-ghost" onClick={onFalha}>Usar o Pix manual</button>}
            </div>
          </>
        ) : pix.url ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 42 }}>💳</div>
            <h3 style={{ margin: '4px 0 6px' }}>{formatCurrency(pix.valor)} · plano {pix.plano}</h3>
            <p className="muted" style={{ fontSize: 13.5, margin: '0 0 14px' }}>Digite os dados do cartão na página segura do Asaas. {pix.metodo === 'recorrente' ? 'A cobrança se repete sozinha a cada período. ' : ''}Assim que for aprovado, o plano é renovado automaticamente aqui.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <a className="btn btn-primary" style={{ justifyContent: 'center', textDecoration: 'none' }} href={pix.url} target="_blank" rel="noopener noreferrer">💳 Abrir pagamento seguro</a>
              <div className="muted" style={{ fontSize: 12.5 }}>⏳ Aguardando a aprovação…</div>
              <button type="button" className="btn btn-ghost" onClick={() => setComprovante(true)}>Problema? Falar com o suporte</button>
            </div>
          </div>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0, textAlign: 'center', fontSize: 13 }}>Plano {pix.plano}: leia o QR Code no app do seu banco ou use o Pix copia e cola.</p>
            <div className="rn-valor">{formatCurrency(pix.valor)}</div>
            {pix.qrBase64 && <div className="rn-qr"><img alt="QR Code do Pix" src={'data:image/png;base64,' + pix.qrBase64} style={{ width: 220, height: 220 }} /></div>}
            <div className="field" style={{ marginTop: 14 }}>
              <label>Pix copia e cola</label>
              <textarea className="rn-codigo" readOnly rows={4} value={pix.qrCode} onFocus={(e) => e.target.select()} />
            </div>
            <div className="muted" style={{ textAlign: 'center', fontSize: 12.5, margin: '6px 0' }}>⏳ Aguardando o pagamento… a liberação é automática.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={copiar}>📋 Copiar código Pix</button>
              <button type="button" className="btn btn-ghost" onClick={() => setComprovante(true)}>Problema? Enviar comprovante</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Usa o Pix automático quando o servidor tem o Asaas configurado; senão, o Pix fixo.
export default function RenovarPlanoModal({ plano, onClose, onPago }) {
  const [modo, setModo] = useState('carregando');
  useEffect(() => {
    let vivo = true;
    const f = window.api && window.api.pagamento && window.api.pagamento.config;
    if (!f) { setModo('estatico'); return undefined; }
    f().then((c) => { if (vivo) setModo(c && c.ativo ? 'auto' : 'estatico'); }).catch(() => { if (vivo) setModo('estatico'); });
    return () => { vivo = false; };
  }, []);
  if (modo === 'carregando') return null;
  if (modo === 'auto') return <PixAutomatico plano={plano} onClose={onClose} onPago={onPago} onFalha={() => setModo('estatico')} />;
  return <PixEstatico plano={plano} onClose={onClose} />;
}
