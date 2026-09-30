require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const licenca = require('./licenca');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

app.get('/api/ping', (req, res) => res.json({ ok: true, versao: '1.0.0', horario: new Date().toISOString() }));

// Rota pública (não exige login) consultada pela tela de bloqueio de licença,
// antes mesmo do usuário conseguir entrar no sistema.
app.get('/api/licenca/status', (req, res) => res.json(licenca.obterStatusCache()));

// Se a licença deste deploy estiver bloqueada, recusa qualquer outra rota da
// API (login e RPC) — mas continua respondendo /api/ping e /api/licenca/status
// normalmente, pra a tela de bloqueio sempre conseguir se comunicar.
app.use((req, res, next) => {
  const lic = licenca.obterStatusCache();
  if (lic.estado === 'bloqueada') {
    const error = lic.motivo === 'vencida'
      ? 'A mensalidade deste sistema venceu. Entre em contato com o suporte para pagar e liberar o acesso.'
      : 'O acesso a este sistema foi bloqueado. Entre em contato com o suporte para regularizar.';
    return res.status(403).json({ ok: false, bloqueada: true, error });
  }
  next();
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/rpc', require('./routes/rpc'));

const PORT = process.env.PORT || 3000;

db.initSchema()
  .then(() => {
    licenca.iniciarVerificacaoPeriodica();
    app.listen(PORT, () => {
      console.log(`[Reboot Tech Server] rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Reboot Tech Server] Falha ao iniciar o banco de dados:', err);
    process.exit(1);
  });
