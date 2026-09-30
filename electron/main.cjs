const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const pdfModule = require('./pdf.cjs');
const { Database } = require('./db.cjs');
const { consultarStatusOnline, DIAS_TOLERANCIA_OFFLINE } = require('./licenca.cjs');
const adb = require('./adb.cjs');
const rede = require('./rede.cjs');
const impressora = require('./impressora.cjs');

const isDev = !app.isPackaged;

app.commandLine.appendSwitch('lang', 'pt-BR');

// Corrige um bug comum do Electron/Chromium no Windows onde o texto digitado
// nos campos não aparece visualmente (problema de composição via GPU),
// especialmente em máquinas com certos drivers de vídeo/integrados.
app.disableHardwareAcceleration();

let mainWindow;
let db;

function nowIso() {
  return new Date().toISOString();
}

function log(usuario, acao, entidade, entidade_id, detalhes) {
  db.insert(
    `INSERT INTO logs (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, criado_em) VALUES (?,?,?,?,?,?,?)`,
    [usuario?.id || null, usuario?.nome || 'Sistema', acao, entidade, entidade_id || null, detalhes || '', nowIso()]
  );
}

// ---------- REDE MULTI-PC: torna todos os canais IPC "transparentes" à rede ----------
// Quando este computador está em modo "cliente", uma chamada para qualquer canal IPC
// comum (dados: clientes, OS, vendas, estoque, financeiro etc.) é automaticamente
// redirecionada, por HTTP, para o computador configurado como servidor — sem precisar
// duplicar lógica em cada handler abaixo. Alguns canais (LOCAL_ONLY) sempre rodam no
// computador local, pois envolvem diálogos de arquivo, impressão, USB/ADB ou
// configuração própria daquela máquina.
const handlersRegistry = {};
const LOCAL_ONLY = new Set([
  'licenca:status', 'licenca:verificarAgora', 'licenca:ativar',
  'backup:manual',
  'pdf:exportarOS', 'pdf:exportarChecklist', 'pdf:exportarGarantia', 'pdf:exportarOrcamento',
  'pdf:exportarComprovante', 'pdf:exportarVendaGarantia', 'pdf:exportarVendaRecibo', 'pdf:exportarRelatorio',
  'whatsapp:abrirConversa',
  'adb:disponivel', 'adb:dispositivos', 'adb:analisar', 'adb:pararApp', 'adb:removerAdmin',
  'adb:desativarPacote', 'adb:reativarPacote', 'adb:desinstalar', 'adb:formatar',
  'app:getVersion',
  'rede:status', 'rede:configurar', 'rede:testarConexao', 'rede:ipsLocais',
  'impressora:listar', 'impressora:imprimirCupomVenda', 'impressora:imprimirCupomOS',
  'impressora:testar', 'impressora:configuracao', 'impressora:salvarConfiguracao',
]);

let redeServidorAtivo = false;

function modoRedeAtual() {
  try {
    if (!db) return 'standalone';
    return rede.obterConfigRede(db).modo || 'standalone';
  } catch (e) {
    return 'standalone';
  }
}

// Chama um canal internamente (a partir de outro handler), respeitando o modo rede:
// em modo cliente, canais que não são LOCAL_ONLY são buscados no servidor; caso
// contrário, executa o handler local diretamente. Usado pelos handlers de PDF e
// impressão para buscar dados atualizados antes de gerar o arquivo/cupom localmente.
// 'auth:login' nunca é encaminhado pelo caminho genérico de rede/nuvem: em modo
// Cliente ele já viaja dentro do protocolo próprio da rede local (chamarServidorRemoto),
// e em modo Nuvem precisa ir para a rota /api/auth/login (não /api/rpc/auth:login) —
// por isso o próprio handler de 'auth:login', mais abaixo, cuida desse caso especial.
async function chamarServidorNuvemComTratamento(channel, payload) {
  try {
    return await rede.chamarServidorNuvem(rede.obterConfigRede(db), channel, payload || {});
  } catch (err) {
    if (err instanceof rede.ErroSessaoNuvemExpirada) {
      rede.limparSessaoNuvem(db);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sessao-nuvem-expirada');
      }
    }
    throw err;
  }
}

async function chamarCanal(channel, payload) {
  const modo = modoRedeAtual();
  if (modo === 'cliente' && !LOCAL_ONLY.has(channel)) {
    return rede.chamarServidorRemoto(rede.obterConfigRede(db), channel, payload || {});
  }
  if (modo === 'nuvem' && channel !== 'auth:login' && !LOCAL_ONLY.has(channel)) {
    return chamarServidorNuvemComTratamento(channel, payload);
  }
  const handler = handlersRegistry[channel];
  if (!handler) throw new Error(`Canal não registrado: ${channel}`);
  return handler(null, payload || {});
}

function aplicarModoRede(cfg) {
  if (cfg.modo === 'servidor') {
    rede.iniciarServidor({ porta: cfg.porta || rede.PORTA_PADRAO, chaveRede: cfg.chave_rede, handlersRegistry, canaisLocais: LOCAL_ONLY });
    redeServidorAtivo = true;
  } else {
    rede.pararServidor();
    redeServidorAtivo = false;
  }
}

// A partir daqui, todo ipcMain.handle(...) registrado neste arquivo passa a ser
// automaticamente "ciente da rede": o wrapper decide, em tempo de execução, se o
// canal deve rodar localmente ou ser encaminhado ao servidor.
const _ipcHandleOriginal = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => {
  handlersRegistry[channel] = fn;
  return _ipcHandleOriginal(channel, async (evt, payload) => {
    const modo = modoRedeAtual();
    if (modo === 'cliente' && !LOCAL_ONLY.has(channel)) {
      return rede.chamarServidorRemoto(rede.obterConfigRede(db), channel, payload || {});
    }
    if (modo === 'nuvem' && channel !== 'auth:login' && !LOCAL_ONLY.has(channel)) {
      return chamarServidorNuvemComTratamento(channel, payload);
    }
    return fn(evt, payload);
  });
};

