import React, { useMemo, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency } from '../utils.js';
import { qrSvg } from '../qr.js';
import { PIX_RENOVACAO, DADOS_PIX, enviarComprovantePeloWhatsapp } from '../plano.js';

// Renovar plano: mostra o QR Code e o Pix "copia e cola". Depois de pagar, o cliente toca em
// "Já fiz o pagamento" e aparece o botão para enviar o comprovante no WhatsApp do suporte.
export default function RenovarPlanoModal({ plano, onClose }) {
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
