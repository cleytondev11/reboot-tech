import React from 'react';
import { useApp } from '../context.jsx';
import { SUPORTE_WHATSAPP, SUPORTE_WHATSAPP_EXIBIR } from '../utils.js';

// Fale com o suporte: abre o WhatsApp do suporte com a mensagem já escrita.
const ASSUNTOS = [
  { icon: '❓', titulo: 'Tirar uma dúvida', texto: 'Olá! Tenho uma dúvida sobre o sistema Reboot Tech.' },
  { icon: '🛠️', titulo: 'Relatar um problema', texto: 'Olá! Estou com um problema no sistema Reboot Tech. Pode me ajudar?' },
  { icon: '💡', titulo: 'Enviar uma sugestão', texto: 'Olá! Tenho uma sugestão de melhoria para o sistema Reboot Tech.' },
  { icon: '💳', titulo: 'Assunto de mensalidade/licença', texto: 'Olá! Preciso de ajuda com a mensalidade/licença do sistema Reboot Tech.' },
];

export default function Suporte() {
  const { user, showToast } = useApp();

  function abrir(texto) {
    const assinatura = user && user.nome ? `\n\n(Usuário: ${user.nome})` : '';
    // Chamado direto do toque no botão: assim o celular permite abrir o WhatsApp.
    window.api.whatsapp.abrirConversa(SUPORTE_WHATSAPP, texto + assinatura)
      .catch((err) => showToast(String((err && err.message) || err), 'error'));
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(SUPORTE_WHATSAPP_EXIBIR); showToast('Número copiado.'); } catch { showToast('Não foi possível copiar o número.', 'error'); }
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="card" style={{ textAlign: 'center', padding: 28 }}>
        <div className="sp-icone">💬</div>
        <h2 style={{ margin: '12px 0 6px' }}>Fale com o suporte</h2>
        <p className="muted" style={{ marginTop: 0 }}>Precisou de ajuda? Chame a gente pelo WhatsApp.</p>

        <div className="sp-numero">{SUPORTE_WHATSAPP_EXIBIR}</div>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', marginTop: 14 }}>
          <button className="btn btn-primary" onClick={() => abrir('Olá! Preciso de ajuda com o sistema Reboot Tech.')}>💬 Chamar no WhatsApp</button>
          <button className="btn btn-secondary" onClick={copiar}>📋 Copiar número</button>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>Sobre o que você quer falar?</div>
      <div className="grid grid-2">
        {ASSUNTOS.map((a) => (
          <button key={a.titulo} className="card sp-assunto" onClick={() => abrir(a.texto)}>
            <span className="sp-assunto-icone">{a.icon}</span>
            <span>{a.titulo}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 16 }}>O WhatsApp abre com a mensagem pronta; é só tocar em enviar.</p>
    </div>
  );
}
