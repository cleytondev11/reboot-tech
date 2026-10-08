require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const licenca = require('./licenca');
const push = require('./push');
const tenants = require('./tenants');
const admin = require('./admin');

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
  if (licenca.obterStatusCache().estado === 'bloqueada') {
    return res.status(403).json({ ok: false, error: 'O acesso a este sistema foi bloqueado. Entre em contato com o suporte para regularizar.' });
  }
  next();
});

// Lista os clientes ativos para o resumo diário de contas a pagar.
const listarBancos = async () => (await tenants.listarClientesAtivos()).map((c) => ({ id: c.id, abrir: () => tenants.bancoDoCliente(c) }));

// Gatilho opcional para um "despertador" externo (cron-job.org, UptimeRobot...).
// Como o plano grátis do Render dorme sem uso, chamar esta rota todo dia de manhã
// acorda o servidor e garante o resumo de contas a pagar. Só existe se CRON_TOKEN
// estiver definido no Render. Chamar várias vezes no dia não duplica o aviso.
app.get('/api/cron/avisos', async (req, res) => {
  const token = process.env.CRON_TOKEN;
  if (!token) return res.status(404).json({ ok: false });
  if (req.query.token !== token) return res.status(401).json({ ok: false, error: 'Token inválido.' });
  const r = await push.verificarTodosOsClientes(listarBancos, { forcar: req.query.forcar === '1' });
  res.json({ ok: true, ...r });
});

// Painel do dono para cadastrar clientes (só funciona com ADMIN_SENHA definida).
app.get('/admin', admin.pagina);
app.use('/api/admin', admin.router);

app.use('/api/cadastro', require('./cadastro'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/rpc', require('./routes/rpc'));

const PORT = process.env.PORT || 3000;

db.initSchema()
  .then(() => tenants.iniciarRegistro())
  .then(() => {
    licenca.iniciarVerificacaoPeriodica();
    push.iniciarAvisosFinanceiros(listarBancos);
    app.listen(PORT, () => {
      console.log(`[Reboot Tech Server] rodando na porta ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[Reboot Tech Server] Falha ao iniciar o banco de dados:', err);
    process.exit(1);
  });
