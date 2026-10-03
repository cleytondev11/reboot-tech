import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';

// Download do app: o sistema é um PWA — instala direto do navegador, sem loja de aplicativos.
// iPhone/iPad: Safari > Compartilhar > Adicionar à Tela de Início.
// Android: Chrome > menu ⋮ > Instalar aplicativo (ou o botão abaixo, quando o navegador permite).
// Computador: Chrome/Edge > ícone de instalar na barra de endereço.

function detectarPlataforma() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function jaInstalado() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

const BENEFICIOS = [
  { icon: '📲', titulo: 'Sem loja de apps', texto: 'Instala direto do navegador, em segundos.' },
  { icon: '⚡', titulo: 'Acesso rápido', texto: 'Abre pelo ícone na tela inicial, em tela cheia.' },
  { icon: '🔔', titulo: 'Sempre atualizado', texto: 'Recebe as novidades do sistema automaticamente.' },
];

function Passo({ n, titulo, texto, destaque }) {
  return (
    <div className="dl-passo">
      <div className="dl-passo-n">{n}</div>
      <div className="dl-passo-txt">
        <b>{titulo}</b>
        <span className="muted">{texto}</span>
      </div>
      {destaque && <div className="dl-passo-icone">{destaque}</div>}
    </div>
  );
}

export default function DownloadApp() {
  const { showToast } = useApp();
  const [aba, setAba] = useState(detectarPlataforma);
  const [convite, setConvite] = useState(() => window.__rtInstallPrompt || null); // evento beforeinstallprompt (Android/Chrome/Edge)
  const [instalado, setInstalado] = useState(jaInstalado);

  useEffect(() => {
    const aoConvidar = (e) => { e.preventDefault(); window.__rtInstallPrompt = e; setConvite(e); };
    const aoInstalar = () => { window.__rtInstallPrompt = null; setConvite(null); setInstalado(true); };
    window.addEventListener('beforeinstallprompt', aoConvidar);
    window.addEventListener('appinstalled', aoInstalar);
    return () => { window.removeEventListener('beforeinstallprompt', aoConvidar); window.removeEventListener('appinstalled', aoInstalar); };
  }, []);

  async function instalarAgora() {
    if (!convite) return;
    try {
      convite.prompt();
      const escolha = await convite.userChoice;
      if (escolha && escolha.outcome === 'accepted') showToast('Instalando o aplicativo...');
    } catch { /* o navegador recusou: os passos manuais continuam valendo */ }
    window.__rtInstallPrompt = null;
    setConvite(null);
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="card">
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <span className="pill" style={{ color: 'var(--info)' }}>PWA</span>
          <span className="pill" style={{ color: 'var(--success)' }}>Seguro</span>
        </div>
        <h2 style={{ margin: '0 0 4px' }}>📲 Instalar Reboot Tech</h2>
        <p className="muted" style={{ marginTop: 0 }}>Tenha o sistema como um aplicativo no seu celular ou computador: acesso rápido e em tela cheia.</p>

        {instalado && <div className="dl-aviso ok">✅ O aplicativo já está instalado neste aparelho (você o está usando agora).</div>}

        <div className="grid grid-3" style={{ margin: '16px 0' }}>
          {BENEFICIOS.map((b) => (
            <div key={b.titulo} className="dl-beneficio">
              <div className="dl-beneficio-icone">{b.icon}</div>
              <b>{b.titulo}</b>
              <span className="muted">{b.texto}</span>
            </div>
          ))}
        </div>

        <div className="dl-abas">
          {[['ios', 'iPhone (iOS)'], ['android', 'Android'], ['desktop', 'Computador']].map(([k, rot]) => (
            <button key={k} className={aba === k ? 'active' : ''} onClick={() => setAba(k)}>{rot}</button>
          ))}
        </div>

        <div className="dl-painel">
          {aba === 'ios' && (
            <>
              <h3>Instalar no iPhone/iPad</h3>
              <p className="muted">Siga os 3 passos simples abaixo:</p>
              <Passo n={1} titulo="Toque no botão Compartilhar" texto="Fica na barra inferior do Safari (o quadrado com a seta para cima)." destaque="⬆️" />
              <Passo n={2} titulo={'Role e toque em "Adicionar à Tela de Início"'} texto="Você pode precisar rolar um pouco para baixo." destaque="➕" />
              <Passo n={3} titulo={'Toque em "Adicionar" no canto superior'} texto="O app aparecerá na sua tela inicial." destaque={<span className="pill">Adicionar</span>} />
              <div className="dl-aviso">Nota: no iPhone/iPad só funciona pelo navegador <b>Safari</b>.</div>
            </>
          )}

          {aba === 'android' && (
            <>
              <h3>Instalar no Android</h3>
              {convite ? (
                <div style={{ margin: '8px 0 14px' }}>
                  <button className="btn btn-primary" onClick={instalarAgora}>⬇️ Instalar aplicativo agora</button>
                </div>
              ) : (
                <p className="muted">Se você já instalou o app, verifique sua lista de aplicativos. Caso contrário, siga os passos manuais:</p>
              )}
              <Passo n={1} titulo="Abra este site no Google Chrome" texto="Use o endereço do sistema no Chrome do celular." destaque="🌐" />
              <Passo n={2} titulo="Toque no menu de três pontos" texto="Fica no canto superior direito do Chrome." destaque="⋮" />
              <Passo n={3} titulo={'Selecione "Instalar aplicativo" ou "Adicionar à tela inicial"'} texto="Confirme em Instalar. O ícone aparece na tela inicial." destaque="📲" />
            </>
          )}

          {aba === 'desktop' && (
            <>
              <h3>Instalar no computador</h3>
              {convite ? (
                <div style={{ margin: '8px 0 14px' }}>
                  <button className="btn btn-primary" onClick={instalarAgora}>⬇️ Instalar aplicativo agora</button>
                </div>
              ) : (
                <p className="muted">Funciona no Google Chrome e no Microsoft Edge:</p>
              )}
              <Passo n={1} titulo="Abra este site no Chrome ou no Edge" texto="Use o endereço do sistema no navegador do computador." destaque="🖥️" />
              <Passo n={2} titulo="Clique no ícone de instalar" texto="Fica no canto direito da barra de endereço (um monitor com uma seta). Ou: menu ⋮ › Transmitir, salvar e compartilhar › Instalar página como app." destaque="⬇️" />
              <Passo n={3} titulo={'Confirme em "Instalar"'} texto="O Reboot Tech abre em janela própria e fica no menu Iniciar / área de trabalho." destaque="✅" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
