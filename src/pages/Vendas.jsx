import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDateTime, toInputDate, todayInputValue, sanitizeDecimalInput, parseDecimal, sanitizeIntegerInput, parseIntSafe, FORMAS_PAGAMENTO } from '../utils.js';

const EMPTY = { id: null, cliente_id: '', itens: [], desconto: 0, forma_pagamento: 'Dinheiro', observacoes: '', garantia_dias: 90, data_venda: todayInputValue() };

function novoItem() { return { produto_id: '', descricao: '', quantidade: 1, valor_unit: 0 }; }

export default function Vendas() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [clientes, setClientes] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [leitor, setLeitor] = useState('');

  async function load() { setList(await window.api.vendas.list(termo)); }
  async function loadClientes() { setClientes(await window.api.clientes.list()); }
  async function loadProdutos() { setProdutos(await window.api.produtos.list()); }

  useEffect(() => { loadClientes(); loadProdutos(); }, []);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [termo]);

  function openNew() { setForm({ ...EMPTY, itens: [novoItem()] }); setModalOpen(true); }

  async function openEdit(row) {
    const full = await window.api.vendas.get(row.id);
    let itens = [];
    try { itens = JSON.parse(full.itens || '[]'); } catch { itens = []; }
    if (itens.length === 0) itens = [novoItem()];
    setForm({
      ...EMPTY,
      ...full,
      cliente_id: full.cliente_id ? String(full.cliente_id) : '',
      itens,
      garantia_dias: full.garantia_dias ?? 90,
      data_venda: toInputDate(full.criado_em) || todayInputValue(),
    });
    setModalOpen(true);
  }

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function setItem(idx, field, value) {
    setForm((f) => {
      const itens = [...f.itens];
      const it = { ...itens[idx], [field]: value };
      if (field === 'produto_id' && value) {
        const p = produtos.find((p) => String(p.id) === String(value));
        if (p) { it.descricao = p.nome; it.valor_unit = p.valor_venda; }
      }
      itens[idx] = it;
      return { ...f, itens };
    });
  }
  function addItem() { setForm((f) => ({ ...f, itens: [...f.itens, novoItem()] })); }
  function removeItem(idx) { setForm((f) => ({ ...f, itens: f.itens.filter((_, i) => i !== idx) })); }

  // Leitor de código de barras (USB, tipo teclado): ele "digita" o código e aparece
  // como se fosse um Enter no final. Ao pressionar Enter neste campo, procuramos o
  // produto pelo código de barras e adicionamos (ou aumentamos a quantidade) na venda.
  function handleLeitorKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const codigo = leitor.trim();
    setLeitor('');
    if (!codigo) return;
    const produto = produtos.find((p) => p.codigo_barras && p.codigo_barras === codigo) || produtos.find((p) => p.codigo_interno && p.codigo_interno === codigo);
    if (!produto) return showToast(`Nenhum produto encontrado com o código "${codigo}".`, 'error');
    setForm((f) => {
      const itens = [...f.itens];
      const idxExistente = itens.findIndex((it) => String(it.produto_id) === String(produto.id));
      if (idxExistente >= 0) {
        itens[idxExistente] = { ...itens[idxExistente], quantidade: (parseInt(itens[idxExistente].quantidade, 10) || 0) + 1 };
      } else {
        const idxLivre = itens.findIndex((it) => !it.produto_id && !it.descricao);
        const novo = { produto_id: produto.id, descricao: produto.nome, quantidade: 1, valor_unit: produto.valor_venda };
        if (idxLivre >= 0) itens[idxLivre] = novo;
        else itens.push(novo);
      }
      return { ...f, itens };
    });
    showToast(`${produto.nome} adicionado.`);
  }

  async function imprimirCupom(row) {
    try {
      await window.api.impressora.imprimirCupomVenda(row.id);
      showToast('Cupom enviado para a impressora.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  const totalItens = useMemo(() => form.itens.reduce((s, it) => s + (parseDecimal(it.quantidade) || 0) * (parseDecimal(it.valor_unit) || 0), 0), [form.itens]);
  const total = useMemo(() => Math.max(0, totalItens - parseDecimal(form.desconto)), [totalItens, form.desconto]);

  async function save(e) {
    e.preventDefault();
    if (form.itens.filter((i) => i.descricao).length === 0) return showToast('Adicione ao menos um item à venda.', 'error');
    if (!form.forma_pagamento) return showToast('Selecione a forma de pagamento.', 'error');
    try {
      const payload = {
        ...form,
        desconto: parseDecimal(form.desconto),
        garantia_dias: parseIntSafe(form.garantia_dias) || 0,
        itens: form.itens.filter((i) => i.descricao).map((i) => ({ ...i, quantidade: parseIntSafe(i.quantidade) || 1, valor_unit: parseDecimal(i.valor_unit) })),
      };
      const res = await window.api.vendas.save(user, payload);
      showToast(form.id ? `Venda ${res.numero} atualizada com sucesso.` : `Venda ${res.numero} registrada com sucesso.`);
      setModalOpen(false);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(row) {
    if (!confirm(`Excluir a venda ${row.numero}? O estoque será estornado e o recebimento removido do Financeiro. Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.vendas.delete(user, row.id);
      showToast('Venda excluída.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function exportarGarantia(row) {
    try {
      const res = await window.api.pdf.exportarVendaGarantia(row.id);
      if (res.ok) showToast('Termo de Garantia exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function exportarRecibo(row) {
    try {
      const res = await window.api.pdf.exportarVendaRecibo(row.id);
      if (res.ok) showToast('Comprovante de Compra exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar por número ou cliente..." value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Nova Venda</button>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
        Registre aqui vendas avulsas de produtos/acessórios, fora do fluxo de Ordem de Serviço. O recebimento é lançado automaticamente no Financeiro como pago.
      </p>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Venda</th><th>Cliente</th><th>Data</th><th>Forma de Pagamento</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}>
                <td><b>{v.numero}</b></td>
                <td>{v.cliente_nome || 'Consumidor'}</td>
                <td>{formatDateTime(v.criado_em)}</td>
                <td>{v.forma_pagamento || '-'}</td>
                <td>{formatCurrency(v.valor_total)}</td>
                <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" title="Editar" onClick={() => openEdit(v)}>✏️</button>
                  <button className="icon-btn" title="Imprimir Cupom (impressora térmica)" onClick={() => imprimirCupom(v)}>🖨️</button>
                  <button className="icon-btn" title="Comprovante de Compra" onClick={() => exportarRecibo(v)}>🧾</button>
                  <button className="icon-btn" title="Termo de Garantia" onClick={() => exportarGarantia(v)}>🛡️</button>
                  {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir" onClick={() => excluir(v)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={6}><div className="empty-state">Nenhuma venda registrada ainda.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 'min(820px, 94vw)' }} onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? `Venda ${form.numero}` : 'Nova Venda'}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => imprimirCupom(form)}>🖨️ Cupom</button>}
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => exportarRecibo(form)}>🧾 Comprovante</button>}
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => exportarGarantia(form)}>🛡️ Garantia</button>}
                <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
              </div>
            </div>

            <div className="field" style={{ marginBottom: 4 }}>
              <label>🔫 Leitor de Código de Barras</label>
              <input
                value={leitor}
                onChange={(e) => setLeitor(e.target.value)}
                onKeyDown={handleLeitorKeyDown}
                placeholder="Clique aqui e escaneie o produto (ou digite o código e pressione Enter)"
                autoFocus
              />
            </div>

            <div className="form-grid">
              <div className="field span-2">
                <label>Cliente (opcional)</label>
                <select value={form.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                  <option value="">Consumidor não identificado</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div className="field"><label>Data da Compra</label><input type="date" value={form.data_venda} onChange={(e) => set('data_venda', e.target.value)} /></div>
              <div className="field"><label>Garantia (dias)</label><input type="text" inputMode="numeric" value={form.garantia_dias} onChange={(e) => set('garantia_dias', sanitizeIntegerInput(e.target.value))} /></div>
            </div>

            <div className="section-title">Itens da Venda</div>
            {form.itens.map((it, idx) => (
              <div className="item-row" key={idx}>
                <div className="field">
                  <label>Produto do estoque (opcional)</label>
                  <select value={it.produto_id} onChange={(e) => setItem(idx, 'produto_id', e.target.value)}>
                    <option value="">Item livre...</option>
                    {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} (estoque: {p.quantidade})</option>)}
                  </select>
                </div>
                <div className="field"><label>Descrição</label><input value={it.descricao} onChange={(e) => setItem(idx, 'descricao', e.target.value)} /></div>
                <div className="field"><label>Qtd</label><input type="text" inputMode="numeric" value={it.quantidade} onChange={(e) => setItem(idx, 'quantidade', sanitizeIntegerInput(e.target.value))} /></div>
                <div className="field"><label>Valor Unit.</label><input type="text" inputMode="decimal" placeholder="0,00" value={it.valor_unit} onChange={(e) => setItem(idx, 'valor_unit', sanitizeDecimalInput(e.target.value))} /></div>
                <button type="button" className="icon-btn" onClick={() => removeItem(idx)}>🗑️</button>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Adicionar item</button>

            <div className="form-grid cols-3" style={{ marginTop: 18 }}>
              <div className="field"><label>Desconto (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={form.desconto} onChange={(e) => set('desconto', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field">
                <label>Forma de Pagamento *</label>
                <select value={form.forma_pagamento} onChange={(e) => set('forma_pagamento', e.target.value)}>
                  {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Valor Total</label>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)', paddingTop: 6 }}>{formatCurrency(total)}</div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Observações</label>
              <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">{form.id ? 'Salvar Alterações' : 'Registrar Venda'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
