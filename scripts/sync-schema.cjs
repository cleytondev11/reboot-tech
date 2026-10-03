// Copia shared/schema.cjs para electron/schema.cjs antes do build,
// garantindo que o schema sempre entre no app.asar junto com electron/**/*.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'shared', 'schema.cjs');
const dst = path.join(__dirname, '..', 'electron', 'schema.cjs');
if (!fs.existsSync(src)) {
  console.error('ERRO: shared/schema.cjs nao encontrado em', src);
  process.exit(1);
}
fs.copyFileSync(src, dst);
console.log('schema sincronizado:', dst);