async function ensureDefaultAdmin() {
  const existing = db.get('SELECT * FROM usuarios LIMIT 1');
  if (!existing) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.insert(
      `INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
      ['Administrador', 'admin', hash, 'Administrador', 1, nowIso()]
    );
  }
}

// Depois de abrir uma janela externa (Explorer, navegador/WhatsApp), o Windows
// às vezes devolve o foco do sistema para esta janela sem que o Chromium
// reconecte o foco do teclado ao campo ativo. Forçar foco algumas vezes logo
// em seguida (com pequenos atrasos) cobre esse intervalo de forma confiável.
function reforcarFocoJanela() {
  if (!mainWindow) return;
  [150, 500, 1000].forEach((ms) => {
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        mainWindow.webContents.focus();
      }
    }, ms);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0b0b0b',
    icon: path.join(__dirname, '..', 'assets', 'icon_256.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Corrige um bug comum do Electron/Chromium no Windows: depois que outra janela
  // ganha o foco do sistema operacional (ex.: o Explorer abre ao "revelar" um PDF
  // salvo, ou o navegador/WhatsApp abre ao compartilhar), o Chromium às vezes não
  // reconecta o foco do teclado corretamente ao voltar para esta janela. O campo
  // parece clicável (o cursor aparece), mas as teclas digitadas não chegam até ele
  // — o que dava a impressão de "campo bloqueado" até fechar e abrir o sistema de
  // novo. Forçar o foco do webContents sempre que a janela ganha foco resolve isso.
  mainWindow.on('focus', () => {
    mainWindow.webContents.focus();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'reboottech.sqlite');
  db = new Database(dbPath);
  await db.init();
  // Em modo cliente ou nuvem, o banco de usuários deste computador não é usado
  // (a autenticação é sempre feita no servidor/nuvem), então não faz sentido
  // criar um admin local aqui.
  const modoInicial = modoRedeAtual();
  if (modoInicial !== 'cliente' && modoInicial !== 'nuvem') {
    await ensureDefaultAdmin();
  }
  aplicarModoRede(rede.obterConfigRede(db));

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- Helpers ----------
function requirePapel(usuario, papeis) {
  if (!usuario || !papeis.includes(usuario.papel)) {
    throw new Error('Permissão negada para esta operação.');
  }
}

function nextOsNumero() {
  const row = db.get(`SELECT numero FROM ordens_servico ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'OS-' + String(n).padStart(6, '0');
}

// ---------- LICENÇA ----------
function diasDesde(dataIso) {
  if (!dataIso) return Infinity;
  const diffMs = Date.now() - new Date(dataIso).getTime();
  return diffMs / (1000 * 60 * 60 * 24);
}

async function verificarLicenca() {
  const local = db.get('SELECT * FROM licenca_local WHERE id = 1');
  const chave = local?.chave || null;

  if (!chave) {
    return { estado: 'ativacao_necessaria' };
  }

  const resultado = await consultarStatusOnline(chave);
  const agora = nowIso();

  if (resultado.ok) {
    if (resultado.status === 'ativa') {
      db.run(`UPDATE licenca_local SET status_cache = 'ativa', ultima_verificacao_ok = ? WHERE id = 1`, [agora]);
      return { estado: 'ativa' };
    }
    // 'bloqueada', 'nao_encontrada' ou qualquer outro valor: trata como bloqueado
    db.run(`UPDATE licenca_local SET status_cache = 'bloqueada', ultima_verificacao_ok = ? WHERE id = 1`, [agora]);
    return { estado: 'bloqueada' };
  }

  // Não foi possível consultar online agora (sem internet, timeout, ou ainda
  // não configurado). Usa o último status confirmado, respeitando a
  // tolerância offline.
  if (resultado.motivo === 'nao_configurado') {
    // Projeto ainda não configurou a verificação online: não trava ninguém.
    return { estado: 'ativa' };
  }

  if (local.status_cache === 'bloqueada') {
    return { estado: 'bloqueada' };
  }

  if (diasDesde(local.ultima_verificacao_ok) > DIAS_TOLERANCIA_OFFLINE) {
    return { estado: 'requer_conexao' };
  }

  return { estado: 'ativa' };
}

ipcMain.handle('licenca:status', async () => {
  return verificarLicenca();
});

ipcMain.handle('licenca:verificarAgora', async () => {
  return verificarLicenca();
});

ipcMain.handle('licenca:ativar', async (evt, { chave }) => {
  const chaveLimpa = String(chave || '').trim();
  if (!chaveLimpa) return { ok: false, error: 'Informe a chave de licença.' };

  const resultado = await consultarStatusOnline(chaveLimpa);

  if (!resultado.ok) {
    if (resultado.motivo === 'nao_configurado') {
      // Sem verificação online configurada: aceita a ativação localmente.
      db.run(
        `UPDATE licenca_local SET chave = ?, status_cache = 'ativa', ultima_verificacao_ok = ?, instalado_em = COALESCE(instalado_em, ?) WHERE id = 1`,
        [chaveLimpa, nowIso(), nowIso()]
      );
      return { ok: true };
    }
    return { ok: false, error: 'Não foi possível confirmar a licença agora. Verifique sua internet e tente novamente.' };
  }

  if (resultado.status !== 'ativa') {
    return { ok: false, error: 'Chave de licença inválida. Confira o código e tente novamente.' };
  }

  db.run(
    `UPDATE licenca_local SET chave = ?, status_cache = 'ativa', ultima_verificacao_ok = ?, instalado_em = COALESCE(instalado_em, ?) WHERE id = 1`,
    [chaveLimpa, nowIso(), nowIso()]
  );
  return { ok: true };
});

// ---------- REDE MULTI-PC (configuração) ----------
ipcMain.handle('rede:ping', async () => {
  return { versao: app.getVersion(), horario: nowIso(), nomeComputador: os.hostname() };
});

function statusRedeParaRenderer(cfg) {
  const { token_nuvem, ...resto } = cfg;
  return { ...resto, conectadoNuvem: !!token_nuvem, ipsLocais: rede.listarIpsLocais(), servidorAtivo: redeServidorAtivo };
}

ipcMain.handle('rede:status', async () => {
  return statusRedeParaRenderer(rede.obterConfigRede(db));
});

ipcMain.handle('rede:ipsLocais', async () => rede.listarIpsLocais());

ipcMain.handle('rede:configurar', async (evt, { atual, modo, servidor_ip, porta, chave_rede, servidor_url }) => {
  requirePapel(atual, ['Administrador']);
  const cfg = rede.salvarConfigRede(db, { modo, servidor_ip, porta, chave_rede, servidor_url });
  aplicarModoRede(cfg);
  log(atual, 'EDITAR', 'configuracoes_rede', 1, `Modo de rede alterado para: ${cfg.modo}`);
  return { ok: true, config: statusRedeParaRenderer(cfg) };
});

ipcMain.handle('rede:testarConexao', async (evt, { servidor_ip, porta, chave_rede, servidor_url }) => {
  if (servidor_url) return rede.testarConexaoNuvem(servidor_url);
  return rede.testarConexao({ servidor_ip, porta, chave_rede });
});

// Encerra a sessão salva do Modo Nuvem (não afeta o modo/servidor configurado,
// só o login) — usado pelo botão "Sair" quando o computador está nesse modo.
ipcMain.handle('rede:sairNuvem', async () => {
  rede.limparSessaoNuvem(db);
  return { ok: true };
});

// ---------- IMPRESSORA TÉRMICA ----------
ipcMain.handle('impressora:listar', async () => {
  return impressora.listarImpressoras(mainWindow);
});

ipcMain.handle('impressora:configuracao', async () => {
  return db.get('SELECT * FROM configuracoes_impressao WHERE id = 1') || {};
});

ipcMain.handle('impressora:salvarConfiguracao', async (evt, { atual, impressora_padrao, largura_papel, copias, formato }) => {
  requirePapel(atual, ['Administrador']);
  const largura = parseInt(largura_papel, 10) === 58 ? 58 : 80;
  const fmt = formato === 'a4' ? 'a4' : 'termica';
  db.run(
    `UPDATE configuracoes_impressao SET impressora_padrao=?, largura_papel=?, formato=?, copias=?, atualizado_em=? WHERE id=1`,
    [impressora_padrao || '', largura, fmt, parseInt(copias, 10) || 1, nowIso()]
  );
  log(atual, 'EDITAR', 'configuracoes_impressao', 1, `Impressora: ${impressora_padrao || '(padrão do sistema)'} — ${fmt === 'a4' ? 'A4' : largura + 'mm'}`);
  return { ok: true };
});

ipcMain.handle('impressora:imprimirCupomVenda', async (evt, { id, formato }) => {
  const venda = await chamarCanal('dados:vendaCompleta', { id });
  if (!venda) throw new Error('Venda não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  const cfg = db.get('SELECT * FROM configuracoes_impressao WHERE id = 1') || {};
  const fmt = (formato === 'a4' || formato === 'termica') ? formato : (cfg.formato === 'a4' ? 'a4' : 'termica');
  const html = fmt === 'a4'
    ? impressora.buildCupomVendaHtmlA4(venda, empresa)
    : impressora.buildCupomVendaHtml(venda, empresa, cfg.largura_papel || 80);
  await impressora.imprimir({ parentWindow: mainWindow, html, nomeImpressora: cfg.impressora_padrao, copias: cfg.copias, larguraMm: cfg.largura_papel || 80, formato: fmt });
  return { ok: true };
});

ipcMain.handle('impressora:imprimirCupomOS', async (evt, { id, formato }) => {
  const osCompleta = await chamarCanal('dados:osCompleta', { id });
  if (!osCompleta) throw new Error('Ordem de Serviço não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  const cfg = db.get('SELECT * FROM configuracoes_impressao WHERE id = 1') || {};
  const fmt = (formato === 'a4' || formato === 'termica') ? formato : (cfg.formato === 'a4' ? 'a4' : 'termica');
  const html = fmt === 'a4'
    ? impressora.buildCupomOsHtmlA4(osCompleta, empresa)
    : impressora.buildCupomOsHtml(osCompleta, empresa, cfg.largura_papel || 80);
  await impressora.imprimir({ parentWindow: mainWindow, html, nomeImpressora: cfg.impressora_padrao, copias: cfg.copias, larguraMm: cfg.largura_papel || 80, formato: fmt });
  return { ok: true };
});

ipcMain.handle('impressora:testar', async (evt, { nomeImpressora, largura_papel, formato }) => {
  const empresa = await chamarCanal('empresa:get', {});
  const fmt = formato === 'a4' ? 'a4' : 'termica';
  const largura = parseInt(largura_papel, 10) === 58 ? 58 : 80;
  const html = fmt === 'a4' ? impressora.buildCupomTesteHtmlA4(empresa) : impressora.buildCupomTesteHtml(empresa, largura);
  await impressora.imprimir({ parentWindow: mainWindow, html, nomeImpressora, copias: 1, larguraMm: largura, formato: fmt });
  return { ok: true };
});

// ---------- AUTH ----------
ipcMain.handle('auth:login', async (evt, { usuario, senha }) => {
  if (modoRedeAtual() === 'nuvem') {
    const cfg = rede.obterConfigRede(db);
    const resultado = await rede.loginNuvem(cfg, usuario, senha);
    if (resultado.ok) {
      rede.salvarSessaoNuvem(db, { token: resultado.token, usuario_nuvem: resultado.user?.nome || usuario });
      log(resultado.user, 'LOGIN', 'usuarios', resultado.user?.id, '(nuvem)');
      return { ok: true, user: resultado.user };
    }
    return { ok: false, error: resultado.error };
  }

  const row = db.get('SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1', [usuario]);
  if (!row) return { ok: false, error: 'Usuário não encontrado ou inativo.' };
  const valid = bcrypt.compareSync(senha, row.senha_hash);
  if (!valid) return { ok: false, error: 'Senha incorreta.' };
  const user = { id: row.id, nome: row.nome, usuario: row.usuario, papel: row.papel };
  log(user, 'LOGIN', 'usuarios', row.id, '');
  return { ok: true, user };
});

// ---------- USUÁRIOS (somente Administrador) ----------
ipcMain.handle('usuarios:list', async () => {
  return db.all('SELECT id, nome, usuario, papel, ativo, criado_em FROM usuarios ORDER BY nome');
});

ipcMain.handle('usuarios:create', async (evt, { atual, nome, usuario, senha, papel }) => {
  requirePapel(atual, ['Administrador']);
  const hash = bcrypt.hashSync(senha, 10);
  const id = db.insert(
    `INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
    [nome, usuario, hash, papel, 1, nowIso()]
  );
  log(atual, 'CRIAR', 'usuarios', id, nome);
  return { ok: true, id };
});

ipcMain.handle('usuarios:toggleAtivo', async (evt, { atual, id, ativo }) => {
  requirePapel(atual, ['Administrador']);
  db.run('UPDATE usuarios SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
  log(atual, ativo ? 'ATIVAR' : 'DESATIVAR', 'usuarios', id, '');
  return { ok: true };
});

ipcMain.handle('usuarios:update', async (evt, { atual, id, nome, usuario, papel }) => {
  requirePapel(atual, ['Administrador']);
  const existente = db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!existente) throw new Error('Usuário não encontrado.');
  if (!nome || !nome.trim()) throw new Error('Informe o nome do usuário.');
  if (!usuario || !usuario.trim()) throw new Error('Informe o login do usuário.');
  const conflito = db.get('SELECT id FROM usuarios WHERE usuario = ? AND id != ?', [usuario, id]);
  if (conflito) throw new Error('Já existe outro usuário com esse login.');
  db.run('UPDATE usuarios SET nome = ?, usuario = ?, papel = ? WHERE id = ?', [nome, usuario, papel, id]);
  log(atual, 'EDITAR', 'usuarios', id, nome);
  return { ok: true };
});

ipcMain.handle('usuarios:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  if (atual?.id === id) throw new Error('Você não pode excluir o seu próprio usuário.');
  const existente = db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!existente) throw new Error('Usuário não encontrado.');
  if (existente.papel === 'Administrador') {
    const outrosAdmins = db.get(`SELECT COUNT(*) c FROM usuarios WHERE papel = 'Administrador' AND ativo = 1 AND id != ?`, [id]);
    if (outrosAdmins.c === 0) throw new Error('Não é possível excluir o único Administrador ativo do sistema.');
  }
  db.run('DELETE FROM usuarios WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'usuarios', id, existente.nome);
  return { ok: true };
});

// Alteração de senha: por política do sistema, somente o Administrador pode alterar
// a senha de qualquer usuário (inclusive a própria). Usuários comuns não têm essa opção.
ipcMain.handle('usuarios:changePassword', async (evt, { atual, id, novaSenha }) => {
  requirePapel(atual, ['Administrador']);
  if (!novaSenha || String(novaSenha).length < 4) {
    throw new Error('A nova senha deve ter pelo menos 4 caracteres.');
  }
  const usuario = db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
  if (!usuario) throw new Error('Usuário não encontrado.');
  const hash = bcrypt.hashSync(novaSenha, 10);
  db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [hash, id]);
  log(atual, 'ALTERAR_SENHA', 'usuarios', id, `Senha alterada por ${atual.nome}`);
  return { ok: true };
});

// ---------- CLIENTES ----------
ipcMain.handle('clientes:list', async (evt, { termo } = {}) => {
  if (termo) {
    const like = `%${termo}%`;
    return db.all(
      `SELECT * FROM clientes WHERE nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ? OR whatsapp LIKE ? OR email LIKE ? ORDER BY nome`,
      [like, like, like, like, like]
    );
  }
  return db.all('SELECT * FROM clientes ORDER BY nome');
});

ipcMain.handle('clientes:get', async (evt, { id }) => {
  return db.get('SELECT * FROM clientes WHERE id = ?', [id]);
});

ipcMain.handle('clientes:save', async (evt, { atual, cliente }) => {
  // Normaliza os campos: o cadastro rápido (feito de dentro do Orçamento/OS) só envia
  // nome, cpf_cnpj, telefone e whatsapp — os demais campos ficam undefined, e o banco
  // exige null (não undefined) para colunas sem valor.
  const c = {
    tipo: cliente.tipo || 'PF',
    nome: cliente.nome || '',
    cpf_cnpj: cliente.cpf_cnpj || null,
    rg_ie: cliente.rg_ie || null,
    telefone: cliente.telefone || null,
    whatsapp: cliente.whatsapp || null,
    email: cliente.email || null,
    cep: cliente.cep || null,
    endereco: cliente.endereco || null,
    numero: cliente.numero || null,
    bairro: cliente.bairro || null,
    cidade: cliente.cidade || null,
    uf: cliente.uf || null,
    observacoes: cliente.observacoes || null,
    data_nascimento: cliente.data_nascimento || null,
    id: cliente.id || null,
  };
  if (c.id) {
    db.run(
      `UPDATE clientes SET tipo=?, nome=?, cpf_cnpj=?, rg_ie=?, telefone=?, whatsapp=?, email=?, cep=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, observacoes=?, data_nascimento=?, atualizado_em=? WHERE id=?`,
      [c.tipo, c.nome, c.cpf_cnpj, c.rg_ie, c.telefone, c.whatsapp, c.email, c.cep, c.endereco, c.numero, c.bairro, c.cidade, c.uf, c.observacoes, c.data_nascimento, nowIso(), c.id]
    );
    log(atual, 'EDITAR', 'clientes', c.id, c.nome);
    return { ok: true, id: c.id };
  } else {
    const id = db.insert(
      `INSERT INTO clientes (tipo, nome, cpf_cnpj, rg_ie, telefone, whatsapp, email, cep, endereco, numero, bairro, cidade, uf, observacoes, data_nascimento, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.tipo, c.nome, c.cpf_cnpj, c.rg_ie, c.telefone, c.whatsapp, c.email, c.cep, c.endereco, c.numero, c.bairro, c.cidade, c.uf, c.observacoes, c.data_nascimento, nowIso()]
    );
    log(atual, 'CRIAR', 'clientes', id, c.nome);
    return { ok: true, id };
  }
});

ipcMain.handle('clientes:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const usados = db.get('SELECT COUNT(*) as c FROM equipamentos WHERE cliente_id = ?', [id]);
  if (usados.c > 0) throw new Error('Cliente possui equipamentos cadastrados e não pode ser excluído.');
  db.run('DELETE FROM clientes WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'clientes', id, '');
  return { ok: true };
});

ipcMain.handle('clientes:historico', async (evt, { id }) => {
  return db.all(
    `SELECT os.*, eq.marca, eq.modelo FROM ordens_servico os
     LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     WHERE os.cliente_id = ? ORDER BY os.criado_em DESC`,
    [id]
  );
});

// ---------- EQUIPAMENTOS ----------
ipcMain.handle('equipamentos:listByCliente', async (evt, { cliente_id }) => {
  return db.all('SELECT * FROM equipamentos WHERE cliente_id = ? ORDER BY id DESC', [cliente_id]);
});

ipcMain.handle('equipamentos:list', async (evt, { termo } = {}) => {
  if (termo) {
    const like = `%${termo}%`;
    return db.all(
      `SELECT eq.*, c.nome as cliente_nome FROM equipamentos eq
       LEFT JOIN clientes c ON c.id = eq.cliente_id
       WHERE eq.marca LIKE ? OR eq.modelo LIKE ? OR eq.imei LIKE ? OR eq.numero_serie LIKE ? OR c.nome LIKE ?
       ORDER BY eq.id DESC`,
      [like, like, like, like, like]
    );
  }
  return db.all(
    `SELECT eq.*, c.nome as cliente_nome FROM equipamentos eq LEFT JOIN clientes c ON c.id = eq.cliente_id ORDER BY eq.id DESC`
  );
});

ipcMain.handle('equipamentos:get', async (evt, { id }) => {
  return db.get('SELECT * FROM equipamentos WHERE id = ?', [id]);
});

ipcMain.handle('equipamentos:save', async (evt, { atual, equipamento }) => {
  // Normaliza os campos: o cadastro rápido (feito de dentro do Orçamento/OS) só envia
  // cliente_id, marca, modelo, imei e cor — os demais ficam undefined, e o banco exige
  // null (não undefined) para colunas sem valor.
  const e = {
    id: equipamento.id || null,
    cliente_id: equipamento.cliente_id || null,
    marca: equipamento.marca || '',
    modelo: equipamento.modelo || null,
    imei: equipamento.imei || null,
    numero_serie: equipamento.numero_serie || null,
    cor: equipamento.cor || null,
    senha_desbloqueio: equipamento.senha_desbloqueio || null,
    capacidade: equipamento.capacidade || null,
    operadora: equipamento.operadora || null,
    estado_conservacao: equipamento.estado_conservacao || null,
    acessorios: equipamento.acessorios || null,
    fotos: JSON.stringify(equipamento.fotos || []),
  };
  if (e.id) {
    db.run(
      `UPDATE equipamentos SET cliente_id=?, marca=?, modelo=?, imei=?, numero_serie=?, cor=?, senha_desbloqueio=?, capacidade=?, operadora=?, estado_conservacao=?, acessorios=?, fotos=? WHERE id=?`,
      [e.cliente_id, e.marca, e.modelo, e.imei, e.numero_serie, e.cor, e.senha_desbloqueio, e.capacidade, e.operadora, e.estado_conservacao, e.acessorios, e.fotos, e.id]
    );
    log(atual, 'EDITAR', 'equipamentos', e.id, `${e.marca} ${e.modelo}`);
    return { ok: true, id: e.id };
  } else {
    const id = db.insert(
      `INSERT INTO equipamentos (cliente_id, marca, modelo, imei, numero_serie, cor, senha_desbloqueio, capacidade, operadora, estado_conservacao, acessorios, fotos, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [e.cliente_id, e.marca, e.modelo, e.imei, e.numero_serie, e.cor, e.senha_desbloqueio, e.capacidade, e.operadora, e.estado_conservacao, e.acessorios, e.fotos, nowIso()]
    );
    log(atual, 'CRIAR', 'equipamentos', id, `${e.marca} ${e.modelo}`);
    return { ok: true, id };
  }
});

ipcMain.handle('equipamentos:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const equipamento = db.get('SELECT * FROM equipamentos WHERE id = ?', [id]);
  if (!equipamento) throw new Error('Equipamento não encontrado.');
  const usadoOs = db.get('SELECT COUNT(*) as c FROM ordens_servico WHERE equipamento_id = ?', [id]);
  if (usadoOs.c > 0) throw new Error('Este equipamento possui Ordens de Serviço vinculadas e não pode ser excluído.');
  const usadoOrc = db.get('SELECT COUNT(*) as c FROM orcamentos WHERE equipamento_id = ?', [id]);
  if (usadoOrc.c > 0) throw new Error('Este equipamento possui Orçamentos vinculados e não pode ser excluído.');
  db.run('DELETE FROM equipamentos WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'equipamentos', id, `${equipamento.marca} ${equipamento.modelo}`);
  return { ok: true };
});

// ---------- ORDENS DE SERVIÇO ----------
const STATUS_LIST = [
  'Recebido', 'Em análise', 'Aguardando orçamento', 'Orçamento enviado',
  'Aguardando aprovação', 'Aguardando peça', 'Em manutenção', 'Teste',
  'Pronto', 'Entregue', 'Cancelado',
];

ipcMain.handle('os:statusList', async () => STATUS_LIST);

ipcMain.handle('os:list', async (evt, { termo, status } = {}) => {
  let sql = `SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp,
                    eq.marca as equip_marca, eq.modelo as equip_modelo, u.nome as tecnico_nome
             FROM ordens_servico os
             LEFT JOIN clientes c ON c.id = os.cliente_id
             LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
             LEFT JOIN usuarios u ON u.id = os.tecnico_id
             WHERE 1=1`;
  const params = [];
  if (termo) {
    sql += ` AND (os.numero LIKE ? OR c.nome LIKE ? OR eq.marca LIKE ? OR eq.modelo LIKE ? OR eq.imei LIKE ?)`;
    const like = `%${termo}%`;
    params.push(like, like, like, like, like);
  }
  if (status) {
    sql += ` AND os.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY os.id DESC`;
  return db.all(sql, params);
});

ipcMain.handle('os:get', async (evt, { id }) => {
  const os = db.get(
    `SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp, c.cpf_cnpj as cliente_cpf_cnpj,
            eq.marca as equip_marca, eq.modelo as equip_modelo, eq.imei as equip_imei, u.nome as tecnico_nome
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     LEFT JOIN usuarios u ON u.id = os.tecnico_id
     WHERE os.id = ?`,
    [id]
  );
  return os;
});

function calcularTotal(o) {
  const mao = parseFloat(o.valor_mao_obra) || 0;
  const pecas = parseFloat(o.valor_pecas) || 0;
  const desc = parseFloat(o.desconto) || 0;
  return Math.max(0, mao + pecas - desc);
}

function baixarEstoqueDaOs(atual, osId, osNumero, itensPecas) {
  (itensPecas || []).forEach((item) => {
    if (!item.produto_id || !item.quantidade) return;
    const produto = db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
    if (!produto) return;
    const novaQtd = (produto.quantidade || 0) - parseFloat(item.quantidade);
    db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
    db.insert(
      `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
      [produto.id, 'saida', item.quantidade, 'Uso em Ordem de Serviço', osNumero, atual?.id, atual?.nome, nowIso()]
    );
  });
}

function caixaAberto() {
  return db.get(`SELECT * FROM caixa_sessoes WHERE status = 'Aberto' ORDER BY id DESC LIMIT 1`);
}

function lancarFinanceiroDaOs(atual, osId, osNumero, valorTotal, formaPagamento) {
  const hoje = nowIso().slice(0, 10);
  db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['receita', 'Serviços (OS)', `Recebimento da ${osNumero}`, valorTotal, formaPagamento, 'Pago', hoje, hoje, osNumero, osId, '', 1, atual?.id, atual?.nome, nowIso()]
  );
  if (formaPagamento === 'Dinheiro') {
    const sessao = caixaAberto();
    if (sessao) {
      db.insert(
        `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
        [sessao.id, 'entrada', valorTotal, formaPagamento, `Recebimento da ${osNumero}`, osNumero, atual?.id, atual?.nome, nowIso()]
      );
    }
  }
}

// Calcula o custo das peças utilizadas numa OS: se as peças vieram do estoque,
// usa o valor de COMPRA de cada produto (custo real); se foi um valor de peças
// digitado manualmente (sem vínculo com o estoque), usa esse valor como custo.
function calcularCustoPecas(itensPecas, valorPecasManual) {
  const itens = (itensPecas || []).filter((i) => i.produto_id);
  if (itens.length > 0) {
    let total = 0;
    itens.forEach((it) => {
      const produto = db.get('SELECT valor_compra FROM produtos WHERE id = ?', [it.produto_id]);
      total += (produto?.valor_compra || 0) * (parseFloat(it.quantidade) || 0);
    });
    return total;
  }
  return parseFloat(valorPecasManual) || 0;
}

// Quando a OS chega ao status "Pronto" (pronta para retirada, mas ainda não paga/entregue),
// lança automaticamente um valor "a receber" (Pendente) no Financeiro, para que o valor já
// apareça em Contas a Receber mesmo antes da entrega/pagamento.
function lancarReceberDaOs(atual, osId, osNumero, valorTotal, previsaoOuHoje) {
  if (!valorTotal || valorTotal <= 0) return;
  const vencimento = previsaoOuHoje || nowIso().slice(0, 10);
  db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['receita', 'Serviços (OS)', `A receber — ${osNumero} (pronta para retirada)`, valorTotal, '', 'Pendente', vencimento, null, osNumero, osId, 'Lançado automaticamente quando a OS ficou com status "Pronto".', 1, atual?.id, atual?.nome, nowIso()]
  );
}

// Quando a OS é entregue e o pagamento é confirmado, se já existir um lançamento "a receber"
// pendente gerado automaticamente ao ficar "Pronto", ele é baixado (marcado como Pago) em vez
// de duplicar o lançamento no Financeiro.
function baixarOuLancarRecebimentoDaOs(atual, osId, osNumero, valorTotal, formaPagamento) {
  const pendente = db.get(
    `SELECT * FROM lancamentos_financeiros WHERE os_id = ? AND tipo = 'receita' AND status = 'Pendente' AND origem_automatica = 1 ORDER BY id DESC LIMIT 1`,
    [osId]
  );
  const hoje = nowIso().slice(0, 10);
  if (pendente) {
    db.run(
      `UPDATE lancamentos_financeiros SET status='Pago', forma_pagamento=?, valor=?, data_pagamento=?, descricao=?, atualizado_em=? WHERE id=?`,
      [formaPagamento, valorTotal, hoje, `Recebimento da ${osNumero}`, nowIso(), pendente.id]
    );
    if (formaPagamento === 'Dinheiro') {
      const sessao = caixaAberto();
      if (sessao) {
        db.insert(
          `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
          [sessao.id, 'entrada', valorTotal, formaPagamento, `Recebimento da ${osNumero}`, osNumero, atual?.id, atual?.nome, nowIso()]
        );
      }
    }
  } else {
    lancarFinanceiroDaOs(atual, osId, osNumero, valorTotal, formaPagamento);
  }
}

