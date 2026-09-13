// ---------- HANDLERS DE DADOS (versão nuvem) ----------
// Cada função aqui espelha, propositalmente, a lógica que já existe nos handlers
// do app desktop (electron/main.cjs), só que com chamadas assíncronas ao banco
// (Turso) e usando o usuário autenticado pelo token JWT (req.usuario) em vez do
// campo "atual" enviado pelo app — isso evita que alguém finja ser Administrador
// manipulando o corpo da requisição.
//
// Todos os módulos de dados (usuários, clientes, equipamentos, ordens de serviço,
// orçamentos, compras, estoque, serviços, vendas, financeiro, caixa e relatórios)
// já estão portados aqui. PDF, impressão térmica, backup local, rede multi-PC e
// remoção de vírus (ADB) continuam sendo recursos exclusivos do app desktop, pois
// dependem de arquivos/USB/impressora/rede local do próprio computador.
const bcrypt = require('bcryptjs');
const { requirePapel } = require('./auth');

function nowIso() {
  return new Date().toISOString();
}

async function log(db, req, acao, entidade, entidade_id, detalhes) {
  const usuario = req.usuario;
  await db.insert(
    `INSERT INTO logs (usuario_id, usuario_nome, acao, entidade, entidade_id, detalhes, criado_em) VALUES (?,?,?,?,?,?,?)`,
    [usuario?.id || null, usuario?.nome || 'Sistema', acao, entidade, entidade_id || null, detalhes || '', nowIso()]
  );
}

async function caixaAberto(db) {
  return db.get(`SELECT * FROM caixa_sessoes WHERE status = 'Aberto' ORDER BY id DESC LIMIT 1`);
}

const STATUS_LIST = [
  'Recebido', 'Em análise', 'Aguardando orçamento', 'Orçamento enviado',
  'Aguardando aprovação', 'Aguardando peça', 'Em manutenção', 'Teste',
  'Pronto', 'Entregue', 'Cancelado',
];

async function nextOsNumero(db) {
  const row = await db.get(`SELECT numero FROM ordens_servico ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'OS-' + String(n).padStart(6, '0');
}

function calcularTotal(o) {
  const mao = parseFloat(o.valor_mao_obra) || 0;
  const pecas = parseFloat(o.valor_pecas) || 0;
  const desc = parseFloat(o.desconto) || 0;
  return Math.max(0, mao + pecas - desc);
}

async function baixarEstoqueDaOs(db, req, osId, osNumero, itensPecas) {
  for (const item of (itensPecas || [])) {
    if (!item.produto_id || !item.quantidade) continue;
    const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
    if (!produto) continue;
    const novaQtd = (produto.quantidade || 0) - parseFloat(item.quantidade);
    await db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
    await db.insert(
      `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
      [produto.id, 'saida', item.quantidade, 'Uso em Ordem de Serviço', osNumero, req.usuario?.id, req.usuario?.nome, nowIso()]
    );
  }
}

async function lancarFinanceiroDaOs(db, req, osId, osNumero, valorTotal, formaPagamento) {
  const hoje = nowIso().slice(0, 10);
  await db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['receita', 'Serviços (OS)', `Recebimento da ${osNumero}`, valorTotal, formaPagamento, 'Pago', hoje, hoje, osNumero, osId, '', 1, req.usuario?.id, req.usuario?.nome, nowIso()]
  );
  if (formaPagamento === 'Dinheiro') {
    const sessao = await caixaAberto(db);
    if (sessao) {
      await db.insert(
        `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
        [sessao.id, 'entrada', valorTotal, formaPagamento, `Recebimento da ${osNumero}`, osNumero, req.usuario?.id, req.usuario?.nome, nowIso()]
      );
    }
  }
}

async function calcularCustoPecas(db, itensPecas, valorPecasManual) {
  const itens = (itensPecas || []).filter((i) => i.produto_id);
  if (itens.length > 0) {
    let total = 0;
    for (const it of itens) {
      const produto = await db.get('SELECT valor_compra FROM produtos WHERE id = ?', [it.produto_id]);
      total += (produto?.valor_compra || 0) * (parseFloat(it.quantidade) || 0);
    }
    return total;
  }
  return parseFloat(valorPecasManual) || 0;
}

async function lancarReceberDaOs(db, req, osId, osNumero, valorTotal, previsaoOuHoje) {
  if (!valorTotal || valorTotal <= 0) return;
  const vencimento = previsaoOuHoje || nowIso().slice(0, 10);
  await db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['receita', 'Serviços (OS)', `A receber — ${osNumero} (pronta para retirada)`, valorTotal, '', 'Pendente', vencimento, null, osNumero, osId, 'Lançado automaticamente quando a OS ficou com status "Pronto".', 1, req.usuario?.id, req.usuario?.nome, nowIso()]
  );
}

async function baixarOuLancarRecebimentoDaOs(db, req, osId, osNumero, valorTotal, formaPagamento) {
  const pendente = await db.get(
    `SELECT * FROM lancamentos_financeiros WHERE os_id = ? AND tipo = 'receita' AND status = 'Pendente' AND origem_automatica = 1 ORDER BY id DESC LIMIT 1`,
    [osId]
  );
  const hoje = nowIso().slice(0, 10);
  if (pendente) {
    await db.run(
      `UPDATE lancamentos_financeiros SET status='Pago', forma_pagamento=?, valor=?, data_pagamento=?, descricao=?, atualizado_em=? WHERE id=?`,
      [formaPagamento, valorTotal, hoje, `Recebimento da ${osNumero}`, nowIso(), pendente.id]
    );
    if (formaPagamento === 'Dinheiro') {
      const sessao = await caixaAberto(db);
      if (sessao) {
        await db.insert(
          `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
          [sessao.id, 'entrada', valorTotal, formaPagamento, `Recebimento da ${osNumero}`, osNumero, req.usuario?.id, req.usuario?.nome, nowIso()]
        );
      }
    }
  } else {
    await lancarFinanceiroDaOs(db, req, osId, osNumero, valorTotal, formaPagamento);
  }
}

async function lancarDespesaPecasDaOs(db, req, osId, osNumero, itensPecas, valorPecasManual, dataReferencia) {
  const valor = await calcularCustoPecas(db, itensPecas, valorPecasManual);
  if (!valor || valor <= 0) return;
  const data = dataReferencia || nowIso().slice(0, 10);
  await db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['despesa', 'Peças/Estoque', `Custo de peças da ${osNumero}`, valor, '', 'Pago', data, data, osNumero, osId, 'Lançado automaticamente com base no custo das peças utilizadas nesta OS.', 1, req.usuario?.id, req.usuario?.nome, nowIso()]
  );
}

// ---------- COMPRAS: helpers ----------
async function nextCompraNumero(db) {
  const row = await db.get(`SELECT numero FROM compras ORDER BY id DESC LIMIT 1`);
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

async function processarEnvioCompra(db, req, compra) {
  const hoje = nowIso().slice(0, 10);
  if (!compra.despesa_lancada && compra.valor_total > 0) {
    await db.insert(
      `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['despesa', 'Fornecedores', `Compra enviada — ${compra.numero}`, compra.valor_total, '', 'Pendente', compra.data_prevista || hoje, null, compra.numero, null, 'Lançado automaticamente ao marcar o pedido de compra como "Enviado".', 1, req.usuario?.id, req.usuario?.nome, nowIso()]
    );
  }
  await db.run(`UPDATE compras SET despesa_lancada = 1, atualizado_em = ? WHERE id = ?`, [nowIso(), compra.id]);
}

async function processarRecebimentoCompra(db, req, compra) {
  let itens = [];
  try { itens = JSON.parse(compra.itens || '[]'); } catch { itens = []; }
  const hoje = nowIso().slice(0, 10);

  if (!compra.estoque_lancado) {
    for (const item of itens) {
      if (!item.produto_id || !item.quantidade) continue;
      const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
      if (!produto) continue;
      const novaQtd = (produto.quantidade || 0) + parseFloat(item.quantidade);
      await db.run('UPDATE produtos SET quantidade = ?, valor_compra = ?, atualizado_em = ? WHERE id = ?',
        [novaQtd, parseFloat(item.valor_unit) || produto.valor_compra, nowIso(), produto.id]);
      await db.insert(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
        [produto.id, 'entrada', item.quantidade, 'Recebimento de compra', compra.numero, req.usuario?.id, req.usuario?.nome, nowIso()]
      );
    }
  }

  if (!compra.despesa_lancada && compra.valor_total > 0) {
    await db.insert(
      `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ['despesa', 'Fornecedores', `Compra recebida — ${compra.numero}`, compra.valor_total, '', 'Pendente', compra.data_prevista || hoje, null, compra.numero, null, 'Lançado automaticamente ao marcar o pedido de compra como "Recebido" (sem passar por "Enviado").', 1, req.usuario?.id, req.usuario?.nome, nowIso()]
    );
  }

  await db.run(`UPDATE compras SET estoque_lancado = 1, despesa_lancada = 1, data_recebimento = ?, atualizado_em = ? WHERE id = ?`,
    [hoje, nowIso(), compra.id]);
}

// ---------- VENDAS: helpers ----------
async function nextVendaNumero(db) {
  const row = await db.get(`SELECT numero FROM vendas ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'VD-' + String(n).padStart(6, '0');
}

async function reverterEfeitosVenda(db, req, vendaAntiga) {
  let itensAntigos = [];
  try { itensAntigos = JSON.parse(vendaAntiga.itens || '[]'); } catch { itensAntigos = []; }
  for (const item of itensAntigos) {
    if (!item.produto_id || !item.quantidade) continue;
    const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
    if (!produto) continue;
    const novaQtd = (produto.quantidade || 0) + parseFloat(item.quantidade);
    await db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
    await db.insert(
      `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
      [produto.id, 'entrada', item.quantidade, 'Estorno por edição/exclusão de venda', vendaAntiga.numero, req.usuario?.id, req.usuario?.nome, nowIso()]
    );
  }
  await db.run(`DELETE FROM lancamentos_financeiros WHERE referencia = ? AND origem_automatica = 1`, [vendaAntiga.numero]);
}

