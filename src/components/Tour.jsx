import React, { useState } from 'react';

const PASSOS = [
  { icon: '👋', titulo: 'Bem-vindo!', texto: 'Um passeio rápido pelas telas principais do sistema. Leva menos de 1 minuto.' },
  { icon: '📊', titulo: 'Dashboard', texto: 'Aqui você vê o resumo do dia: OS em aberto, faturamento, contas a receber/pagar, meta do mês e o gráfico de faturamento.' },
  { icon: '⚡', titulo: 'Atalhos rápidos', texto: 'Use os botões Nova venda, Novo orçamento e Nova OS para começar um atendimento com um toque.' },
  { icon: '☰', titulo: 'Menu', texto: 'Toque no ☰ (canto superior esquerdo) para abrir clientes, equipamentos, estoque, financeiro, bancada e o restante.' },
  { icon: '🔔', titulo: 'Avisos', texto: 'O sino mostra avisos importantes, como a meta do mês batida, estoque baixo, contas a pagar e o vencimento do plano.' },
  { icon: '🚪', titulo: 'Sair', texto: 'O ícone no canto superior direito encerra a sessão quando você quiser sair do sistema.' },
];

function Instalar() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const instalado = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone;
  const [convite, setConvite] = useState(() => window.__rtInstallPrompt || null);
  async function instalar() {
    if (!convite) return;
    try { convite.prompt(); await convite.userChoice; } catch { /* ignora */ }
    window.__rtInstallPrompt = null; setConvite(null);
  }
  if (instalado) return <p className="muted">O app já está instalado neste aparelho. ✅</p>;
  return (
    <div>
      {convite && <button type="button" className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }} onClick={instalar}>📲 Instalar agora</button>}
      {ios
        ? <p className="muted" style={{ fontSize: 13 }}>No iPhone (Safari): toque em <b>Compartilhar</b> (quadrado com seta) e depois em <b>Adicionar à Tela de Início</b>.</p>
        : <p className="muted" style={{ fontSize: 13 }}>No Android (Chrome): toque nos <b>três pontinhos ⋮</b> e depois em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</p>}
    </div>
  );
}

export default function Tour({ app, onClose }) {
  const [i, setI] = useState(0);
  const total = PASSOS.length + 1; // último passo = instalar o app
  const ultimo = i === total - 1;
  const p = PASSOS[i];
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tour-modal">
        <div className="modal-header">
          <h3>{ultimo ? `📲 ${app} como app` : `${p.icon} ${p.titulo}`}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">✕</button>
        </div>
        {ultimo
          ? (<div><p style={{ fontSize: 14, marginTop: 0 }}>Coloque o <b>{app}</b> na tela inicial do celular e abra como um aplicativo, sem barra do navegador.</p><Instalar /></div>)
          : <p style={{ fontSize: 14.5, lineHeight: 1.5, marginTop: 0 }}>{p.texto}</p>}
        <div className="tour-dots">{Array.from({ length: total }).map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn btn-secondary" onClick={() => (i === 0 ? onClose() : setI(i - 1))}>{i === 0 ? 'Pular' : 'Voltar'}</button>
          <button type="button" className="btn btn-primary" onClick={() => (ultimo ? onClose() : setI(i + 1))}>{ultimo ? 'Concluir' : 'Próximo'}</button>
        </div>
      </div>
    </div>
  );
}
