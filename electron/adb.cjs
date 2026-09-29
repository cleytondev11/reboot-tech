const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================================
// LOCALIZAÇÃO DO ADB (Android Debug Bridge)
// ----------------------------------------------------------------------------
// 1º tenta usar um adb "empacotado junto" do app (pasta resources/platform-tools
//    ao lado do executável — veja ADB-SETUP.md para como obter o platform-tools
//    oficial do Google e colocar nessa pasta).
// 2º tenta usar o "adb" já instalado no PATH do sistema.
// ============================================================================
function localizarAdb() {
  const nomeExe = process.platform === 'win32' ? 'adb.exe' : 'adb';

  const candidatos = [
    path.join(process.resourcesPath || '', 'platform-tools', nomeExe),
    path.join(__dirname, '..', 'platform-tools', nomeExe),
    path.join(__dirname, '..', 'resources', 'platform-tools', nomeExe),
  ];

  for (const c of candidatos) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch (e) { /* ignora */ }
  }

  // Sem caminho empacotado: assume que "adb" está no PATH do sistema.
  return nomeExe;
}

const ADB_PATH = localizarAdb();
const TIMEOUT_MS = 15000;

function rodar(args) {
  return new Promise((resolve) => {
    execFile(ADB_PATH, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, erro: error.code === 'ENOENT' ? 'adb_nao_encontrado' : String(error.message || error), stdout: stdout || '', stderr: stderr || '' });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

function rodarShell(serial, comandoShell) {
  return rodar(['-s', serial, 'shell', ...comandoShell]);
}

async function verificarAdbDisponivel() {
  const res = await rodar(['version']);
  if (!res.ok) {
    return { disponivel: false, motivo: res.erro };
  }
  return { disponivel: true };
}

// Lista os dispositivos conectados (adb devices -l)
async function listarDispositivos() {
  const res = await rodar(['devices', '-l']);
  if (!res.ok) return [];
  const linhas = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const dispositivos = [];
  for (const linha of linhas) {
    if (linha.startsWith('List of devices')) continue;
    const partes = linha.split(/\s+/);
    if (partes.length < 2) continue;
    const serial = partes[0];
    const status = partes[1]; // device, unauthorized, offline
    const modeloMatch = linha.match(/model:(\S+)/);
    dispositivos.push({ serial, status, modelo: modeloMatch ? modeloMatch[1].replace(/_/g, ' ') : null });
  }
  return dispositivos;
}

// Lista pacotes de terceiros (apps instalados pelo usuário — nunca inclui apps
// de sistema, que ficam de fora por segurança).
async function listarPacotesTerceiros(serial) {
  const res = await rodarShell(serial, ['pm', 'list', 'packages', '-3']);
  if (!res.ok) return [];
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'))
    .map((l) => l.replace('package:', '').trim())
    .filter(Boolean);
}

// Componentes com privilégio de administrador do dispositivo (Device Admin) —
// mecanismo clássico usado por apps maliciosos para dificultar a remoção.
async function listarAdminsAtivos(serial) {
  const res = await rodarShell(serial, ['dumpsys', 'device_policy']);
  if (!res.ok) return [];
  const componentes = new Set();
  const regex = /([a-zA-Z0-9_.]+\/[a-zA-Z0-9_.$]+)/g;
  const blocoAdmins = res.stdout.split(/Admin list|Active admins/i)[1] || res.stdout;
  let m;
  while ((m = regex.exec(blocoAdmins)) !== null) {
    componentes.add(m[1]);
  }
  return Array.from(componentes);
}

// Serviços de acessibilidade habilitados — outro mecanismo comum de spyware.
async function listarAcessibilidadeAtiva(serial) {
  const res = await rodarShell(serial, ['settings', 'get', 'secure', 'enabled_accessibility_services']);
  if (!res.ok) return [];
  const valor = res.stdout.trim();
  if (!valor || valor === 'null') return [];
  return valor.split(':').map((s) => s.trim()).filter(Boolean);
}

const PERMISSOES_RISCO = [
  'SYSTEM_ALERT_WINDOW',
  'BIND_ACCESSIBILITY_SERVICE',
  'BIND_DEVICE_ADMIN',
  'RECEIVE_SMS',
  'READ_SMS',
  'SEND_SMS',
  'BIND_NOTIFICATION_LISTENER_SERVICE',
  'REQUEST_INSTALL_PACKAGES',
  'QUERY_ALL_PACKAGES',
  'PACKAGE_USAGE_STATS',
];

// Detalhes de um pacote específico: permissões concedidas, se aparece no
// launcher (ícone visível) e data de instalação.
async function obterDetalhesPacote(serial, pacote) {
  const res = await rodarShell(serial, ['dumpsys', 'package', pacote]);
  const detalhes = {
    pacote,
    firstInstallTime: null,
    versionName: null,
    permissoesRisco: [],
    temLauncher: false,
  };
  if (!res.ok) return detalhes;

  const texto = res.stdout;

  const instMatch = texto.match(/firstInstallTime=([^\n]+)/);
  if (instMatch) detalhes.firstInstallTime = instMatch[1].trim();

  const verMatch = texto.match(/versionName=([^\n]+)/);
  if (verMatch) detalhes.versionName = verMatch[1].trim();

  for (const perm of PERMISSOES_RISCO) {
    if (texto.includes(perm)) detalhes.permissoesRisco.push(perm);
  }

  // Verifica se existe uma activity de launcher (ícone na tela inicial)
  const launcherRes = await rodarShell(serial, [
    'cmd', 'package', 'query-activities',
    '--brief', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER',
  ]);
  if (launcherRes.ok && launcherRes.stdout.includes(pacote)) {
    detalhes.temLauncher = true;
  }

  return detalhes;
}

// Nomes de pacote com "cara" de gerado automaticamente (padrão comum em
// famílias de adware/malware que trocam de nome a cada variante).
function pareceNomeSuspeito(pacote) {
  const partes = pacote.split('.');
  const ultima = partes[partes.length - 1] || '';
  if (/^[a-z]{6,}[0-9]{2,}$/i.test(ultima)) return true;
  if (/^[a-z0-9]{8,}$/i.test(ultima) && !/[aeiou]/i.test(ultima)) return true;
  return false;
}

// Calcula uma pontuação de risco heurística (NÃO é uma verificação de
// assinatura de vírus — é um conjunto de sinais de comportamento suspeito
// para orientar a análise do técnico).
function calcularRisco({ pacote, temAdmin, temAcessibilidade, temLauncher, permissoesRisco }) {
  let score = 0;
  if (temAdmin) score += 3;
  if (temAcessibilidade) score += 3;
  if (!temLauncher) score += 2;
  score += Math.min(permissoesRisco.length, 3);
  if (pareceNomeSuspeito(pacote)) score += 1;

  let nivel = 'Normal';
  if (score >= 5) nivel = 'AltoRisco';
  else if (score >= 2) nivel = 'Suspeito';

  return { score, nivel };
}

// Executa a análise completa de um dispositivo: lista apps de terceiros,
// cruza com admins ativos e acessibilidade, e devolve tudo já com a
// pontuação de risco calculada, ordenado do mais suspeito para o menos.
async function analisarDispositivo(serial) {
  const [pacotes, admins, acessibilidade] = await Promise.all([
    listarPacotesTerceiros(serial),
    listarAdminsAtivos(serial),
    listarAcessibilidadeAtiva(serial),
  ]);

  const resultado = [];
  for (const pacote of pacotes) {
    const detalhes = await obterDetalhesPacote(serial, pacote);
    const temAdmin = admins.some((a) => a.startsWith(pacote + '/'));
    const temAcessibilidade = acessibilidade.some((a) => a.startsWith(pacote + '/'));
    const { score, nivel } = calcularRisco({
      pacote,
      temAdmin,
      temAcessibilidade,
      temLauncher: detalhes.temLauncher,
      permissoesRisco: detalhes.permissoesRisco,
    });

    resultado.push({
      ...detalhes,
      temAdmin,
      componenteAdmin: temAdmin ? admins.find((a) => a.startsWith(pacote + '/')) : null,
      temAcessibilidade,
      score,
      nivel,
    });
  }

  resultado.sort((a, b) => b.score - a.score);
  return resultado;
}

async function pararApp(serial, pacote) {
  return rodarShell(serial, ['am', 'force-stop', pacote]);
}

async function removerAdmin(serial, componente) {
  return rodarShell(serial, ['dpm', 'remove-active-admin', componente]);
}

async function desativarPacote(serial, pacote) {
  return rodarShell(serial, ['pm', 'disable-user', '--user', '0', pacote]);
}

async function reativarPacote(serial, pacote) {
  return rodarShell(serial, ['pm', 'enable', pacote]);
}

async function desinstalarPacote(serial, pacote) {
  return rodarShell(serial, ['pm', 'uninstall', '--user', '0', pacote]);
}

// Restauração de fábrica (formatação) do aparelho inteiro via broadcast do
// sistema Android. Ação IRREVERSÍVEL — apaga todos os dados do usuário.
// Em alguns aparelhos (principalmente com MDM/Device Admin ativo ou ROMs
// de fabricante com restrições, ex.: MIUI/One UI mais recentes) esse
// broadcast pode ser bloqueado; nesse caso é preciso formatar manualmente
// pelo menu de recovery do aparelho.
async function formatarDispositivo(serial) {
  return rodarShell(serial, ['am', 'broadcast', '-a', 'android.intent.action.MASTER_CLEAR']);
}

module.exports = {
  verificarAdbDisponivel,
  listarDispositivos,
  listarPacotesTerceiros,
  analisarDispositivo,
  pararApp,
  removerAdmin,
  desativarPacote,
  reativarPacote,
  desinstalarPacote,
  formatarDispositivo,
  ADB_PATH,
};
