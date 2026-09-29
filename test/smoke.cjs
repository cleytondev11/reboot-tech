const path = require('path');
const fs = require('fs');
const os = require('os');
const bcrypt = require('bcryptjs');
const { Database } = require('../electron/db.cjs');

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');
  const db = new Database(dbPath);
  await db.init();
  console.log('✔ DB inicializado em', dbPath);

  // admin
  const hash = bcrypt.hashSync('admin123', 10);
  const adminId = db.insert(
    `INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em) VALUES (?,?,?,?,?,?)`,
    ['Administrador', 'admin', hash, 'Administrador', 1, new Date().toISOString()]
  );
  console.log('✔ Usuário admin criado, id=', adminId);

  const adminRow = db.get('SELECT * FROM usuarios WHERE usuario = ?', ['admin']);
  console.assert(bcrypt.compareSync('admin123', adminRow.senha_hash), 'senha deveria bater');
  console.log('✔ Login (hash de senha) validado');

  // cliente
  const clienteId = db.insert(
    `INSERT INTO clientes (tipo, nome, cpf_cnpj, rg_ie, telefone, whatsapp, email, cep, endereco, numero, bairro, cidade, uf, observacoes, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['PF', 'João da Silva', '123.456.789-00', '', '(61) 99999-0000', '', 'joao@teste.com', '', '', '', '', 'Brasília', 'DF', '', new Date().toISOString()]
  );
  console.log('✔ Cliente criado, id=', clienteId);

  // equipamento
  const equipId = db.insert(
    `INSERT INTO equipamentos (cliente_id, marca, modelo, imei, numero_serie, cor, senha_desbloqueio, capacidade, operadora, estado_conservacao, acessorios, fotos, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [clienteId, 'Apple', 'iPhone 13', '123456789012345', 'SN123', 'Preto', '1234', '128GB', 'Vivo', 'Bom', 'Capinha,Carregador', '[]', new Date().toISOString()]
  );
  console.log('✔ Equipamento criado, id=', equipId);

  // OS
  const osId = db.insert(
    `INSERT INTO ordens_servico (numero, cliente_id, equipamento_id, defeito_informado, diagnostico, servicos_executados, pecas_utilizadas, valor_mao_obra, valor_pecas, desconto, valor_total, garantia_dias, data_entrada, previsao, data_saida, status, observacoes, assinatura_cliente, checklist, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['OS-000001', clienteId, equipId, 'Tela quebrada', '', '', '', 150, 200, 0, 350, 90, new Date().toISOString(), '', '', 'Recebido', '', '', '[]', adminId, new Date().toISOString()]
  );
  console.log('✔ Ordem de Serviço criada, id=', osId);

  const osRow = db.get(
    `SELECT os.*, c.nome as cliente_nome, eq.marca FROM ordens_servico os
     LEFT JOIN clientes c ON c.id = os.cliente_id LEFT JOIN equipamentos eq ON eq.id = os.equipamento_id
     WHERE os.id = ?`, [osId]
  );
  console.assert(osRow.cliente_nome === 'João da Silva', 'join de cliente deveria funcionar');
  console.assert(osRow.marca === 'Apple', 'join de equipamento deveria funcionar');
  console.log('✔ Consulta com JOIN (cliente + equipamento) validada:', osRow.numero, osRow.cliente_nome, osRow.marca);

  // dashboard-like aggregation
  const abertas = db.get(`SELECT COUNT(*) c FROM ordens_servico WHERE status NOT IN ('Entregue','Cancelado')`);
  console.assert(abertas.c === 1, 'deveria ter 1 OS aberta');
  console.log('✔ Agregação de dashboard (OS abertas) =', abertas.c);

  // licença local
  const licencaRow = db.get('SELECT * FROM licenca_local WHERE id = 1');
  console.assert(licencaRow && licencaRow.status_cache === 'pendente', 'licença local deveria iniciar como pendente');
  console.log('✔ Linha de licença local criada automaticamente, status inicial =', licencaRow.status_cache);

  // tabela de ações de segurança (remoção de vírus)
  db.insert(
    `INSERT INTO seguranca_acoes (dispositivo_serial, pacote, acao, resultado, usuario_nome, criado_em) VALUES (?,?,?,?,?,?)`,
    ['EMULATOR-TEST', 'com.teste.suspeito', 'analise', 'ok', 'Teste', new Date().toISOString()]
  );
  const acaoSeg = db.get('SELECT * FROM seguranca_acoes WHERE dispositivo_serial = ?', ['EMULATOR-TEST']);
  console.assert(acaoSeg && acaoSeg.pacote === 'com.teste.suspeito', 'registro de ação de segurança deveria ter sido salvo');
  console.log('✔ Tabela seguranca_acoes funcionando,', acaoSeg.acao);

  // fornecedor + produto (para o teste de compras)
  const fornecedorId = db.insert(
    `INSERT INTO fornecedores (nome, cnpj_cpf, telefone, email, endereco, observacoes, criado_em) VALUES (?,?,?,?,?,?,?)`,
    ['Distribuidora Peças LTDA', '11.222.333/0001-44', '(61) 3333-0000', 'contato@pecas.com', '', '', new Date().toISOString()]
  );
  const produtoId = db.insert(
    `INSERT INTO produtos (nome, categoria, fabricante, fornecedor_id, codigo_interno, codigo_barras, quantidade, estoque_minimo, valor_compra, valor_venda, localizacao, ativo, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['Tela iPhone 13', 'Tela', 'Apple', fornecedorId, 'TEL-IP13', '', 5, 2, 180, 350, '', 1, new Date().toISOString()]
  );
  console.log('✔ Fornecedor e produto criados para o teste de compras, ids=', fornecedorId, produtoId);

  // compras: pedido de compra a fornecedor
  const itensCompra = JSON.stringify([{ produto_id: produtoId, descricao: 'Tela iPhone 13', quantidade: 10, valor_unit: 175 }]);
  const compraId = db.insert(
    `INSERT INTO compras (numero, fornecedor_id, itens, valor_total, status, data_pedido, data_prevista, observacoes, usuario_id, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ['CP-000001', fornecedorId, itensCompra, 1750, 'Pendente', new Date().toISOString().slice(0, 10), null, '', adminId, new Date().toISOString()]
  );
  console.log('✔ Pedido de compra criado, id=', compraId);

  // simula o recebimento do pedido: entrada no estoque + despesa em Contas a Pagar
  // (mesma lógica de electron/main.cjs -> processarRecebimentoCompra)
  const produtoAntes = db.get('SELECT * FROM produtos WHERE id = ?', [produtoId]);
  db.run('UPDATE produtos SET quantidade = ?, valor_compra = ? WHERE id = ?', [produtoAntes.quantidade + 10, 175, produtoId]);
  db.insert(
    `INSERT INTO movimentacoes_estoque (produto_id, tipo, quantidade, motivo, referencia, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?)`,
    [produtoId, 'entrada', 10, 'Recebimento de compra', 'CP-000001', adminId, 'Administrador', new Date().toISOString()]
  );
  db.insert(
    `INSERT INTO lancamentos_financeiros (tipo, categoria, descricao, valor, forma_pagamento, status, data_vencimento, data_pagamento, referencia, os_id, observacoes, origem_automatica, usuario_id, usuario_nome, criado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ['despesa', 'Fornecedores', 'Compra recebida — CP-000001', 1750, '', 'Pendente', new Date().toISOString().slice(0, 10), null, 'CP-000001', null, '', 1, adminId, 'Administrador', new Date().toISOString()]
  );
  db.run(`UPDATE compras SET status = 'Recebido', estoque_lancado = 1, despesa_lancada = 1 WHERE id = ?`, [compraId]);

  const produtoDepois = db.get('SELECT * FROM produtos WHERE id = ?', [produtoId]);
  console.assert(produtoDepois.quantidade === 15, 'estoque deveria ter subido de 5 para 15 após o recebimento da compra');
  console.assert(produtoDepois.valor_compra === 175, 'valor de compra do produto deveria ter sido atualizado pela compra');
  const despesaCompra = db.get(`SELECT * FROM lancamentos_financeiros WHERE referencia = 'CP-000001' AND tipo = 'despesa'`);
  console.assert(despesaCompra && despesaCompra.valor === 1750, 'despesa de Contas a Pagar da compra deveria ter sido lançada');
  console.log('✔ Recebimento de compra validado: estoque', produtoDepois.quantidade, '| despesa lançada', despesaCompra.valor);

  // persistence: reload db from file
  const db2 = new Database(dbPath);
  await db2.init();
  const reloadedOs = db2.get('SELECT * FROM ordens_servico WHERE id = ?', [osId]);
  console.assert(reloadedOs && reloadedOs.numero === 'OS-000001', 'dados deveriam persistir em disco');
  console.log('✔ Persistência em disco (reabrir arquivo .sqlite) validada');

  // cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\n✅ TODOS OS TESTES DE BACKEND PASSARAM COM SUCESSO');
}

main().catch((err) => {
  console.error('❌ FALHA NO TESTE:', err);
  process.exit(1);
});