function lancarDespesaPecasDaOs(atual, osId, osNumero, itensPecas, valorPecasManual, dataReferencia) {
  const valor = calcularCustoPecas(itensPecas, valorPecasManual);
  if (!valor || valor <= 0) return;
  const data = dataReferencia || nowIso().slice(0, 10);
  db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['despesa', 'Peças/Estoque', `Custo de peças da ${osNumero}`, valor, '', 'Pago', data, data, osNumero, osId, 'Lançado automaticamente com base no custo das peças utilizadas nesta OS.', 1, atual?.id, atual?.nome, nowIso()]
  );
}

ipcMain.handle('os:save', async (evt, { atual, os }) => {
  const o = os;
  o.valor_total = calcularTotal(o);
  const checklist = JSON.stringify(o.checklist || []);
  const itensPecas = JSON.stringify(o.itens_pecas || []);
  const termosAceite = JSON.stringify(o.termos_aceite || []);
  const checklistAcessorios = JSON.stringify(o.checklist_acessorios || []);
  const temPecas = (o.itens_pecas || []).length > 0 || parseFloat(o.valor_pecas) > 0;
  if (o.id) {
    const before = db.get('SELECT status, estoque_baixado, numero, financeiro_lancado, despesa_pecas_lancada, financeiro_receber_lancado FROM ordens_servico WHERE id = ?', [o.id]);
    db.run(
      `UPDATE ordens_servico SET cliente_id=?, equipamento_id=?, defeito_informado=?, diagnostico=?, servicos_executados=?, pecas_utilizadas=?, valor_mao_obra=?, valor_pecas=?, desconto=?, valor_total=?, garantia_dias=?, data_entrada=?, previsao=?, data_saida=?, status=?, observacoes=?, assinatura_cliente=?, checklist=?, itens_pecas=?, forma_pagamento=?, tecnico_id=?, termos_aceite=?, senha_tipo=?, senha_valor=?, checklist_acessorios=?, atualizado_em=? WHERE id=?`,
      [o.cliente_id, o.equipamento_id, o.defeito_informado, o.diagnostico, o.servicos_executados, o.pecas_utilizadas, o.valor_mao_obra, o.valor_pecas, o.desconto, o.valor_total, o.garantia_dias, o.data_entrada, o.previsao, o.data_saida, o.status, o.observacoes, o.assinatura_cliente, checklist, itensPecas, o.forma_pagamento || null, o.tecnico_id || null, termosAceite, o.senha_tipo || null, o.senha_valor || null, checklistAcessorios, nowIso(), o.id]
    );
    if (!before?.estoque_baixado && (o.itens_pecas || []).length > 0) {
      baixarEstoqueDaOs(atual, o.id, before?.numero, o.itens_pecas);
      db.run('UPDATE ordens_servico SET estoque_baixado = 1 WHERE id = ?', [o.id]);
    }
    if (!before?.despesa_pecas_lancada && temPecas) {
      lancarDespesaPecasDaOs(atual, o.id, before?.numero, o.itens_pecas, o.valor_pecas, o.data_entrada);
      db.run('UPDATE ordens_servico SET despesa_pecas_lancada = 1 WHERE id = ?', [o.id]);
    }
    if (!before?.financeiro_receber_lancado && o.status === 'Pronto' && !before?.financeiro_lancado) {
      lancarReceberDaOs(atual, o.id, before?.numero, o.valor_total, o.previsao);
      db.run('UPDATE ordens_servico SET financeiro_receber_lancado = 1 WHERE id = ?', [o.id]);
    }
    if (!before?.financeiro_lancado && o.status === 'Entregue' && o.forma_pagamento) {
      baixarOuLancarRecebimentoDaOs(atual, o.id, before?.numero, o.valor_total, o.forma_pagamento);
      db.run('UPDATE ordens_servico SET financeiro_lancado = 1 WHERE id = ?', [o.id]);
    }
    if (before && before.status !== o.status) {
      log(atual, 'MUDAR_STATUS', 'ordens_servico', o.id, `${before.status} -> ${o.status}`);
    } else {
      log(atual, 'EDITAR', 'ordens_servico', o.id, o.numero);
    }
    return { ok: true, id: o.id };
  } else {
    const numero = nextOsNumero();
    const id = db.insert(
      `INSERT INTO ordens_servico (numero, cliente_id, equipamento_id, defeito_informado, diagnostico, servicos_executados, pecas_utilizadas, valor_mao_obra, valor_pecas, desconto, valor_total, garantia_dias, data_entrada, previsao, data_saida, status, observacoes, assinatura_cliente, checklist, itens_pecas, estoque_baixado, forma_pagamento, financeiro_lancado, despesa_pecas_lancada, tecnico_id, termos_aceite, senha_tipo, senha_valor, checklist_acessorios, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [numero, o.cliente_id, o.equipamento_id, o.defeito_informado, o.diagnostico, o.servicos_executados, o.pecas_utilizadas, o.valor_mao_obra || 0, o.valor_pecas || 0, o.desconto || 0, o.valor_total, o.garantia_dias || 90, o.data_entrada, o.previsao, o.data_saida, o.status || 'Recebido', o.observacoes, o.assinatura_cliente, checklist, itensPecas, (o.itens_pecas || []).length > 0 ? 1 : 0, o.forma_pagamento || null, 0, temPecas ? 1 : 0, o.tecnico_id || null, termosAceite, o.senha_tipo || null, o.senha_valor || null, checklistAcessorios, atual?.id, nowIso()]
    );
    if ((o.itens_pecas || []).length > 0) {
      baixarEstoqueDaOs(atual, id, numero, o.itens_pecas);
    }
    if (temPecas) {
      lancarDespesaPecasDaOs(atual, id, numero, o.itens_pecas, o.valor_pecas, o.data_entrada);
    }
    if (o.status === 'Pronto') {
      lancarReceberDaOs(atual, id, numero, o.valor_total, o.previsao);
      db.run('UPDATE ordens_servico SET financeiro_receber_lancado = 1 WHERE id = ?', [id]);
    }
    if (o.status === 'Entregue' && o.forma_pagamento) {
      baixarOuLancarRecebimentoDaOs(atual, id, numero, o.valor_total, o.forma_pagamento);
      db.run('UPDATE ordens_servico SET financeiro_lancado = 1 WHERE id = ?', [id]);
    }
    log(atual, 'CRIAR', 'ordens_servico', id, numero);
    return { ok: true, id, numero };
  }
});

ipcMain.handle('os:setStatus', async (evt, { atual, id, status }) => {
  const before = db.get('SELECT status, numero, valor_total, previsao, financeiro_receber_lancado, financeiro_lancado FROM ordens_servico WHERE id = ?', [id]);
  db.run('UPDATE ordens_servico SET status = ?, atualizado_em = ? WHERE id = ?', [status, nowIso(), id]);
  if (!before?.financeiro_receber_lancado && status === 'Pronto' && !before?.financeiro_lancado) {
    lancarReceberDaOs(atual, id, before?.numero, before?.valor_total, before?.previsao);
    db.run('UPDATE ordens_servico SET financeiro_receber_lancado = 1 WHERE id = ?', [id]);
  }
  log(atual, 'MUDAR_STATUS', 'ordens_servico', id, `${before?.status} -> ${status}`);
  return { ok: true };
});

ipcMain.handle('os:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const os = db.get('SELECT * FROM ordens_servico WHERE id = ?', [id]);
  if (!os) throw new Error('Ordem de Serviço não encontrada.');

  // Estorna o estoque, se peças já haviam sido baixadas
  if (os.estoque_baixado) {
    let itens = [];
    try { itens = JSON.parse(os.itens_pecas || '[]'); } catch { itens = []; }
    itens.forEach((item) => {
      if (!item.produto_id || !item.quantidade) return;
      const produto = db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
      if (!produto) return;
      const novaQtd = (produto.quantidade || 0) + parseFloat(item.quantidade);
      db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
      db.insert(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
        [produto.id, 'entrada', item.quantidade, 'Estorno por exclusão de OS', os.numero, atual?.id, atual?.nome, nowIso()]
      );
    });
  }
  // Remove os lançamentos financeiros gerados automaticamente por esta OS (receita e/ou despesa de peças)
  db.run(`DELETE FROM lancamentos_financeiros WHERE os_id = ? AND origem_automatica = 1`, [id]);
  db.run('DELETE FROM ordens_servico WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'ordens_servico', id, os.numero);
  return { ok: true };
});

// ---------- FORNECEDORES ----------
ipcMain.handle('fornecedores:list', async (evt, { termo } = {}) => {
  if (termo) {
    const like = `%${termo}%`;
    return db.all('SELECT * FROM fornecedores WHERE nome LIKE ? OR cnpj_cpf LIKE ? ORDER BY nome', [like, like]);
  }
  return db.all('SELECT * FROM fornecedores ORDER BY nome');
});

ipcMain.handle('fornecedores:save', async (evt, { atual, fornecedor }) => {
  const f = fornecedor;
  if (f.id) {
    db.run('UPDATE fornecedores SET nome=?, cnpj_cpf=?, telefone=?, email=?, endereco=?, observacoes=? WHERE id=?',
      [f.nome, f.cnpj_cpf, f.telefone, f.email, f.endereco, f.observacoes, f.id]);
    log(atual, 'EDITAR', 'fornecedores', f.id, f.nome);
    return { ok: true, id: f.id };
  }
  const id = db.insert('INSERT INTO fornecedores (nome, cnpj_cpf, telefone, email, endereco, observacoes, criado_em) VALUES (?,?,?,?,?,?,?)',
    [f.nome, f.cnpj_cpf, f.telefone, f.email, f.endereco, f.observacoes, nowIso()]);
  log(atual, 'CRIAR', 'fornecedores', id, f.nome);
  return { ok: true, id };
});

// ---------- PRODUTOS / ESTOQUE ----------
ipcMain.handle('produtos:list', async (evt, { termo, apenasBaixo } = {}) => {
  let sql = `SELECT p.*, f.nome as fornecedor_nome FROM produtos p LEFT JOIN fornecedores f ON f.id = p.fornecedor_id WHERE p.ativo = 1`;
  const params = [];
  if (termo) {
    sql += ` AND (p.nome LIKE ? OR p.codigo_interno LIKE ? OR p.codigo_barras LIKE ? OR p.categoria LIKE ? OR p.fabricante LIKE ?)`;
    const like = `%${termo}%`;
    params.push(like, like, like, like, like);
  }
  if (apenasBaixo) sql += ` AND p.quantidade <= p.estoque_minimo`;
  sql += ` ORDER BY p.nome`;
  return db.all(sql, params);
});

ipcMain.handle('produtos:get', async (evt, { id }) => db.get('SELECT * FROM produtos WHERE id = ?', [id]));

ipcMain.handle('produtos:save', async (evt, { atual, produto }) => {
  const p = produto;
  if (p.id) {
    db.run(
      `UPDATE produtos SET nome=?, categoria=?, fabricante=?, fornecedor_id=?, codigo_interno=?, codigo_barras=?, estoque_minimo=?, valor_compra=?, valor_venda=?, localizacao=?, atualizado_em=? WHERE id=?`,
      [p.nome, p.categoria, p.fabricante, p.fornecedor_id || null, p.codigo_interno, p.codigo_barras, p.estoque_minimo || 0, p.valor_compra || 0, p.valor_venda || 0, p.localizacao, nowIso(), p.id]
    );
    log(atual, 'EDITAR', 'produtos', p.id, p.nome);
    return { ok: true, id: p.id };
  } else {
    const id = db.insert(
      `INSERT INTO produtos (nome, categoria, fabricante, fornecedor_id, codigo_interno, codigo_barras, quantidade, estoque_minimo, valor_compra, valor_venda, localizacao, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.nome, p.categoria, p.fabricante, p.fornecedor_id || null, p.codigo_interno, p.codigo_barras, p.quantidade || 0, p.estoque_minimo || 0, p.valor_compra || 0, p.valor_venda || 0, p.localizacao, 1, nowIso()]
    );
    if ((p.quantidade || 0) > 0) {
      db.insert(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
        [id, 'entrada', p.quantidade, 'Estoque inicial', '', atual?.id, atual?.nome, nowIso()]
      );
    }
    log(atual, 'CRIAR', 'produtos', id, p.nome);
    return { ok: true, id };
  }
});

