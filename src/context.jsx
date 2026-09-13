import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AppCtx = createContext(null);

export function AppProvider({ children }) {
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('rt-theme') || 'dark');
  const [toast, setToast] = useState(null);

  // Na versão web (fora do Electron), restaura a sessão salva ao recarregar a
  // página — evita ter que logar de novo toda hora enquanto o token for válido.
  useEffect(() => {
    window.api?.auth?.sessaoSalva?.().then((u) => { if (u) setUser(u); });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('rt-theme', theme);
  }, [theme]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() });
    setTimeout(() => setToast((t) => (t && t.message === message ? null : t)), 3200);
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <AppCtx.Provider value={{ user, setUser, theme, toggleTheme, showToast }}>
      {children}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </AppCtx.Provider>
  );
}

export function useApp() {
  return useContext(AppCtx);
}
