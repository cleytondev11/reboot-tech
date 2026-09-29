// ---------- MODO REDE MULTI-PC ----------
// Este módulo permite que vários computadores, na mesma rede local, compartilhem
// o mesmo banco de dados. Um dos PCs é configurado como "Servidor" (é nele que o
// banco de dados realmente mora) e os demais como "Cliente" (eles não guardam os
// dados localmente — cada ação é enviada, por HTTP, ao computador Servidor).
//
// Não é necessário instalar nada além do próprio sistema: o "servidor" é apenas
// um pequeno serviço HTTP que já roda dentro do próprio app quando ligado no
// modo Servidor.
const http = require('http');
const os = require('os');

const PORTA_PADRAO = 4653;

function obterConfigRede(db) {
  const row = db.get('SELECT * FROM configuracoes_rede WHERE id = 1');
  return row || { id: 1, modo: 'standalone', servidor_ip: '', porta: PORTA_PADRAO, chave_rede: '', servidor_url: '', token_nuvem: '', usuario_nuvem: '' };
}

function salvarConfigRede(db, { modo, servidor_ip, porta, chave_rede, servidor_url }) {
  const modosValidos = ['standalone', 'servidor', 'cliente', 'nuvem'];
  const m = modosValidos.includes(modo) ? modo : 'standalone';
  const p = parseInt(porta, 10) || PORTA_PADRAO;
  const configAnterior = obterConfigRede(db);
  // Trocar a URL do servidor nuvem (ou sair do modo nuvem) invalida a sessão
  // guardada — evita ficar usando, por engano, o token de outro endereço.
  const urlLimpa = (servidor_url || '').trim().replace(/\/+$/, '');
  const manterToken = m === 'nuvem' && urlLimpa === (configAnterior.servidor_url || '');
  db.run(
    `UPDATE configuracoes_rede SET modo=?, servidor_ip=?, porta=?, chave_rede=?, servidor_url=?, token_nuvem=?, usuario_nuvem=?, atualizado_em=? WHERE id=1`,
    [m, (servidor_ip || '').trim(), p, chave_rede || '', urlLimpa,
      manterToken ? (configAnterior.token_nuvem || '') : '', manterToken ? (configAnterior.usuario_nuvem || '') : '',
      new Date().toISOString()]
  );
  return obterConfigRede(db);
}

function salvarSessaoNuvem(db, { token, usuario_nuvem }) {
  db.run(`UPDATE configuracoes_rede SET token_nuvem=?, usuario_nuvem=?, atualizado_em=? WHERE id=1`, [token || '', usuario_nuvem || '', new Date().toISOString()]);
  return obterConfigRede(db);
}

function limparSessaoNuvem(db) {
  return salvarSessaoNuvem(db, { token: '', usuario_nuvem: '' });
}

function listarIpsLocais() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  Object.values(interfaces).forEach((entradas) => {
    (entradas || []).forEach((e) => {
      if (e.family === 'IPv4' && !e.internal) ips.push(e.address);
    });
  });
  return ips;
}

function gerarChaveAleatoria() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

let servidorHttp = null;

function pararServidor() {
  if (servidorHttp) {
    try { servidorHttp.close(); } catch (e) { /* já estava parado */ }
    servidorHttp = null;
  }
}