ipcMain.handle('produtos:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  db.run('UPDATE produtos SET ativo = 0 WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'produtos', id, '');
  return { ok: true };
});

ipcMain.handle('produtos:movimentar', async (evt, { atual, produto_id, tipo, quantidade, motivo }) => {
  const produto = db.get('SELECT * FROM produtos WHERE id = ?', [produto_id]);
  if (!produto) throw new Error('Produto não encontrado.');
  let novaQtd = produto.quantidade;
  if (tipo === 'entrada') novaQtd += parseFloat(quantidade);
  else if (tipo === 'saida') novaQtd -= parseFloat(quantidade);
  else if (tipo === 'ajuste') novaQtd = parseFloat(quantidade);
  db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto_id]);
  db.insert(
    `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
    [produto_id, tipo, quantidade, motivo || '', 'Ajuste manual', atual?.id, atual?.nome, nowIso()]
  );
  log(atual, 'MOVIMENTAR_ESTOQUE', 'produtos', produto_id, `${tipo} ${quantidade} — ${motivo || ''}`);
  return { ok: true };
});

ipcMain.handle('produtos:movimentacoes', async (evt, { produto_id }) => {
  return db.all('SELECT * FROM movimentacoes_estoque WHERE produto_id = ? ORDER BY id DESC LIMIT 100', [produto_id]);
});

// ---------- COMPRAS / PEDIDOS A FORNECEDORES ----------
function nextCompraNumero() {
  const row = db.get(`SELECT numero FROM compras ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'CP-' + String(n).padStart(6, '0');
}

function calcularTotalCompra(itens) {
  return (itens || []).reduce((sum, it) => sum + (parseFloat(it.quantidade) || 0) * (parseFloat(it.valor_unit) || 0), 0);
}

// Quando um pedido de compra é marcado como "Enviado": lança a despesa
// correspondente ao valor total do pedido em Contas a Pagar (Financeiro), como
// um lançamento "Pendente" a ser pago depois. Protegido por flag para não
// duplicar o lançamento caso o status seja setado como "Enviado" mais de uma vez.
function processarEnvioCompra(atual, compra) {
  const hoje = nowIso().slice(0, 10);

  if (!compra.despesa_lancada && compra.valor_total > 0) {
    db.insert(
      `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['despesa', 'Fornecedores', `Compra enviada — ${compra.numero}`, compra.valor_total, '', 'Pendente', compra.data_prevista || hoje, null, compra.numero, null, 'Lançado automaticamente ao marcar o pedido de compra como "Enviado".', 1, atual?.id, atual?.nome, nowIso()]
    );
  }

  db.run(`UPDATE compras SET despesa_lancada = 1, atualizado_em = ? WHERE id = ?`, [nowIso(), compra.id]);
}

// Quando um pedido de compra é marcado como "Recebido": dá entrada no estoque de
// cada item vinculado a um produto cadastrado (atualizando também o valor de
// compra do produto para o preço pago nesta compra). Não mexe no financeiro —
// a despesa já foi lançada quando o pedido foi marcado como "Enviado". Protegido
// por flag para não duplicar a entrada caso o status seja setado como "Recebido"
// mais de uma vez.
function processarRecebimentoCompra(atual, compra) {
  let itens = [];
  try { itens = JSON.parse(compra.itens || '[]'); } catch { itens = []; }
  const hoje = nowIso().slice(0, 10);

  if (!compra.estoque_lancado) {
    itens.forEach((item) => {
      if (!item.produto_id || !item.quantidade) return;
      const produto = db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
      if (!produto) return;
      const novaQtd = (produto.quantidade || 0) + parseFloat(item.quantidade);
      db.run('UPDATE produtos SET quantidade = ?, valor_compra = ?, atualizado_em = ? WHERE id = ?',
        [novaQtd, parseFloat(item.valor_unit) || produto.valor_compra, nowIso(), produto.id]);
      db.insert(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
        [produto.id, 'entrada', item.quantidade, 'Recebimento de compra', compra.numero, atual?.id, atual?.nome, nowIso()]
      );
    });
  }

  // Caso o pedido tenha pulado direto de "Pendente" para "Recebido" (sem passar
  // por "Enviado"), lança a despesa agora como rede de segurança, para que o
  // valor não deixe de aparecer em Contas a Pagar.
  if (!compra.despesa_lancada && compra.valor_total > 0) {
    db.insert(
      `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['despesa', 'Fornecedores', `Compra recebida — ${compra.numero}`, compra.valor_total, '', 'Pendente', compra.data_prevista || hoje, null, compra.numero, null, 'Lançado automaticamente ao marcar o pedido de compra como "Recebido" (sem passar por "Enviado").', 1, atual?.id, atual?.nome, nowIso()]
    );
  }

  db.run(`UPDATE compras SET estoque_lancado = 1, despesa_lancada = 1, data_recebimento = ?, atualizado_em = ? WHERE id = ?`,
    [hoje, nowIso(), compra.id]);
}

ipcMain.handle('compras:list', async (evt, { termo, status } = {}) => {
  let sql = `SELECT c.*, f.nome as fornecedor_nome FROM compras c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id WHERE 1=1`;
  const params = [];
  if (termo) {
    sql += ` AND (c.numero LIKE ? OR f.nome LIKE ?)`;
    const like = `%${termo}%`;
    params.push(like, like);
  }
  if (status) { sql += ` AND c.status = ?`; params.push(status); }
  sql += ` ORDER BY c.id DESC`;
  return db.all(sql, params);
});

ipcMain.handle('compras:get', async (evt, { id }) => {
  return db.get(
    `SELECT c.*, f.nome as fornecedor_nome, f.telefone as fornecedor_telefone, f.email as fornecedor_email
     FROM compras c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id WHERE c.id = ?`, [id]
  );
});

ipcMain.handle('compras:save', async (evt, { atual, compra }) => {
  const c = compra;
  const itens = (c.itens || []).filter((i) => i.descricao);
  const valorTotal = calcularTotalCompra(itens);
  const itensJson = JSON.stringify(itens);
  if (c.id) {
    db.run(
      `UPDATE compras SET fornecedor_id=?, itens=?, valor_total=?, data_pedido=?, data_prevista=?, observacoes=?, atualizado_em=? WHERE id=?`,
      [c.fornecedor_id, itensJson, valorTotal, c.data_pedido, c.data_prevista || null, c.observacoes, nowIso(), c.id]
    );
    log(atual, 'EDITAR', 'compras', c.id, c.numero);
    return { ok: true, id: c.id };
  }
  const numero = nextCompraNumero();
  const id = db.insert(
    `INSERT INTO compras (numero, fornecedor_id, itens, valor_total, status, data_pedido, data_prevista, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [numero, c.fornecedor_id, itensJson, valorTotal, 'Pendente', c.data_pedido, c.data_prevista || null, c.observacoes, atual?.id, nowIso()]
  );
  log(atual, 'CRIAR', 'compras', id, numero);
  return { ok: true, id, numero };
});

ipcMain.handle('compras:setStatus', async (evt, { atual, id, status }) => {
  const compra = db.get('SELECT * FROM compras WHERE id = ?', [id]);
  if (!compra) throw new Error('Pedido de compra não encontrado.');
  db.run('UPDATE compras SET status = ?, atualizado_em = ? WHERE id = ?', [status, nowIso(), id]);
  if (status === 'Enviado') {
    processarEnvioCompra(atual, compra);
  } else if (status === 'Recebido') {
    processarRecebimentoCompra(atual, compra);
  }
  log(atual, 'MUDAR_STATUS', 'compras', id, `${compra.status} -> ${status}`);
  return { ok: true };
});

ipcMain.handle('compras:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const compra = db.get('SELECT * FROM compras WHERE id = ?', [id]);
  if (!compra) throw new Error('Pedido de compra não encontrado.');
  if (compra.status === 'Recebido') throw new Error('Não é possível excluir um pedido já recebido (estoque e financeiro já foram lançados).');
  if (compra.despesa_lancada) throw new Error('Não é possível excluir um pedido já enviado (a despesa já foi lançada em Contas a Pagar). Cancele o pedido em vez de excluí-lo.');
  db.run('DELETE FROM compras WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'compras', id, compra.numero);
  return { ok: true };
});

// ---------- SERVIÇOS (catálogo, usado para agilizar orçamentos) ----------
ipcMain.handle('servicos:list', async (evt, { termo } = {}) => {
  let sql = `SELECT * FROM servicos WHERE ativo = 1`;
  const params = [];
  if (termo) {
    sql += ` AND (nome LIKE ? OR categoria LIKE ?)`;
    const like = `%${termo}%`;
    params.push(like, like);
  }
  sql += ` ORDER BY nome`;
  return db.all(sql, params);
});

ipcMain.handle('servicos:save', async (evt, { atual, servico }) => {
  const s = servico;
  if (s.id) {
    db.run(
      `UPDATE servicos SET nome=?, descricao=?, categoria=?, valor_padrao=?, atualizado_em=? WHERE id=?`,
      [s.nome, s.descricao || '', s.categoria || '', s.valor_padrao || 0, nowIso(), s.id]
    );
    log(atual, 'EDITAR', 'servicos', s.id, s.nome);
    return { ok: true, id: s.id };
  }
  const id = db.insert(
    `INSERT INTO servicos (nome, descricao, categoria, valor_padrao, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
    [s.nome, s.descricao || '', s.categoria || '', s.valor_padrao || 0, 1, nowIso()]
  );
  log(atual, 'CRIAR', 'servicos', id, s.nome);
  return { ok: true, id };
});

ipcMain.handle('servicos:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  db.run('UPDATE servicos SET ativo = 0 WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'servicos', id, '');
  return { ok: true };
});

// ---------- VENDAS (venda avulsa de produtos/serviços, fora de OS/Orçamento) ----------
function nextVendaNumero() {
  const row = db.get(`SELECT numero FROM vendas ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'VD-' + String(n).padStart(6, '0');
}

ipcMain.handle('vendas:list', async (evt, { termo } = {}) => {
  let sql = `SELECT v.*, c.nome as cliente_nome FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE 1=1`;
  const params = [];
  if (termo) {
    sql += ` AND (v.numero LIKE ? OR c.nome LIKE ? OR v.itens LIKE ?)`;
    const like = `%${termo}%`;
    params.push(like, like, like);
  }
  sql += ` ORDER BY v.id DESC`;
  return db.all(sql, params);
});

ipcMain.handle('vendas:get', async (evt, { id }) => {
  return db.get(
    `SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf_cnpj, c.telefone as cliente_telefone,
            c.whatsapp as cliente_whatsapp, c.email as cliente_email, c.endereco as cliente_endereco,
            c.numero as cliente_numero, c.bairro as cliente_bairro, c.cidade as cliente_cidade, c.uf as cliente_uf
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`,
    [id]
  );
});

// Reverte os efeitos colaterais de uma venda (estoque + lançamento financeiro automático).
// Usado tanto na edição (reverte o estado antigo antes de reaplicar o novo) quanto na exclusão.
function reverterEfeitosVenda(atual, vendaAntiga) {
  let itensAntigos = [];
  try { itensAntigos = JSON.parse(vendaAntiga.itens || '[]'); } catch { itensAntigos = []; }
  itensAntigos.forEach((item) => {
    if (!item.produto_id || !item.quantidade) return;
    const produto = db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
    if (!produto) return;
    const novaQtd = (produto.quantidade || 0) + parseFloat(item.quantidade);
    db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
    db.insert(
      `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
      [produto.id, 'entrada', item.quantidade, 'Estorno por edição/exclusão de venda', vendaAntiga.numero, atual?.id, atual?.nome, nowIso()]
    );
  });
  db.run(`DELETE FROM lancamentos_financeiros WHERE referencia = ? AND origem_automatica = 1`, [vendaAntiga.numero]);
}

ipcMain.handle('vendas:save', async (evt, { atual, venda }) => {
  const v = venda;
  const itens = (v.itens || []).filter((i) => i.descricao);
  const valorItens = itens.reduce((s, i) => s + (parseFloat(i.quantidade) || 0) * (parseFloat(i.valor_unit) || 0), 0);
  const desconto = parseFloat(v.desconto) || 0;
  const valorTotal = Math.max(0, valorItens - desconto);
  const garantiaDias = v.garantia_dias === '' || v.garantia_dias === null || v.garantia_dias === undefined ? 90 : parseInt(v.garantia_dias, 10) || 0;
  const dataVenda = v.data_venda || nowIso().slice(0, 10);

  let numero;
  let id;
  if (v.id) {
    const existente = db.get('SELECT * FROM vendas WHERE id = ?', [v.id]);
    if (!existente) throw new Error('Venda não encontrada.');
    reverterEfeitosVenda(atual, existente);
    numero = existente.numero;
    id = existente.id;
    db.run(
      `UPDATE vendas SET cliente_id=?, itens=?, valor_itens=?, desconto=?, valor_total=?, forma_pagamento=?, observacoes=?, garantia_dias=?, criado_em=? WHERE id=?`,
      [v.cliente_id || null, JSON.stringify(itens), valorItens, desconto, valorTotal, v.forma_pagamento || null, v.observacoes || '', garantiaDias, dataVenda, id]
    );
    log(atual, 'EDITAR', 'vendas', id, numero);
  } else {
    numero = nextVendaNumero();
    id = db.insert(
      `INSERT INTO vendas (numero, cliente_id, itens, valor_itens, desconto, valor_total, forma_pagamento, status, observacoes, garantia_dias, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [numero, v.cliente_id || null, JSON.stringify(itens), valorItens, desconto, valorTotal, v.forma_pagamento || null, 'Concluída', v.observacoes || '', garantiaDias, atual?.id, dataVenda]
    );
    log(atual, 'CRIAR', 'vendas', id, numero);
  }

  // Baixa estoque dos itens vendidos que vieram do estoque
  itens.forEach((item) => {
    if (!item.produto_id || !item.quantidade) return;
    const produto = db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
    if (!produto) return;
    const novaQtd = (produto.quantidade || 0) - parseFloat(item.quantidade);
    db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
    db.insert(
      `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
      [produto.id, 'saida', item.quantidade, 'Venda avulsa', numero, atual?.id, atual?.nome, nowIso()]
    );
  });
  // Lança o recebimento diretamente como Pago no Financeiro
  if (valorTotal > 0) {
    const hoje = nowIso().slice(0, 10);
    db.insert(
      `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['receita', 'Vendas', `Venda ${numero}`, valorTotal, v.forma_pagamento || '', 'Pago', hoje, hoje, numero, null, '', 1, atual?.id, atual?.nome, nowIso()]
    );
    if (v.forma_pagamento === 'Dinheiro') {
      const sessao = caixaAberto();
      if (sessao) {
        db.insert(
          `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
          [sessao.id, 'entrada', valorTotal, v.forma_pagamento, `Venda ${numero}`, numero, atual?.id, atual?.nome, nowIso()]
        );
      }
    }
  }
  return { ok: true, id, numero };
});

