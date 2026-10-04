const { contextBridge, ipcRenderer } = require('electron');

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload);
}

contextBridge.exposeInMainWorld('api', {
  licenca: {
    status: () => invoke('licenca:status'),
    verificarAgora: () => invoke('licenca:verificarAgora'),
    ativar: (chave) => invoke('licenca:ativar', { chave }),
  },
  auth: {
    login: (usuario, senha) => invoke('auth:login', { usuario, senha }),
    // Só relevante no Modo Nuvem: dispara quando uma chamada qualquer volta com
    // "sessão expirada" (token vencido), pra a tela poder voltar ao login sozinha.
    onSessaoNuvemExpirada: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('sessao-nuvem-expirada', listener);
      return () => ipcRenderer.removeListener('sessao-nuvem-expirada', listener);
    },
  },
  usuarios: {
    list: () => invoke('usuarios:list'),
    create: (atual, nome, usuario, senha, papel) => invoke('usuarios:create', { atual, nome, usuario, senha, papel }),
    update: (atual, id, nome, usuario, papel) => invoke('usuarios:update', { atual, id, nome, usuario, papel }),
    delete: (atual, id) => invoke('usuarios:delete', { atual, id }),
    toggleAtivo: (atual, id, ativo) => invoke('usuarios:toggleAtivo', { atual, id, ativo }),
    changePassword: (atual, id, novaSenha) => invoke('usuarios:changePassword', { atual, id, novaSenha }),
  },
  clientes: {
    list: (termo) => invoke('clientes:list', { termo }),
    get: (id) => invoke('clientes:get', { id }),
    save: (atual, cliente) => invoke('clientes:save', { atual, cliente }),
    delete: (atual, id) => invoke('clientes:delete', { atual, id }),
    historico: (id) => invoke('clientes:historico', { id }),
  },
  equipamentos: {
    listByCliente: (cliente_id) => invoke('equipamentos:listByCliente', { cliente_id }),
    list: (termo) => invoke('equipamentos:list', { termo }),
    get: (id) => invoke('equipamentos:get', { id }),
    save: (atual, equipamento) => invoke('equipamentos:save', { atual, equipamento }),
    delete: (atual, id) => invoke('equipamentos:delete', { atual, id }),
  },
  os: {
    statusList: () => invoke('os:statusList'),
    list: (termo, status) => invoke('os:list', { termo, status }),
    get: (id) => invoke('os:get', { id }),
    save: (atual, os) => invoke('os:save', { atual, os }),
    setStatus: (atual, id, status, pagamento) => invoke('os:setStatus', { atual, id, status, pagamento }),
    delete: (atual, id) => invoke('os:delete', { atual, id }),
  },
  fornecedores: {
    list: (termo) => invoke('fornecedores:list', { termo }),
    save: (atual, fornecedor) => invoke('fornecedores:save', { atual, fornecedor }),
  },
  produtos: {
    list: (termo, apenasBaixo) => invoke('produtos:list', { termo, apenasBaixo }),
    get: (id) => invoke('produtos:get', { id }),
    save: (atual, produto) => invoke('produtos:save', { atual, produto }),
    delete: (atual, id) => invoke('produtos:delete', { atual, id }),
    movimentar: (atual, produto_id, tipo, quantidade, motivo) => invoke('produtos:movimentar', { atual, produto_id, tipo, quantidade, motivo }),
    movimentacoes: (produto_id) => invoke('produtos:movimentacoes', { produto_id }),
  },
  orcamentos: {
    list: (termo, status) => invoke('orcamentos:list', { termo, status }),
    get: (id) => invoke('orcamentos:get', { id }),
    save: (atual, orcamento) => invoke('orcamentos:save', { atual, orcamento }),
    setStatus: (atual, id, status) => invoke('orcamentos:setStatus', { atual, id, status }),
    duplicar: (atual, id) => invoke('orcamentos:duplicar', { atual, id }),
    converterEmOs: (atual, id) => invoke('orcamentos:converterEmOs', { atual, id }),
    delete: (atual, id) => invoke('orcamentos:delete', { atual, id }),
  },
  compras: {
    list: (termo, status) => invoke('compras:list', { termo, status }),
    get: (id) => invoke('compras:get', { id }),
    save: (atual, compra) => invoke('compras:save', { atual, compra }),
    setStatus: (atual, id, status) => invoke('compras:setStatus', { atual, id, status }),
    delete: (atual, id) => invoke('compras:delete', { atual, id }),
  },
  servicos: {
    list: (termo) => invoke('servicos:list', { termo }),
    save: (atual, servico) => invoke('servicos:save', { atual, servico }),
    delete: (atual, id) => invoke('servicos:delete', { atual, id }),
  },
  vendas: {
    list: (termo) => invoke('vendas:list', { termo }),
    get: (id) => invoke('vendas:get', { id }),
    save: (atual, venda) => invoke('vendas:save', { atual, venda }),
    delete: (atual, id) => invoke('vendas:delete', { atual, id }),
  },
  whatsapp: {
    abrirConversa: (telefone, mensagem) => invoke('whatsapp:abrirConversa', { telefone, mensagem }),
  },
  dashboard: {
    resumo: () => invoke('dashboard:resumo'),
  },
  financas: {
    metaMensal: (mes) => invoke('financas:metaMensal', { mes }),
    definirMeta: (atual, mes, meta_lucro) => invoke('financas:definirMeta', { atual, mes, meta_lucro }),
    metasFuturas: (quantidadeMeses) => invoke('financas:metasFuturas', { quantidadeMeses }),
  },
  financeiro: {
    list: (tipo, status, termo) => invoke('financeiro:list', { tipo, status, termo }),
    save: (atual, lancamento) => invoke('financeiro:save', { atual, lancamento }),
    marcarPago: (atual, id, forma_pagamento, data_pagamento) => invoke('financeiro:marcarPago', { atual, id, forma_pagamento, data_pagamento }),
    cancelar: (atual, id) => invoke('financeiro:cancelar', { atual, id }),
    registrarCobranca: (id) => invoke('financeiro:registrarCobranca', { id }),
    reprogramar: (id, data_vencimento) => invoke('financeiro:reprogramar', { id, data_vencimento }),
    delete: (atual, id) => invoke('financeiro:delete', { atual, id }),
    dre: (mes) => invoke('financeiro:dre', { mes }),
  },
  caixa: {
    atual: () => invoke('caixa:atual'),
    historico: (limit) => invoke('caixa:historico', { limit }),
    abrir: (atual, valor_abertura, observacoes) => invoke('caixa:abrir', { atual, valor_abertura, observacoes }),
    movimentar: (atual, tipo, valor, forma_pagamento, descricao) => invoke('caixa:movimentar', { atual, tipo, valor, forma_pagamento, descricao }),
    fechar: (atual, valor_fechamento_informado, observacoes) => invoke('caixa:fechar', { atual, valor_fechamento_informado, observacoes }),
    excluir: (atual, id) => invoke('caixa:excluir', { atual, id }),
  },
  logs: {
    list: (limit) => invoke('logs:list', { limit }),
  },
  backup: {
    manual: () => invoke('backup:manual'),
  },
  pdf: {
    exportarOS: (id) => invoke('pdf:exportarOS', { id }),
    exportarChecklist: (id) => invoke('pdf:exportarChecklist', { id }),
    exportarGarantia: (id) => invoke('pdf:exportarGarantia', { id }),
    exportarOrcamento: (id) => invoke('pdf:exportarOrcamento', { id }),
    exportarComprovante: (id) => invoke('pdf:exportarComprovante', { id }),
    exportarVendaGarantia: (id) => invoke('pdf:exportarVendaGarantia', { id }),
    exportarVendaRecibo: (id) => invoke('pdf:exportarVendaRecibo', { id }),
    exportarRelatorio: (atual, titulo, periodoTexto, resumo, columns, rows) => invoke('pdf:exportarRelatorio', { atual, titulo, periodoTexto, resumo, columns, rows }),
  },
  empresa: {
    get: () => invoke('empresa:get'),
    save: (atual, empresa) => invoke('empresa:save', { atual, empresa }),
  },
  relatorios: {
    os: (atual, dataInicio, dataFim, status) => invoke('relatorios:os', { atual, dataInicio, dataFim, status }),
    financeiro: (atual, dataInicio, dataFim) => invoke('relatorios:financeiro', { atual, dataInicio, dataFim }),
    clientes: (atual, dataInicio, dataFim) => invoke('relatorios:clientes', { atual, dataInicio, dataFim }),
    vendas: (atual, dataInicio, dataFim) => invoke('relatorios:vendas', { atual, dataInicio, dataFim }),
    metas: (atual, dataInicio, dataFim) => invoke('relatorios:metas', { atual, dataInicio, dataFim }),
    estoque: (atual) => invoke('relatorios:estoque', { atual }),
    tecnicos: (atual, dataInicio, dataFim) => invoke('relatorios:tecnicos', { atual, dataInicio, dataFim }),
    garantias: (atual, apenasAtivas) => invoke('relatorios:garantias', { atual, apenasAtivas }),
    pecas: (atual, dataInicio, dataFim) => invoke('relatorios:pecas', { atual, dataInicio, dataFim }),
  },
  app: {
    getVersion: () => invoke('app:getVersion'),
  },
  rede: {
    status: () => invoke('rede:status'),
    ipsLocais: () => invoke('rede:ipsLocais'),
    configurar: (atual, modo, servidor_ip, porta, chave_rede, servidor_url) => invoke('rede:configurar', { atual, modo, servidor_ip, porta, chave_rede, servidor_url }),
    testarConexao: (servidor_ip, porta, chave_rede, servidor_url) => invoke('rede:testarConexao', { servidor_ip, porta, chave_rede, servidor_url }),
    sairNuvem: () => invoke('rede:sairNuvem'),
  },
  impressora: {
    listar: () => invoke('impressora:listar'),
    configuracao: () => invoke('impressora:configuracao'),
    salvarConfiguracao: (atual, impressora_padrao, largura_papel, copias, formato) => invoke('impressora:salvarConfiguracao', { atual, impressora_padrao, largura_papel, copias, formato }),
    imprimirCupomVenda: (id, formato) => invoke('impressora:imprimirCupomVenda', { id, formato }),
    imprimirCupomOS: (id, formato) => invoke('impressora:imprimirCupomOS', { id, formato }),
    testar: (nomeImpressora, largura_papel, formato) => invoke('impressora:testar', { nomeImpressora, largura_papel, formato }),
  },
});
