import { useEffect, useState } from 'react';

// Celular (PWA): só nessa largura valem as telas/recursos "mobile". No computador nada muda.
const QUERY = '(max-width: 700px)';

export function useMobile() {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(QUERY).matches;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(QUERY);
    const on = () => setM(mq.matches);
    on();
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on); };
  }, []);
  return m;
}

export function mesLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function lerLS(k) { try { return localStorage.getItem(k); } catch { return null; } }
export function gravarLS(k, v) { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } }

// Atalhos da tela inicial (manifest "shortcuts"): ?acao=venda|orcamento|os
export function lerAcaoInicial() {
  try {
    const p = new URLSearchParams(location.search).get('acao');
    if (p === 'venda' || p === 'orcamento' || p === 'os') {
      history.replaceState(null, '', location.pathname + location.hash);
      return p;
    }
  } catch { /* ignora */ }
  return null;
}