ipcMain.handle('vendas:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const venda = db.get('SELECT * FROM vendas WHERE id = ?', [id]);
  if (!venda) throw new Error('Venda não encontrada.');
  reverterEfeitosVenda(atual, venda);
  db.run('DELETE FROM vendas WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'vendas', id, venda.numero);
  return { ok: true };
});

// ---------- ORÇAMENTOS ----------
function nextOrcamentoNumero() {
  const row = db.get(`SELECT numero FROM orcamentos ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'ORC-' + String(n).padStart(6, '0');
}

// Cada item do orçamento tem valor de peça (valor_peca) e mão de obra própria
// (valor_mao_obra). O total do item é (quantidade * valor_peca) + valor_mao_obra.
// Fallback para "valor_unit" mantém compatibilidade com orçamentos salvos antes
// dessa mudança (mão de obra única para o orçamento inteiro, em o.valor_servicos).
function valorPecaDoItem(it) {
  return it.valor_peca !== undefined ? (parseFloat(it.valor_peca) || 0) : (parseFloat(it.valor_unit) || 0);
}
function valorMaoObraDoItem(it) {
  return parseFloat(it.valor_mao_obra) || 0;
}
function calcularTotalItemOrcamento(it) {
  const qtd = parseFloat(it.quantidade) || 0;
  return qtd * valorPecaDoItem(it) + valorMaoObraDoItem(it);
}
function calcularTotalOrcamento(o) {
  const itens = o.itens || [];
  const totalItens = itens.reduce((sum, it) => sum + calcularTotalItemOrcamento(it), 0);
  const servicos = parseFloat(o.valor_servicos) || 0; // legado (orçamentos antigos)
  const desc = parseFloat(o.desconto) || 0;
  return Math.max(0, totalItens + servicos - desc);
}

ipcMain.handle('orcamentos:list', async (evt, { termo, status } = {}) => {
  let sql = `SELECT o.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp
             FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id WHERE 1=1`;
  const params = [];
  if (termo) {
    sql += ` AND (o.numero LIKE ? OR c.nome LIKE ?)`;
    const like = `%${termo}%`;
    params.push(like, like);
  }
  if (status) { sql += ` AND o.status = ?`; params.push(status); }
  sql += ` ORDER BY o.id DESC`;
  return db.all(sql, params);
});

ipcMain.handle('orcamentos:get', async (evt, { id }) => {
  return db.get(
    `SELECT o.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp, c.email as cliente_email,
            eq.marca as equip_marca, eq.modelo as equip_modelo
     FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
     WHERE o.id = ?`, [id]
  );
});

ipcMain.handle('orcamentos:save', async (evt, { atual, orcamento }) => {
  const o = orcamento;
  o.valor_total = calcularTotalOrcamento(o);
  const itens = JSON.stringify(o.itens || []);
  if (o.id) {
    db.run(
      `UPDATE orcamentos SET cliente_id=?, equipamento_id=?, descricao=?, itens=?, valor_servicos=?, desconto=?, valor_total=?, validade_dias=?, data_orcamento=?, status=?, observacoes=?, atualizado_em=? WHERE id=?`,
      [o.cliente_id, o.equipamento_id || null, o.descricao, itens, o.valor_servicos || 0, o.desconto || 0, o.valor_total, o.validade_dias || 7, o.data_orcamento, o.status, o.observacoes, nowIso(), o.id]
    );
    log(atual, 'EDITAR', 'orcamentos', o.id, o.numero);
    return { ok: true, id: o.id };
  } else {
    const numero = nextOrcamentoNumero();
    const id = db.insert(
      `INSERT INTO orcamentos (numero, cliente_id, equipamento_id, descricao, itens, valor_servicos, desconto, valor_total, validade_dias, data_orcamento, status, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [numero, o.cliente_id, o.equipamento_id || null, o.descricao, itens, o.valor_servicos || 0, o.desconto || 0, o.valor_total, o.validade_dias || 7, o.data_orcamento, o.status || 'Pendente', o.observacoes, atual?.id, nowIso()]
    );
    log(atual, 'CRIAR', 'orcamentos', id, numero);
    return { ok: true, id, numero };
  }
});

ipcMain.handle('orcamentos:setStatus', async (evt, { atual, id, status }) => {
  const before = db.get('SELECT status, numero FROM orcamentos WHERE id = ?', [id]);
  db.run('UPDATE orcamentos SET status = ?, atualizado_em = ? WHERE id = ?', [status, nowIso(), id]);
  log(atual, 'MUDAR_STATUS', 'orcamentos', id, `${before?.status} -> ${status}`);
  return { ok: true };
});

ipcMain.handle('orcamentos:duplicar', async (evt, { atual, id }) => {
  const orig = db.get('SELECT * FROM orcamentos WHERE id = ?', [id]);
  if (!orig) throw new Error('Orçamento não encontrado.');
  const numero = nextOrcamentoNumero();
  const newId = db.insert(
    `INSERT INTO orcamentos (numero, cliente_id, equipamento_id, descricao, itens, valor_servicos, desconto, valor_total, validade_dias, data_orcamento, status, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [numero, orig.cliente_id, orig.equipamento_id, orig.descricao, orig.itens, orig.valor_servicos, orig.desconto, orig.valor_total, orig.validade_dias, nowIso().slice(0, 10), 'Pendente', orig.observacoes, atual?.id, nowIso()]
  );
  log(atual, 'DUPLICAR', 'orcamentos', newId, `A partir de ${orig.numero}`);
  return { ok: true, id: newId, numero };
});

ipcMain.handle('orcamentos:converterEmOs', async (evt, { atual, id }) => {
  const orc = db.get('SELECT * FROM orcamentos WHERE id = ?', [id]);
  if (!orc) throw new Error('Orçamento não encontrado.');
  if (!orc.equipamento_id) throw new Error('Este orçamento não possui um equipamento vinculado. Edite o orçamento e selecione o equipamento antes de converter em OS.');
  let itens = [];
  try { itens = JSON.parse(orc.itens || '[]'); } catch { itens = []; }
  // Peças utilizadas na OS: usa o valor da peça de cada item (com fallback para o
  // formato antigo "valor_unit"). A mão de obra de cada item vira uma única
  // "Valor de Mão de Obra" na OS, somada à eventual mão de obra única de
  // orçamentos antigos (orc.valor_servicos).
  const itensPecas = itens.filter((i) => i.produto_id).map((i) => ({ produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, valor_unit: valorPecaDoItem(i) }));
  const valorPecas = itens.reduce((sum, it) => sum + (parseFloat(it.quantidade) || 0) * valorPecaDoItem(it), 0);
  const valorMaoObra = itens.reduce((sum, it) => sum + valorMaoObraDoItem(it), 0) + (parseFloat(orc.valor_servicos) || 0);
  const numero = nextOsNumero();
  const dataHoje = nowIso().slice(0, 10);
  const temPecas = itensPecas.length > 0 || valorPecas > 0;
  const osId = db.insert(
    `INSERT INTO ordens_servico (numero, cliente_id, equipamento_id, defeito_informado, diagnostico, servicos_executados, pecas_utilizadas, valor_mao_obra, valor_pecas, desconto, valor_total, garantia_dias, data_entrada, previsao, data_saida, status, observacoes, assinatura_cliente, checklist, itens_pecas, estoque_baixado, despesa_pecas_lancada, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [numero, orc.cliente_id, orc.equipamento_id, orc.descricao || '', '', '', '', valorMaoObra, valorPecas, orc.desconto || 0, orc.valor_total, 90, dataHoje, '', '', 'Recebido', `Convertido do orçamento ${orc.numero}`, '', '[]', JSON.stringify(itensPecas), 0, temPecas ? 1 : 0, atual?.id, nowIso()]
  );
  if (itensPecas.length > 0) {
    baixarEstoqueDaOs(atual, osId, numero, itensPecas);
    db.run('UPDATE ordens_servico SET estoque_baixado = 1 WHERE id = ?', [osId]);
  }
  if (temPecas) {
    lancarDespesaPecasDaOs(atual, osId, numero, itensPecas, valorPecas, dataHoje);
  }
  db.run(`UPDATE orcamentos SET status='Convertido', os_id=?, atualizado_em=? WHERE id=?`, [osId, nowIso(), id]);
  log(atual, 'CONVERTER_EM_OS', 'orcamentos', id, `${orc.numero} -> ${numero}`);
  return { ok: true, osId, osNumero: numero };
});

ipcMain.handle('orcamentos:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const orc = db.get('SELECT * FROM orcamentos WHERE id = ?', [id]);
  if (!orc) throw new Error('Orçamento não encontrado.');
  db.run('DELETE FROM orcamentos WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'orcamentos', id, orc.numero);
  return { ok: true };
});

// ---------- DASHBOARD ----------
ipcMain.handle('dashboard:resumo', async () => {
  const abertas = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status NOT IN ('Entregue','Cancelado')`);
  const aguardandoPeca = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status = 'Aguardando peça'`);
  const prontos = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status = 'Pronto'`);
  const hoje = nowIso().slice(0, 10);
  const mesAtual = hoje.slice(0, 7);
  const entreguesHoje = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status='Entregue' AND substr(data_saida,1,10) = ?`, [hoje]);
  const totalClientes = db.get('SELECT COUNT(*) c FROM clientes');
  const estoqueBaixo = db.get(`SELECT COUNT(*) c FROM produtos WHERE ativo = 1 AND quantidade <= estoque_minimo`);
  const faturamentoDia = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,10) = ?`, [hoje]);
  const faturamentoMes = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,7) = ?`, [mesAtual]);
  const despesasMes = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pago' AND substr(data_pagamento,1,7) = ?`, [mesAtual]);
  const contasAPagar = db.get(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) c FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pendente'`);
  const contasAReceber = db.get(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) c FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pendente'`);
  const sessao = caixaAberto();
  const ultimasOs = db.all(
    `SELECT os.numero, os.status, os.criado_em, c.nome as cliente_nome FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id ORDER BY os.id DESC LIMIT 8`
  );
  const porStatus = db.all(`SELECT status, COUNT(*) as qtd FROM ordens_servico GROUP BY status`);

  // Estoque baixo — lista detalhada dos produtos, não só a contagem
  const estoqueBaixoList = db.all(
    `SELECT id, nome, quantidade, estoque_minimo, categoria FROM produtos WHERE ativo = 1 AND quantidade <= estoque_minimo ORDER BY (quantidade - estoque_minimo) ASC LIMIT 30`
  );

  // Aniversariantes do mês (calendário de clientes) — ordenado pelo dia do mês
  const mesNum = hoje.slice(5, 7);
  const diaAtual = parseInt(hoje.slice(8, 10), 10);
  const aniversariantesMes = db.all(
    `SELECT id, nome, telefone, whatsapp, data_nascimento FROM clientes
     WHERE data_nascimento IS NOT NULL AND data_nascimento != '' AND substr(data_nascimento, 6, 2) = ?
     ORDER BY substr(data_nascimento, 9, 2) ASC`,
    [mesNum]
  ).map((c) => ({ ...c, dia: parseInt(c.data_nascimento.slice(8, 10), 10), jaPassou: parseInt(c.data_nascimento.slice(8, 10), 10) < diaAtual }));

  // Faturamento dos últimos 7 dias (para gráfico de barras semanal)
  const faturamentoSemana = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const diaIso = d.toISOString().slice(0, 10);
    const row = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,10) = ?`, [diaIso]);
    faturamentoSemana.push({ label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), data: diaIso, valor: row.v });
  }

  // Faturamento dos últimos 12 meses (para gráfico de barras mensal/anual)
  const faturamentoMensal = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const mesIso = d.toISOString().slice(0, 7);
    const row = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,7) = ?`, [mesIso]);
    faturamentoMensal.push({ label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), data: mesIso, valor: row.v });
  }
  const faturamentoAno = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,4) = ?`, [hoje.slice(0, 4)]);

  return {
    abertas: abertas.c, aguardandoPeca: aguardandoPeca.c, prontos: prontos.c,
    entreguesHoje: entreguesHoje.c, totalClientes: totalClientes.c, ultimasOs, porStatus,
    estoqueBaixo: estoqueBaixo.c, estoqueBaixoList, faturamentoDia: faturamentoDia.v, faturamentoMes: faturamentoMes.v,
    faturamentoAno: faturamentoAno.v, faturamentoSemana, faturamentoMensal,
    despesasMes: despesasMes.v, contasAPagar: contasAPagar.v, contasAPagarQtd: contasAPagar.c,
    contasAReceber: contasAReceber.v, contasAReceberQtd: contasAReceber.c,
    caixaAberto: !!sessao, caixaSessaoId: sessao?.id || null,
    aniversariantesMes,
  };
});

// ---------- META MENSAL DE LUCRO / DASHBOARD FINANCEIRO ----------
// Calcula, para um mês (formato 'YYYY-MM'), o lucro já realizado (receitas pagas - despesas
// pagas), compara com a meta definida pelo usuário, projeta o fechamento do mês e monta a
// evolução diária — tudo a partir dos lançamentos que já existem no Financeiro.
function somaMes(tipo, mesAlvo) {
  return db.get(
    `SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo=? AND status='Pago' AND substr(data_pagamento,1,7) = ?`,
    [tipo, mesAlvo]
  ).v;
}

function mesAnterior(mesAlvo) {
  const [ano, mesNum] = mesAlvo.split('-').map((n) => parseInt(n, 10));
  const d = new Date(ano, mesNum - 2, 1); // mesNum é 1-indexado; -2 volta um mês (Date usa mês 0-indexado)
  return d.toISOString().slice(0, 7);
}

function variacaoPercentual(atual, anterior) {
  if (!anterior) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function calcularMetaMensal(mes) {
  const hoje = nowIso().slice(0, 10);
  const mesHoje = hoje.slice(0, 7);
  const mesAlvo = mes || mesHoje;
  const ehMesAtual = mesAlvo === mesHoje;
  const ehMesFuturo = mesAlvo > mesHoje;
  const ehMesPassado = mesAlvo < mesHoje;

  const receitasV = somaMes('receita', mesAlvo);
  const despesasV = somaMes('despesa', mesAlvo);
  const lucroRealizado = receitasV - despesasV;

  const mesAnt = mesAnterior(mesAlvo);
  const receitasAnt = somaMes('receita', mesAnt);
  const despesasAnt = somaMes('despesa', mesAnt);
  const lucroAnt = receitasAnt - despesasAnt;

  const metaRow = db.get('SELECT * FROM metas_financeiras WHERE mes = ?', [mesAlvo]);
  const metaLucro = metaRow ? metaRow.meta_lucro : null;

  const [ano, mesNum] = mesAlvo.split('-').map((n) => parseInt(n, 10));
  const diasNoMes = new Date(ano, mesNum, 0).getDate();
  const diaAtual = ehMesAtual ? parseInt(hoje.slice(8, 10), 10) : (ehMesPassado ? diasNoMes : 0);
  const diasRestantes = Math.max(0, diasNoMes - diaAtual);

  let percentualAlcancado = null;
  let ritmoEsperadoHoje = null;
  let statusRitmo = null; // 'atingida' | 'no_ritmo' | 'atrasado' | 'nao_atingida' | null (mês futuro)
  let faltaAtingir = null;
  let mediaDiariaNecessaria = null;

  if (metaLucro && metaLucro > 0) {
    percentualAlcancado = (lucroRealizado / metaLucro) * 100;
    faltaAtingir = Math.max(0, metaLucro - lucroRealizado);
    if (ehMesFuturo) {
      statusRitmo = null; // mês ainda não começou, não faz sentido falar em ritmo
      mediaDiariaNecessaria = metaLucro / diasNoMes;
    } else if (ehMesPassado) {
      statusRitmo = lucroRealizado >= metaLucro ? 'atingida' : 'nao_atingida';
      mediaDiariaNecessaria = null;
    } else {
      ritmoEsperadoHoje = metaLucro * (diaAtual / diasNoMes);
      mediaDiariaNecessaria = diasRestantes > 0 ? faltaAtingir / diasRestantes : faltaAtingir;
      if (lucroRealizado >= metaLucro) statusRitmo = 'atingida';
      else if (lucroRealizado >= ritmoEsperadoHoje) statusRitmo = 'no_ritmo';
      else statusRitmo = 'atrasado';
    }
  }

  // Projeção de fechamento do mês: extrapola o ritmo médio diário até hoje para o mês inteiro
  // (só faz sentido para o mês corrente, com pelo menos 1 dia decorrido)
  const projecaoLucro = (ehMesAtual && diaAtual > 0) ? (lucroRealizado / diaAtual) * diasNoMes : null;

  // Evolução diária do lucro acumulado (para o gráfico de linha)
  const diasParaEvoluir = ehMesFuturo ? 0 : diaAtual;
  const evolucaoDiaria = [];
  if (diasParaEvoluir > 0) {
    let acumulado = 0;
    for (let d = 1; d <= diasParaEvoluir; d++) {
      const diaIso = `${mesAlvo}-${String(d).padStart(2, '0')}`;
      const rec = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND data_pagamento = ?`, [diaIso]);
      const desp = db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pago' AND data_pagamento = ?`, [diaIso]);
      acumulado += (rec.v - desp.v);
      evolucaoDiaria.push({ dia: d, valor: acumulado });
    }
  }

  // Serviços/vendas realizados e ticket médio no mês (para os cartões auxiliares)
  const osEntregues = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status='Entregue' AND substr(data_saida,1,7) = ?`, [mesAlvo]);
  const vendasConcluidas = db.get(`SELECT COUNT(*) c FROM vendas WHERE status != 'Cancelada' AND substr(criado_em,1,7) = ?`, [mesAlvo]);
  const servicosRealizados = (osEntregues.c || 0) + (vendasConcluidas.c || 0);
  const osEntreguesAnt = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status='Entregue' AND substr(data_saida,1,7) = ?`, [mesAnt]);
  const vendasConcluidasAnt = db.get(`SELECT COUNT(*) c FROM vendas WHERE status != 'Cancelada' AND substr(criado_em,1,7) = ?`, [mesAnt]);
  const servicosRealizadosAnt = (osEntreguesAnt.c || 0) + (vendasConcluidasAnt.c || 0);
  const ticketMedio = servicosRealizados > 0 ? receitasV / servicosRealizados : 0;
  const ticketMedioAnt = servicosRealizadosAnt > 0 ? receitasAnt / servicosRealizadosAnt : 0;

  return {
    mes: mesAlvo, ehMesAtual, ehMesFuturo, ehMesPassado,
    receitas: receitasV, despesas: despesasV, lucroRealizado,
    metaLucro, diasNoMes, diaAtual, diasRestantes,
    percentualAlcancado, ritmoEsperadoHoje, statusRitmo, faltaAtingir, mediaDiariaNecessaria,
    projecaoLucro, evolucaoDiaria,
    servicosRealizados, servicosRealizadosVar: servicosRealizados - servicosRealizadosAnt,
    ticketMedio, ticketMedioVar: variacaoPercentual(ticketMedio, ticketMedioAnt),
    comparativo: {
      faturamento: receitasV, faturamentoVar: variacaoPercentual(receitasV, receitasAnt),
      despesas: despesasV, despesasVar: variacaoPercentual(despesasV, despesasAnt),
      lucro: lucroRealizado, lucroVar: variacaoPercentual(lucroRealizado, lucroAnt),
    },
  };
}

