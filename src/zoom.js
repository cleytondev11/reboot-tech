// Zoom automático da tela no computador.
// Em telas menores (notebook 1366x768, Windows com escala de 125% ou 150%) o sistema ficava
// grande demais e escondia colunas/botões do lado direito. Aqui o tamanho é ajustado sozinho
// para caber, e o usuário pode escolher um valor fixo em Configurações → Zoom da tela.
const CHAVE = 'rt-zoom';
const LARGURA_ALVO = 1360; // largura "lógica" confortável para o layout de computador
const MIN = 0.7, MAX = 1.3;

export function zoomPref() {
  try { return localStorage.getItem(CHAVE) || 'auto'; } catch { return 'auto'; }
}
export function definirZoom(v) {
  try { if (v === 'auto') localStorage.removeItem(CHAVE); else localStorage.setItem(CHAVE, String(v)); } catch { /* ignora */ }
  aplicarZoom();
}
export function zoomAtual() {
  const w = window.innerWidth || 1366;
  if (w <= 900) return 1; // celular/tablet: layout próprio, sem zoom
  const p = zoomPref();
  if (p !== 'auto') { const n = Number(p); return Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, n)) : 1; }
  return Math.min(1, Math.max(0.8, w / LARGURA_ALVO));
}
export function aplicarZoom() {
  try {
    const z = Math.round(zoomAtual() * 100) / 100;
    const r = document.documentElement;
    r.style.setProperty('--z', String(z));
    r.style.zoom = z === 1 ? '' : String(z);
  } catch { /* ignora */ }
}
if (typeof window !== 'undefined') {
  aplicarZoom();
  window.addEventListener('resize', aplicarZoom);
}
