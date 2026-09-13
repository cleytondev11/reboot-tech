import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDate, todayInputValue, statusClass, prazoEntregaInfo, COMPRA_STATUS, sanitizeDecimalInput, parseDecimal, sanitizeIntegerInput, parseIntSafe, maskPhone } from '../utils.js';

const EMPTY = {
  id: null, fornecedor_id: '', itens: [], data_pedido: todayInputValue(), data_prevista: '', observacoes: '',
};

const EMPTY_FORNECEDOR_RAPIDO = { nome: '', cnpj_cpf: '', telefone: '', email: '', endereco: '', observacoes: '' };

function novoItem() {
  return { produto_id: '', descricao: '', quantidade: 1, valor_unit: 0 };
}

function totalDoItem(it) {
  const qtd = parseDecimal(it.quantidade) || 0;
  const valor = parseDecimal(it.valor_unit) || 0;
  return qtd * valor;
}

export default function Compras() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [fornecedores, setFornecedores] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [novoFornecedorOpen, setNovoFornecedorOpen] = useState(false);
  const [novoFornecedor, setNovoFornecedor] = useState(EMPTY_FORNECEDOR_RAPIDO);

  async function load() { setList(await window.api.compras.list(termo, statusFiltro)); }
  async function loadFornecedores() { setFornecedores(await window.api.fornecedores.list()); }
  async function loadProdutos() { setProdutos(await window.api.produtos.list()); }

  useEffect(() => { loadFornecedores(); loadProdutos(); }, []);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [termo, statusFiltro]);

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function openNew() {
    setForm({ ...EMPTY, itens: [novoItem()] });
    setModalOpen(true);
  }

  async function openEdit(row) {
    const full = await window.api.compras.get(row.id);
    let itens = [];
    try { itens = JSON.parse(full.itens || '[]'); } catch { itens = []; }
    if (itens.length === 0) itens = [novoItem()];
    setForm({
      ...full,
      fornecedor_id: String(full.fornecedor_id),
      data_pedido: String(full.data_pedido).slice(0, 10),
      data_prevista: full.data_prevista ? String(full.data_prevista).slice(0, 10) : '',
      itens,
    });
    setModalOpen(true);
  }

  function setItem(idx, field, value) {
    setForm((f) => {
      const itens = [...f.itens];
      const it = { ...itens[idx], [field]: value };
      if (field === 'produto_id' && value) {
        const p = produtos.find((p) => String(p.id) === String(value));
        if (p) { it.descricao = p.nome; it.valor_unit = p.valor_compra; }
      }
      itens[idx] = it;
      return { ...f, itens };
    });
  }

  function addItem() { setForm((f) => ({ ...f, itens: [...f.itens, novoItem()] })); }
  function removeItem(idx) { setForm((f) => ({ ...f, itens: f.itens.filter((_, i) => i !== idx) })); }

  const total = useMemo(() => form.itens.reduce((s, it) => s + totalDoItem(it), 0), [form.itens]);
  // Uma vez que o pedido foi "Enviado" (despesa já lançada em Contas a Pagar) ou
  // "Recebido" (estoque já lançado), os dados do pedido ficam travados para não
  // desalinhar do que já foi lançado no financeiro/estoque.
  const locked = form.status === 'Enviado' || form.status === 'Recebido';

  async function save(e) {
    e.preventDefault();
    if (!form.fornecedor_id) return showToast('Selecione o fornecedor.', 'error');
    if (!form.itens.some((i) => i.descricao)) return showToast('Adicione ao menos um item ao pedido.', 'error');
    try {
      const payload = {
        ...form,
        itens: form.itens
          .filter((i) => i.descricao)
          .map((i) => ({
            ...i,
            quantidade: parseIntSafe(i.quantidade) || 1,
            valor_unit: parseDecimal(i.valor_unit),
          })),
      };
      const res = await window.api.compras.save(user, payload);
      showToast(`Pedido de compra ${res.numero || form.numero || ''} salvo com sucesso.`);
      setModalOpen(false);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function quickStatus(row, status) {
    if (status === 'Enviado' && !confirm(`Confirmar envio do pedido ${row.numero}? Isso vai lançar o valor total como despesa (Pendente) em Contas a Pagar.`)) return;
    if (status === 'Recebido' && !confirm(`Confirmar recebimento do pedido ${row.numero}? Isso vai dar entrada no estoque dos itens vinculados a produtos.`)) return;
    try {
      await window.api.compras.setStatus(user, row.id, status);
      if (status === 'Enviado') showToast('Envio registrado: despesa lançada em Contas a Pagar.');
      else if (status === 'Recebido') showToast('Recebimento registrado: estoque atualizado.');
      else showToast('Status atualizado.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(row) {
    if (!confirm(`Excluir o pedido de compra ${row.numero} (${row.fornecedor_nome})? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.compras.delete(user, row.id);
      showToast('Pedido de compra excluído.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  function abrirNovoFornecedor() {
    setNovoFornecedor(EMPTY_FORNECEDOR_RAPIDO);
    setNovoFornecedorOpen(true);
  }

  async function salvarNovoFornecedor(e) {
    e.preventDefault();
    if (!novoFornecedor.nome.trim()) return showToast('Informe o nome do fornecedor.', 'error');
    try {
      const res = await window.api.fornecedores.save(user, novoFornecedor);
      showToast('Fornecedor cadastrado com sucesso.');
      await loadFornecedores();
      set('fornecedor_id', String(res.id));
      setNovoFornecedorOpen(false);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar por número ou fornecedor..." value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
            <option value="">Todos os status</option>
            {COMPRA_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Novo Pedido de Compra</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Pedido</th><th>Fornecedor</th><th>Data</th><th>Previsão</th><th>Data Recebida</th><th>Prazo</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map((c) => {
              const prazo = prazoEntregaInfo(c.data_prevista, c.data_recebimento);
              return (
              <tr key={c.id}>
                <td><b>{c.numero}</b></td>
                <td>{c.fornecedor_nome}</td>
                <td>{formatDate(c.data_pedido)}</td>
                <td>{c.data_prevista ? formatDate(c.data_prevista) : '-'}</td>
                <td>{c.data_recebimento ? formatDate(c.data_recebimento) : '-'}</td>
                <td><span className={`badge ${prazo.className}`}>{prazo.label}</span></td>
                <td>{formatCurrency(c.valor_total)}</td>
                <td>
                  <select className={`badge ${statusClass(c.status)}`} style={{ border: 'none', background: 'transparent', fontWeight: 700 }}
                    value={c.status} onChange={(e) => quickStatus(c, e.target.value)} disabled={c.status === 'Recebido' || c.status === 'Cancelado'}>
                    {COMPRA_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" title="Abrir" onClick={() => openEdit(c)}>✏️</button>
                  {user.papel === 'Administrador' && !c.despesa_lancada && c.status !== 'Recebido' && <button className="icon-btn" title="Excluir" onClick={() => excluir(c)}>🗑️</button>}
                </td>
              </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={9}><div className="empty-state">Nenhum pedido de compra encontrado.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 'min(920px, 94vw)' }} onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? `Pedido de Compra ${form.numero}` : 'Novo Pedido de Compra'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>

            {form.data_recebimento && (() => {
              const prazo = prazoEntregaInfo(form.data_prevista, form.data_recebimento);
              return (
                <div className="form-grid cols-2" style={{ marginBottom: 4 }}>
                  <div className="field"><label>Data Recebida</label><div style={{ fontWeight: 700, paddingTop: 4 }}>{formatDate(form.data_recebimento)}</div></div>
                  <div className="field"><label>Prazo</label><div style={{ paddingTop: 4 }}><span className={`badge ${prazo.className}`}>{prazo.label}</span></div></div>
                </div>
              );
            })()}

            <div className="form-grid">
              <div className="field">
                <label>Fornecedor *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ flex: 1 }} value={form.fornecedor_id} onChange={(e) => set('fornecedor_id', e.target.value)} disabled={locked}>
                    <option value="">Selecione...</option>
                    {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" title="Cadastrar novo fornecedor sem sair do pedido" onClick={abrirNovoFornecedor}>+ Novo</button>
                </div>
              </div>
              <div className="field"><label>Data do Pedido</label><input type="date" value={form.data_pedido} onChange={(e) => set('data_pedido', e.target.value)} disabled={locked} /></div>
              <div className="field"><label>Previsão de Entrega (opcional)</label><input type="date" value={form.data_prevista} onChange={(e) => set('data_prevista', e.target.value)} disabled={locked} /></div>
            </div>

            <div className="section-title">Itens do Pedido</div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
              Ao marcar o pedido como <b>"Enviado"</b>, o valor total do pedido é lançado como despesa (Pendente) em Contas a Pagar. Ao marcar como <b>"Recebido"</b>, os itens vinculados a um produto do estoque dão entrada automaticamente na quantidade e atualizam o valor de compra do produto.
            </p>
            {form.itens.map((it, idx) => (
              <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Produto do estoque (opcional)</label>
                    <select value={it.produto_id} onChange={(e) => setItem(idx, 'produto_id', e.target.value)} disabled={locked}>
                      <option value="">Item livre / digitar manualmente...</option>
                      {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </div>
                  {!locked && <button type="button" className="icon-btn" onClick={() => removeItem(idx)} title="Remover item">🗑️</button>}
                </div>
                <div className="form-grid cols-3">
                  <div className="field span-2"><label>Descrição do item</label><input value={it.descricao} onChange={(e) => setItem(idx, 'descricao', e.target.value)} disabled={locked} /></div>
                  <div className="field"><label>Qtd</label><input type="text" inputMode="numeric" value={it.quantidade} onChange={(e) => setItem(idx, 'quantidade', sanitizeIntegerInput(e.target.value))} disabled={locked} /></div>
                </div>
                <div className="form-grid cols-3">
                  <div className="field"><label>Valor unitário de compra (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={it.valor_unit} onChange={(e) => setItem(idx, 'valor_unit', sanitizeDecimalInput(e.target.value))} disabled={locked} /></div>
                  <div className="field">
                    <label>Total do item</label>
                    <div style={{ fontSize: 18, fontWeight: 700, paddingTop: 6 }}>{formatCurrency(totalDoItem(it))}</div>
                  </div>
                </div>
              </div>
            ))}
            {!locked && <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Adicionar item</button>}

            <div className="form-grid cols-2" style={{ marginTop: 18 }}>
              <div className="field">
                <label>Valor Total do Pedido</label>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)', paddingTop: 6 }}>{formatCurrency(total)}</div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Observações</label>
              <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} disabled={locked} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>{locked ? 'Fechar' : 'Cancelar'}</button>
              {!locked && <button type="submit" className="btn btn-primary">Salvar Pedido</button>}
            </div>
          </form>
        </div>
      )}

      {novoFornecedorOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setNovoFornecedorOpen(false)}>
          <form className="modal" style={{ width: 460 }} onSubmit={salvarNovoFornecedor}>
            <div className="modal-header">
              <h3>Cadastro Rápido de Fornecedor</h3>
              <button type="button" className="icon-btn" onClick={() => setNovoFornecedorOpen(false)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field span-2"><label>Nome *</label><input value={novoFornecedor.nome} onChange={(e) => setNovoFornecedor((f) => ({ ...f, nome: e.target.value }))} autoFocus /></div>
              <div className="field"><label>CNPJ/CPF</label><input value={novoFornecedor.cnpj_cpf} onChange={(e) => setNovoFornecedor((f) => ({ ...f, cnpj_cpf: e.target.value }))} /></div>
              <div className="field"><label>Telefone</label><input value={novoFornecedor.telefone} onChange={(e) => setNovoFornecedor((f) => ({ ...f, telefone: maskPhone(e.target.value) }))} /></div>
              <div className="field span-2"><label>E-mail</label><input value={novoFornecedor.email} onChange={(e) => setNovoFornecedor((f) => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>Você pode completar o cadastro (endereço, observações) depois, na tela de Estoque → Fornecedores.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setNovoFornecedorOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Cadastrar e Selecionar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