// handlersRegistry: mapa { canal: async (evt, payload) => resultado }, preenchido
// automaticamente por main.cjs a cada ipcMain.handle(...) registrado.
// canaisLocais: Set com os canais que NUNCA podem ser executados a pedido de outro
// computador (diálogos de arquivo, impressão, USB/ADB, etc.) — proteção extra além
// do que o próprio computador cliente já respeita ao decidir o que proxyar.
function iniciarServidor({ porta, chaveRede, handlersRegistry, canaisLocais }) {
  pararServidor();
  servidorHttp = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/rpc/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Rota não encontrada.' }));
      return;
    }
    const canal = decodeURIComponent(req.url.slice('/rpc/'.length));

    if (canaisLocais.has(canal)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Este recurso só pode ser executado localmente no computador onde a ação foi disparada.' }));
      return;
    }

    if (chaveRede) {
      const chaveRecebida = req.headers['x-rede-chave'] || '';
      if (chaveRecebida !== chaveRede) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Chave de rede inválida. Confira a chave configurada neste computador cliente.' }));
        return;
      }
    }

    const partes = [];
    let tamanho = 0;
    const LIMITE_BYTES = 60 * 1024 * 1024; // 60MB — cobre fotos/anexos em base64
    req.on('data', (chunk) => {
      tamanho += chunk.length;
      if (tamanho > LIMITE_BYTES) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Requisição muito grande.' }));
        req.destroy();
        return;
      }
      partes.push(chunk);
    });
    req.on('end', async () => {
      if (tamanho > LIMITE_BYTES) return;
      let payload = {};
      try {
        const texto = Buffer.concat(partes).toString('utf8');
        payload = texto ? JSON.parse(texto) : {};
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Corpo da requisição inválido.' }));
        return;
      }
      const handler = handlersRegistry[canal];
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: `Canal desconhecido no servidor: ${canal}` }));
        return;
      }
      try {
        const resultado = await handler(null, payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, data: resultado === undefined ? null : resultado }));
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (err && err.message) || String(err) }));
      }
    });
  });
  servidorHttp.on('error', (err) => {
    console.error('[Rede] Erro no servidor HTTP local:', err && err.message);
  });
  servidorHttp.listen(porta || PORTA_PADRAO, '0.0.0.0');
  return servidorHttp;
}

async function chamarServidorRemoto({ servidor_ip, porta, chave_rede }, canal, payload) {
  if (!servidor_ip) {
    throw new Error('Modo rede: nenhum computador servidor configurado. Configure o IP do servidor em Configurações → Rede Multi-PC.');
  }
  const url = `http://${servidor_ip}:${porta || PORTA_PADRAO}/rpc/${encodeURIComponent(canal)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  let resposta;
  try {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-rede-chave': chave_rede || '' },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Não foi possível falar com o computador servidor: tempo esgotado. Verifique se ele está ligado, com o sistema aberto, e na mesma rede.');
    }
    throw new Error('Não foi possível conectar ao computador servidor. Verifique o IP configurado, se o servidor está ligado com o sistema aberto, e se os dois computadores estão na mesma rede/Wi-Fi.');
  } finally {
    clearTimeout(timeoutId);
  }

  let corpo;
  try {
    corpo = await resposta.json();
  } catch (e) {
    throw new Error(`Resposta inválida do servidor (HTTP ${resposta.status}).`);
  }
  if (!corpo || typeof corpo.ok === 'undefined') {
    throw new Error('Resposta inesperada do servidor.');
  }
  if (!corpo.ok) {
    throw new Error(corpo.error || 'Erro desconhecido no computador servidor.');
  }
  return corpo.data;
}

async function testarConexao(config) {
  const inicio = Date.now();
  const resultado = await chamarServidorRemoto(config, 'rede:ping', {});
  return { ok: true, latenciaMs: Date.now() - inicio, versaoServidor: resultado && resultado.versao, nomeServidor: resultado && resultado.nomeComputador };
}

// ---------- MODO NUVEM ----------
// Igual ao Modo Rede Local (Cliente), mas em vez de falar com outro computador
// na mesma rede Wi-Fi, este computador fala pela INTERNET com o mesmo backend
// (server/) que atende a versão web do sistema — usando a mesma API (login com
// usuário/senha, token JWT, rotas /api/rpc/:canal). Assim o histórico de
// remoção de vírus, impressões, vendas, OS etc. ficam centralizados num único
// banco na nuvem, acessível de qualquer computador com internet, em vez de
// exigir que todos estejam na mesma rede local com um deles sempre ligado.
const TIMEOUT_NUVEM_MS = 20000;

async function loginNuvem({ servidor_url }, usuario, senha) {
  if (!servidor_url) {
    return { ok: false, error: 'Nenhum servidor na nuvem configurado. Configure o endereço em Configurações → Rede Multi-PC.' };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_NUVEM_MS);
  let resposta;
  try {
    resposta = await fetch(`${servidor_url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return { ok: false, error: 'Não foi possível falar com o servidor na nuvem: tempo esgotado. Verifique sua internet e o endereço configurado.' };
    }
    return { ok: false, error: 'Não foi possível conectar ao servidor na nuvem. Verifique sua internet e o endereço configurado em Configurações → Rede Multi-PC.' };
  } finally {
    clearTimeout(timeoutId);
  }
  let corpo;
  try {
    corpo = await resposta.json();
  } catch (e) {
    return { ok: false, error: `Resposta inválida do servidor na nuvem (HTTP ${resposta.status}).` };
  }
  if (!corpo.ok) return { ok: false, error: corpo.error || 'Usuário ou senha inválidos.' };
  return { ok: true, user: corpo.user, token: corpo.token };
}

