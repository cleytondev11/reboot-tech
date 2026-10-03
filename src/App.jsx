import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context.jsx';
import LicencaGate from './pages/LicencaGate.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Clientes from './pages/Clientes.jsx';
import Equipamentos from './pages/Equipamentos.jsx';
import OrdensServico from './pages/OrdensServico.jsx';
import Orcamentos from './pages/Orcamentos.jsx';
import Compras from './pages/Compras.jsx';
import Estoque from './pages/Estoque.jsx';
import Servicos from './pages/Servicos.jsx';
import Vendas from './pages/Vendas.jsx';
import Financeiro from './pages/Financeiro.jsx';
import Relatorios from './pages/Relatorios.jsx';
import Usuarios from './pages/Usuarios.jsx';
import Configuracoes from './pages/Configuracoes.jsx';
import Kanban from './pages/Kanban.jsx';
import Cobrancas from './pages/Cobrancas.jsx';
import Suporte from './pages/Suporte.jsx';
import DownloadApp from './pages/DownloadApp.jsx';

// No programa instalado no Windows (Electron) não faz sentido o menu de instalar o app no celular.
const EH_ELECTRON = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'clientes', label: 'Clientes', icon: '👤' },
  { key: 'equipamentos', label: 'Equipamentos', icon: '📱' },
  { key: 'os', label: 'Ordens de Serviço', icon: '🧾' },
  { key: 'kanban', label: 'Bancada (Kanban)', icon: '🗂️' },
  { key: 'orcamentos', label: 'Orçamentos', icon: '📝' },
  { key: 'compras', label: 'Compras', icon: '🚚' },
  { key: 'estoque', label: 'Estoque', icon: '📦' },
  { key: 'servicos', label: 'Serviços', icon: '🔧' },
  { key: 'vendas', label: 'Vendas', icon: '🛒' },
  { key: 'cobrancas', label: 'Cobranças', icon: '💸', restrictTo: ['Administrador', 'Financeiro', 'Atendente'] },
  { key: 'financeiro', label: 'Financeiro', icon: '💰', restrictTo: ['Administrador', 'Financeiro'] },
  { key: 'relatorios', label: 'Relatórios', icon: '📈', adminOnly: true },
  { key: 'usuarios', label: 'Usuários', icon: '🔐', adminOnly: true },
  { key: 'config', label: 'Configurações', icon: '⚙️' },
  { key: 'suporte', label: 'Fale com o Suporte', icon: '💬' },
  { key: 'download', label: 'Download App', icon: '📲', hideInElectron: true },
];

const TITLES = {
  dashboard: 'Dashboard', clientes: 'Clientes', equipamentos: 'Equipamentos',
  os: 'Ordens de Serviço', kanban: 'Bancada — Kanban', cobrancas: 'Cobranças', suporte: 'Fale com o Suporte', download: 'Download App', orcamentos: 'Orçamentos', compras: 'Compras', estoque: 'Estoque', servicos: 'Serviços', vendas: 'Vendas', financeiro: 'Financeiro',
  relatorios: 'Relatórios', usuarios: 'Usuários', config: 'Configurações',
};

function Shell() {
  const { user, setUser, theme, toggleTheme } = useApp();
  const [page, setPage] = useState('dashboard');
  const [menuAberto, setMenuAberto] = useState(false); // só afeta o celular/tablet

  // Fecha o menu com a tecla ESC (útil em tablet com teclado)
  useEffect(() => {
    if (!menuAberto) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setMenuAberto(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuAberto]);

  function irPara(key) {
    setPage(key);
    setMenuAberto(false); // depois de escolher a tela, esconde o menu
  }

  useEffect(() => {
    // Só existe no Electron em Modo Nuvem: se o token da nuvem expirar durante
    // o uso, volta pra tela de login sozinho (evita ficar preso mostrando erro
    // em toda ação, igual já acontece na versão web quando o token expira).
    if (!window.api?.auth?.onSessaoNuvemExpirada) return;
    const remover = window.api.auth.onSessaoNuvemExpirada(() => setUser(null));
    return remover;
  }, [setUser]);

  if (!user) return <Login />;

  function renderPage() {
    switch (page) {
      case 'dashboard': return <Dashboard goTo={irPara} />;
      case 'clientes': return <Clientes />;
      case 'equipamentos': return <Equipamentos />;
      case 'os': return <OrdensServico />;
      case 'kanban': return <Kanban />;
      case 'cobrancas': return <Cobrancas />;
      case 'suporte': return <Suporte />;
      case 'download': return <DownloadApp />;
      case 'orcamentos': return <Orcamentos />;
      case 'compras': return <Compras />;
      case 'estoque': return <Estoque />;
      case 'servicos': return <Servicos />;
      case 'vendas': return <Vendas />;
      case 'financeiro': return <Financeiro />;
      case 'relatorios': return <Relatorios />;
      case 'usuarios': return <Usuarios />;
      case 'config': return <Configuracoes />;
      default: return null;
    }
  }

  const initials = (user.nome || '?').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div className={`app-shell ${menuAberto ? 'menu-aberto' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="./logo.png" alt="" onError={(e) => (e.target.style.display = 'none')} />
          <div className="brand">REBOOT <span>TECH</span></div>
        </div>
        <nav className="sidebar-nav">
          {NAV.filter((n) => (!n.adminOnly || user.papel === 'Administrador') && (!n.restrictTo || n.restrictTo.includes(user.papel)) && !(n.hideInElectron && EH_ELECTRON)).map((n) => (
            <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => irPara(n.key)}>
              <span className="icon">{n.icon}</span> {n.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div className="user-meta">
              <span className="name">{user.nome}</span>
              <span className="role">{user.papel}</span>
            </div>
          </div>
          <button className="nav-item" style={{ marginTop: 4 }} onClick={() => { window.api?.rede?.sairNuvem?.(); window.api?.auth?.sair?.(); setUser(null); }}>
            <span className="icon">🚪</span> Sair
          </button>
        </div>
      </aside>

      <div className="sidebar-backdrop" onClick={() => setMenuAberto(false)} />

      <div className="main-area">
        <div className="topbar">
          <button className="icon-btn menu-toggle" aria-label="Abrir menu" onClick={() => setMenuAberto((v) => !v)}>☰</button>
          <h1>{TITLES[page]}</h1>
          <div className="topbar-actions">
            <button className="icon-btn" title="Alternar tema" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          </div>
        </div>
        <div className="content">{renderPage()}</div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LicencaGate>
      <AppProvider>
        <Shell />
      </AppProvider>
    </LicencaGate>
  );
}
