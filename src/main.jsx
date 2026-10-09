import React from 'react';
import ReactDOM from 'react-dom/client';
import './web-shim.js';
import App from './App.jsx';
import './styles.css';
import { ativarMaiusculas } from './maiusculas.js';
import './som.js';
import './zoom.js';

// Padrão do sistema: tudo que o usuário digita fica em letra maiúscula.
ativarMaiusculas();

// Reforço extra contra o bug do Electron/Chromium (Windows) em que o campo em
// foco para de receber o teclado depois que a janela volta a ficar em primeiro
// plano (ex.: após abrir o seletor de fotos, o Explorer ou o WhatsApp). Ao
// detectar que a janela recuperou o foco, "cutuca-se" o elemento ativo
// (blur + focus) para forçar o Chromium a reconectar o teclado a ele.
window.addEventListener('focus', () => {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
    el.blur();
    setTimeout(() => el.focus(), 0);
  }
});

// PWA: o navegador (Chrome/Edge/Android) avisa que o app pode ser instalado UMA vez, logo no
// começo. Guardamos esse aviso aqui para a tela "Download App" poder oferecer o botão de instalar.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__rtInstallPrompt = e;
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// PWA: só registra o Service Worker na versão web (http/https). No app
// instalado (Electron) a página é carregada via file://, onde Service Worker
// não se aplica — o registro nem chega a rodar lá.
if (!import.meta.env.DEV && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Sem problema se falhar (ex.: navegador antigo) — o site continua
      // funcionando normalmente, só sem os recursos de PWA.
    });
  });
}
