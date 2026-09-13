import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDateTime, CATEGORIAS_PRODUTO, sanitizeDecimalInput, parseDecimal, sanitizeIntegerInput, parseIntSafe } from '../utils.js';

const EMPTY_PRODUTO = {
  id: null, nome: '', categoria: '', fabricante: '', fornecedor_id: '', codigo_interno: '',
  codigo_barras: '', quantidade: 0, estoque_minimo: 1, valor_compra: 0, valor_venda: 0, localizacao: '',
};
const EMPTY_FORNECEDOR = { id: null, nome: '', cnpj_cpf: '', telefone: '', email: '', endereco: '', observacoes: '' };

export default function Estoque() {
  const { user, showToast } = useApp();
  const [tab, setTab] = useState('produtos');
  const [produtos, setProdutos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [termo, setTermo] = useState('');
  const [apenasBaixo, setApenasBaixo] = useState(false);

  const [modalProduto, setModalProduto] = useState(false);
  const [formProduto, setFormProduto] = useState(EMPTY_PRODUTO);

  const [modalFornecedor, setModalFornecedor] = useState(false);
  const [formFornecedor, setFormFornecedor] = useState(EMPTY_FORNECEDOR);

  const [modalMov, setModalMov] = useState(null); // produto selecionado
  const [movTipo, setMovTipo] = useState('entrada');
  const [movQtd, setMovQtd] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [movHistorico, setMovHistorico] = useState([]);

  async function loadProdutos() { setProdutos(await window.api.produtos.list(termo, apenasBaixo)); }
  async function loadFornecedores() { setFornecedores(await window.api.fornecedores.list()); }

  useEffect(() => { loadFornecedores(); }, []);
  useEffect(() => {
    const t = setTimeout(loadProdutos, 250);
    return () => clearTimeout(t);
  }, [termo, apenasBaixo]);

  function openNewProduto() { setFormProduto(EMPTY_PRODUTO); setModalProduto(true); }
  function openEditProduto(p) { setFormProduto(p); setModalProduto(true); }
  function setP(field, v) { setFormProduto((f) => ({ ...f, [field]: v })); }

  async function saveProduto(e) {
    e.preventDefault();
    if (!formProduto.nome.trim()) return showToast('Informe o nome do produto.', 'error');
    try {
      const payload = {
        ...formProduto,
        quantidade: parseIntSafe(formProduto.quantidade),
        estoque_minimo: parseIntSafe(formProduto.estoque_minimo),
        valor_compra: parseDecimal(formProduto.valor_compra),
        valor_venda: parseDecimal(formProduto.valor_venda),
      };
      await window.api.produtos.save(user, payload);
      showToast('Produto salvo com sucesso.');
      setModalProduto(false);
      loadProdutos();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function removeProduto(p) {
    if (!confirm(`Remover "${p.nome}" do estoque?`)) return;
    try {
      await window.api.produtos.delete(user, p.id);
      showToast('Produto removido.');
      loadProdutos();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  function openNewFornecedor() { setFormFornecedor(EMPTY_FORNECEDOR); setModalFornecedor(true); }
  function openEditFornecedor(f) { setFormFornecedor(f); setModalFornecedor(true); }
  function setF(field, v) { setFormFornecedor((f) => ({ ...f, [field]: v })); }

  async function saveFornecedor(e) {
    e.preventDefault();
    if (!formFornecedor.nome.trim()) return showToast('Informe o nome do fornecedor.', 'error');
    try {
      await window.api.fornecedores.save(user, formFornecedor);
      showToast('Fornecedor salvo com sucesso.');
      setModalFornecedor(false);
      loadFornecedores();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  // Leitor de código de barras (USB, tipo teclado): ao escanear um produto neste
  // campo de busca, ele digita o código e pressiona Enter automaticamente. Se o
  // código bater exatamente com o código de barras de um único produto, já abre
  // a tela de Movimentar Estoque para agilizar entrada/saída no balcão.
  async function handleTermoKeyDown(e) {
    if (e.key !== 'Enter') return;
    const codigo = termo.trim();
    if (!codigo) return;
    const resultados = await window.api.produtos.list(codigo, false);
    const exato = resultados.find((p) => p.codigo_barras === codigo || p.codigo_interno === codigo);
    if (exato) {
      setTermo('');
      openMovimentar(exato);
    } else if (resultados.length === 1) {
      setTermo('');
      openMovimentar(resultados[0]);
    }
  }

  async function openMovimentar(p) {
    setModalMov(p);
    setMovTipo('entrada');
    setMovQtd('');
    setMovMotivo('');
    setMovHistorico(await window.api.produtos.movimentacoes(p.id));
  }

  async function confirmarMovimentacao() {
    const qtd = parseIntSafe(movQtd);
    if (!qtd || qtd <= 0) return showToast('Informe uma quantidade válida.', 'error');
    try {
      await window.api.produtos.movimentar(user, modalMov.id, movTipo, qtd, movMotivo);
      showToast('Movimentação registrada.');
      setModalMov(null);
      loadProdutos();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="tabs-sub">
        <button className={`tab-btn ${tab === 'produtos' ? 'active' : ''}`} onClick={() => setTab('produtos')}>📦 Produtos</button>
        <button className={`tab-btn ${tab === 'fornecedores' ? 'active' : ''}`} onClick={() => setTab('fornecedores')}>🚚 Fornecedores</button>
      </div>

      {tab === 'produtos' && (
        <div>
          <div className="toolbar">
            <div className="toolbar-left">
              <input className="search-input" placeholder="Buscar por nome, categoria, código... (ou use o leitor de código de barras)" value={termo} onChange={(e) => setTermo(e.target.value)} onKeyDown={handleTermoKeyDown} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={apenasBaixo} onChange={(e) => setApenasBaixo(e.target.checked)} /> Somente estoque baixo
              </label>
            </div>
            <div className="toolbar-right">
              <button className="btn btn-primary" onClick={openNewProduto}>+ Novo Produto</button>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
            💡 Dica: clique no campo de busca e escaneie o código de barras do produto para abrir direto a movimentação de estoque.
          </p>

          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Produto</th><th>Categoria</th><th>Fornecedor</th><th>Qtd</th><th>Mín.</th><th>Venda</th><th>Local</th><th></th></tr>
              </thead>
              <tbody>
                {produtos.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.nome}</b>{p.codigo_interno ? <div className="muted" style={{ fontSize: 11 }}>{p.codigo_interno}</div> : null}</td>
                    <td>{p.categoria || '-'}</td>
                    <td>{p.fornecedor_nome || '-'}</td>
                    <td className={p.quantidade <= p.estoque_minimo ? 'low-stock' : ''}>{p.quantidade}</td>
                    <td>{p.estoque_minimo}</td>
                    <td>{formatCurrency(p.valor_venda)}</td>
                    <td>{p.localizacao || '-'}</td>
                    <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button className="icon-btn" title="Movimentar" onClick={() => openMovimentar(p)}>🔁</button>
                      <button className="icon-btn" title="Editar" onClick={() => openEditProduto(p)}>✏️</button>
                      {user.papel === 'Administrador' && <button className="icon-btn" title="Remover" onClick={() => removeProduto(p)}>🗑️</button>}
                    </td>
                  </tr>
                ))}
                {produtos.length === 0 && <tr><td colSpan={8}><div className="empty-state">Nenhum produto encontrado.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'fornecedores' && (
        <div>
          <div className="toolbar">
            <div className="toolbar-left"><span className="muted">Cadastro de fornecedores de peças e produtos.</span></div>
            <div className="toolbar-right"><button className="btn btn-primary" onClick={openNewFornecedor}>+ Novo Fornecedor</button></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>CNPJ/CPF</th><th>Telefone</th><th>E-mail</th><th></th></tr></thead>
              <tbody>
                {fornecedores.map((f) => (
                  <tr key={f.id}>
                    <td><b>{f.nome}</b></td>
                    <td>{f.cnpj_cpf || '-'}</td>
                    <td>{f.telefone || '-'}</td>
                    <td>{f.email || '-'}</td>
                    <td style={{ textAlign: 'right' }}><button className="icon-btn" onClick={() => openEditFornecedor(f)}>✏️</button></td>
                  </tr>
                ))}
                {fornecedores.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhum fornecedor cadastrado.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalProduto && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalProduto(false)}>
          <form className="modal" onSubmit={saveProduto}>
            <div className="modal-header">
              <h3>{formProduto.id ? 'Editar Produto' : 'Novo Produto'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalProduto(false)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field span-2"><label>Nome do Produto *</label><input value={formProduto.nome} onChange={(e) => setP('nome', e.target.value)} /></div>

              <div className="field">
                <label>Categoria</label>
                <select value={formProduto.categoria} onChange={(e) => setP('categoria', e.target.value)}>
                  <option value="">Selecione...</option>
                  {CATEGORIAS_PRODUTO.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Fabricante</label><input value={formProduto.fabricante} onChange={(e) => setP('fabricante', e.target.value)} /></div>

              <div className="field">
                <label>Fornecedor</label>
                <select value={formProduto.fornecedor_id || ''} onChange={(e) => setP('fornecedor_id', e.target.value)}>
                  <option value="">Selecione...</option>
                  {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                </select>
              </div>
              <div className="field"><label>Localização</label><input placeholder="Ex: Gaveta 3" value={formProduto.localizacao} onChange={(e) => setP('localizacao', e.target.value)} /></div>

              <div className="field"><label>Código Interno</label><input value={formProduto.codigo_interno} onChange={(e) => setP('codigo_interno', e.target.value)} /></div>
              <div className="field"><label>Código de Barras</label><input value={formProduto.codigo_barras} onChange={(e) => setP('codigo_barras', e.target.value)} /></div>

              {!formProduto.id && (
                <div className="field"><label>Quantidade Inicial</label><input type="text" inputMode="numeric" value={formProduto.quantidade} onChange={(e) => setP('quantidade', sanitizeIntegerInput(e.target.value))} /></div>
              )}
              <div className="field"><label>Estoque Mínimo</label><input type="text" inputMode="numeric" value={formProduto.estoque_minimo} onChange={(e) => setP('estoque_minimo', sanitizeIntegerInput(e.target.value))} /></div>

              <div className="field"><label>Valor de Compra (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={formProduto.valor_compra} onChange={(e) => setP('valor_compra', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field"><label>Valor de Venda (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={formProduto.valor_venda} onChange={(e) => setP('valor_venda', sanitizeDecimalInput(e.target.value))} /></div>
            </div>
            {formProduto.id && <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>Para alterar a quantidade em estoque, use o botão "🔁 Movimentar" na listagem.</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalProduto(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Produto</button>
            </div>
          </form>
        </div>
      )}

      {modalFornecedor && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalFornecedor(false)}>
          <form className="modal" style={{ width: 460 }} onSubmit={saveFornecedor}>
            <div className="modal-header">
              <h3>{formFornecedor.id ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalFornecedor(false)}>✕</button>
            </div>
            <div className="field" style={{ marginBottom: 12 }}><label>Nome</label><input value={formFornecedor.nome} onChange={(e) => setF('nome', e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>CNPJ/CPF</label><input value={formFornecedor.cnpj_cpf} onChange={(e) => setF('cnpj_cpf', e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Telefone</label><input value={formFornecedor.telefone} onChange={(e) => setF('telefone', e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>E-mail</label><input value={formFornecedor.email} onChange={(e) => setF('email', e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Endereço</label><input value={formFornecedor.endereco} onChange={(e) => setF('endereco', e.target.value)} /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Observações</label><textarea value={formFornecedor.observacoes} onChange={(e) => setF('observacoes', e.target.value)} /></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalFornecedor(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Fornecedor</button>
            </div>
          </form>
        </div>
      )}

      {modalMov && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalMov(null)}>
          <div className="modal" style={{ width: 520 }}>
            <div className="modal-header">
              <h3>Movimentar Estoque — {modalMov.nome}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalMov(null)}>✕</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Quantidade atual: <b>{modalMov.quantidade}</b></p>
            <div className="form-grid cols-3">
              <div className="field">
                <label>Tipo</label>
                <select value={movTipo} onChange={(e) => setMovTipo(e.target.value)}>
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                  <option value="ajuste">Ajuste (definir valor exato)</option>
                </select>
              </div>
              <div className="field"><label>Quantidade</label><input type="text" inputMode="numeric" value={movQtd} onChange={(e) => setMovQtd(sanitizeIntegerInput(e.target.value))} /></div>
              <div className="field"><label>Motivo</label><input value={movMotivo} onChange={(e) => setMovMotivo(e.target.value)} /></div>
            </div>
            <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={confirmarMovimentacao}>Confirmar Movimentação</button>

            <div className="section-title">Histórico recente</div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Data</th><th>Tipo</th><th>Qtd</th><th>Motivo</th><th>Ref.</th><th>Usuário</th></tr></thead>
                <tbody>
                  {movHistorico.map((m) => (
                    <tr key={m.id}>
                      <td>{formatDateTime(m.criado_em)}</td>
                      <td><span className="pill">{m.tipo}</span></td>
                      <td>{m.quantidade}</td>
                      <td className="muted">{m.motivo}</td>
                      <td className="muted">{m.referencia}</td>
                      <td className="muted">{m.usuario_nome}</td>
                    </tr>
                  ))}
                  {movHistorico.length === 0 && <tr><td colSpan={6}><div className="empty-state">Nenhuma movimentação ainda.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