ipcMain.handle('financas:metaMensal', async (evt, { mes } = {}) => {
  return calcularMetaMensal(mes);
});

ipcMain.handle('financas:metasFuturas', async (evt, { quantidadeMeses } = {}) => {
  const n = quantidadeMeses || 6;
  const hoje = nowIso().slice(0, 10);
  const meses = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(hoje.slice(0, 10) + 'T00:00:00');
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    const mes = d.toISOString().slice(0, 7);
    const metaRow = db.get('SELECT meta_lucro FROM metas_financeiras WHERE mes = ?', [mes]);
    meses.push({ mes, label: mesLabelBackend(mes), metaLucro: metaRow ? metaRow.meta_lucro : null });
  }
  return meses;
});

function mesLabelBackend(mes) {
  const [ano, mesNum] = mes.split('-').map((v) => parseInt(v, 10));
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[mesNum - 1]} / ${ano}`;
}

ipcMain.handle('financas:definirMeta', async (evt, { atual, mes, meta_lucro }) => {
  requirePapel(atual, ['Administrador', 'Financeiro']);
  const mesAlvo = mes || nowIso().slice(0, 7);
  const meta = Math.max(0, parseFloat(meta_lucro) || 0);
  const existente = db.get('SELECT mes FROM metas_financeiras WHERE mes = ?', [mesAlvo]);
  if (existente) {
    db.run('UPDATE metas_financeiras SET meta_lucro = ?, usuario_id = ?, atualizado_em = ? WHERE mes = ?', [meta, atual?.id, nowIso(), mesAlvo]);
  } else {
    db.run('INSERT INTO metas_financeiras (mes, meta_lucro, usuario_id, atualizado_em) VALUES (?,?,?,?)', [mesAlvo, meta, atual?.id, nowIso()]);
  }
  log(atual, 'EDITAR', 'metas_financeiras', mesAlvo, `Meta de lucro definida: ${meta}`);
  return { ok: true };
});

// ---------- FINANCEIRO ----------
ipcMain.handle('financeiro:list', async (evt, { tipo, status, termo } = {}) => {
  let sql = `SELECT * FROM lancamentos_financeiros WHERE 1=1`;
  const params = [];
  if (tipo) { sql += ` AND tipo = ?`; params.push(tipo); }
  if (status) { sql += ` AND status = ?`; params.push(status); }
  if (termo) { sql += ` AND (descricao LIKE ? OR referencia LIKE ? OR categoria LIKE ?)`; const like = `%${termo}%`; params.push(like, like, like); }
  sql += ` ORDER BY COALESCE(data_vencimento, criado_em) DESC, id DESC`;
  return db.all(sql, params);
});

ipcMain.handle('financeiro:save', async (evt, { atual, lancamento }) => {
  const l = lancamento;
  // Se o lançamento já nasce/edita como "Pago" e não veio data de pagamento, assume hoje.
  // Sem isso, data_pagamento fica NULL e o lançamento nunca aparece na DRE/faturamento
  // (que filtram por data_pagamento), mesmo constando como "Pago" na listagem.
  const dataPagamento = l.data_pagamento || (l.status === 'Pago' ? nowIso().slice(0, 10) : null);
  if (l.id) {
    db.run(
      `UPDATE lancamentos_financeiros SET tipo=?, categoria=?, descricao=?, valor=?, forma_pagamento=?, status=?, data_vencimento=?, data_pagamento=?, observacoes=?, atualizado_em=? WHERE id=?`,
      [l.tipo, l.categoria, l.descricao, l.valor, l.forma_pagamento, l.status, l.data_vencimento, dataPagamento, l.observacoes, nowIso(), l.id]
    );
    log(atual, 'EDITAR', 'lancamentos_financeiros', l.id, l.descricao);
    return { ok: true, id: l.id };
  }
  const id = db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [l.tipo, l.categoria, l.descricao, l.valor, l.forma_pagamento, l.status || 'Pendente', l.data_vencimento, dataPagamento, l.referencia || '', l.observacoes, 0, atual?.id, atual?.nome, nowIso()]
  );
  log(atual, 'CRIAR', 'lancamentos_financeiros', id, l.descricao);
  return { ok: true, id };
});

ipcMain.handle('financeiro:delete', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const l = db.get('SELECT * FROM lancamentos_financeiros WHERE id = ?', [id]);
  if (!l) throw new Error('Lançamento não encontrado.');
  db.run('DELETE FROM lancamentos_financeiros WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'lancamentos_financeiros', id, `${l.tipo} — ${l.descricao} — ${l.valor}`);
  return { ok: true };
});

ipcMain.handle('financeiro:marcarPago', async (evt, { atual, id, forma_pagamento, data_pagamento }) => {
  const l = db.get('SELECT * FROM lancamentos_financeiros WHERE id = ?', [id]);
  if (!l) throw new Error('Lançamento não encontrado.');
  const dataPg = data_pagamento || nowIso().slice(0, 10);
  db.run(`UPDATE lancamentos_financeiros SET status='Pago', forma_pagamento=?, data_pagamento=?, atualizado_em=? WHERE id=?`,
    [forma_pagamento, dataPg, nowIso(), id]);
  if (l.tipo === 'receita' && forma_pagamento === 'Dinheiro') {
    const sessao = caixaAberto();
    if (sessao) {
      db.insert(`INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
        [sessao.id, 'entrada', l.valor, forma_pagamento, l.descricao, l.referencia, atual?.id, atual?.nome, nowIso()]);
    }
  } else if (l.tipo === 'despesa' && forma_pagamento === 'Dinheiro') {
    const sessao = caixaAberto();
    if (sessao) {
      db.insert(`INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
        [sessao.id, 'saida', l.valor, forma_pagamento, l.descricao, l.referencia, atual?.id, atual?.nome, nowIso()]);
    }
  }
  log(atual, 'MARCAR_PAGO', 'lancamentos_financeiros', id, `${l.tipo} — ${forma_pagamento}`);
  return { ok: true };
});

ipcMain.handle('financeiro:cancelar', async (evt, { atual, id }) => {
  db.run(`UPDATE lancamentos_financeiros SET status='Cancelado', atualizado_em=? WHERE id=?`, [nowIso(), id]);
  log(atual, 'CANCELAR', 'lancamentos_financeiros', id, '');
  return { ok: true };
});

ipcMain.handle('financeiro:dre', async (evt, { mes }) => {
  // mes no formato YYYY-MM
  const receitas = db.all(
    `SELECT categoria, COALESCE(SUM(valor),0) as total FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,7) = ? GROUP BY categoria ORDER BY total DESC`,
    [mes]
  );
  const despesas = db.all(
    `SELECT categoria, COALESCE(SUM(valor),0) as total FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pago' AND substr(data_pagamento,1,7) = ? GROUP BY categoria ORDER BY total DESC`,
    [mes]
  );
  const totalReceitas = receitas.reduce((s, r) => s + r.total, 0);
  const totalDespesas = despesas.reduce((s, r) => s + r.total, 0);
  return { receitas, despesas, totalReceitas, totalDespesas, resultado: totalReceitas - totalDespesas };
});

