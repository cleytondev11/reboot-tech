import lib from './qr-lib.js';

const { QRCode, QRErrorCorrectLevel } = lib;

// Gera o QR Code do texto como imagem SVG (fundo branco com margem, para qualquer app de banco ler).
export function qrSvg(texto, { tamanho = 256, margem = 4 } = {}) {
  const qr = new QRCode(-1, QRErrorCorrectLevel.M);
  qr.addData(String(texto));
  qr.make();
  const n = qr.getModuleCount();
  const total = n + margem * 2;
  let caminho = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) caminho += `M${c + margem},${r + margem}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${tamanho}" height="${tamanho}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${caminho}" fill="#000"/></svg>`;
}

// Lê os campos principais de um código Pix "copia e cola" (formato EMV): valor, nome e cidade do recebedor.
export function lerPix(codigo) {
  const campos = {};
  let i = 0;
  const s = String(codigo || '').trim();
  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = parseInt(s.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    campos[id] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  const valor = campos['54'] ? parseFloat(campos['54']) : null;
  return { valor: Number.isNaN(valor) ? null : valor, nome: campos['59'] || '', cidade: campos['60'] || '' };
}
