require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/ping', (req, res) => res.json({ ok: true, versao: '1.0.0', horario: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/rpc', require('./routes/rpc'));

const PORT = process.env.PORT || 3000;

db.initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[Reboot Tech Server] rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Reboot Tech Server] Falha ao iniciar o banco de dados:', err);
    process.exit(1);
  });
