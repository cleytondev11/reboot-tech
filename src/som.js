// Sons de notificação do Reboot Tech (sintetizados no navegador — não usa arquivo de áudio).
// Tipos: 'venda', 'meta', 'pronta', 'entregue'.
// Toca quando a ação acontece neste aparelho e também quando chega um aviso (push)
// com o app aberto. O usuário pode desligar em Configurações → Sons.
const CHAVE = 'rt-som';
let ctx = null;
const ultimo = {};

export function somAtivo() {
  try { return localStorage.getItem(CHAVE) !== '0'; } catch { return true; }
}
export function definirSom(ligado) {
  try { localStorage.setItem(CHAVE, ligado ? '1' : '0'); } catch { /* ignora */ }
}

function audio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

// Navegadores só liberam áudio depois de um toque/clique do usuário.
if (typeof window !== 'undefined') {
  const liberar = () => { audio(); window.removeEventListener('pointerdown', liberar); window.removeEventListener('keydown', liberar); };
  window.addEventListener('pointerdown', liberar);
  window.addEventListener('keydown', liberar);
}

// Um sino: onda senoidal + harmônico, ataque rápido e decaimento suave.
function sino(c, freq, inicio, dur = 0.9, vol = 0.22) {
  const t0 = c.currentTime + inicio;
  [[1, vol], [2.76, vol * 0.35], [5.4, vol * 0.12]].forEach(([mult, v]) => {
    const o = c.createOscillator(); const g = c.createGain();
    o.type = 'sine'; o.frequency.value = freq * mult;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  });
}

const SONS = {
  // "Cha-ching": dois toques metálicos rápidos e brilho final.
  venda: (c) => { sino(c, 1318.5, 0, 0.5, 0.2); sino(c, 1760, 0.11, 0.9, 0.24); sino(c, 2349, 0.2, 1.0, 0.14); },
  // Fanfarra curta ascendente.
  meta: (c) => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => sino(c, f, i * 0.13, 0.9, 0.2)); sino(c, 1318.5, 0.58, 1.3, 0.2); sino(c, 1568, 0.58, 1.3, 0.12); },
  // Três notas subindo: aparelho pronto.
  pronta: (c) => { [783.99, 987.77, 1174.7].forEach((f, i) => sino(c, f, i * 0.16, 0.8, 0.22)); },
  // "Ding-dong" que resolve: entregue/concluído.
  entregue: (c) => { sino(c, 880, 0, 0.7, 0.22); sino(c, 659.25, 0.22, 1.0, 0.22); },
};

export function tocarSom(tipo) {
  try {
    if (!somAtivo() || !SONS[tipo]) return;
    const agora = Date.now();
    if (ultimo[tipo] && agora - ultimo[tipo] < 3000) return; // evita tocar duas vezes (ação local + aviso push)
    const c = audio();
    if (!c) return;
    ultimo[tipo] = agora;
    SONS[tipo](c);
  } catch { /* som nunca pode quebrar o app */ }
}

if (typeof window !== 'undefined') window.rtSom = tocarSom;

// Aviso (push) recebido com o app aberto: o Service Worker repassa o tipo do som.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e && e.data;
    if (d && d.tipo === 'rt-som' && d.som) tocarSom(d.som);
  });
}
