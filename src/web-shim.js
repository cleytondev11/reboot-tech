// ---------- MODO WEB/NUVEM: window.api via HTTP, em vez do Electron ----------
// Quando este app roda dentro do Electron, o preload.cjs já expõe "window.api"
// antes desta página carregar — nesse caso não fazemos nada aqui. Quando o app
// roda direto num navegador (versão web/celular), este arquivo cria um
// "window.api" equivalente, só que cada chamada vira uma requisição HTTP para o
// backend na nuvem, autenticada por token (JWT), em vez de IPC do Electron.
//
// Isso permite que TODAS as telas (src/pages/*.jsx) continuem exatamente iguais,
// sem saber (nem precisar saber) se estão rodando no programa instalado ou no
// navegador — elas só usam "window.api.xxx.yyy(...)" normalmente.
(function () {
  if (typeof window === 'undefined' || window.api) return; // já roda no Electron

  const API_URL = (import.meta.env && import.meta.env.VITE_API_URL) || 'http://localhost:3000';
  const TOKEN_KEY = 'rt-token';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); }

  async function invoke(canal, payload) {
    let resposta;
    try {
      resposta = await fetch(`${API_URL}/api/rpc/${encodeURIComponent(canal)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify(payload || {}),
      });
    } catch (e) {
      throw new Error('Não foi possível falar com o servidor. Verifique sua conexão com a internet.');
    }
    if (resposta.status === 401) {
      setToken(null);
      localStorage.removeItem('rt-user');
      // Força o app a voltar para a tela de login.
      window.dispatchEvent(new CustomEvent('rt-sessao-expirada'));
    }
    let corpo;
    try { corpo = await resposta.json(); } catch (e) { throw new Error(`Resposta inválida do servidor (HTTP ${resposta.status}).`); }
    if (!corpo.ok) throw new Error(corpo.error || 'Erro desconhecido no servidor.');
    return corpo.data;
  }

  // Recursos que dependem do computador local (arquivos, USB, impressora) não têm
  // equivalente no navegador — cada função abaixo explica isso de forma amigável
  // em vez de simplesmente falhar sem explicação.
  function indisponivelNoNavegador(mensagem) {
    return async () => { throw new Error(mensagem || 'Este recurso só está disponível no programa instalado no computador.'); };
  }

  window.api = {
    auth: {
      login: async (usuario, senha) => {
        const resposta = await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ usuario, senha }),
        });
        const corpo = await resposta.json();
        if (corpo.ok) {
          setToken(corpo.token);
          localStorage.setItem('rt-user', JSON.stringify(corpo.user));
        }
        return corpo; // { ok, user } ou { ok:false, error }
      },
      // Só existe na versão web: permite restaurar a sessão ao recarregar a página,
      // sem precisar fazer login de novo enquanto o token continuar válido.
      sessaoSalva: async () => {
        const token = getToken();
        const userRaw = localStorage.getItem('rt-user');
        if (!token || !userRaw) return null;
        try { return JSON.parse(userRaw); } catch (e) { return null; }
      },
      sair: async () => {
        setToken(null);
        localStorage.removeItem('rt-user');
        return { ok: true };
      },
    },
    seguranca: {
      adbDisponivel: indisponivelNoNavegador('A Remoção de Vírus (análise via cabo USB) só está disponível no programa instalado no computador.'),
      listarDispositivos: indisponivelNoNavegador(),
      analisar: indisponivelNoNavegador(),
      pararApp: indisponivelNoNavegador(),
      removerAdmin: indisponivelNoNavegador(),
      desativarPacote: indisponivelNoNavegador(),
      reativarPacote: indisponivelNoNavegador(),
      desinstalar: indisponivelNoNavegador(),
      formatar: indisponivelNoNavegador(),
      historico: (cliente_id, equipamento_id) => invoke('adb:historico', { cliente_id, equipamento_id }),
    },
    usuarios: {
      list: () => invoke('usuarios:list'),
      create: (atual, nome, usuario, senha, papel) => invoke('usuarios:create', { nome, usuario, senha, papel }),
      update: (atual, id, nome, usuario, papel) => invoke('usuarios:update', { id, nome, usuario, papel }),
      delete: (atual, id) => invoke('usuarios:delete', { id }),
      toggleAtivo: (atual, id, ativo) => invoke('usuarios:toggleAtivo', { id, ativo }),
      changePassword: (atual, id, novaSenha) => invoke('usuarios:changePassword', { id, novaSenha }),
    },
    clientes: {
      list: (termo) => invoke('clientes:list', { termo }),
      get: (id) => invoke('clientes:get', { id }),
      save: (atual, cliente) => invoke('clientes:save', { cliente }),
      delete: (atual, id) => invoke('clientes:delete', { id }),
      historico: (id) => invoke('clientes:historico', { id }),
    },
    equipamentos: {
      listByCliente: (cliente_id) => invoke('equipamentos:listByCliente', { cliente_id }),
      list: (termo) => invoke('equipamentos:list', { termo }),
      get: (id) => invoke('equipamentos:get', { id }),
      save: (atual, equipamento) => invoke('equipamentos:save', { equipamento }),
      delete: (atual, id) => invoke('equipamentos:delete', { id }),
    },
    os: {
      statusList: () => invoke('os:statusList'),
      list: (termo, status) => invoke('os:list', { termo, status }),
      get: (id) => invoke('os:get', { id }),
      save: (atual, os) => invoke('os:save', { os }),
      setStatus: (atual, id, status) => invoke('os:setStatus', { id, status }),
      delete: (atual, id) => invoke('os:delete', { id }),
    },
    fornecedores: {
      list: (termo) => invoke('fornecedores:list', { termo }),
      save: (atual, fornecedor) => invoke('fornecedores:save', { fornecedor }),
    },
    produtos: {
      list: (termo, apenasBaixo) => invoke('produtos:list', { termo, apenasBaixo }),
      get: (id) => invoke('produtos:get', { id }),
      save: (atual, produto) => invoke('produtos:save', { produto }),
      delete: (atual, id) => invoke('produtos:delete', { id }),
      movimentar: (atual, produto_id, tipo, quantidade, motivo) => invoke('produtos:movimentar', { produto_id, tipo, quantidade, motivo }),
      movimentacoes: (produto_id) => invoke('produtos:movimentacoes', { produto_id }),
    },
    orcamentos: {
      list: (termo, status) => invoke('orcamentos:list', { termo, status }),
      get: (id) => invoke('orcamentos:get', { id }),
      save: (atual, orcamento) => invoke('orcamentos:save', { orcamento }),
      setStatus: (atual, id, status) => invoke('orcamentos:setStatus', { id, status }),
      duplicar: (atual, id) => invoke('orcamentos:duplicar', { id }),
      converterEmOs: (atual, id) => invoke('orcamentos:converterEmOs', { id }),
      delete: (atual, id) => invoke('orcamentos:delete', { id }),
    },
    compras: {
      list: (termo, status) => invoke('compras:list', { termo, status }),
      get: (id) => invoke('compras:get', { id }),
      save: (atual, compra) => invoke('compras:save', { compra }),
      setStatus: (atual, id, status) => invoke('compras:setStatus', { id, status }),
      delete: (atual, id) => invoke('compras:delete', { id }),
    },
    servicos: {
      list: (termo) => invoke('servicos:list', { termo }),
      save: (atual, servico) => invoke('servicos:save', { servico }),
      delete: (atual, id) => invoke('servicos:delete', { id }),
    },
    vendas: {
      list: (termo) => invoke('vendas:list', { termo }),
      get: (id) => invoke('vendas:get', { id }),
      save: (atual, venda) => invoke('vendas:save', { venda }),
      delete: (atual, id) => invoke('vendas:delete', { id }),
    },
    whatsapp: {
      // No navegador não existe app do WhatsApp Desktop pra "abrir" — usamos o
      // link universal wa.me, que abre o WhatsApp Web ou o app do celular.
      abrirConversa: async (telefone, mensagem) => {
        const numero = String(telefone || '').replace(/\D/g, '');
        const url = `https://wa.me/${numero}${mensagem ? '?text=' + encodeURIComponent(mensagem) : ''}`;
        window.open(url, '_blank');
        return { ok: true };
      },
    },
    dashboard: {
      resumo: () => invoke('dashboard:resumo'),
    },
    financas: {
      metaMensal: (mes) => invoke('financas:metaMensal', { mes }),
      definirMeta: (atual, mes, meta_lucro) => invoke('financas:definirMeta', { mes, meta_lucro }),
      metasFuturas: (quantidadeMeses) => invoke('financas:metasFuturas', { quantidadeMeses }),
    },
    financeiro: {
      list: (tipo, status, termo) => invoke('financeiro:list', { tipo, status, termo }),
      save: (atual, lancamento) => invoke('financeiro:save', { lancamento }),
      marcarPago: (atual, id, forma_pagamento, data_pagamento) => invoke('financeiro:marcarPago', { id, forma_pagamento, data_pagamento }),
      cancelar: (atual, id) => invoke('financeiro:cancelar', { id }),
      delete: (atual, id) => invoke('financeiro:delete', { id }),
      dre: (mes) => invoke('financeiro:dre', { mes }),
    },
    caixa: {
      atual: () => invoke('caixa:atual'),
      historico: (limit) => invoke('caixa:historico', { limit }),
      abrir: (atual, valor_abertura, observacoes) => invoke('caixa:abrir', { valor_abertura, observacoes }),
      movimentar: (atual, tipo, valor, forma_pagamento, descricao) => invoke('caixa:movimentar', { tipo, valor, forma_pagamento, descricao }),
      fechar: (atual, valor_fechamento_informado, observacoes) => invoke('caixa:fechar', { valor_fechamento_informado, observacoes }),
      excluir: (atual, id) => invoke('caixa:excluir', { id }),
    },
    logs: {
      list: (limit) => invoke('logs:list', { limit }),
    },
    backup: {
      manual: indisponivelNoNavegador('O backup do banco de dados é feito automaticamente pelo Turso (nuvem). Este botão só existe no programa instalado.'),
    },
    pdf: {
      exportarOS: indisponivelNoNavegador('Exportar PDF ainda só está disponível no programa instalado no computador.'),
      exportarChecklist: indisponivelNoNavegador(),
      exportarGarantia: indisponivelNoNavegador(),
      exportarOrcamento: indisponivelNoNavegador(),
      exportarComprovante: indisponivelNoNavegador(),
      exportarVendaGarantia: indisponivelNoNavegador(),
      exportarVendaRecibo: indisponivelNoNavegador(),
      exportarRelatorio: indisponivelNoNavegador(),
    },
    empresa: {
      get: () => invoke('empresa:get'),
      save: (atual, empresa) => invoke('empresa:save', { empresa }),
    },
    relatorios: {
      os: (atual, dataInicio, dataFim, status) => invoke('relatorios:os', { dataInicio, dataFim, status }),
      financeiro: (atual, dataInicio, dataFim) => invoke('relatorios:financeiro', { dataInicio, dataFim }),
      clientes: (atual, dataInicio, dataFim) => invoke('relatorios:clientes', { dataInicio, dataFim }),
      vendas: (atual, dataInicio, dataFim) => invoke('relatorios:vendas', { dataInicio, dataFim }),
      metas: (atual, dataInicio, dataFim) => invoke('relatorios:metas', { dataInicio, dataFim }),
      estoque: (atual) => invoke('relatorios:estoque', {}),
      tecnicos: (atual, dataInicio, dataFim) => invoke('relatorios:tecnicos', { dataInicio, dataFim }),
      garantias: (atual, apenasAtivas) => invoke('relatorios:garantias', { apenasAtivas }),
      pecas: (atual, dataInicio, dataFim) => invoke('relatorios:pecas', { dataInicio, dataFim }),
    },
    app: {
      getVersion: async () => 'Web',
    },
    // Rede Multi-PC e Impressora Térmica são recursos do programa instalado
    // (dependem do computador físico) — no navegador, simplesmente não existem.
    rede: {
      status: async () => ({ modo: 'standalone', ipsLocais: [], servidorAtivo: false }),
      ipsLocais: async () => [],
      configurar: indisponivelNoNavegador(),
      testarConexao: indisponivelNoNavegador(),
    },
    impressora: {
      listar: async () => [],
      configuracao: async () => ({}),
      salvarConfiguracao: indisponivelNoNavegador(),
      imprimirCupomVenda: indisponivelNoNavegador('Impressão térmica só está disponível no programa instalado no computador.'),
      imprimirCupomOS: indisponivelNoNavegador('Impressão térmica só está disponível no programa instalado no computador.'),
      testar: indisponivelNoNavegador(),
    },
  };

  // A "licença" do app desktop não se aplica à versão web (o controle de acesso
  // aqui é simplesmente o login) — sempre reporta "ativa" pra não bloquear a tela.
  window.api.licenca = {
    status: async () => ({ estado: 'ativa' }),
    verificarAgora: async () => ({ estado: 'ativa' }),
    ativar: async () => ({ ok: true }),
  };

  // Se o servidor responder 401 (token expirado/ausente) em qualquer chamada,
  // volta para a tela de login limpando o usuário salvo.
  window.addEventListener('rt-sessao-expirada', () => {
    window.location.reload();
  });
})();