class ErroSessaoNuvemExpirada extends Error {}

async function chamarServidorNuvem({ servidor_url, token_nuvem }, canal, payload) {
  if (!servidor_url) {
    throw new Error('Nenhum servidor na nuvem configurado. Configure o endereço em Configurações → Rede Multi-PC.');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_NUVEM_MS);
  let resposta;
  try {
    resposta = await fetch(`${servidor_url}/api/rpc/${encodeURIComponent(canal)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token_nuvem ? { Authorization: `Bearer ${token_nuvem}` } : {}),
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('Não foi possível falar com o servidor na nuvem: tempo esgotado. Verifique sua conexão com a internet.');
    }
    throw new Error('Não foi possível conectar ao servidor na nuvem. Verifique sua internet e o endereço configurado em Configurações → Rede Multi-PC.');
  } finally {
    clearTimeout(timeoutId);
  }

  if (resposta.status === 401) {
    throw new ErroSessaoNuvemExpirada('Sua sessão na nuvem expirou. Saia e faça login novamente.');
  }

  let corpo;
  try {
    corpo = await resposta.json();
  } catch (e) {
    throw new Error(`Resposta inválida do servidor na nuvem (HTTP ${resposta.status}).`);
  }
  if (!corpo || typeof corpo.ok === 'undefined') {
    throw new Error('Resposta inesperada do servidor na nuvem.');
  }
  if (!corpo.ok) {
    throw new Error(corpo.error || 'Erro desconhecido no servidor na nuvem.');
  }
  return corpo.data;
}

async function testarConexaoNuvem(servidor_url) {
  const url = (servidor_url || '').trim().replace(/\/+$/, '');
  if (!url) throw new Error('Informe o endereço do servidor na nuvem.');
  const inicio = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_NUVEM_MS);
  let resposta;
  try {
    resposta = await fetch(`${url}/api/ping`, { signal: controller.signal });
  } catch (err) {
    throw new Error('Não foi possível conectar nesse endereço. Confira se está correto e se o servidor está no ar (no Render, a primeira visita depois de um tempo parado pode demorar ~1 minuto para acordar).');
  } finally {
    clearTimeout(timeoutId);
  }
  if (!resposta.ok) throw new Error(`O servidor respondeu com erro (HTTP ${resposta.status}).`);
  const corpo = await resposta.json();
  return { ok: true, latenciaMs: Date.now() - inicio, versaoServidor: corpo && corpo.versao };
}

module.exports = {
  PORTA_PADRAO,
  obterConfigRede,
  salvarConfigRede,
  salvarSessaoNuvem,
  limparSessaoNuvem,
  listarIpsLocais,
  gerarChaveAleatoria,
  iniciarServidor,
  pararServidor,
  chamarServidorRemoto,
  testarConexao,
  loginNuvem,
  chamarServidorNuvem,
  testarConexaoNuvem,
  ErroSessaoNuvemExpirada,
};