// ---------- CAIXA ----------
ipcMain.handle('caixa:atual', async () => {
  const sessao = caixaAberto();
  if (!sessao) return null;
  const movimentos = db.all('SELECT * FROM caixa_movimentos WHERE sessao_id = ? ORDER BY id DESC', [sessao.id]);
  const entradas = movimentos.filter((m) => m.tipo === 'entrada' || m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
  const saidas = movimentos.filter((m) => m.tipo === 'saida' || m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
  const saldoCalculado = (sessao.valor_abertura || 0) + entradas - saidas;
  return { sessao, movimentos, saldoCalculado };
});

ipcMain.handle('caixa:historico', async (evt, { limit } = {}) => {
  return db.all('SELECT * FROM caixa_sessoes ORDER BY id DESC LIMIT ?', [limit || 30]);
});

ipcMain.handle('caixa:abrir', async (evt, { atual, valor_abertura, observacoes }) => {
  if (caixaAberto()) throw new Error('Já existe um caixa aberto.');
  const id = db.insert(
    `INSERT INTO caixa_sessoes (data_abertura, valor_abertura, usuario_abertura_id, usuario_abertura_nome, status, observacoes, criado_em) VALUES (?,?,?,?,?,?,?)`,
    [nowIso(), parseFloat(valor_abertura) || 0, atual?.id, atual?.nome, 'Aberto', observacoes || '', nowIso()]
  );
  log(atual, 'ABRIR_CAIXA', 'caixa_sessoes', id, `Abertura: ${valor_abertura}`);
  return { ok: true, id };
});

ipcMain.handle('caixa:movimentar', async (evt, { atual, tipo, valor, forma_pagamento, descricao }) => {
  const sessao = caixaAberto();
  if (!sessao) throw new Error('Não há caixa aberto no momento.');
  const id = db.insert(
    `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
    [sessao.id, tipo, parseFloat(valor), forma_pagamento || 'Dinheiro', descricao || '', '', atual?.id, atual?.nome, nowIso()]
  );
  log(atual, tipo === 'suprimento' ? 'SUPRIMENTO' : 'SANGRIA', 'caixa_movimentos', id, `${valor} — ${descricao || ''}`);
  return { ok: true, id };
});

ipcMain.handle('caixa:fechar', async (evt, { atual, valor_fechamento_informado, observacoes }) => {
  const sessao = caixaAberto();
  if (!sessao) throw new Error('Não há caixa aberto no momento.');
  const movimentos = db.all('SELECT * FROM caixa_movimentos WHERE sessao_id = ?', [sessao.id]);
  const entradas = movimentos.filter((m) => m.tipo === 'entrada' || m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
  const saidas = movimentos.filter((m) => m.tipo === 'saida' || m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
  const saldoCalculado = (sessao.valor_abertura || 0) + entradas - saidas;
  db.run(
    `UPDATE caixa_sessoes SET data_fechamento=?, valor_fechamento_informado=?, valor_fechamento_calculado=?, usuario_fechamento_id=?, usuario_fechamento_nome=?, status='Fechado', observacoes=? WHERE id=?`,
    [nowIso(), parseFloat(valor_fechamento_informado) || 0, saldoCalculado, atual?.id, atual?.nome, observacoes || sessao.observacoes, sessao.id]
  );
  log(atual, 'FECHAR_CAIXA', 'caixa_sessoes', sessao.id, `Calculado: ${saldoCalculado} / Informado: ${valor_fechamento_informado}`);
  return { ok: true, saldoCalculado, diferenca: (parseFloat(valor_fechamento_informado) || 0) - saldoCalculado };
});

ipcMain.handle('caixa:excluir', async (evt, { atual, id }) => {
  requirePapel(atual, ['Administrador']);
  const existente = db.get('SELECT * FROM caixa_sessoes WHERE id = ?', [id]);
  if (!existente) throw new Error('Sessão de caixa não encontrada.');
  db.run('DELETE FROM caixa_movimentos WHERE sessao_id = ?', [id]);
  db.run('DELETE FROM caixa_sessoes WHERE id = ?', [id]);
  log(atual, 'EXCLUIR', 'caixa_sessoes', id, `Abertura de ${existente.data_abertura} — valor ${existente.valor_abertura}`);
  return { ok: true };
});

// ---------- LOGS ----------
ipcMain.handle('logs:list', async (evt, { limit } = {}) => {
  return db.all('SELECT * FROM logs ORDER BY id DESC LIMIT ?', [limit || 200]);
});

// ---------- BACKUP ----------
ipcMain.handle('backup:manual', async () => {
  if (modoRedeAtual() === 'cliente') {
    throw new Error('Este computador está em modo Cliente (rede multi-PC). O banco de dados fica armazenado no computador Servidor — gere o backup por lá.');
  }
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Salvar backup do banco de dados',
    defaultPath: `reboottech-backup-${nowIso().slice(0, 10)}.sqlite`,
    filters: [{ name: 'SQLite DB', extensions: ['sqlite'] }],
  });
  if (canceled || !filePath) return { ok: false };
  db.backupTo(filePath);
  return { ok: true, filePath };
});

// ---------- PDF ----------
function getEmpresa() {
  return db.get('SELECT * FROM configuracoes_empresa WHERE id = 1') || {};
}

ipcMain.handle('empresa:get', async () => getEmpresa());

ipcMain.handle('empresa:save', async (evt, { atual, empresa }) => {
  const e = empresa;
  db.run(
    `UPDATE configuracoes_empresa SET nome=?, nome_fantasia=?, logo=?, cnpj=?, ie=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=?, telefone=?, whatsapp=?, email=?, site=?, redes_sociais=?, atualizado_em=? WHERE id=1`,
    [e.nome, e.nome_fantasia, e.logo, e.cnpj, e.ie, e.endereco, e.numero, e.bairro, e.cidade, e.uf, e.cep, e.telefone, e.whatsapp, e.email, e.site, e.redes_sociais, nowIso()]
  );
  log(atual, 'EDITAR', 'configuracoes_empresa', 1, 'Dados da empresa atualizados');
  return { ok: true };
});

function getOsCompletaPorId(id) {
  return db.get(
    `SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp, c.cpf_cnpj as cliente_cpf_cnpj,
            eq.marca as equip_marca, eq.modelo as equip_modelo, eq.imei as equip_imei, eq.fotos as equip_fotos, u.nome as tecnico_nome
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     LEFT JOIN usuarios u ON u.id = os.tecnico_id
     WHERE os.id = ?`,
    [id]
  );
}

function getOrcamentoCompletoPorId(id) {
  return db.get(
    `SELECT o.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp, c.email as cliente_email,
            eq.marca as equip_marca, eq.modelo as equip_modelo
     FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
     WHERE o.id = ?`, [id]
  );
}

// Canais de dados usados internamente pelos handlers de PDF/impressão (LOCAL_ONLY),
// para que eles sempre busquem informação atualizada — do servidor, quando este
// computador estiver em modo Cliente — antes de gerar o arquivo localmente.
ipcMain.handle('dados:osCompleta', async (evt, { id }) => getOsCompletaPorId(id));
ipcMain.handle('dados:orcamentoCompleta', async (evt, { id }) => getOrcamentoCompletoPorId(id));
ipcMain.handle('dados:lancamentoFinanceiro', async (evt, { id }) => db.get('SELECT * FROM lancamentos_financeiros WHERE id = ?', [id]));

ipcMain.handle('pdf:exportarOS', async (evt, { id }) => {
  const os = await chamarCanal('dados:osCompleta', { id });
  if (!os) throw new Error('Ordem de Serviço não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar PDF da Ordem de Serviço',
    defaultFileName: `${os.numero}.pdf`,
    title: `Ordem de Serviço Nº ${os.numero}`,
    subtitle: 'Vistoria técnica, orçamento e acompanhamento do reparo',
    innerHtml: pdfModule.buildOsHtml(os),
    footerSubtitulo: `OS ${os.numero}`,
  });
});

ipcMain.handle('pdf:exportarChecklist', async (evt, { id }) => {
  const os = await chamarCanal('dados:osCompleta', { id });
  if (!os) throw new Error('Ordem de Serviço não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar PDF do Checklist de Entrada',
    defaultFileName: `Checklist_${os.numero}.pdf`,
    title: `Checklist de Entrada — ${os.numero}`,
    subtitle: 'Vistoria técnica e recebimento do equipamento',
    innerHtml: pdfModule.buildChecklistOnlyHtml(os),
    footerSubtitulo: `Checklist ${os.numero}`,
  });
});

ipcMain.handle('pdf:exportarGarantia', async (evt, { id }) => {
  const os = await chamarCanal('dados:osCompleta', { id });
  if (!os) throw new Error('Ordem de Serviço não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar Termo de Garantia em PDF',
    defaultFileName: `Termo_Garantia_${os.numero}.pdf`,
    title: 'Termo de Garantia',
    subtitle: `Referente à Ordem de Serviço ${os.numero}`,
    innerHtml: pdfModule.buildGarantiaHtml(os, empresa),
    footerSubtitulo: `Termo de Garantia — ${os.numero}`,
  });
});

ipcMain.handle('pdf:exportarOrcamento', async (evt, { id }) => {
  const orc = await chamarCanal('dados:orcamentoCompleta', { id });
  if (!orc) throw new Error('Orçamento não encontrado.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar PDF do Orçamento',
    defaultFileName: `${orc.numero}.pdf`,
    title: `Orçamento Nº ${orc.numero}`,
    subtitle: `Válido por ${orc.validade_dias || 7} dias a partir da data de emissão`,
    innerHtml: pdfModule.buildOrcamentoHtml(orc),
    footerSubtitulo: `Orçamento ${orc.numero}`,
  });
});

ipcMain.handle('pdf:exportarComprovante', async (evt, { id }) => {
  const l = await chamarCanal('dados:lancamentoFinanceiro', { id });
  if (!l) throw new Error('Lançamento não encontrado.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar Comprovante em PDF',
    defaultFileName: `Comprovante_${l.referencia || l.id}.pdf`,
    title: `Comprovante de ${l.tipo === 'receita' ? 'Recebimento' : 'Pagamento'}`,
    subtitle: l.referencia ? `Referência: ${l.referencia}` : '',
    innerHtml: pdfModule.buildComprovanteHtml(l),
    footerSubtitulo: 'Comprovante Financeiro',
  });
});

function getVendaCompletaPorId(id) {
  return db.get(
    `SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf_cnpj, c.telefone as cliente_telefone,
            c.whatsapp as cliente_whatsapp, c.email as cliente_email, c.endereco as cliente_endereco,
            c.numero as cliente_numero, c.bairro as cliente_bairro, c.cidade as cliente_cidade, c.uf as cliente_uf
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`,
    [id]
  );
}

ipcMain.handle('dados:vendaCompleta', async (evt, { id }) => getVendaCompletaPorId(id));

ipcMain.handle('pdf:exportarVendaGarantia', async (evt, { id }) => {
  const venda = await chamarCanal('dados:vendaCompleta', { id });
  if (!venda) throw new Error('Venda não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar Termo de Garantia em PDF',
    defaultFileName: `Garantia_${venda.numero}.pdf`,
    title: 'Termo de Garantia',
    subtitle: `Referente à Venda ${venda.numero}`,
    innerHtml: pdfModule.buildVendaGarantiaHtml(venda, empresa),
    footerSubtitulo: `Termo de Garantia — ${venda.numero}`,
  });
});

ipcMain.handle('pdf:exportarVendaRecibo', async (evt, { id }) => {
  const venda = await chamarCanal('dados:vendaCompleta', { id });
  if (!venda) throw new Error('Venda não encontrada.');
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar Comprovante de Compra em PDF',
    defaultFileName: `Comprovante_Compra_${venda.numero}.pdf`,
    title: 'Comprovante de Compra',
    subtitle: `Venda Nº ${venda.numero}`,
    innerHtml: pdfModule.buildVendaReciboHtml(venda, empresa),
    footerSubtitulo: `Comprovante de Compra — ${venda.numero}`,
  });
});

ipcMain.handle('pdf:exportarRelatorio', async (evt, { atual, titulo, periodoTexto, resumo, columns, rows }) => {
  requirePapel(atual, ['Administrador']);
  const empresa = await chamarCanal('empresa:get', {});
  return pdfModule.gerarPdf({
    parentWindow: mainWindow,
    empresa,
    dialogTitle: 'Salvar Relatório em PDF',
    defaultFileName: `${titulo.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')}.pdf`,
    title: titulo,
    subtitle: 'Relatório gerencial',
    innerHtml: pdfModule.buildRelatorioHtml({ periodoTexto, resumo, columns, rows }),
    footerSubtitulo: titulo,
  });
});

// ---------- COMPARTILHAMENTO (WhatsApp) ----------
// Observação técnica: o WhatsApp não oferece nenhuma forma de anexar automaticamente um
// arquivo local a uma mensagem via link (wa.me) — isso não é permitido pelo próprio WhatsApp,
// por segurança. O que este recurso faz é: (1) garantir que o PDF já foi salvo e revelar o
// arquivo na pasta, e (2) abrir a conversa do WhatsApp já com o número do cliente e uma
// mensagem pronta, para o usuário anexar o PDF manualmente (arrastando o arquivo).
ipcMain.handle('whatsapp:abrirConversa', async (evt, { telefone, mensagem }) => {
  let digits = String(telefone || '').replace(/\D/g, '');
  if (!digits) throw new Error('Este cliente não possui telefone/WhatsApp cadastrado.');
  if (digits.length <= 11) digits = '55' + digits; // assume Brasil quando não há DDI
  const url = `https://wa.me/${digits}${mensagem ? '?text=' + encodeURIComponent(mensagem) : ''}`;
  await shell.openExternal(url);
  reforcarFocoJanela();
  return { ok: true };
});

// ---------- TEMA ----------
// ---------- RELATÓRIOS ----------
ipcMain.handle('relatorios:os', async (evt, { atual, dataInicio, dataFim, status }) => {
  requirePapel(atual, ['Administrador']);
  let sql = `SELECT os.numero, c.nome as cliente, (eq.marca || ' ' || eq.modelo) as equipamento,
                    os.status, u.nome as tecnico, os.valor_mao_obra, os.valor_pecas, os.desconto,
                    os.valor_total, os.data_entrada, os.data_saida, os.garantia_dias
             FROM ordens_servico os
             LEFT JOIN clientes c ON c.id = os.cliente_id
             LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
             LEFT JOIN usuarios u ON u.id = os.tecnico_id
             WHERE date(os.data_entrada) BETWEEN date(?) AND date(?)`;
  const params = [dataInicio, dataFim];
  if (status) { sql += ` AND os.status = ?`; params.push(status); }
  sql += ` ORDER BY os.data_entrada DESC`;
  const rows = db.all(sql, params);
  const columns = [
    { header: 'Nº OS', key: 'numero' }, { header: 'Cliente', key: 'cliente' }, { header: 'Equipamento', key: 'equipamento' },
    { header: 'Status', key: 'status' }, { header: 'Técnico', key: 'tecnico' }, { header: 'Mão de Obra', key: 'valor_mao_obra' },
    { header: 'Peças', key: 'valor_pecas' }, { header: 'Desconto', key: 'desconto' }, { header: 'Total', key: 'valor_total' },
    { header: 'Entrada', key: 'data_entrada' }, { header: 'Saída', key: 'data_saida' }, { header: 'Garantia (dias)', key: 'garantia_dias' },
  ];
  const resumo = {
    'Quantidade de OS': rows.length,
    'Valor Total': rows.reduce((s, r) => s + (r.valor_total || 0), 0),
    'Ticket Médio': rows.length ? rows.reduce((s, r) => s + (r.valor_total || 0), 0) / rows.length : 0,
    'Entregues': rows.filter((r) => r.status === 'Entregue').length,
  };
  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:financeiro', async (evt, { atual, dataInicio, dataFim }) => {
  requirePapel(atual, ['Administrador']);
  const rows = db.all(
    `SELECT data_pagamento as data, tipo, categoria, descricao, valor, forma_pagamento, referencia
     FROM lancamentos_financeiros WHERE status='Pago' AND date(data_pagamento) BETWEEN date(?) AND date(?)
     ORDER BY data_pagamento DESC`,
    [dataInicio, dataFim]
  );
  const columns = [
    { header: 'Data', key: 'data' }, { header: 'Tipo', key: 'tipo' }, { header: 'Categoria', key: 'categoria' },
    { header: 'Descrição', key: 'descricao' }, { header: 'Valor', key: 'valor' }, { header: 'Forma de Pagamento', key: 'forma_pagamento' },
    { header: 'Referência', key: 'referencia' },
  ];
  const receitas = rows.filter((r) => r.tipo === 'receita').reduce((s, r) => s + r.valor, 0);
  const despesas = rows.filter((r) => r.tipo === 'despesa').reduce((s, r) => s + r.valor, 0);
  const resumo = { 'Total de Receitas': receitas, 'Total de Despesas': despesas, 'Saldo do Período': receitas - despesas };
  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:clientes', async (evt, { atual, dataInicio, dataFim }) => {
  requirePapel(atual, ['Administrador']);
  const rows = db.all(
    `SELECT c.nome as cliente, c.telefone, COUNT(os.id) as qtd_os, COALESCE(SUM(os.valor_total),0) as total_gasto
     FROM clientes c JOIN ordens_servico os ON os.cliente_id = c.id
     WHERE os.status = 'Entregue' AND date(os.data_saida) BETWEEN date(?) AND date(?)
     GROUP BY c.id ORDER BY total_gasto DESC`,
    [dataInicio, dataFim]
  );
  const novosClientes = db.get(`SELECT COUNT(*) c FROM clientes WHERE date(criado_em) BETWEEN date(?) AND date(?)`, [dataInicio, dataFim]);
  const columns = [
    { header: 'Cliente', key: 'cliente' }, { header: 'Telefone', key: 'telefone' },
    { header: 'Qtd. de OS', key: 'qtd_os' }, { header: 'Total Gasto', key: 'total_gasto' },
  ];
  const resumo = {
    'Clientes Atendidos': rows.length,
    'Novos Clientes no Período': novosClientes.c,
    'Total Faturado': rows.reduce((s, r) => s + r.total_gasto, 0),
  };
  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:vendas', async (evt, { atual, dataInicio, dataFim }) => {
  requirePapel(atual, ['Administrador']);
  const rows = db.all(
    `SELECT v.numero, v.criado_em as data, c.nome as cliente, v.itens, v.valor_itens, v.desconto, v.valor_total, v.forma_pagamento, v.status
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE date(v.criado_em) BETWEEN date(?) AND date(?)
     ORDER BY v.criado_em DESC`,
    [dataInicio, dataFim]
  );
  const columns = [
    { header: 'Venda', key: 'numero' }, { header: 'Data', key: 'data' }, { header: 'Cliente', key: 'cliente' },
    { header: 'Desconto', key: 'desconto' }, { header: 'Valor Total', key: 'valor_total' },
    { header: 'Forma de Pagamento', key: 'forma_pagamento' }, { header: 'Status', key: 'status' },
  ];
  const concluidas = rows.filter((r) => r.status !== 'Cancelada');
  const totalVendido = concluidas.reduce((s, r) => s + (r.valor_total || 0), 0);
  const resumo = {
    'Qtd. de Vendas': concluidas.length,
    'Total Vendido': totalVendido,
    'Ticket Médio': concluidas.length ? totalVendido / concluidas.length : 0,
  };
  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:metas', async (evt, { atual, dataInicio, dataFim } = {}) => {
  requirePapel(atual, ['Administrador']);
  const hoje = nowIso().slice(0, 10);
  const mesInicio = (dataInicio || hoje).slice(0, 7);
  const mesFim = (dataFim || hoje).slice(0, 7);

  // Monta a lista de meses entre mesInicio e mesFim (inclusive), na ordem cronológica
  const meses = [];
  let cursor = mesInicio;
  let guardaLoop = 0;
  while (cursor <= mesFim && guardaLoop < 240) {
    meses.push(cursor);
    const [ano, mesNum] = cursor.split('-').map((n) => parseInt(n, 10));
    cursor = new Date(ano, mesNum, 1).toISOString().slice(0, 7); // avança 1 mês
    guardaLoop++;
  }

  const rows = meses.map((mes) => {
    const m = calcularMetaMensal(mes);
    let status = 'Sem meta definida';
    if (m.metaLucro && m.metaLucro > 0) {
      if (m.statusRitmo === 'atingida') status = 'Meta atingida';
      else if (m.statusRitmo === 'nao_atingida') status = 'Meta não atingida';
      else if (m.statusRitmo === 'no_ritmo') status = 'No ritmo';
      else if (m.statusRitmo === 'atrasado') status = 'Abaixo do ritmo';
      else if (m.ehMesFuturo) status = 'Mês futuro (planejada)';
    }
    return {
      mes: mesLabelBackend(mes),
      valor_meta: m.metaLucro,
      valor_faturamento: m.receitas,
      valor_despesas: m.despesas,
      valor_lucro_realizado: m.lucroRealizado,
      percentual_atingido: m.percentualAlcancado != null ? `${m.percentualAlcancado.toFixed(1)}%` : '-',
      status,
    };
  });

  const columns = [
    { header: 'Mês', key: 'mes' }, { header: 'Meta de Lucro', key: 'valor_meta' },
    { header: 'Faturamento', key: 'valor_faturamento' }, { header: 'Despesas', key: 'valor_despesas' },
    { header: 'Lucro Realizado', key: 'valor_lucro_realizado' }, { header: '% Atingido', key: 'percentual_atingido' },
    { header: 'Status', key: 'status' },
  ];

  const mesesComMeta = rows.filter((r) => r.valor_meta != null && r.valor_meta > 0);
  const metasAtingidas = mesesComMeta.filter((r) => r.status === 'Meta atingida').length;
  const resumo = {
    'Meses com Meta Definida': mesesComMeta.length,
    'Metas Atingidas': metasAtingidas,
    'Meta Total do Período': mesesComMeta.reduce((s, r) => s + (r.valor_meta || 0), 0),
    'Lucro Total Realizado': rows.reduce((s, r) => s + (r.valor_lucro_realizado || 0), 0),
  };

  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:estoque', async (evt, { atual } = {}) => {
  requirePapel(atual, ['Administrador']);
  const rows = db.all(
    `SELECT p.nome, p.categoria, p.quantidade, p.estoque_minimo, p.valor_compra, p.valor_venda,
            (p.quantidade * p.valor_compra) as valor_em_estoque
     FROM produtos p WHERE p.ativo = 1 ORDER BY valor_em_estoque DESC`
  );
  const columns = [
    { header: 'Produto', key: 'nome' }, { header: 'Categoria', key: 'categoria' }, { header: 'Quantidade', key: 'quantidade' },
    { header: 'Estoque Mínimo', key: 'estoque_minimo' }, { header: 'Valor de Compra', key: 'valor_compra' },
    { header: 'Valor de Venda', key: 'valor_venda' }, { header: 'Valor em Estoque (custo)', key: 'valor_em_estoque' },
  ];
  const resumo = {
    'Itens Cadastrados': rows.length,
    'Valor Total em Estoque (custo)': rows.reduce((s, r) => s + r.valor_em_estoque, 0),
    'Valor Potencial de Venda': rows.reduce((s, r) => s + r.quantidade * r.valor_venda, 0),
    'Itens Abaixo do Mínimo': rows.filter((r) => r.quantidade <= r.estoque_minimo).length,
  };
  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:tecnicos', async (evt, { atual, dataInicio, dataFim }) => {
  requirePapel(atual, ['Administrador']);
  const rows = db.all(
    `SELECT COALESCE(u.nome, 'Sem técnico definido') as tecnico, COUNT(os.id) as qtd_os,
            COALESCE(SUM(os.valor_total),0) as valor_total
     FROM ordens_servico os LEFT JOIN usuarios u ON u.id = os.tecnico_id
     WHERE os.status = 'Entregue' AND date(os.data_saida) BETWEEN date(?) AND date(?)
     GROUP BY os.tecnico_id ORDER BY valor_total DESC`,
    [dataInicio, dataFim]
  );
  const columns = [
    { header: 'Técnico', key: 'tecnico' }, { header: 'Qtd. de OS Entregues', key: 'qtd_os' }, { header: 'Valor Total', key: 'valor_total' },
  ];
  const resumo = {
    'Técnicos com OS no Período': rows.length,
    'Quantidade de OS Entregues': rows.reduce((s, r) => s + r.qtd_os, 0),
  };
  return { columns, rows, resumo };
});

ipcMain.handle('relatorios:garantias', async (evt, { atual, apenasAtivas }) => {
  requirePapel(atual, ['Administrador']);
  const rowsOs = db.all(
    `SELECT 'OS' as origem, os.numero, c.nome as cliente, (eq.marca || ' ' || eq.modelo) as equipamento, os.data_saida,
            os.garantia_dias, date(os.data_saida, '+' || os.garantia_dias || ' days') as fim_garantia
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     WHERE os.status = 'Entregue' AND os.data_saida IS NOT NULL AND os.data_saida != ''`
  );
  const rowsVendas = db.all(
    `SELECT 'Venda' as origem, v.numero, c.nome as cliente, 'Venda de produto(s)' as equipamento, v.criado_em as data_saida,
            v.garantia_dias, date(v.criado_em, '+' || v.garantia_dias || ' days') as fim_garantia
     FROM vendas v
     LEFT JOIN clientes c ON c.id = v.cliente_id
     WHERE v.status = 'Concluída' AND v.criado_em IS NOT NULL AND v.criado_em != '' AND v.garantia_dias > 0`
  );
  const rows = [...rowsOs, ...rowsVendas].sort((a, b) => (a.fim_garantia < b.fim_garantia ? 1 : -1));
  const hoje = nowIso().slice(0, 10);
  rows.forEach((r) => { r.situacao = r.fim_garantia >= hoje ? 'Em garantia' : 'Expirada'; });
  const filtradas = apenasAtivas ? rows.filter((r) => r.situacao === 'Em garantia') : rows;
  const columns = [
    { header: 'Origem', key: 'origem' }, { header: 'Nº', key: 'numero' }, { header: 'Cliente', key: 'cliente' }, { header: 'Equipamento', key: 'equipamento' },
    { header: 'Data de Saída', key: 'data_saida' }, { header: 'Garantia (dias)', key: 'garantia_dias' },
    { header: 'Fim da Garantia', key: 'fim_garantia' }, { header: 'Situação', key: 'situacao' },
  ];
  const resumo = {
    'Em Garantia': rows.filter((r) => r.situacao === 'Em garantia').length,
    'Expiradas': rows.filter((r) => r.situacao === 'Expirada').length,
  };
  return { columns, rows: filtradas, resumo };
});

ipcMain.handle('relatorios:pecas', async (evt, { atual, dataInicio, dataFim }) => {
  requirePapel(atual, ['Administrador']);
  const rows = db.all(
    `SELECT p.nome as produto, p.categoria, SUM(m.quantidade) as qtd_utilizada,
            SUM(m.quantidade * p.valor_venda) as valor_total_venda, SUM(m.quantidade * p.valor_compra) as custo_total
     FROM movimentacoes_estoque m JOIN produtos p ON p.id = m.produto_id
     WHERE m.tipo = 'saida' AND m.motivo = 'Uso em Ordem de Serviço' AND date(m.criado_em) BETWEEN date(?) AND date(?)
     GROUP BY m.produto_id ORDER BY qtd_utilizada DESC`,
    [dataInicio, dataFim]
  );
  const columns = [
    { header: 'Produto', key: 'produto' }, { header: 'Categoria', key: 'categoria' }, { header: 'Qtd. Utilizada', key: 'qtd_utilizada' },
    { header: 'Custo Total', key: 'custo_total' }, { header: 'Valor Total (venda)', key: 'valor_total_venda' },
  ];
  const resumo = {
    'Itens Diferentes Utilizados': rows.length,
    'Unidades Utilizadas': rows.reduce((s, r) => s + r.qtd_utilizada, 0),
    'Custo Total das Peças': rows.reduce((s, r) => s + r.custo_total, 0),
  };
  return { columns, rows, resumo };
});

// ---------- EXPORTAÇÃO EXCEL ----------
// Exportação para Excel foi substituída por PDF profissional (ver pdf:exportarRelatorio).




// ---------- SEGURANÇA / REMOÇÃO DE VÍRUS (ADB) ----------
// Lista de pacotes que NUNCA podem ser desativados/desinstalados por essa
// ferramenta, mesmo que apareçam nos resultados por algum motivo. Isso é uma
// segunda trava de segurança além de já listarmos só apps de terceiros
// (adb.listarPacotesTerceiros usa "pm list packages -3", que já exclui apps
// de sistema).
const PACOTES_PROTEGIDOS = [
  'android',
  'com.android.systemui',
  'com.android.settings',
  'com.android.phone',
  'com.android.server.telecom',
  'com.google.android.gms',
  'com.google.android.gsf',
  'com.android.vending',
  'com.android.launcher',
  'com.android.launcher3',
];

function garantirPacoteNaoProtegido(pacote) {
  const alvo = String(pacote || '');
  const protegido = PACOTES_PROTEGIDOS.some((p) => alvo === p || alvo.startsWith(p + '.'));
  if (protegido) {
    throw new Error('Este pacote é protegido pelo sistema e não pode ser alterado por aqui.');
  }
}

ipcMain.handle('seguranca:registrar', async (evt, dados) => {
  db.insert(
    `INSERT INTO seguranca_acoes (dispositivo_serial, dispositivo_modelo, pacote, acao, nivel_risco, resultado, cliente_id, equipamento_id, usuario_id, usuario_nome, criado_em)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      dados.serial || null, dados.modelo || null, dados.pacote || null, dados.acao, dados.nivel || null, dados.resultado || null,
      dados.cliente_id || null, dados.equipamento_id || null, dados.usuario_id || null, dados.usuario_nome || 'Sistema', nowIso(),
    ]
  );
  return { ok: true };
});

// Grava o histórico de ações de segurança sempre no banco central (via rede, se este
// computador estiver em modo Cliente): a análise/limpeza do aparelho em si roda no
// PC onde o celular está conectado por USB, mas o registro deve ficar visível para
// todos os PCs da loja.
async function registrarAcaoSeguranca({ serial, modelo, pacote, acao, nivel, resultado, atual, cliente_id, equipamento_id }) {
  try {
    await chamarCanal('seguranca:registrar', {
      serial, modelo, pacote, acao, nivel, resultado,
      cliente_id, equipamento_id, usuario_id: atual?.id, usuario_nome: atual?.nome,
    });
  } catch (e) {
    console.error('[Segurança] Falha ao registrar ação no histórico:', e && e.message);
  }
}

ipcMain.handle('adb:disponivel', async () => {
  return adb.verificarAdbDisponivel();
});

ipcMain.handle('adb:dispositivos', async () => {
  return adb.listarDispositivos();
});

ipcMain.handle('adb:analisar', async (evt, { atual, serial, modelo, cliente_id, equipamento_id }) => {
  const resultado = await adb.analisarDispositivo(serial);
  registrarAcaoSeguranca({
    serial, modelo, pacote: null, acao: 'analise', nivel: null,
    resultado: `${resultado.length} apps analisados`, atual, cliente_id, equipamento_id,
  });
  return resultado;
});

ipcMain.handle('adb:pararApp', async (evt, { serial, pacote }) => {
  garantirPacoteNaoProtegido(pacote);
  return adb.pararApp(serial, pacote);
});

ipcMain.handle('adb:removerAdmin', async (evt, { atual, serial, modelo, pacote, componente, nivel, cliente_id, equipamento_id }) => {
  garantirPacoteNaoProtegido(pacote);
  const res = await adb.removerAdmin(serial, componente);
  registrarAcaoSeguranca({ serial, modelo, pacote, acao: 'remover_admin', nivel, resultado: res.ok ? 'sucesso' : res.erro, atual, cliente_id, equipamento_id });
  return res;
});

ipcMain.handle('adb:desativarPacote', async (evt, { atual, serial, modelo, pacote, nivel, cliente_id, equipamento_id }) => {
  garantirPacoteNaoProtegido(pacote);
  const res = await adb.desativarPacote(serial, pacote);
  registrarAcaoSeguranca({ serial, modelo, pacote, acao: 'desativar', nivel, resultado: res.ok ? 'sucesso' : res.erro, atual, cliente_id, equipamento_id });
  return res;
});

ipcMain.handle('adb:reativarPacote', async (evt, { atual, serial, modelo, pacote, cliente_id, equipamento_id }) => {
  garantirPacoteNaoProtegido(pacote);
  const res = await adb.reativarPacote(serial, pacote);
  registrarAcaoSeguranca({ serial, modelo, pacote, acao: 'reativar', nivel: null, resultado: res.ok ? 'sucesso' : res.erro, atual, cliente_id, equipamento_id });
  return res;
});

ipcMain.handle('adb:desinstalar', async (evt, { atual, serial, modelo, pacote, nivel, cliente_id, equipamento_id }) => {
  garantirPacoteNaoProtegido(pacote);
  // Segunda checagem: confirma que o pacote realmente está na lista de apps de
  // terceiros do aparelho antes de desinstalar (nunca confia só no que veio do front-end).
  const pacotesTerceiros = await adb.listarPacotesTerceiros(serial);
  if (!pacotesTerceiros.includes(pacote)) {
    throw new Error('Este pacote não foi encontrado como app de terceiros neste aparelho. Operação cancelada por segurança.');
  }
  await adb.pararApp(serial, pacote);
  const res = await adb.desinstalarPacote(serial, pacote);
  registrarAcaoSeguranca({ serial, modelo, pacote, acao: 'desinstalar', nivel, resultado: res.ok ? 'sucesso' : res.erro, atual, cliente_id, equipamento_id });
  return res;
});

// Formatação (restauração de fábrica) do aparelho inteiro. É a ação mais
// destrutiva desta tela — apaga TODOS os dados do cliente, não só um app —
// então exige que o técnico repita a confirmação exigida pelo front-end
// (frase de confirmação) antes de disparar o comando, além de sempre gravar
// no histórico de segurança, mesmo em caso de falha.
ipcMain.handle('adb:formatar', async (evt, { atual, serial, modelo, confirmacao, cliente_id, equipamento_id }) => {
  if (confirmacao !== 'FORMATAR') {
    throw new Error('Confirmação inválida. Digite FORMATAR para prosseguir com a restauração de fábrica.');
  }
  if (!serial) {
    throw new Error('Nenhum aparelho selecionado.');
  }
  const res = await adb.formatarDispositivo(serial);
  registrarAcaoSeguranca({
    serial, modelo, pacote: null, acao: 'formatar_aparelho', nivel: null,
    resultado: res.ok ? 'sucesso' : (res.erro || res.stderr || 'falha'),
    atual, cliente_id, equipamento_id,
  });
  return res;
});

ipcMain.handle('adb:historico', async (evt, { cliente_id, equipamento_id } = {}) => {
  let sql = `SELECT s.*, c.nome as cliente_nome FROM seguranca_acoes s LEFT JOIN clientes c ON c.id = s.cliente_id WHERE 1=1`;
  const params = [];
  if (cliente_id) { sql += ' AND s.cliente_id = ?'; params.push(cliente_id); }
  if (equipamento_id) { sql += ' AND s.equipamento_id = ?'; params.push(equipamento_id); }
  sql += ' ORDER BY s.id DESC LIMIT 200';
  return db.all(sql, params);
});

ipcMain.handle('app:getVersion', async () => app.getVersion());