// ---------- ORÇAMENTOS: helpers ----------
async function nextOrcamentoNumero(db) {
  const row = await db.get(`SELECT numero FROM orcamentos ORDER BY id DESC LIMIT 1`);
  let n = 1;
  if (row && row.numero) {
    const m = String(row.numero).match(/(\d+)/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return 'ORC-' + String(n).padStart(6, '0');
}

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
  const servicos = parseFloat(o.valor_servicos) || 0;
  const desc = parseFloat(o.desconto) || 0;
  return Math.max(0, totalItens + servicos - desc);
}

// ---------- METAS FINANCEIRAS: helpers ----------
async function somaMes(db, tipo, mesAlvo) {
  const row = await db.get(
    `SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo=? AND status='Pago' AND substr(data_pagamento,1,7) = ?`,
    [tipo, mesAlvo]
  );
  return row.v;
}

function mesAnterior(mesAlvo) {
  const [ano, mesNum] = mesAlvo.split('-').map((n) => parseInt(n, 10));
  const d = new Date(ano, mesNum - 2, 1);
  return d.toISOString().slice(0, 7);
}

function variacaoPercentual(atual, anterior) {
  if (!anterior) return atual > 0 ? 100 : 0;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

function mesLabelBackend(mes) {
  const [ano, mesNum] = mes.split('-').map((v) => parseInt(v, 10));
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[mesNum - 1]} / ${ano}`;
}

async function calcularMetaMensal(db, mes) {
  const hoje = nowIso().slice(0, 10);
  const mesHoje = hoje.slice(0, 7);
  const mesAlvo = mes || mesHoje;
  const ehMesAtual = mesAlvo === mesHoje;
  const ehMesFuturo = mesAlvo > mesHoje;
  const ehMesPassado = mesAlvo < mesHoje;

  const receitasV = await somaMes(db, 'receita', mesAlvo);
  const despesasV = await somaMes(db, 'despesa', mesAlvo);
  const lucroRealizado = receitasV - despesasV;

  const mesAnt = mesAnterior(mesAlvo);
  const receitasAnt = await somaMes(db, 'receita', mesAnt);
  const despesasAnt = await somaMes(db, 'despesa', mesAnt);
  const lucroAnt = receitasAnt - despesasAnt;

  const metaRow = await db.get('SELECT * FROM metas_financeiras WHERE mes = ?', [mesAlvo]);
  const metaLucro = metaRow ? metaRow.meta_lucro : null;

  const [ano, mesNum] = mesAlvo.split('-').map((n) => parseInt(n, 10));
  const diasNoMes = new Date(ano, mesNum, 0).getDate();
  const diaAtual = ehMesAtual ? parseInt(hoje.slice(8, 10), 10) : (ehMesPassado ? diasNoMes : 0);
  const diasRestantes = Math.max(0, diasNoMes - diaAtual);

  let percentualAlcancado = null;
  let ritmoEsperadoHoje = null;
  let statusRitmo = null;
  let faltaAtingir = null;
  let mediaDiariaNecessaria = null;

  if (metaLucro && metaLucro > 0) {
    percentualAlcancado = (lucroRealizado / metaLucro) * 100;
    faltaAtingir = Math.max(0, metaLucro - lucroRealizado);
    if (ehMesFuturo) {
      statusRitmo = null;
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

  const projecaoLucro = (ehMesAtual && diaAtual > 0) ? (lucroRealizado / diaAtual) * diasNoMes : null;

  const diasParaEvoluir = ehMesFuturo ? 0 : diaAtual;
  const evolucaoDiaria = [];
  if (diasParaEvoluir > 0) {
    let acumulado = 0;
    for (let d = 1; d <= diasParaEvoluir; d++) {
      const diaIso = `${mesAlvo}-${String(d).padStart(2, '0')}`;
      const rec = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND data_pagamento = ?`, [diaIso]);
      const desp = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pago' AND data_pagamento = ?`, [diaIso]);
      acumulado += (rec.v - desp.v);
      evolucaoDiaria.push({ dia: d, valor: acumulado });
    }
  }

  const osEntregues = await db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status='Entregue' AND substr(data_saida,1,7) = ?`, [mesAlvo]);
  const vendasConcluidas = await db.get(`SELECT COUNT(*) c FROM vendas WHERE status != 'Cancelada' AND substr(criado_em,1,7) = ?`, [mesAlvo]);
  const servicosRealizados = (osEntregues.c || 0) + (vendasConcluidas.c || 0);
  const osEntreguesAnt = await db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status='Entregue' AND substr(data_saida,1,7) = ?`, [mesAnt]);
  const vendasConcluidasAnt = await db.get(`SELECT COUNT(*) c FROM vendas WHERE status != 'Cancelada' AND substr(criado_em,1,7) = ?`, [mesAnt]);
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


