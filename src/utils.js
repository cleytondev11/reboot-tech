export function formatCurrency(v) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR');
}

export function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export function toInputDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 10);
}

export function maskCpfCnpj(value, tipo) {
  const digits = (value || '').replace(/\D/g, '');
  if (tipo === 'PJ') {
    return digits
      .slice(0, 14)
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  }
  return digits
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskPhone(value) {
  const digits = (value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{0,4})/, (m, a, b, c) => (c ? `(${a}) ${b}-${c}` : b ? `(${a}) ${b}` : `(${a}`));
  }
  return digits.replace(/(\d{2})(\d{5})(\d{0,4})/, (m, a, b, c) => (c ? `(${a}) ${b}-${c}` : `(${a}) ${b}`));
}

export function classNames(...arr) {
  return arr.filter(Boolean).join(' ');
}

export function statusClass(status) {
  return 'badge-' + String(status).replace(/[^a-zA-ZÀ-ÿ]/g, '');
}

// Indica se uma compra foi recebida dentro do prazo previsto ou não.
// - Ainda não recebida: "Aguardando"
// - Recebida mas sem data de previsão cadastrada: "Sem previsão"
// - Recebida até (ou antes d)a data prevista: "No prazo"
// - Recebida depois da data prevista: "Fora do prazo"
export function prazoEntregaInfo(dataPrevista, dataRecebimento) {
  if (!dataRecebimento) return { label: 'Aguardando', className: 'badge-Aguardando' };
  if (!dataPrevista) return { label: 'Sem previsão', className: 'badge-SemPrevisao' };
  const prevista = String(dataPrevista).slice(0, 10);
  const recebida = String(dataRecebimento).slice(0, 10);
  if (recebida <= prevista) return { label: 'No prazo', className: 'badge-NoPrazo' };
  return { label: 'Fora do prazo', className: 'badge-ForaDoPrazo' };
}

export const CHECKLIST_ITENS = [
  'Tela quebrada', 'Tela trincada', 'Display funcionando', 'Touch funcionando',
  'Tampa traseira', 'Carcaça', 'Botões', 'Câmeras', 'Alto-falante', 'Microfone',
  'Vibração', 'Face ID', 'Impressão Digital', 'Sensor', 'Bluetooth', 'Wi-Fi',
  'Rede móvel', 'Leitor de Chip', 'Carregamento', 'Bateria', 'Oxidação',
  'Equipamento liga', 'Equipamento desliga', 'Equipamento molhado', 'Equipamento já aberto',
];

export const PAPEIS = ['Administrador', 'Atendente', 'Tecnico', 'Financeiro'];

export const ORCAMENTO_STATUS = ['Pendente', 'Enviado', 'Aprovado', 'Recusado', 'Expirado', 'Convertido'];

export const COMPRA_STATUS = ['Pendente', 'Enviado', 'Recebido', 'Cancelado'];

export const CATEGORIAS_PRODUTO = ['Tela', 'Bateria', 'Conector de Carga', 'Placa', 'Câmera', 'Alto-falante', 'Carcaça', 'Botão', 'Cabo Flex', 'Acessório', 'Outro'];

export const FORMAS_PAGAMENTO = ['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Boleto', 'Transferência'];

export const ACESSORIOS_OPCOES = ['Capinha', 'Película', 'Cartão SIM', 'Cartão SD', 'Carregador', 'Fone de ouvido', 'Caixa/embalagem'];

export const TERMOS_ACEITE_ITENS = [
  'Se o celular entrar sem funcionamento na assistência, a assistência não se responsabiliza por qualquer dano, a não ser o serviço que foi executado (exemplos de dano: som não funcionando, chip, etc.).',
  'O cliente foi informado de que a assistência não se responsabiliza por dados armazenados no aparelho (fotos, contatos, arquivos), sendo recomendado backup prévio.',
  'O cliente autoriza a abertura do aparelho para diagnóstico técnico.',
  'O cliente está ciente de que aparelhos com sinais de oxidação/líquido podem apresentar defeitos ocultos não cobertos por garantia.',
  'O cliente foi informado sobre o prazo para retirada do aparelho após conclusão ou desistência do serviço.',
  'Peças e componentes substituídos ficam sob custódia da assistência, salvo solicitação em contrário.',
];

export const DECLARACAO_CONDICAO_APARELHO = 'O cliente declara estar ciente de que, caso o aparelho seja entregue à assistência técnica sem funcionamento total ou parcial, a assistência se responsabilizará exclusivamente pela execução do serviço contratado. Não nos responsabilizamos por defeitos, falhas ou funcionalidades que já apresentavam problemas antes da realização do serviço, bem como por itens não relacionados ao reparo solicitado. Exemplos incluem, mas não se limitam a: alto-falante (som), microfone, câmeras, leitor de chip (SIM), sinal de rede, Wi-Fi, Bluetooth, sensores, biometria, carregamento, touchscreen ou quaisquer outros componentes que já estivessem inoperantes ou apresentassem defeito no momento da entrada do aparelho. A responsabilidade da assistência técnica limita-se exclusivamente ao reparo descrito na ordem de serviço, não abrangendo defeitos preexistentes ou não relacionados ao serviço executado.';

export const CATEGORIAS_DESPESA = ['Aluguel', 'Água/Luz/Internet', 'Salários', 'Fornecedores', 'Peças/Estoque', 'Marketing', 'Manutenção', 'Impostos', 'Outros'];

export function monthInputValue() {
  return new Date().toISOString().slice(0, 7);
}

export function firstDayOfMonth() {
  return new Date().toISOString().slice(0, 7) + '-01';
}

const CURRENCY_HINTS = ['valor', 'total', 'custo', 'gasto', 'desconto', 'saldo', 'ticket', 'faturado'];
const DATE_HINTS = ['data', 'fim_garantia', 'criado_em'];

export function isCurrencyKey(key) {
  const k = key.toLowerCase();
  return CURRENCY_HINTS.some((h) => k.includes(h));
}

export function isDateKey(key) {
  const k = key.toLowerCase();
  return DATE_HINTS.some((h) => k.includes(h)) && !k.includes('validade');
}

// ---------- Entrada de números/valores monetários ----------
// input type="number" nativo do navegador bloqueia a vírgula decimal (padrão brasileiro)
// e pode alterar o valor sozinho ao rolar a página com o mouse sobre o campo. Por isso,
// campos de valor/quantidade usam type="text" + estas funções de sanitização/parse.

// Mantém apenas dígitos e UM separador decimal (vírgula ou ponto), permitindo digitação livre.
export function sanitizeDecimalInput(raw) {
  if (raw === null || raw === undefined) return '';
  let v = String(raw).replace(/[^0-9.,]/g, '');
  const firstSep = v.search(/[.,]/);
  if (firstSep !== -1) {
    const before = v.slice(0, firstSep + 1);
    const after = v.slice(firstSep + 1).replace(/[.,]/g, '');
    v = before + after;
  }
  return v;
}

// Converte string digitada (com vírgula OU ponto) em número float, sem travar em valores parciais.
export function parseDecimal(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const n = parseFloat(String(raw).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Mantém apenas dígitos, para campos de quantidade/dias inteiros.
export function sanitizeIntegerInput(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).replace(/[^0-9]/g, '');
}

export function parseIntSafe(raw) {
  if (raw === '' || raw === null || raw === undefined) return 0;
  const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}
