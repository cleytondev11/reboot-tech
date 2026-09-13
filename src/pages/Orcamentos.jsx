import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDate, todayInputValue, statusClass, ORCAMENTO_STATUS, sanitizeDecimalInput, parseDecimal, sanitizeIntegerInput, parseIntSafe, maskCpfCnpj, maskPhone } from '../utils.js';

const EMPTY = {
  id: null, cliente_id: '', equipamento_id: '', descricao: '', itens: [],
  valor_servicos: 0, desconto: 0, validade_dias: 7, data_orcamento: todayInputValue(),
  status: 'Pendente', observacoes: '',
};

const EMPTY_CLIENTE_RAPIDO = { tipo: 'PF', nome: '', cpf_cnpj: '', telefone: '', whatsapp: '' };
const EMPTY_EQUIP_RAPIDO = { marca: '', modelo: '', imei: '', cor: '' };

function novoItem() {
  return { produto_id: '', servico_id: '', descricao: '', quantidade: 1, valor_peca: 0, valor_mao_obra: 0 };
}

// Calcula o total de um item: (quantidade * valor da peça) + mão de obra do item.
// "valor_unit" é aceito como fallback para itens salvos antes desta mudança
// (quando a mão de obra ainda não era individual por item).
function totalDoItem(it) {
  const qtd = parseDecimal(it.quantidade) || 0;
  const peca = it.valor_peca !== undefined && it.valor_peca !== '' ? (parseDecimal(it.valor_peca) || 0) : (parseDecimal(it.valor_unit) || 0);
  const maoObra = parseDecimal(it.valor_mao_obra) || 0;
  return qtd * peca + maoObra;
}

// Migra itens de orçamentos salvos no formato antigo (valor_unit único, sem
// mão de obra por item) para o novo formato com valor_peca + valor_mao_obra.
function migrarItensAntigos(itens) {
  return (itens || []).map((it) => ({
    produto_id: it.produto_id || '',
    servico_id: it.servico_id || '',
    descricao: it.descricao || '',
    quantidade: it.quantidade ?? 1,
    valor_peca: it.valor_peca !== undefined ? it.valor_peca : (it.valor_unit ?? 0),
    valor_mao_obra: it.valor_mao_obra !== undefined ? it.valor_mao_obra : 0,
  }));
}

