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
import RemocaoVirus from './pages/RemocaoVirus.jsx';

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'clientes', label: 'Clientes', icon: '👤' },
  { key: 'equipamentos', label: 'Equipamentos', icon: '📱' },
  { key: 'os', label: 'Ordens de Serviço', icon: '🧾' },
  { key: 'orcamentos', label: 'Orçamentos', icon: '📝' },
  { key: 'compras', label: 'Compras', icon: '🚚' },
  { key: 'estoque', label: 'Estoque', icon: '📦' },
  { key: 'servicos', label: 'Serviços', icon: '🔧' },
  { key: 'vendas', label: 'Vendas', icon: '🛒' },
  { key: 'antivirus', label: 'Remoção de Vírus', icon: '🛡️' },
  { key: 'financeiro', label: 'Financeiro', icon: '💰', restrictTo: ['Administrador', 'Financeiro'] },
  { key: 'relatorios', label: 'Relatórios', icon: '📈', adminOnly: true },
  { key: 'usuarios', label: 'Usuários', icon: '🔐', adminOnly: true },
  { key: 'config', label: 'Configurações', icon: '⚙️' },
];

const TITLES = {
  dashboard: 'Dashboard', clientes: 'Clientes', equipamentos: 'Equipamentos',
  os: 'Ordens de Serviço', orcamentos: 'Orçamentos', compras: 'Compras', estoque: 'Estoque', servicos: 'Serviços', vendas: 'Vendas', financeiro: 'Financeiro',
  relatorios: 'Relatórios', usuarios: 'Usuários', config: 'Configurações', antivirus: 'Remoção de Vírus',
};

function RedeBadge() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let ativo = true;
    async function checar() {
      try {
        const res = await window.api.rede.status();
        if (ativo) setStatus(res);
      } catch (e) { /* silencioso */ }
    }
    checar();
    const t = setInterval(checar, 20000);
    return () => { ativo = false; clearInterval(t); };
  }, []);

  if (!status || status.modo === 'standalone') return null;
  if (status.modo === 'servidor') {
    return <span className="pill" title="Este computador é o Servidor da rede multi-PC">🌐 Servidor</span>;
  }
  return <span className="pill" title={`Conectado ao servidor em ${status.servidor_ip}`}>🌐 Cliente</span>;
}

function Shell() {
  const { user, setUser, theme, toggleTheme } = useApp();
  const [page, setPage] = useState('dashboard');

  if (!user) return <Login />;

  function renderPage() {
    switch (page) {
      case 'dashboard': return <Dashboard goTo={setPage} />;
      case 'clientes': return <Clientes />;
      case 'equipamentos': return <Equipamentos />;
      case 'os': return <OrdensServico />;
      case 'orcamentos': return <Orcamentos />;
      case 'compras': return <Compras />;
      case 'estoque': return <Estoque />;
      case 'servicos': return <Servicos />;
      case 'vendas': return <Vendas />;
      case 'antivirus': return <RemocaoVirus />;
      case 'financeiro': return <Financeiro />;
      case 'relatorios': return <Relatorios />;
      case 'usuarios': return <Usuarios />;
      case 'config': return <Configuracoes />;
      default: return null;
    }
  }

  const initials = (user.nome || '?').split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <img src="./logo.png" alt="" onError={(e) => (e.target.style.display = 'none')} />
          <div className="brand">REBOOT <span>TECH</span></div>
        </div>
        <nav className="sidebar-nav">
          {NAV.filter((n) => (!n.adminOnly || user.papel === 'Administrador') && (!n.restrictTo || n.restrictTo.includes(user.papel))).map((n) => (
            <button key={n.key} className={`nav-item ${page === n.key ? 'active' : ''}`} onClick={() => setPage(n.key)}>
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
          <button className="nav-item" style={{ marginTop: 4 }} onClick={() => { window.api?.auth?.sair?.(); setUser(null); }}>
            <span className="icon">🚪</span> Sair
          </button>
        </div>
      </aside>

      <div className="main-area">
        <div className="topbar">
          <h1>{TITLES[page]}</h1>
          <div className="topbar-actions">
            <RedeBadge />
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