const handlers = {
  // ---------- USUÁRIOS ----------
  'usuarios:list': async (db) => db.all('SELECT id, nome, usuario, papel, ativo, criado_em FROM usuarios ORDER BY nome'),

  'usuarios:create': async (db, { nome, usuario, senha, papel }, req) => {
    requirePapel(req, ['Administrador']);
    const hash = bcrypt.hashSync(senha, 10);
    const id = await db.insert(
      `INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
      [nome, usuario, hash, papel, 1, nowIso()]
    );
    await log(db, req, 'CRIAR', 'usuarios', id, nome);
    return { ok: true, id };
  },

  'usuarios:toggleAtivo': async (db, { id, ativo }, req) => {
    requirePapel(req, ['Administrador']);
    await db.run('UPDATE usuarios SET ativo = ? WHERE id = ?', [ativo ? 1 : 0, id]);
    await log(db, req, ativo ? 'ATIVAR' : 'DESATIVAR', 'usuarios', id, '');
    return { ok: true };
  },

  'usuarios:update': async (db, { id, nome, usuario, papel }, req) => {
    requirePapel(req, ['Administrador']);
    const existente = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (!existente) throw new Error('Usuário não encontrado.');
    if (!nome || !nome.trim()) throw new Error('Informe o nome do usuário.');
    if (!usuario || !usuario.trim()) throw new Error('Informe o login do usuário.');
    const conflito = await db.get('SELECT id FROM usuarios WHERE usuario = ? AND id != ?', [usuario, id]);
    if (conflito) throw new Error('Já existe outro usuário com esse login.');
    await db.run('UPDATE usuarios SET nome = ?, usuario = ?, papel = ? WHERE id = ?', [nome, usuario, papel, id]);
    await log(db, req, 'EDITAR', 'usuarios', id, nome);
    return { ok: true };
  },

  'usuarios:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    if (req.usuario?.id === id) throw new Error('Você não pode excluir o seu próprio usuário.');
    const existente = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (!existente) throw new Error('Usuário não encontrado.');
    if (existente.papel === 'Administrador') {
      const outrosAdmins = await db.get(`SELECT COUNT(*) c FROM usuarios WHERE papel = 'Administrador' AND ativo = 1 AND id != ?`, [id]);
      if (outrosAdmins.c === 0) throw new Error('Não é possível excluir o único Administrador ativo do sistema.');
    }
    await db.run('DELETE FROM usuarios WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'usuarios', id, existente.nome);
    return { ok: true };
  },

  'usuarios:changePassword': async (db, { id, novaSenha }, req) => {
    requirePapel(req, ['Administrador']);
    if (!novaSenha || String(novaSenha).length < 4) throw new Error('A nova senha deve ter pelo menos 4 caracteres.');
    const usuario = await db.get('SELECT * FROM usuarios WHERE id = ?', [id]);
    if (!usuario) throw new Error('Usuário não encontrado.');
    const hash = bcrypt.hashSync(novaSenha, 10);
    await db.run('UPDATE usuarios SET senha_hash = ? WHERE id = ?', [hash, id]);
    await log(db, req, 'ALTERAR_SENHA', 'usuarios', id, `Senha alterada por ${req.usuario.nome}`);
    return { ok: true };
  },

  // ---------- CLIENTES ----------
  'clientes:list': async (db, { termo } = {}) => {
    if (termo) {
      const like = `%${termo}%`;
      return db.all(
        `SELECT * FROM clientes WHERE nome LIKE ? OR cpf_cnpj LIKE ? OR telefone LIKE ? OR whatsapp LIKE ? OR email LIKE ? ORDER BY nome`,
        [like, like, like, like, like]
      );
    }
    return db.all('SELECT * FROM clientes ORDER BY nome');
  },

  'clientes:get': async (db, { id }) => db.get('SELECT * FROM clientes WHERE id = ?', [id]),

  'clientes:save': async (db, { cliente }, req) => {
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
      await db.run(
        `UPDATE clientes SET tipo=?, nome=?, cpf_cnpj=?, rg_ie=?, telefone=?, whatsapp=?, email=?, cep=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, observacoes=?, data_nascimento=?, atualizado_em=? WHERE id=?`,
        [c.tipo, c.nome, c.cpf_cnpj, c.rg_ie, c.telefone, c.whatsapp, c.email, c.cep, c.endereco, c.numero, c.bairro, c.cidade, c.uf, c.observacoes, c.data_nascimento, nowIso(), c.id]
      );
      await log(db, req, 'EDITAR', 'clientes', c.id, c.nome);
      return { ok: true, id: c.id };
    }
    const id = await db.insert(
      `INSERT INTO clientes (tipo, nome, cpf_cnpj, rg_ie, telefone, whatsapp, email, cep, endereco, numero, bairro, cidade, uf, observacoes, data_nascimento, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [c.tipo, c.nome, c.cpf_cnpj, c.rg_ie, c.telefone, c.whatsapp, c.email, c.cep, c.endereco, c.numero, c.bairro, c.cidade, c.uf, c.observacoes, c.data_nascimento, nowIso()]
    );
    await log(db, req, 'CRIAR', 'clientes', id, c.nome);
    return { ok: true, id };
  },

  'clientes:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const usados = await db.get('SELECT COUNT(*) as c FROM equipamentos WHERE cliente_id = ?', [id]);
    if (usados.c > 0) throw new Error('Cliente possui equipamentos cadastrados e não pode ser excluído.');
    await db.run('DELETE FROM clientes WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'clientes', id, '');
    return { ok: true };
  },

  'clientes:historico': async (db, { id }) => db.all(
    `SELECT os.*, eq.marca, eq.modelo FROM ordens_servico os
     LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     WHERE os.cliente_id = ? ORDER BY os.criado_em DESC`,
    [id]
  ),

  // ---------- EQUIPAMENTOS ----------
  'equipamentos:listByCliente': async (db, { cliente_id }) => db.all('SELECT * FROM equipamentos WHERE cliente_id = ? ORDER BY id DESC', [cliente_id]),

  'equipamentos:list': async (db, { termo } = {}) => {
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
    return db.all(`SELECT eq.*, c.nome as cliente_nome FROM equipamentos eq LEFT JOIN clientes c ON c.id = eq.cliente_id ORDER BY eq.id DESC`);
  },

  'equipamentos:get': async (db, { id }) => db.get('SELECT * FROM equipamentos WHERE id = ?', [id]),

  'equipamentos:save': async (db, { equipamento }, req) => {
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
      await db.run(
        `UPDATE equipamentos SET cliente_id=?, marca=?, modelo=?, imei=?, numero_serie=?, cor=?, senha_desbloqueio=?, capacidade=?, operadora=?, estado_conservacao=?, acessorios=?, fotos=? WHERE id=?`,
        [e.cliente_id, e.marca, e.modelo, e.imei, e.numero_serie, e.cor, e.senha_desbloqueio, e.capacidade, e.operadora, e.estado_conservacao, e.acessorios, e.fotos, e.id]
      );
      await log(db, req, 'EDITAR', 'equipamentos', e.id, `${e.marca} ${e.modelo}`);
      return { ok: true, id: e.id };
    }
    const id = await db.insert(
      `INSERT INTO equipamentos (cliente_id, marca, modelo, imei, numero_serie, cor, senha_desbloqueio, capacidade, operadora, estado_conservacao, acessorios, fotos, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [e.cliente_id, e.marca, e.modelo, e.imei, e.numero_serie, e.cor, e.senha_desbloqueio, e.capacidade, e.operadora, e.estado_conservacao, e.acessorios, e.fotos, nowIso()]
    );
    await log(db, req, 'CRIAR', 'equipamentos', id, `${e.marca} ${e.modelo}`);
    return { ok: true, id };
  },

  'equipamentos:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const equipamento = await db.get('SELECT * FROM equipamentos WHERE id = ?', [id]);
    if (!equipamento) throw new Error('Equipamento não encontrado.');
    const usadoOs = await db.get('SELECT COUNT(*) as c FROM ordens_servico WHERE equipamento_id = ?', [id]);
    if (usadoOs.c > 0) throw new Error('Este equipamento possui Ordens de Serviço vinculadas e não pode ser excluído.');
    const usadoOrc = await db.get('SELECT COUNT(*) as c FROM orcamentos WHERE equipamento_id = ?', [id]);
    if (usadoOrc.c > 0) throw new Error('Este equipamento possui Orçamentos vinculados e não pode ser excluído.');
    await db.run('DELETE FROM equipamentos WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'equipamentos', id, `${equipamento.marca} ${equipamento.modelo}`);
    return { ok: true };
  },

  // ---------- EMPRESA ----------
  'empresa:get': async (db) => (await db.get('SELECT * FROM configuracoes_empresa WHERE id = 1')) || {},

  'empresa:save': async (db, { empresa }, req) => {
    const e = empresa;
    await db.run(
      `UPDATE configuracoes_empresa SET nome=?, nome_fantasia=?, logo=?, cnpj=?, ie=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=?, telefone=?, whatsapp=?, email=?, site=?, redes_sociais=?, atualizado_em=? WHERE id=1`,
      [e.nome, e.nome_fantasia, e.logo, e.cnpj, e.ie, e.endereco, e.numero, e.bairro, e.cidade, e.uf, e.cep, e.telefone, e.whatsapp, e.email, e.site, e.redes_sociais, nowIso()]
    );
    await log(db, req, 'EDITAR', 'configuracoes_empresa', 1, 'Dados da empresa atualizados');
    return { ok: true };
  },

  // ---------- LOGS ----------
  'logs:list': async (db, { limit } = {}) => db.all('SELECT * FROM logs ORDER BY id DESC LIMIT ?', [limit || 200]),

  // ---------- DASHBOARD ----------
  'dashboard:resumo': async (db) => {
    const abertas = await db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status NOT IN ('Entregue','Cancelado')`);
    const aguardandoPeca = await db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status = 'Aguardando peça'`);
    const prontos = await db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status = 'Pronto'`);
    const hoje = nowIso().slice(0, 10);
    const mesAtual = hoje.slice(0, 7);
    const entreguesHoje = await db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status='Entregue' AND substr(data_saida,1,10) = ?`, [hoje]);
    const totalClientes = await db.get('SELECT COUNT(*) c FROM clientes');
    const estoqueBaixo = await db.get(`SELECT COUNT(*) c FROM produtos WHERE ativo = 1 AND quantidade <= estoque_minimo`);
    const faturamentoDia = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,10) = ?`, [hoje]);
    const faturamentoMes = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,7) = ?`, [mesAtual]);
    const despesasMes = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pago' AND substr(data_pagamento,1,7) = ?`, [mesAtual]);
    const contasAPagar = await db.get(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) c FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pendente'`);
    const contasAReceber = await db.get(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) c FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pendente'`);
    const sessao = await caixaAberto(db);
    const ultimasOs = await db.all(
      `SELECT os.numero, os.status, os.criado_em, c.nome as cliente_nome FROM ordens_servico os
       LEFT JOIN clientes c ON c.id = os.cliente_id ORDER BY os.id DESC LIMIT 8`
    );
    const porStatus = await db.all(`SELECT status, COUNT(*) as qtd FROM ordens_servico GROUP BY status`);

    const estoqueBaixoList = await db.all(
      `SELECT id, nome, quantidade, estoque_minimo, categoria FROM produtos WHERE ativo = 1 AND quantidade <= estoque_minimo ORDER BY (quantidade - estoque_minimo) ASC LIMIT 30`
    );

    const mesNum = hoje.slice(5, 7);
    const diaAtual = parseInt(hoje.slice(8, 10), 10);
    const aniversariantesRaw = await db.all(
      `SELECT id, nome, telefone, whatsapp, data_nascimento FROM clientes
       WHERE data_nascimento IS NOT NULL AND data_nascimento != '' AND substr(data_nascimento, 6, 2) = ?
       ORDER BY substr(data_nascimento, 9, 2) ASC`,
      [mesNum]
    );
    const aniversariantesMes = aniversariantesRaw.map((c) => ({
      ...c,
      dia: parseInt(c.data_nascimento.slice(8, 10), 10),
      jaPassou: parseInt(c.data_nascimento.slice(8, 10), 10) < diaAtual,
    }));

    const faturamentoSemana = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const diaIso = d.toISOString().slice(0, 10);
      const row = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,10) = ?`, [diaIso]);
      faturamentoSemana.push({ label: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''), data: diaIso, valor: row.v });
    }

    const faturamentoMensal = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const mesIso = d.toISOString().slice(0, 7);
      const row = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,7) = ?`, [mesIso]);
      faturamentoMensal.push({ label: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''), data: mesIso, valor: row.v });
    }
    const faturamentoAno = await db.get(`SELECT COALESCE(SUM(valor),0) v FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,4) = ?`, [hoje.slice(0, 4)]);

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
  },

  // ---------- ORDENS DE SERVIÇO ----------
  'os:statusList': async () => STATUS_LIST,

  'os:list': async (db, { termo, status } = {}) => {
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
  },

  'os:get': async (db, { id }) => db.get(
    `SELECT os.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp, c.cpf_cnpj as cliente_cpf_cnpj,
            eq.marca as equip_marca, eq.modelo as equip_modelo, eq.imei as equip_imei, u.nome as tecnico_nome
     FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id
     LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     LEFT JOIN usuarios u ON u.id = os.tecnico_id
     WHERE os.id = ?`,
    [id]
  ),

  'os:save': async (db, { os }, req) => {
    const o = os;
    o.valor_total = calcularTotal(o);
    const checklist = JSON.stringify(o.checklist || []);
    const itensPecas = JSON.stringify(o.itens_pecas || []);
    const termosAceite = JSON.stringify(o.termos_aceite || []);
    const checklistAcessorios = JSON.stringify(o.checklist_acessorios || []);
    const temPecas = (o.itens_pecas || []).length > 0 || parseFloat(o.valor_pecas) > 0;
    if (o.id) {
      const before = await db.get('SELECT status, estoque_baixado, numero, financeiro_lancado, despesa_pecas_lancada, financeiro_receber_lancado FROM ordens_servico WHERE id = ?', [o.id]);
      await db.run(
        `UPDATE ordens_servico SET cliente_id=?, equipamento_id=?, defeito_informado=?, diagnostico=?, servicos_executados=?, pecas_utilizadas=?, valor_mao_obra=?, valor_pecas=?, desconto=?, valor_total=?, garantia_dias=?, data_entrada=?, previsao=?, data_saida=?, status=?, observacoes=?, assinatura_cliente=?, checklist=?, itens_pecas=?, forma_pagamento=?, tecnico_id=?, termos_aceite=?, senha_tipo=?, senha_valor=?, checklist_acessorios=?, atualizado_em=? WHERE id=?`,
        [o.cliente_id, o.equipamento_id, o.defeito_informado, o.diagnostico, o.servicos_executados, o.pecas_utilizadas, o.valor_mao_obra, o.valor_pecas, o.desconto, o.valor_total, o.garantia_dias, o.data_entrada, o.previsao, o.data_saida, o.status, o.observacoes, o.assinatura_cliente, checklist, itensPecas, o.forma_pagamento || null, o.tecnico_id || null, termosAceite, o.senha_tipo || null, o.senha_valor || null, checklistAcessorios, nowIso(), o.id]
      );
      if (!before?.estoque_baixado && (o.itens_pecas || []).length > 0) {
        await baixarEstoqueDaOs(db, req, o.id, before?.numero, o.itens_pecas);
        await db.run('UPDATE ordens_servico SET estoque_baixado = 1 WHERE id = ?', [o.id]);
      }
      if (!before?.despesa_pecas_lancada && temPecas) {
        await lancarDespesaPecasDaOs(db, req, o.id, before?.numero, o.itens_pecas, o.valor_pecas, o.data_entrada);
        await db.run('UPDATE ordens_servico SET despesa_pecas_lancada = 1 WHERE id = ?', [o.id]);
      }
      if (!before?.financeiro_receber_lancado && o.status === 'Pronto' && !before?.financeiro_lancado) {
        await lancarReceberDaOs(db, req, o.id, before?.numero, o.valor_total, o.previsao);
        await db.run('UPDATE ordens_servico SET financeiro_receber_lancado = 1 WHERE id = ?', [o.id]);
      }
      if (!before?.financeiro_lancado && o.status === 'Entregue' && o.forma_pagamento) {
        await baixarOuLancarRecebimentoDaOs(db, req, o.id, before?.numero, o.valor_total, o.forma_pagamento);
        await db.run('UPDATE ordens_servico SET financeiro_lancado = 1 WHERE id = ?', [o.id]);
      }
      if (before && before.status !== o.status) {
        await log(db, req, 'MUDAR_STATUS', 'ordens_servico', o.id, `${before.status} -> ${o.status}`);
      } else {
        await log(db, req, 'EDITAR', 'ordens_servico', o.id, o.numero);
      }
      return { ok: true, id: o.id };
    } else {
      const numero = await nextOsNumero(db);
      const id = await db.insert(
        `INSERT INTO ordens_servico (numero, cliente_id, equipamento_id, defeito_informado, diagnostico, servicos_executados, pecas_utilizadas, valor_mao_obra, valor_pecas, desconto, valor_total, garantia_dias, data_entrada, previsao, data_saida, status, observacoes, assinatura_cliente, checklist, itens_pecas, estoque_baixado, forma_pagamento, financeiro_lancado, despesa_pecas_lancada, tecnico_id, termos_aceite, senha_tipo, senha_valor, checklist_acessorios, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [numero, o.cliente_id, o.equipamento_id, o.defeito_informado, o.diagnostico, o.servicos_executados, o.pecas_utilizadas, o.valor_mao_obra || 0, o.valor_pecas || 0, o.desconto || 0, o.valor_total, o.garantia_dias || 90, o.data_entrada, o.previsao, o.data_saida, o.status || 'Recebido', o.observacoes, o.assinatura_cliente, checklist, itensPecas, (o.itens_pecas || []).length > 0 ? 1 : 0, o.forma_pagamento || null, 0, temPecas ? 1 : 0, o.tecnico_id || null, termosAceite, o.senha_tipo || null, o.senha_valor || null, checklistAcessorios, req.usuario?.id, nowIso()]
      );
      if ((o.itens_pecas || []).length > 0) {
        await baixarEstoqueDaOs(db, req, id, numero, o.itens_pecas);
      }
      if (temPecas) {
        await lancarDespesaPecasDaOs(db, req, id, numero, o.itens_pecas, o.valor_pecas, o.data_entrada);
      }
      if (o.status === 'Pronto') {
        await lancarReceberDaOs(db, req, id, numero, o.valor_total, o.previsao);
        await db.run('UPDATE ordens_servico SET financeiro_receber_lancado = 1 WHERE id = ?', [id]);
      }
      if (o.status === 'Entregue' && o.forma_pagamento) {
        await baixarOuLancarRecebimentoDaOs(db, req, id, numero, o.valor_total, o.forma_pagamento);
        await db.run('UPDATE ordens_servico SET financeiro_lancado = 1 WHERE id = ?', [id]);
      }
      await log(db, req, 'CRIAR', 'ordens_servico', id, numero);
      return { ok: true, id, numero };
    }
  },

  'os:setStatus': async (db, { id, status }, req) => {
    const before = await db.get('SELECT status, numero, valor_total, previsao, financeiro_receber_lancado, financeiro_lancado FROM ordens_servico WHERE id = ?', [id]);
    await db.run('UPDATE ordens_servico SET status = ?, atualizado_em = ? WHERE id = ?', [status, nowIso(), id]);
    if (!before?.financeiro_receber_lancado && status === 'Pronto' && !before?.financeiro_lancado) {
      await lancarReceberDaOs(db, req, id, before?.numero, before?.valor_total, before?.previsao);
      await db.run('UPDATE ordens_servico SET financeiro_receber_lancado = 1 WHERE id = ?', [id]);
    }
    await log(db, req, 'MUDAR_STATUS', 'ordens_servico', id, `${before?.status} -> ${status}`);
    return { ok: true };
  },

  'os:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const os = await db.get('SELECT * FROM ordens_servico WHERE id = ?', [id]);
    if (!os) throw new Error('Ordem de Serviço não encontrada.');

    if (os.estoque_baixado) {
      let itens = [];
      try { itens = JSON.parse(os.itens_pecas || '[]'); } catch { itens = []; }
      for (const item of itens) {
        if (!item.produto_id || !item.quantidade) continue;
        const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
        if (!produto) continue;
        const novaQtd = (produto.quantidade || 0) + parseFloat(item.quantidade);
        await db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
        await db.insert(
          `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
          [produto.id, 'entrada', item.quantidade, 'Estorno por exclusão de OS', os.numero, req.usuario?.id, req.usuario?.nome, nowIso()]
        );
      }
    }
    await db.run(`DELETE FROM lancamentos_financeiros WHERE os_id = ? AND origem_automatica = 1`, [id]);
    await db.run('DELETE FROM ordens_servico WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'ordens_servico', id, os.numero);
    return { ok: true };
  },

  // ---------- FORNECEDORES ----------
  'fornecedores:list': async (db, { termo } = {}) => {
    if (termo) {
      const like = `%${termo}%`;
      return db.all('SELECT * FROM fornecedores WHERE nome LIKE ? OR cnpj_cpf LIKE ? ORDER BY nome', [like, like]);
    }
    return db.all('SELECT * FROM fornecedores ORDER BY nome');
  },

  'fornecedores:save': async (db, { fornecedor }, req) => {
    const f = fornecedor;
    if (f.id) {
      await db.run('UPDATE fornecedores SET nome=?, cnpj_cpf=?, telefone=?, email=?, endereco=?, observacoes=? WHERE id=?',
        [f.nome, f.cnpj_cpf, f.telefone, f.email, f.endereco, f.observacoes, f.id]);
      await log(db, req, 'EDITAR', 'fornecedores', f.id, f.nome);
      return { ok: true, id: f.id };
    }
    const id = await db.insert('INSERT INTO fornecedores (nome, cnpj_cpf, telefone, email, endereco, observacoes, criado_em) VALUES (?,?,?,?,?,?,?)',
      [f.nome, f.cnpj_cpf, f.telefone, f.email, f.endereco, f.observacoes, nowIso()]);
    await log(db, req, 'CRIAR', 'fornecedores', id, f.nome);
    return { ok: true, id };
  },

  // ---------- PRODUTOS / ESTOQUE ----------
  'produtos:list': async (db, { termo, apenasBaixo } = {}) => {
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
  },

  'produtos:get': async (db, { id }) => db.get('SELECT * FROM produtos WHERE id = ?', [id]),

  'produtos:save': async (db, { produto }, req) => {
    const p = produto;
    if (p.id) {
      await db.run(
        `UPDATE produtos SET nome=?, categoria=?, fabricante=?, fornecedor_id=?, codigo_interno=?, codigo_barras=?, estoque_minimo=?, valor_compra=?, valor_venda=?, localizacao=?, atualizado_em=? WHERE id=?`,
        [p.nome, p.categoria, p.fabricante, p.fornecedor_id || null, p.codigo_interno, p.codigo_barras, p.estoque_minimo || 0, p.valor_compra || 0, p.valor_venda || 0, p.localizacao, nowIso(), p.id]
      );
      await log(db, req, 'EDITAR', 'produtos', p.id, p.nome);
      return { ok: true, id: p.id };
    } else {
      const id = await db.insert(
        `INSERT INTO produtos (nome, categoria, fabricante, fornecedor_id, codigo_interno, codigo_barras, quantidade, estoque_minimo, valor_compra, valor_venda, localizacao, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.nome, p.categoria, p.fabricante, p.fornecedor_id || null, p.codigo_interno, p.codigo_barras, p.quantidade || 0, p.estoque_minimo || 0, p.valor_compra || 0, p.valor_venda || 0, p.localizacao, 1, nowIso()]
      );
      if ((p.quantidade || 0) > 0) {
        await db.insert(
          `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
          [id, 'entrada', p.quantidade, 'Estoque inicial', '', req.usuario?.id, req.usuario?.nome, nowIso()]
        );
      }
      await log(db, req, 'CRIAR', 'produtos', id, p.nome);
      return { ok: true, id };
    }
  },

  'produtos:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    await db.run('UPDATE produtos SET ativo = 0 WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'produtos', id, '');
    return { ok: true };
  },

  'produtos:movimentar': async (db, { produto_id, tipo, quantidade, motivo }, req) => {
    const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [produto_id]);
    if (!produto) throw new Error('Produto não encontrado.');
    let novaQtd = produto.quantidade;
    if (tipo === 'entrada') novaQtd += parseFloat(quantidade);
    else if (tipo === 'saida') novaQtd -= parseFloat(quantidade);
    else if (tipo === 'ajuste') novaQtd = parseFloat(quantidade);
    await db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto_id]);
    await db.insert(
      `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
      [produto_id, tipo, quantidade, motivo || '', 'Ajuste manual', req.usuario?.id, req.usuario?.nome, nowIso()]
    );
    await log(db, req, 'MOVIMENTAR_ESTOQUE', 'produtos', produto_id, `${tipo} ${quantidade} — ${motivo || ''}`);
    return { ok: true };
  },

  'produtos:movimentacoes': async (db, { produto_id }) => db.all('SELECT * FROM movimentacoes_estoque WHERE produto_id = ? ORDER BY id DESC LIMIT 100', [produto_id]),

  // ---------- COMPRAS / PEDIDOS A FORNECEDORES ----------
  'compras:list': async (db, { termo, status } = {}) => {
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
  },

  'compras:get': async (db, { id }) => db.get(
    `SELECT c.*, f.nome as fornecedor_nome, f.telefone as fornecedor_telefone, f.email as fornecedor_email
     FROM compras c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id WHERE c.id = ?`, [id]
  ),

  'compras:save': async (db, { compra }, req) => {
    const c = compra;
    const itens = (c.itens || []).filter((i) => i.descricao);
    const valorTotal = calcularTotalCompra(itens);
    const itensJson = JSON.stringify(itens);
    if (c.id) {
      await db.run(
        `UPDATE compras SET fornecedor_id=?, itens=?, valor_total=?, data_pedido=?, data_prevista=?, observacoes=?, atualizado_em=? WHERE id=?`,
        [c.fornecedor_id, itensJson, valorTotal, c.data_pedido, c.data_prevista || null, c.observacoes, nowIso(), c.id]
      );
      await log(db, req, 'EDITAR', 'compras', c.id, c.numero);
      return { ok: true, id: c.id };
    }
    const numero = await nextCompraNumero(db);
    const id = await db.insert(
      `INSERT INTO compras (numero, fornecedor_id, itens, valor_total, status, data_pedido, data_prevista, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [numero, c.fornecedor_id, itensJson, valorTotal, 'Pendente', c.data_pedido, c.data_prevista || null, c.observacoes, req.usuario?.id, nowIso()]
    );
    await log(db, req, 'CRIAR', 'compras', id, numero);
    return { ok: true, id, numero };
  },

  'compras:setStatus': async (db, { id, status }, req) => {
    const compra = await db.get('SELECT * FROM compras WHERE id = ?', [id]);
    if (!compra) throw new Error('Pedido de compra não encontrado.');
    await db.run('UPDATE compras SET status = ?, atualizado_em = ? WHERE id = ?', [status, nowIso(), id]);
    if (status === 'Enviado') {
      await processarEnvioCompra(db, req, compra);
    } else if (status === 'Recebido') {
      await processarRecebimentoCompra(db, req, compra);
    }
    await log(db, req, 'MUDAR_STATUS', 'compras', id, `${compra.status} -> ${status}`);
    return { ok: true };
  },

  'compras:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const compra = await db.get('SELECT * FROM compras WHERE id = ?', [id]);
    if (!compra) throw new Error('Pedido de compra não encontrado.');
    if (compra.status === 'Recebido') throw new Error('Não é possível excluir um pedido já recebido (estoque e financeiro já foram lançados).');
    if (compra.despesa_lancada) throw new Error('Não é possível excluir um pedido já enviado (a despesa já foi lançada em Contas a Pagar). Cancele o pedido em vez de excluí-lo.');
    await db.run('DELETE FROM compras WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'compras', id, compra.numero);
    return { ok: true };
  },

  // ---------- SERVIÇOS (catálogo, usado para agilizar orçamentos) ----------
  'servicos:list': async (db, { termo } = {}) => {
    let sql = `SELECT * FROM servicos WHERE ativo = 1`;
    const params = [];
    if (termo) {
      sql += ` AND (nome LIKE ? OR categoria LIKE ?)`;
      const like = `%${termo}%`;
      params.push(like, like);
    }
    sql += ` ORDER BY nome`;
    return db.all(sql, params);
  },

  'servicos:save': async (db, { servico }, req) => {
    const s = servico;
    if (s.id) {
      await db.run(
        `UPDATE servicos SET nome=?, descricao=?, categoria=?, valor_padrao=?, atualizado_em=? WHERE id=?`,
        [s.nome, s.descricao || '', s.categoria || '', s.valor_padrao || 0, nowIso(), s.id]
      );
      await log(db, req, 'EDITAR', 'servicos', s.id, s.nome);
      return { ok: true, id: s.id };
    }
    const id = await db.insert(
      `INSERT INTO servicos (nome, descricao, categoria, valor_padrao, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
      [s.nome, s.descricao || '', s.categoria || '', s.valor_padrao || 0, 1, nowIso()]
    );
    await log(db, req, 'CRIAR', 'servicos', id, s.nome);
    return { ok: true, id };
  },

  'servicos:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    await db.run('UPDATE servicos SET ativo = 0 WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'servicos', id, '');
    return { ok: true };
  },

  // ---------- VENDAS (venda avulsa de produtos/serviços, fora de OS/Orçamento) ----------
  'vendas:list': async (db, { termo } = {}) => {
    let sql = `SELECT v.*, c.nome as cliente_nome FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE 1=1`;
    const params = [];
    if (termo) {
      sql += ` AND (v.numero LIKE ? OR c.nome LIKE ?)`;
      const like = `%${termo}%`;
      params.push(like, like);
    }
    sql += ` ORDER BY v.id DESC`;
    return db.all(sql, params);
  },

  'vendas:get': async (db, { id }) => db.get(
    `SELECT v.*, c.nome as cliente_nome, c.cpf_cnpj as cliente_cpf_cnpj, c.telefone as cliente_telefone,
            c.whatsapp as cliente_whatsapp, c.email as cliente_email, c.endereco as cliente_endereco,
            c.numero as cliente_numero, c.bairro as cliente_bairro, c.cidade as cliente_cidade, c.uf as cliente_uf
     FROM vendas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ?`,
    [id]
  ),

  'vendas:save': async (db, { venda }, req) => {
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
      const existente = await db.get('SELECT * FROM vendas WHERE id = ?', [v.id]);
      if (!existente) throw new Error('Venda não encontrada.');
      await reverterEfeitosVenda(db, req, existente);
      numero = existente.numero;
      id = existente.id;
      await db.run(
        `UPDATE vendas SET cliente_id=?, itens=?, valor_itens=?, desconto=?, valor_total=?, forma_pagamento=?, observacoes=?, garantia_dias=?, criado_em=? WHERE id=?`,
        [v.cliente_id || null, JSON.stringify(itens), valorItens, desconto, valorTotal, v.forma_pagamento || null, v.observacoes || '', garantiaDias, dataVenda, id]
      );
      await log(db, req, 'EDITAR', 'vendas', id, numero);
    } else {
      numero = await nextVendaNumero(db);
      id = await db.insert(
        `INSERT INTO vendas (numero, cliente_id, itens, valor_itens, desconto, valor_total, forma_pagamento, status, observacoes, garantia_dias, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [numero, v.cliente_id || null, JSON.stringify(itens), valorItens, desconto, valorTotal, v.forma_pagamento || null, 'Concluída', v.observacoes || '', garantiaDias, req.usuario?.id, dataVenda]
      );
      await log(db, req, 'CRIAR', 'vendas', id, numero);
    }

    for (const item of itens) {
      if (!item.produto_id || !item.quantidade) continue;
      const produto = await db.get('SELECT * FROM produtos WHERE id = ?', [item.produto_id]);
      if (!produto) continue;
      const novaQtd = (produto.quantidade || 0) - parseFloat(item.quantidade);
      await db.run('UPDATE produtos SET quantidade = ?, atualizado_em = ? WHERE id = ?', [novaQtd, nowIso(), produto.id]);
      await db.insert(
        `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
        [produto.id, 'saida', item.quantidade, 'Venda avulsa', numero, req.usuario?.id, req.usuario?.nome, nowIso()]
      );
    }
    if (valorTotal > 0) {
      const hoje = nowIso().slice(0, 10);
      await db.insert(
        `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ['receita', 'Vendas', `Venda ${numero}`, valorTotal, v.forma_pagamento || '', 'Pago', hoje, hoje, numero, null, '', 1, req.usuario?.id, req.usuario?.nome, nowIso()]
      );
      if (v.forma_pagamento === 'Dinheiro') {
        const sessao = await caixaAberto(db);
        if (sessao) {
          await db.insert(
            `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
            [sessao.id, 'entrada', valorTotal, v.forma_pagamento, `Venda ${numero}`, numero, req.usuario?.id, req.usuario?.nome, nowIso()]
          );
        }
      }
    }
    return { ok: true, id, numero };
  },

  'vendas:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const venda = await db.get('SELECT * FROM vendas WHERE id = ?', [id]);
    if (!venda) throw new Error('Venda não encontrada.');
    await reverterEfeitosVenda(db, req, venda);
    await db.run('DELETE FROM vendas WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'vendas', id, venda.numero);
    return { ok: true };
  },

  // ---------- ORÇAMENTOS ----------
  'orcamentos:list': async (db, { termo, status } = {}) => {
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
  },

  'orcamentos:get': async (db, { id }) => db.get(
    `SELECT o.*, c.nome as cliente_nome, c.telefone as cliente_telefone, c.whatsapp as cliente_whatsapp, c.email as cliente_email,
            eq.marca as equip_marca, eq.modelo as equip_modelo
     FROM orcamentos o LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN equipamentos eq ON eq.id = o.equipamento_id
     WHERE o.id = ?`, [id]
  ),

  'orcamentos:save': async (db, { orcamento }, req) => {
    const o = orcamento;
    o.valor_total = calcularTotalOrcamento(o);
    const itens = JSON.stringify(o.itens || []);
    if (o.id) {
      await db.run(
        `UPDATE orcamentos SET cliente_id=?, equipamento_id=?, descricao=?, itens=?, valor_servicos=?, desconto=?, valor_total=?, validade_dias=?, data_orcamento=?, status=?, observacoes=?, atualizado_em=? WHERE id=?`,
        [o.cliente_id, o.equipamento_id || null, o.descricao, itens, o.valor_servicos || 0, o.desconto || 0, o.valor_total, o.validade_dias || 7, o.data_orcamento, o.status, o.observacoes, nowIso(), o.id]
      );
      await log(db, req, 'EDITAR', 'orcamentos', o.id, o.numero);
      return { ok: true, id: o.id };
    } else {
      const numero = await nextOrcamentoNumero(db);
      const id = await db.insert(
        `INSERT INTO orcamentos (numero, cliente_id, equipamento_id, descricao, itens, valor_servicos, desconto, valor_total, validade_dias, data_orcamento, status, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [numero, o.cliente_id, o.equipamento_id || null, o.descricao, itens, o.valor_servicos || 0, o.desconto || 0, o.valor_total, o.validade_dias || 7, o.data_orcamento, o.status || 'Pendente', o.observacoes, req.usuario?.id, nowIso()]
      );
      await log(db, req, 'CRIAR', 'orcamentos', id, numero);
      return { ok: true, id, numero };
    }
  },

  'orcamentos:setStatus': async (db, { id, status }, req) => {
    const before = await db.get('SELECT status, numero FROM orcamentos WHERE id = ?', [id]);
    await db.run('UPDATE orcamentos SET status = ?, atualizado_em = ? WHERE id = ?', [status, nowIso(), id]);
    await log(db, req, 'MUDAR_STATUS', 'orcamentos', id, `${before?.status} -> ${status}`);
    return { ok: true };
  },

  'orcamentos:duplicar': async (db, { id }, req) => {
    const orig = await db.get('SELECT * FROM orcamentos WHERE id = ?', [id]);
    if (!orig) throw new Error('Orçamento não encontrado.');
    const numero = await nextOrcamentoNumero(db);
    const newId = await db.insert(
      `INSERT INTO orcamentos (numero, cliente_id, equipamento_id, descricao, itens, valor_servicos, desconto, valor_total, validade_dias, data_orcamento, status, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [numero, orig.cliente_id, orig.equipamento_id, orig.descricao, orig.itens, orig.valor_servicos, orig.desconto, orig.valor_total, orig.validade_dias, nowIso().slice(0, 10), 'Pendente', orig.observacoes, req.usuario?.id, nowIso()]
    );
    await log(db, req, 'DUPLICAR', 'orcamentos', newId, `A partir de ${orig.numero}`);
    return { ok: true, id: newId, numero };
  },

  'orcamentos:converterEmOs': async (db, { id }, req) => {
    const orc = await db.get('SELECT * FROM orcamentos WHERE id = ?', [id]);
    if (!orc) throw new Error('Orçamento não encontrado.');
    if (!orc.equipamento_id) throw new Error('Este orçamento não possui um equipamento vinculado. Edite o orçamento e selecione o equipamento antes de converter em OS.');
    let itens = [];
    try { itens = JSON.parse(orc.itens || '[]'); } catch { itens = []; }
    const itensPecas = itens.filter((i) => i.produto_id).map((i) => ({ produto_id: i.produto_id, descricao: i.descricao, quantidade: i.quantidade, valor_unit: valorPecaDoItem(i) }));
    const valorPecas = itens.reduce((sum, it) => sum + (parseFloat(it.quantidade) || 0) * valorPecaDoItem(it), 0);
    const valorMaoObra = itens.reduce((sum, it) => sum + valorMaoObraDoItem(it), 0) + (parseFloat(orc.valor_servicos) || 0);
    const numero = await nextOsNumero(db);
    const dataHoje = nowIso().slice(0, 10);
    const temPecas = itensPecas.length > 0 || valorPecas > 0;
    const osId = await db.insert(
      `INSERT INTO ordens_servico (numero, cliente_id, equipamento_id, defeito_informado, diagnostico, servicos_executados, pecas_utilizadas, valor_mao_obra, valor_pecas, desconto, valor_total, garantia_dias, data_entrada, previsao, data_saida, status, observacoes, assinatura_cliente, checklist, itens_pecas, estoque_baixado, despesa_pecas_lancada, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [numero, orc.cliente_id, orc.equipamento_id, orc.descricao || '', '', '', '', valorMaoObra, valorPecas, orc.desconto || 0, orc.valor_total, 90, dataHoje, '', '', 'Recebido', `Convertido do orçamento ${orc.numero}`, '', '[]', JSON.stringify(itensPecas), 0, temPecas ? 1 : 0, req.usuario?.id, nowIso()]
    );
    if (itensPecas.length > 0) {
      await baixarEstoqueDaOs(db, req, osId, numero, itensPecas);
      await db.run('UPDATE ordens_servico SET estoque_baixado = 1 WHERE id = ?', [osId]);
    }
    if (temPecas) {
      await lancarDespesaPecasDaOs(db, req, osId, numero, itensPecas, valorPecas, dataHoje);
    }
    await db.run(`UPDATE orcamentos SET status='Convertido', os_id=?, atualizado_em=? WHERE id=?`, [osId, nowIso(), id]);
    await log(db, req, 'CONVERTER_EM_OS', 'orcamentos', id, `${orc.numero} -> ${numero}`);
    return { ok: true, osId, osNumero: numero };
  },

  'orcamentos:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const orc = await db.get('SELECT * FROM orcamentos WHERE id = ?', [id]);
    if (!orc) throw new Error('Orçamento não encontrado.');
    await db.run('DELETE FROM orcamentos WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'orcamentos', id, orc.numero);
    return { ok: true };
  },

  // ---------- METAS FINANCEIRAS ----------
  'financas:metaMensal': async (db, { mes } = {}) => calcularMetaMensal(db, mes),

  'financas:metasFuturas': async (db, { quantidadeMeses } = {}) => {
    const n = quantidadeMeses || 6;
    const hoje = nowIso().slice(0, 10);
    const meses = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(hoje.slice(0, 10) + 'T00:00:00');
      d.setDate(1);
      d.setMonth(d.getMonth() + i);
      const mes = d.toISOString().slice(0, 7);
      const metaRow = await db.get('SELECT meta_lucro FROM metas_financeiras WHERE mes = ?', [mes]);
      meses.push({ mes, label: mesLabelBackend(mes), metaLucro: metaRow ? metaRow.meta_lucro : null });
    }
    return meses;
  },

  'financas:definirMeta': async (db, { mes, meta_lucro }, req) => {
    requirePapel(req, ['Administrador', 'Financeiro']);
    const mesAlvo = mes || nowIso().slice(0, 7);
    const meta = Math.max(0, parseFloat(meta_lucro) || 0);
    const existente = await db.get('SELECT mes FROM metas_financeiras WHERE mes = ?', [mesAlvo]);
    if (existente) {
      await db.run('UPDATE metas_financeiras SET meta_lucro = ?, usuario_id = ?, atualizado_em = ? WHERE mes = ?', [meta, req.usuario?.id, nowIso(), mesAlvo]);
    } else {
      await db.run('INSERT INTO metas_financeiras (mes, meta_lucro, usuario_id, atualizado_em) VALUES (?,?,?,?)', [mesAlvo, meta, req.usuario?.id, nowIso()]);
    }
    await log(db, req, 'EDITAR', 'metas_financeiras', mesAlvo, `Meta de lucro definida: ${meta}`);
    return { ok: true };
  },

  // ---------- FINANCEIRO ----------
  'financeiro:list': async (db, { tipo, status, termo } = {}) => {
    let sql = `SELECT * FROM lancamentos_financeiros WHERE 1=1`;
    const params = [];
    if (tipo) { sql += ` AND tipo = ?`; params.push(tipo); }
    if (status) { sql += ` AND status = ?`; params.push(status); }
    if (termo) { sql += ` AND (descricao LIKE ? OR referencia LIKE ? OR categoria LIKE ?)`; const like = `%${termo}%`; params.push(like, like, like); }
    sql += ` ORDER BY COALESCE(data_vencimento, criado_em) DESC, id DESC`;
    return db.all(sql, params);
  },

  'financeiro:save': async (db, { lancamento }, req) => {
    const l = lancamento;
    const dataPagamento = l.data_pagamento || (l.status === 'Pago' ? nowIso().slice(0, 10) : null);
    if (l.id) {
      await db.run(
        `UPDATE lancamentos_financeiros SET tipo=?, categoria=?, descricao=?, valor=?, forma_pagamento=?, status=?, data_vencimento=?, data_pagamento=?, observacoes=?, atualizado_em=? WHERE id=?`,
        [l.tipo, l.categoria, l.descricao, l.valor, l.forma_pagamento, l.status, l.data_vencimento, dataPagamento, l.observacoes, nowIso(), l.id]
      );
      await log(db, req, 'EDITAR', 'lancamentos_financeiros', l.id, l.descricao);
      return { ok: true, id: l.id };
    }
    const id = await db.insert(
      `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [l.tipo, l.categoria, l.descricao, l.valor, l.forma_pagamento, l.status || 'Pendente', l.data_vencimento, dataPagamento, l.referencia || '', l.observacoes, 0, req.usuario?.id, req.usuario?.nome, nowIso()]
    );
    await log(db, req, 'CRIAR', 'lancamentos_financeiros', id, l.descricao);
    return { ok: true, id };
  },

  'financeiro:delete': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const l = await db.get('SELECT * FROM lancamentos_financeiros WHERE id = ?', [id]);
    if (!l) throw new Error('Lançamento não encontrado.');
    await db.run('DELETE FROM lancamentos_financeiros WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'lancamentos_financeiros', id, `${l.tipo} — ${l.descricao} — ${l.valor}`);
    return { ok: true };
  },

  'financeiro:marcarPago': async (db, { id, forma_pagamento, data_pagamento }, req) => {
    const l = await db.get('SELECT * FROM lancamentos_financeiros WHERE id = ?', [id]);
    if (!l) throw new Error('Lançamento não encontrado.');
    const dataPg = data_pagamento || nowIso().slice(0, 10);
    await db.run(`UPDATE lancamentos_financeiros SET status='Pago', forma_pagamento=?, data_pagamento=?, atualizado_em=? WHERE id=?`,
      [forma_pagamento, dataPg, nowIso(), id]);
    if (l.tipo === 'receita' && forma_pagamento === 'Dinheiro') {
      const sessao = await caixaAberto(db);
      if (sessao) {
        await db.insert(`INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
          [sessao.id, 'entrada', l.valor, forma_pagamento, l.descricao, l.referencia, req.usuario?.id, req.usuario?.nome, nowIso()]);
      }
    } else if (l.tipo === 'despesa' && forma_pagamento === 'Dinheiro') {
      const sessao = await caixaAberto(db);
      if (sessao) {
        await db.insert(`INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
          [sessao.id, 'saida', l.valor, forma_pagamento, l.descricao, l.referencia, req.usuario?.id, req.usuario?.nome, nowIso()]);
      }
    }
    await log(db, req, 'MARCAR_PAGO', 'lancamentos_financeiros', id, `${l.tipo} — ${forma_pagamento}`);
    return { ok: true };
  },

  'financeiro:cancelar': async (db, { id }, req) => {
    await db.run(`UPDATE lancamentos_financeiros SET status='Cancelado', atualizado_em=? WHERE id=?`, [nowIso(), id]);
    await log(db, req, 'CANCELAR', 'lancamentos_financeiros', id, '');
    return { ok: true };
  },

  'financeiro:dre': async (db, { mes }) => {
    const receitas = await db.all(
      `SELECT categoria, COALESCE(SUM(valor),0) as total FROM lancamentos_financeiros WHERE tipo='receita' AND status='Pago' AND substr(data_pagamento,1,7) = ? GROUP BY categoria ORDER BY total DESC`,
      [mes]
    );
    const despesas = await db.all(
      `SELECT categoria, COALESCE(SUM(valor),0) as total FROM lancamentos_financeiros WHERE tipo='despesa' AND status='Pago' AND substr(data_pagamento,1,7) = ? GROUP BY categoria ORDER BY total DESC`,
      [mes]
    );
    const totalReceitas = receitas.reduce((s, r) => s + r.total, 0);
    const totalDespesas = despesas.reduce((s, r) => s + r.total, 0);
    return { receitas, despesas, totalReceitas, totalDespesas, resultado: totalReceitas - totalDespesas };
  },

  // ---------- CAIXA ----------
  'caixa:atual': async (db) => {
    const sessao = await caixaAberto(db);
    if (!sessao) return null;
    const movimentos = await db.all('SELECT * FROM caixa_movimentos WHERE sessao_id = ? ORDER BY id DESC', [sessao.id]);
    const entradas = movimentos.filter((m) => m.tipo === 'entrada' || m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
    const saidas = movimentos.filter((m) => m.tipo === 'saida' || m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
    const saldoCalculado = (sessao.valor_abertura || 0) + entradas - saidas;
    return { sessao, movimentos, saldoCalculado };
  },

  'caixa:historico': async (db, { limit } = {}) => db.all('SELECT * FROM caixa_sessoes ORDER BY id DESC LIMIT ?', [limit || 30]),

  'caixa:abrir': async (db, { valor_abertura, observacoes }, req) => {
    if (await caixaAberto(db)) throw new Error('Já existe um caixa aberto.');
    const id = await db.insert(
      `INSERT INTO caixa_sessoes (data_abertura, valor_abertura, usuario_abertura_id, usuario_abertura_nome, status, observacoes, criado_em) VALUES (?,?,?,?,?,?,?)`,
      [nowIso(), parseFloat(valor_abertura) || 0, req.usuario?.id, req.usuario?.nome, 'Aberto', observacoes || '', nowIso()]
    );
    await log(db, req, 'ABRIR_CAIXA', 'caixa_sessoes', id, `Abertura: ${valor_abertura}`);
    return { ok: true, id };
  },

  'caixa:movimentar': async (db, { tipo, valor, forma_pagamento, descricao }, req) => {
    const sessao = await caixaAberto(db);
    if (!sessao) throw new Error('Não há caixa aberto no momento.');
    const id = await db.insert(
      `INSERT INTO caixa_movimentos (sessao_id, tipo, valor, forma_pagamento, descricao, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?)`,
      [sessao.id, tipo, parseFloat(valor), forma_pagamento || 'Dinheiro', descricao || '', '', req.usuario?.id, req.usuario?.nome, nowIso()]
    );
    await log(db, req, tipo === 'suprimento' ? 'SUPRIMENTO' : 'SANGRIA', 'caixa_movimentos', id, `${valor} — ${descricao || ''}`);
    return { ok: true, id };
  },

  'caixa:fechar': async (db, { valor_fechamento_informado, observacoes }, req) => {
    const sessao = await caixaAberto(db);
    if (!sessao) throw new Error('Não há caixa aberto no momento.');
    const movimentos = await db.all('SELECT * FROM caixa_movimentos WHERE sessao_id = ?', [sessao.id]);
    const entradas = movimentos.filter((m) => m.tipo === 'entrada' || m.tipo === 'suprimento').reduce((s, m) => s + m.valor, 0);
    const saidas = movimentos.filter((m) => m.tipo === 'saida' || m.tipo === 'sangria').reduce((s, m) => s + m.valor, 0);
    const saldoCalculado = (sessao.valor_abertura || 0) + entradas - saidas;
    await db.run(
      `UPDATE caixa_sessoes SET data_fechamento=?, valor_fechamento_informado=?, valor_fechamento_calculado=?, usuario_fechamento_id=?, usuario_fechamento_nome=?, status='Fechado', observacoes=? WHERE id=?`,
      [nowIso(), parseFloat(valor_fechamento_informado) || 0, saldoCalculado, req.usuario?.id, req.usuario?.nome, observacoes || sessao.observacoes, sessao.id]
    );
    await log(db, req, 'FECHAR_CAIXA', 'caixa_sessoes', sessao.id, `Calculado: ${saldoCalculado} / Informado: ${valor_fechamento_informado}`);
    return { ok: true, saldoCalculado, diferenca: (parseFloat(valor_fechamento_informado) || 0) - saldoCalculado };
  },

  'caixa:excluir': async (db, { id }, req) => {
    requirePapel(req, ['Administrador']);
    const existente = await db.get('SELECT * FROM caixa_sessoes WHERE id = ?', [id]);
    if (!existente) throw new Error('Sessão de caixa não encontrada.');
    await db.run('DELETE FROM caixa_movimentos WHERE sessao_id = ?', [id]);
    await db.run('DELETE FROM caixa_sessoes WHERE id = ?', [id]);
    await log(db, req, 'EXCLUIR', 'caixa_sessoes', id, `Abertura de ${existente.data_abertura} — valor ${existente.valor_abertura}`);
    return { ok: true };
  },

  // ---------- RELATÓRIOS ----------
  'relatorios:os': async (db, { dataInicio, dataFim, status }, req) => {
    requirePapel(req, ['Administrador']);
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
    const rows = await db.all(sql, params);
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
  },

  'relatorios:financeiro': async (db, { dataInicio, dataFim }, req) => {
    requirePapel(req, ['Administrador']);
    const rows = await db.all(
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
  },

  'relatorios:clientes': async (db, { dataInicio, dataFim }, req) => {
    requirePapel(req, ['Administrador']);
    const rows = await db.all(
      `SELECT c.nome as cliente, c.telefone, COUNT(os.id) as qtd_os, COALESCE(SUM(os.valor_total),0) as total_gasto
       FROM clientes c JOIN ordens_servico os ON os.cliente_id = c.id
       WHERE os.status = 'Entregue' AND date(os.data_saida) BETWEEN date(?) AND date(?)
       GROUP BY c.id ORDER BY total_gasto DESC`,
      [dataInicio, dataFim]
    );
    const novosClientes = await db.get(`SELECT COUNT(*) c FROM clientes WHERE date(criado_em) BETWEEN date(?) AND date(?)`, [dataInicio, dataFim]);
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
  },

  'relatorios:vendas': async (db, { dataInicio, dataFim }, req) => {
    requirePapel(req, ['Administrador']);
    const rows = await db.all(
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
  },

  'relatorios:metas': async (db, { dataInicio, dataFim } = {}, req) => {
    requirePapel(req, ['Administrador']);
    const hoje = nowIso().slice(0, 10);
    const mesInicio = (dataInicio || hoje).slice(0, 7);
    const mesFim = (dataFim || hoje).slice(0, 7);

    const meses = [];
    let cursor = mesInicio;
    let guardaLoop = 0;
    while (cursor <= mesFim && guardaLoop < 240) {
      meses.push(cursor);
      const [ano, mesNum] = cursor.split('-').map((n) => parseInt(n, 10));
      cursor = new Date(ano, mesNum, 1).toISOString().slice(0, 7);
      guardaLoop++;
    }

    const rows = [];
    for (const mes of meses) {
      const m = await calcularMetaMensal(db, mes);
      let status = 'Sem meta definida';
      if (m.metaLucro && m.metaLucro > 0) {
        if (m.statusRitmo === 'atingida') status = 'Meta atingida';
        else if (m.statusRitmo === 'nao_atingida') status = 'Meta não atingida';
        else if (m.statusRitmo === 'no_ritmo') status = 'No ritmo';
        else if (m.statusRitmo === 'atrasado') status = 'Abaixo do ritmo';
        else if (m.ehMesFuturo) status = 'Mês futuro (planejada)';
      }
      rows.push({
        mes: mesLabelBackend(mes),
        valor_meta: m.metaLucro,
        valor_faturamento: m.receitas,
        valor_despesas: m.despesas,
        valor_lucro_realizado: m.lucroRealizado,
        percentual_atingido: m.percentualAlcancado != null ? `${m.percentualAlcancado.toFixed(1)}%` : '-',
        status,
      });
    }

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
  },

  'relatorios:estoque': async (db, {} = {}, req) => {
    requirePapel(req, ['Administrador']);
    const rows = await db.all(
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
  },

  'relatorios:tecnicos': async (db, { dataInicio, dataFim }, req) => {
    requirePapel(req, ['Administrador']);
    const rows = await db.all(
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
  },

  'relatorios:garantias': async (db, { apenasAtivas }, req) => {
    requirePapel(req, ['Administrador']);
    const rowsOs = await db.all(
      `SELECT 'OS' as origem, os.numero, c.nome as cliente, (eq.marca || ' ' || eq.modelo) as equipamento, os.data_saida,
              os.garantia_dias, date(os.data_saida, '+' || os.garantia_dias || ' days') as fim_garantia
       FROM ordens_servico os
       LEFT JOIN clientes c ON c.id = os.cliente_id
       LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
       WHERE os.status = 'Entregue' AND os.data_saida IS NOT NULL AND os.data_saida != ''`
    );
    const rowsVendas = await db.all(
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
  },

  'relatorios:pecas': async (db, { dataInicio, dataFim }, req) => {
    requirePapel(req, ['Administrador']);
    const rows = await db.all(
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
  },

};

module.exports = { handlers };