export default function Orcamentos() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [clientes, setClientes] = useState([]);
  const [equipCliente, setEquipCliente] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [servicos, setServicos] = useState([]);
  const [novoClienteOpen, setNovoClienteOpen] = useState(false);
  const [novoCliente, setNovoCliente] = useState(EMPTY_CLIENTE_RAPIDO);
  const [novoEquipOpen, setNovoEquipOpen] = useState(false);
  const [novoEquip, setNovoEquip] = useState(EMPTY_EQUIP_RAPIDO);

  async function load() { setList(await window.api.orcamentos.list(termo, statusFiltro)); }
  async function loadClientes() { setClientes(await window.api.clientes.list()); }
  async function loadProdutos() { setProdutos(await window.api.produtos.list()); }
  async function loadServicos() { setServicos(await window.api.servicos.list()); }

  useEffect(() => { loadClientes(); loadProdutos(); loadServicos(); }, []);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [termo, statusFiltro]);

  useEffect(() => {
    if (!form.cliente_id) { setEquipCliente([]); return; }
    window.api.equipamentos.listByCliente(Number(form.cliente_id)).then(setEquipCliente);
  }, [form.cliente_id]);

  function openNew() {
    setForm({ ...EMPTY, itens: [novoItem()] });
    setModalOpen(true);
  }

  async function openEdit(row) {
    const full = await window.api.orcamentos.get(row.id);
    let itens = [];
    try { itens = JSON.parse(full.itens || '[]'); } catch { itens = []; }
    itens = migrarItensAntigos(itens);
    // Orçamentos antigos guardavam uma mão de obra única para o orçamento inteiro
    // em "valor_servicos". Como agora a mão de obra é por item, migramos esse
    // valor para um item próprio (visível e editável) na primeira vez que o
    // orçamento é aberto, para não perder o valor.
    const valorServicosLegado = parseDecimal(full.valor_servicos) || 0;
    if (valorServicosLegado > 0) {
      itens = [...itens, { produto_id: '', servico_id: '', descricao: 'Mão de obra (valor anterior)', quantidade: 1, valor_peca: 0, valor_mao_obra: valorServicosLegado }];
    }
    if (itens.length === 0) itens = [novoItem()];
    setForm({ ...full, cliente_id: String(full.cliente_id), equipamento_id: full.equipamento_id ? String(full.equipamento_id) : '', data_orcamento: String(full.data_orcamento).slice(0, 10), itens, valor_servicos: 0 });
    setModalOpen(true);
  }

  function set(field, value) { setForm((f) => ({ ...f, [field]: value })); }

  function setItem(idx, field, value) {
    setForm((f) => {
      const itens = [...f.itens];
      const it = { ...itens[idx], [field]: value };
      if (field === 'produto_id' && value) {
        const p = produtos.find((p) => String(p.id) === String(value));
        if (p) { it.descricao = p.nome; it.valor_peca = p.valor_venda; }
      }
      if (field === 'servico_id' && value) {
        const s = servicos.find((s) => String(s.id) === String(value));
        if (s) {
          // Preenche automaticamente a descrição e o valor padrão da mão de obra
          // do serviço escolhido; o usuário ainda pode alterar esse valor antes
          // de adicionar ao orçamento.
          it.descricao = it.descricao ? it.descricao : s.nome;
          it.valor_mao_obra = s.valor_padrao;
        }
      }
      itens[idx] = it;
      return { ...f, itens };
    });
  }

  function addItem() { setForm((f) => ({ ...f, itens: [...f.itens, novoItem()] })); }
  function removeItem(idx) { setForm((f) => ({ ...f, itens: f.itens.filter((_, i) => i !== idx) })); }

  const totalItens = useMemo(() => form.itens.reduce((s, it) => s + totalDoItem(it), 0), [form.itens]);
  const total = useMemo(() => {
    const desc = parseDecimal(form.desconto);
    return Math.max(0, totalItens - desc);
  }, [totalItens, form.desconto]);

  async function save(e) {
    e.preventDefault();
    if (!form.cliente_id) return showToast('Selecione o cliente.', 'error');
    try {
      const payload = {
        ...form,
        validade_dias: parseIntSafe(form.validade_dias) || 7,
        // A mão de obra agora é individual por item (ver "itens" abaixo); este
        // campo é mantido zerado apenas por compatibilidade com orçamentos antigos.
        valor_servicos: 0,
        desconto: parseDecimal(form.desconto),
        itens: form.itens
          .filter((i) => i.descricao)
          .map((i) => ({
            ...i,
            quantidade: parseIntSafe(i.quantidade) || 1,
            valor_peca: parseDecimal(i.valor_peca),
            valor_mao_obra: parseDecimal(i.valor_mao_obra),
          })),
      };
      const res = await window.api.orcamentos.save(user, payload);
      showToast(`Orçamento ${res.numero || form.numero || ''} salvo com sucesso.`);
      setModalOpen(false);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function quickStatus(row, status) {
    try {
      await window.api.orcamentos.setStatus(user, row.id, status);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function duplicar(row) {
    try {
      const res = await window.api.orcamentos.duplicar(user, row.id);
      showToast(`Orçamento duplicado como ${res.numero}.`);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function converterEmOs(row) {
    if (!confirm(`Converter o orçamento ${row.numero} em uma Ordem de Serviço?`)) return;
    try {
      const res = await window.api.orcamentos.converterEmOs(user, row.id);
      showToast(`Convertido em ${res.osNumero} com sucesso.`);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(row) {
    if (!confirm(`Excluir o orçamento ${row.numero} (${row.cliente_nome})? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.orcamentos.delete(user, row.id);
      showToast('Orçamento excluído.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function exportarPdf() {
    const res = await window.api.pdf.exportarOrcamento(form.id);
    if (res.ok) showToast('PDF exportado com sucesso.');
  }

  async function exportarPdfListagem(row) {
    try {
      const res = await window.api.pdf.exportarOrcamento(row.id);
      if (res.ok) showToast('PDF exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  // ---------- Cadastro rápido de Cliente (sem sair do Orçamento) ----------
  function abrirNovoCliente() {
    setNovoCliente(EMPTY_CLIENTE_RAPIDO);
    setNovoClienteOpen(true);
  }

  async function salvarNovoCliente(e) {
    e.preventDefault();
    if (!novoCliente.nome.trim()) return showToast('Informe o nome do cliente.', 'error');
    try {
      const res = await window.api.clientes.save(user, novoCliente);
      showToast('Cliente cadastrado com sucesso.');
      await loadClientes();
      set('cliente_id', String(res.id));
      setNovoClienteOpen(false);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  // ---------- Cadastro rápido de Equipamento (sem sair do Orçamento) ----------
  function abrirNovoEquip() {
    if (!form.cliente_id) return showToast('Selecione (ou cadastre) o cliente antes de cadastrar o equipamento.', 'error');
    setNovoEquip(EMPTY_EQUIP_RAPIDO);
    setNovoEquipOpen(true);
  }

  async function salvarNovoEquip(e) {
    e.preventDefault();
    if (!novoEquip.marca.trim()) return showToast('Informe a marca do equipamento.', 'error');
    try {
      const payload = { ...novoEquip, cliente_id: form.cliente_id, acessorios: '', fotos: [] };
      const res = await window.api.equipamentos.save(user, payload);
      showToast('Equipamento cadastrado com sucesso.');
      const lista = await window.api.equipamentos.listByCliente(Number(form.cliente_id));
      setEquipCliente(lista);
      set('equipamento_id', String(res.id));
      setNovoEquipOpen(false);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  // ---------- Compartilhar PDF no WhatsApp do cliente ----------
  async function compartilharWhatsapp(row) {
    try {
      const telefone = row.cliente_whatsapp || row.cliente_telefone;
      if (!telefone) return showToast('Este cliente não possui WhatsApp/telefone cadastrado.', 'error');
      const res = await window.api.pdf.exportarOrcamento(row.id);
      if (!res.ok) return; // usuário cancelou o salvamento do PDF
      const msg = `Olá! Segue o orçamento ${row.numero}${row.cliente_nome ? ' referente ao atendimento de ' + row.cliente_nome : ''}. Anexei o PDF aqui, um momento.`;
      await window.api.whatsapp.abrirConversa(telefone, msg);
      showToast('PDF salvo. O WhatsApp foi aberto — anexe o arquivo que acabou de ser revelado na pasta.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar por número ou cliente..." value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
            <option value="">Todos os status</option>
            {ORCAMENTO_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Novo Orçamento</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Orçamento</th><th>Cliente</th><th>Data</th><th>Validade</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td><b>{o.numero}</b></td>
                <td>{o.cliente_nome}</td>
                <td>{formatDate(o.data_orcamento)}</td>
                <td>{o.validade_dias} dias</td>
                <td>{formatCurrency(o.valor_total)}</td>
                <td>
                  <select className={`badge ${statusClass(o.status)}`} style={{ border: 'none', background: 'transparent', fontWeight: 700 }}
                    value={o.status} onChange={(e) => quickStatus(o, e.target.value)} disabled={o.status === 'Convertido'}>
                    {ORCAMENTO_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" title="Abrir" onClick={() => openEdit(o)}>✏️</button>
                  <button className="icon-btn" title="Exportar PDF" onClick={() => exportarPdfListagem(o)}>📄</button>
                  <button className="icon-btn" title="Compartilhar no WhatsApp" onClick={() => compartilharWhatsapp(o)}>📲</button>
                  <button className="icon-btn" title="Duplicar" onClick={() => duplicar(o)}>📋</button>
                  {o.status !== 'Convertido' && <button className="icon-btn" title="Converter em OS" onClick={() => converterEmOs(o)}>➡️</button>}
                  {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir" onClick={() => excluir(o)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhum orçamento encontrado.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 'min(920px, 94vw)' }} onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? `Orçamento ${form.numero}` : 'Novo Orçamento'}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={exportarPdf}>📄 Exportar PDF</button>}
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => compartilharWhatsapp({ id: form.id, numero: form.numero, cliente_nome: clientes.find((c) => String(c.id) === String(form.cliente_id))?.nome, cliente_whatsapp: clientes.find((c) => String(c.id) === String(form.cliente_id))?.whatsapp, cliente_telefone: clientes.find((c) => String(c.id) === String(form.cliente_id))?.telefone })}>📲 WhatsApp</button>}
                <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
              </div>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Cliente *</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ flex: 1 }} value={form.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                    <option value="">Selecione...</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" title="Cadastrar novo cliente sem sair do orçamento" onClick={abrirNovoCliente}>+ Novo</button>
                </div>
              </div>
              <div className="field">
                <label>Equipamento (opcional)</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select style={{ flex: 1 }} value={form.equipamento_id} onChange={(e) => set('equipamento_id', e.target.value)} disabled={!form.cliente_id}>
                    <option value="">Nenhum / a definir</option>
                    {equipCliente.map((eq) => <option key={eq.id} value={eq.id}>{eq.marca} {eq.modelo}</option>)}
                  </select>
                  <button type="button" className="btn btn-secondary btn-sm" title="Cadastrar novo equipamento sem sair do orçamento" disabled={!form.cliente_id} onClick={abrirNovoEquip}>+ Novo</button>
                </div>
              </div>

              <div className="field span-2">
                <label>Descrição geral / observações do serviço orçado (opcional)</label>
                <textarea value={form.descricao} onChange={(e) => set('descricao', e.target.value)} />
              </div>

              <div className="field"><label>Data do Orçamento</label><input type="date" value={form.data_orcamento} onChange={(e) => set('data_orcamento', e.target.value)} /></div>
              <div className="field"><label>Validade (dias)</label><input type="text" inputMode="numeric" value={form.validade_dias} onChange={(e) => set('validade_dias', sanitizeIntegerInput(e.target.value))} /></div>
            </div>

            <div className="section-title">Itens do Orçamento</div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: -6 }}>
              Cada item tem sua própria mão de obra. O valor da mão de obra é somado ao valor da peça no total do item e <b>não aparece no PDF do orçamento</b> — é apenas para seu controle interno.
            </p>
            {form.itens.map((it, idx) => (
              <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Produto/peça do estoque (opcional)</label>
                    <select value={it.produto_id} onChange={(e) => setItem(idx, 'produto_id', e.target.value)}>
                      <option value="">Item livre / digitar manualmente...</option>
                      {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Serviço cadastrado (opcional)</label>
                    <select value={it.servico_id} onChange={(e) => setItem(idx, 'servico_id', e.target.value)}>
                      <option value="">Nenhum...</option>
                      {servicos.map((s) => <option key={s.id} value={s.id}>{s.nome} — {formatCurrency(s.valor_padrao)}</option>)}
                    </select>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => removeItem(idx)} title="Remover item">🗑️</button>
                </div>
                <div className="form-grid cols-3" style={{ marginBottom: 10 }}>
                  <div className="field span-2"><label>Descrição do item</label><input value={it.descricao} onChange={(e) => setItem(idx, 'descricao', e.target.value)} /></div>
                  <div className="field"><label>Qtd</label><input type="text" inputMode="numeric" value={it.quantidade} onChange={(e) => setItem(idx, 'quantidade', sanitizeIntegerInput(e.target.value))} /></div>
                </div>
                <div className="form-grid cols-3">
                  <div className="field"><label>Valor da peça (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={it.valor_peca} onChange={(e) => setItem(idx, 'valor_peca', sanitizeDecimalInput(e.target.value))} /></div>
                  <div className="field"><label>Valor da mão de obra (R$) <span className="muted">(interno)</span></label><input type="text" inputMode="decimal" placeholder="0,00" value={it.valor_mao_obra} onChange={(e) => setItem(idx, 'valor_mao_obra', sanitizeDecimalInput(e.target.value))} /></div>
                  <div className="field">
                    <label>Total do item</label>
                    <div style={{ fontSize: 18, fontWeight: 700, paddingTop: 6 }}>{formatCurrency(totalDoItem(it))}</div>
                  </div>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={addItem}>+ Adicionar item</button>

            <div className="form-grid cols-2" style={{ marginTop: 18 }}>
              <div className="field"><label>Desconto (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={form.desconto} onChange={(e) => set('desconto', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field">
                <label>Valor Total Geral do Orçamento</label>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)', paddingTop: 6 }}>{formatCurrency(total)}</div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 14 }}>
              <label>Observações</label>
              <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Orçamento</button>
            </div>
          </form>
        </div>
      )}

      {novoClienteOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setNovoClienteOpen(false)}>
          <form className="modal" style={{ width: 460 }} onSubmit={salvarNovoCliente}>
            <div className="modal-header">
              <h3>Cadastro Rápido de Cliente</h3>
              <button type="button" className="icon-btn" onClick={() => setNovoClienteOpen(false)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field">
                <label>Tipo</label>
                <select value={novoCliente.tipo} onChange={(e) => setNovoCliente((f) => ({ ...f, tipo: e.target.value }))}>
                  <option value="PF">Pessoa Física</option>
                  <option value="PJ">Pessoa Jurídica</option>
                </select>
              </div>
              <div className="field"><label>CPF/CNPJ</label><input value={novoCliente.cpf_cnpj} onChange={(e) => setNovoCliente((f) => ({ ...f, cpf_cnpj: maskCpfCnpj(e.target.value, f.tipo) }))} /></div>
              <div className="field span-2"><label>Nome *</label><input value={novoCliente.nome} onChange={(e) => setNovoCliente((f) => ({ ...f, nome: e.target.value }))} autoFocus /></div>
              <div className="field"><label>Telefone</label><input value={novoCliente.telefone} onChange={(e) => setNovoCliente((f) => ({ ...f, telefone: maskPhone(e.target.value) }))} /></div>
              <div className="field"><label>WhatsApp</label><input value={novoCliente.whatsapp} onChange={(e) => setNovoCliente((f) => ({ ...f, whatsapp: maskPhone(e.target.value) }))} /></div>
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>Você pode completar o cadastro (endereço, e-mail, etc.) depois, na tela de Clientes.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setNovoClienteOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Cadastrar e Selecionar</button>
            </div>
          </form>
        </div>
      )}

      {novoEquipOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setNovoEquipOpen(false)}>
          <form className="modal" style={{ width: 460 }} onSubmit={salvarNovoEquip}>
            <div className="modal-header">
              <h3>Cadastro Rápido de Equipamento</h3>
              <button type="button" className="icon-btn" onClick={() => setNovoEquipOpen(false)}>✕</button>
            </div>
            <div className="form-grid">
              <div className="field"><label>Marca *</label><input value={novoEquip.marca} onChange={(e) => setNovoEquip((f) => ({ ...f, marca: e.target.value }))} autoFocus /></div>
              <div className="field"><label>Modelo</label><input value={novoEquip.modelo} onChange={(e) => setNovoEquip((f) => ({ ...f, modelo: e.target.value }))} /></div>
              <div className="field"><label>IMEI / Nº de Série</label><input value={novoEquip.imei} onChange={(e) => setNovoEquip((f) => ({ ...f, imei: e.target.value }))} /></div>
              <div className="field"><label>Cor</label><input value={novoEquip.cor} onChange={(e) => setNovoEquip((f) => ({ ...f, cor: e.target.value }))} /></div>
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>Fotos e demais detalhes podem ser adicionados depois, na tela de Equipamentos.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setNovoEquipOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Cadastrar e Selecionar</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
