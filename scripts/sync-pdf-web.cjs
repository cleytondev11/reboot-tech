// Gera src/pdf-builders.js (usado pelo site/celular) a partir de electron/pdf.cjs.
// Assim os PDFs da versão web têm EXATAMENTE o mesmo conteúdo do programa
// instalado, e qualquer ajuste feito em electron/pdf.cjs vale para os dois.
// Roda sozinho antes de "npm run build:vite" e "npm run dev:vite".
const fs = require('fs');
const path = require('path');

const origem = path.join(__dirname, '..', 'electron', 'pdf.cjs');
const destino = path.join(__dirname, '..', 'src', 'pdf-builders.js');

let src = fs.readFileSync(origem, 'utf8');

// 1) Dependências que só existem no Electron
src = src.replace(/^const \{ BrowserWindow, dialog, shell \} = require\('electron'\);\r?\n/m, '');
src = src.replace(/^const fs = require\('fs'\);\r?\n/m, '');

// 2) Remove gerarPdf (salvar arquivo via janela do Electron) — no navegador quem
//    gera o arquivo é a impressão do próprio navegador (src/pdf-web.js).
const ini = src.indexOf('// ---------- Geração / salvamento ----------');
const fim = src.indexOf('// ---------- Construtores de corpo por tipo de documento ----------');
if (ini < 0 || fim < 0 || fim < ini) throw new Error('electron/pdf.cjs mudou de formato: não achei o bloco gerarPdf.');
src = src.slice(0, ini) + src.slice(fim);

// 3) module.exports -> export
const m = src.match(/module\.exports = \{([\s\S]*?)\};?\s*$/);
if (!m) throw new Error('electron/pdf.cjs mudou de formato: não achei module.exports.');
const nomes = m[1].split(',').map((s) => s.trim()).filter((s) => s && s !== 'gerarPdf');
for (const extra of ['escapeHtml', 'headerTemplate', 'footerTemplateHtml', 'wrapBodyHtml']) {
  if (!nomes.includes(extra)) nomes.push(extra);
}
src = src.replace(/module\.exports = \{[\s\S]*?\};?\s*$/, `export { ${nomes.join(', ')} };\n`);

if (/require\(|BrowserWindow|dialog\.|shell\./.test(src)) {
  throw new Error('Sobrou código do Electron em pdf-builders.js — ajuste scripts/sync-pdf-web.cjs.');
}

const cabecalho = '// ARQUIVO GERADO AUTOMATICAMENTE por scripts/sync-pdf-web.cjs a partir de electron/pdf.cjs.\n// NÃO edite aqui: edite electron/pdf.cjs e rode "npm run sync:pdf-web".\n\n';
fs.writeFileSync(destino, cabecalho + src, 'utf8');
console.log('[sync-pdf-web] src/pdf-builders.js gerado.');
