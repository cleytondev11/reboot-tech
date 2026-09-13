import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDateTime, toInputDate, todayInputValue, statusClass, CHECKLIST_ITENS, FORMAS_PAGAMENTO, sanitizeDecimalInput, parseDecimal, sanitizeIntegerInput, parseIntSafe, ACESSORIOS_OPCOES, TERMOS_ACEITE_ITENS, DECLARACAO_CONDICAO_APARELHO } from '../utils.js';
import SignaturePad from '../components/SignaturePad.jsx';
import PatternLock from '../components/PatternLock.jsx';

const EMPTY = {
  id: null, cliente_id: '', equipamento_id: '', defeito_informado: '', diagnostico: '',
  servicos_executados: '', pecas_utilizadas: '', valor_mao_obra: 0, valor_pecas: 0, desconto: 0,
  garantia_dias: 90, data_entrada: todayInputValue(), previsao: '', data_saida: '',
  status: 'Recebido', observacoes: '', assinatura_cliente: '', checklist: [], itens_pecas: [], estoque_baixado: 0,
  forma_pagamento: '', financeiro_lancado: 0, tecnico_id: '',
  termos_aceite: TERMOS_ACEITE_ITENS.map(() => false), senha_tipo: 'texto', senha_valor: '', checklist_acessorios: [],
};

export default function OrdensServico() {
  const { user, showToast } = useApp();
  const [list, setList] = useState([]);
  const [termo, setTermo] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [statusList, setStatusList] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState('dados');
  const [form, setForm] = useState(EMPTY);
  const [clientes, setClientes] = useState([]);
  const [equipCliente, setEquipCliente] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [tecnicos, setTecnicos] = useState([]);
  const [equipFotos, setEquipFotos] = useState([]);
  const [equipFotosLoading, setEquipFotosLoading] = useState(false);

  async function load() {
    const res = await window.api.os.list(termo, statusFiltro);
    setList(res);
  }
  async function loadStatusList() { setStatusList(await window.api.os.statusList()); }
  async function loadClientes() { setClientes(await window.api.clientes.list()); }
  async function loadProdutos() { setProdutos(await window.api.produtos.list()); }
  async function loadTecnicos() { setTecnicos(await window.api.usuarios.list()); }

  useEffect(() => { loadStatusList(); loadClientes(); loadProdutos(); loadTecnicos(); }, []);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [termo, statusFiltro]);

  useEffect(() => {
    if (!form.cliente_id) { setEquipCliente([]); return; }
    window.api.equipamentos.listByCliente(Number(form.cliente_id)).then(setEquipCliente);
  }, [form.cliente_id]);

  useEffect(() => {
    if (!form.equipamento_id) { setEquipFotos([]); return; }
    setEquipFotosLoading(true);
    window.api.equipamentos.get(Number(form.equipamento_id)).then((eq) => {
      let fotos = [];
      try { fotos = JSON.parse(eq?.fotos || '[]'); } catch { fotos = []; }
      setEquipFotos(fotos);
      setEquipFotosLoading(false);
    });
  }, [form.equipamento_id]);

  // Fotos do aparelho pertencem ao cadastro do Equipamento — aqui salvamos direto, sem
  // precisar sair da Ordem de Serviço para ir até a tela de Equipamentos.
  async function persistirFotosEquip(novasFotos) {
    if (!form.equipamento_id) return;
    setEquipFotos(novasFotos);
    try {
      const eq = await window.api.equipamentos.get(Number(form.equipamento_id));
      await window.api.equipamentos.save(user, { ...eq, fotos: novasFotos, acessorios: eq.acessorios || '' });
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  function handleFotosOs(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    let pendentes = files.length;
    const novasFotos = [...equipFotos];
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        novasFotos.push(reader.result);
        pendentes -= 1;
        if (pendentes === 0) persistirFotosEquip(novasFotos);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  function removeFotoOs(idx) {
    persistirFotosEquip(equipFotos.filter((_, i) => i !== idx));
  }

  function openNew() {
    setForm({
      ...EMPTY,
      checklist: CHECKLIST_ITENS.map((item) => ({ item, status: '', obs: '' })),
      itens_pecas: [],
      termos_aceite: TERMOS_ACEITE_ITENS.map(() => false),
      checklist_acessorios: [],
    });
    setTab('dados');
    setModalOpen(true);
  }

  async function openEdit(row) {
    const full = await window.api.os.get(row.id);
    let checklist = [];
    try { checklist = JSON.parse(full.checklist || '[]'); } catch { checklist = []; }
    if (checklist.length === 0) checklist = CHECKLIST_ITENS.map((item) => ({ item, status: '', obs: '' }));
    let itensPecas = [];
    try { itensPecas = JSON.parse(full.itens_pecas || '[]'); } catch { itensPecas = []; }
    let termosAceite = [];
    try { termosAceite = JSON.parse(full.termos_aceite || '[]'); } catch { termosAceite = []; }
    if (termosAceite.length !== TERMOS_ACEITE_ITENS.length) termosAceite = TERMOS_ACEITE_ITENS.map((_, i) => !!termosAceite[i]);
    let checklistAcessorios = [];
    try { checklistAcessorios = JSON.parse(full.checklist_acessorios || '[]'); } catch { checklistAcessorios = []; }
    setForm({
      ...full,
      cliente_id: String(full.cliente_id),
      tecnico_id: full.tecnico_id ? String(full.tecnico_id) : '',
      equipamento_id: String(full.equipamento_id),
      data_entrada: toInputDate(full.data_entrada),
      previsao: toInputDate(full.previsao),
      data_saida: toInputDate(full.data_saida),
      checklist,
      itens_pecas: itensPecas,
      termos_aceite: termosAceite,
      senha_tipo: full.senha_tipo || 'texto',
      senha_valor: full.senha_valor || '',
      checklist_acessorios: checklistAcessorios,
    });
    setTab('dados');
    setModalOpen(true);
  }

  function set(field, value) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      // Ao marcar como Entregue, preenche a data de saída automaticamente se ainda estiver vazia
      // (evita que relatórios de garantia e o "entregues hoje" do dashboard fiquem sem dado).
      if (field === 'status' && value === 'Entregue' && !f.data_saida) {
        next.data_saida = todayInputValue();
      }
      return next;
    });
  }

  function setItemPeca(idx, field, value) {
    setForm((f) => {
      const itens = [...f.itens_pecas];
      const it = { ...itens[idx], [field]: value };
      if (field === 'produto_id' && value) {
        const p = produtos.find((p) => String(p.id) === String(value));
        if (p) { it.descricao = p.nome; it.valor_unit = p.valor_venda; }
      }
      itens[idx] = it;
      const novaSoma = itens.reduce((s, i) => s + (parseDecimal(i.quantidade) || 0) * (parseDecimal(i.valor_unit) || 0), 0);
      return { ...f, itens_pecas: itens, valor_pecas: novaSoma };
    });
  }

  function addItemPeca() {
    setForm((f) => ({ ...f, itens_pecas: [...f.itens_pecas, { produto_id: '', descricao: '', quantidade: 1, valor_unit: 0 }] }));
  }

  function removeItemPeca(idx) {
    setForm((f) => {
      const itens = f.itens_pecas.filter((_, i) => i !== idx);
      const novaSoma = itens.reduce((s, i) => s + (parseDecimal(i.quantidade) || 0) * (parseDecimal(i.valor_unit) || 0), 0);
      return { ...f, itens_pecas: itens, valor_pecas: itens.length > 0 ? novaSoma : f.valor_pecas };
    });
  }

  function setChecklistStatus(idx, status) {
    setForm((f) => {
      const arr = [...f.checklist];
      arr[idx] = { ...arr[idx], status: arr[idx].status === status ? '' : status };
      return { ...f, checklist: arr };
    });
  }

  function toggleTermo(idx) {
    setForm((f) => {
      const arr = [...f.termos_aceite];
      arr[idx] = !arr[idx];
      return { ...f, termos_aceite: arr };
    });
  }

  function toggleAcessorioChecklist(a) {
    setForm((f) => {
      const arr = f.checklist_acessorios || [];
      const has = arr.includes(a);
      return { ...f, checklist_acessorios: has ? arr.filter((x) => x !== a) : [...arr, a] };
    });
  }

  const total = useMemo(() => {
    const mao = parseDecimal(form.valor_mao_obra);
    const pecas = parseDecimal(form.valor_pecas);
    const desc = parseDecimal(form.desconto);
    return Math.max(0, mao + pecas - desc);
  }, [form.valor_mao_obra, form.valor_pecas, form.desconto]);

  async function save(e) {
    e.preventDefault();
    if (!form.cliente_id) return showToast('Selecione o cliente.', 'error');
    if (!form.equipamento_id) return showToast('Selecione o equipamento.', 'error');
    try {
      const payload = {
        ...form,
        valor_mao_obra: parseDecimal(form.valor_mao_obra),
        valor_pecas: parseDecimal(form.valor_pecas),
        desconto: parseDecimal(form.desconto),
        garantia_dias: parseIntSafe(form.garantia_dias) || 90,
        itens_pecas: form.itens_pecas
          .filter((i) => i.produto_id)
          .map((i) => ({ ...i, quantidade: parseIntSafe(i.quantidade) || 1, valor_unit: parseDecimal(i.valor_unit) })),
      };
      const res = await window.api.os.save(user, payload);
      showToast(`Ordem de Serviço ${res.numero || form.numero || ''} salva com sucesso.`);
      setModalOpen(false);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function quickStatus(row, status) {
    try {
      await window.api.os.setStatus(user, row.id, status);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function exportarPdf() {
    const res = await window.api.pdf.exportarOS(form.id);
    if (res.ok) showToast('PDF exportado com sucesso.');
  }

  async function exportarChecklistPdf() {
    const res = await window.api.pdf.exportarChecklist(form.id);
    if (res.ok) showToast('Checklist em PDF exportado com sucesso.');
  }

  async function exportarGarantiaPdf(id) {
    try {
      const res = await window.api.pdf.exportarGarantia(id);
      if (res.ok) showToast('Termo de Garantia exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(row) {
    if (!confirm(`Excluir a Ordem de Serviço ${row.numero} (${row.cliente_nome})? Se houver peças baixadas do estoque, elas serão estornadas, e os lançamentos financeiros gerados automaticamente por ela serão removidos. Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.os.delete(user, row.id);
      showToast('Ordem de Serviço excluída.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function imprimirCupom(id) {
    try {
      await window.api.impressora.imprimirCupomOS(id);
      showToast('Recibo enviado para a impressora.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function exportarPdfListagem(row) {
    try {
      const res = await window.api.pdf.exportarOS(row.id);
      if (res.ok) showToast('PDF exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function compartilharWhatsapp(row) {
    try {
      const telefone = row.cliente_whatsapp || row.cliente_telefone;
      if (!telefone) return showToast('Este cliente não possui WhatsApp/telefone cadastrado.', 'error');
      const res = await window.api.pdf.exportarOS(row.id);
      if (!res.ok) return;
      const msg = `Olá! Segue a Ordem de Serviço ${row.numero}${row.cliente_nome ? ' de ' + row.cliente_nome : ''}. Anexei o PDF aqui, um momento.`;
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
          <input className="search-input" placeholder="Buscar por número, cliente, marca, modelo ou IMEI..." value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
            <option value="">Todos os status</option>
            {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-primary" onClick={openNew}>+ Nova Ordem de Serviço</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>OS</th><th>Cliente</th><th>Equipamento</th><th>Entrada</th><th>Saída</th><th>Valor</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((o) => (
              <tr key={o.id}>
                <td><b>{o.numero}</b></td>
                <td>{o.cliente_nome}</td>
                <td>{o.equip_marca} {o.equip_modelo}</td>
                <td>{formatDateTime(o.data_entrada)}</td>
                <td>{o.data_saida ? formatDateTime(o.data_saida) : '-'}</td>
                <td>{formatCurrency(o.valor_total)}</td>
                <td>
                  <select className={`badge ${statusClass(o.status)}`} style={{ border: 'none', background: 'transparent', fontWeight: 700 }}
                    value={o.status} onChange={(e) => quickStatus(o, e.target.value)}>
                    {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button className="icon-btn" title="Abrir" onClick={() => openEdit(o)}>✏️</button>
                  <button className="icon-btn" title="Exportar PDF" onClick={() => exportarPdfListagem(o)}>📄</button>
                  <button className="icon-btn" title="Imprimir Recibo (impressora térmica)" onClick={() => imprimirCupom(o.id)}>🖨️</button>
                  <button className="icon-btn" title="Compartilhar no WhatsApp" onClick={() => compartilharWhatsapp(o)}>📲</button>
                  {o.status === 'Entregue' && <button className="icon-btn" title="Termo de Garantia" onClick={() => exportarGarantiaPdf(o.id)}>🛡️</button>}
                  {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir" onClick={() => excluir(o)}>🗑️</button>}
                </td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhuma ordem de serviço encontrada.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 'min(980px, 94vw)' }} onSubmit={save}>
            <div className="modal-header">
              <h3>{form.id ? `Ordem de Serviço ${form.numero}` : 'Nova Ordem de Serviço'}</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={exportarPdf}>📄 Exportar PDF</button>}
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => imprimirCupom(form.id)}>🖨️ Imprimir Recibo</button>}
                {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={() => compartilharWhatsapp({ id: form.id, numero: form.numero, cliente_nome: clientes.find((c) => String(c.id) === String(form.cliente_id))?.nome, cliente_whatsapp: clientes.find((c) => String(c.id) === String(form.cliente_id))?.whatsapp, cliente_telefone: clientes.find((c) => String(c.id) === String(form.cliente_id))?.telefone })}>📲 WhatsApp</button>}
                {form.id && form.status === 'Entregue' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => exportarGarantiaPdf(form.id)}>🛡️ Termo de Garantia</button>}
                <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
              </div>
            </div>

            <div className="tabs">
              {['dados', 'checklist', 'orcamento', 'assinatura'].map((t) => (
                <div key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                  {{ dados: 'Dados Gerais', checklist: 'Checklist de Entrada', orcamento: 'Orçamento & Status', assinatura: 'Assinatura' }[t]}
                </div>
              ))}
            </div>

            {tab === 'dados' && (
              <div className="form-grid">
                <div className="field">
                  <label>Cliente *</label>
                  <select value={form.cliente_id} onChange={(e) => set('cliente_id', e.target.value)}>
                    <option value="">Selecione...</option>
                    {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Equipamento *</label>
                  <select value={form.equipamento_id} onChange={(e) => set('equipamento_id', e.target.value)} disabled={!form.cliente_id}>
                    <option value="">{form.cliente_id ? 'Selecione...' : 'Selecione o cliente primeiro'}</option>
                    {equipCliente.map((eq) => <option key={eq.id} value={eq.id}>{eq.marca} {eq.modelo} {eq.imei ? `(IMEI ${eq.imei})` : ''}</option>)}
                  </select>
                </div>

                <div className="field span-2">
                  <label>Defeito informado pelo cliente</label>
                  <textarea value={form.defeito_informado} onChange={(e) => set('defeito_informado', e.target.value)} />
                </div>
                <div className="field span-2">
                  <label>Diagnóstico técnico</label>
                  <textarea value={form.diagnostico} onChange={(e) => set('diagnostico', e.target.value)} />
                </div>

                <div className="field">
                  <label>Data de Entrada</label>
                  <input type="date" value={form.data_entrada} onChange={(e) => set('data_entrada', e.target.value)} />
                </div>
                <div className="field">
                  <label>Previsão de Entrega</label>
                  <input type="date" value={form.previsao} onChange={(e) => set('previsao', e.target.value)} />
                </div>

                <div className="field span-2">
                  <label>Técnico Responsável</label>
                  <select value={form.tecnico_id} onChange={(e) => set('tecnico_id', e.target.value)}>
                    <option value="">Não definido</option>
                    {tecnicos.map((t) => <option key={t.id} value={t.id}>{t.nome} {t.papel === 'Tecnico' ? '' : `(${t.papel})`}</option>)}
                  </select>
                </div>

                <div className="field span-2">
                  <label>Observações</label>
                  <textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} />
                </div>
              </div>
            )}

            {tab === 'checklist' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Marque o status de cada item na vistoria de entrada: <b style={{ color: 'var(--success)' }}>✓ OK</b> · <b style={{ color: 'var(--danger)' }}>✗ Avaria</b> · <b>— N/A</b></p>
                  {form.id && <button type="button" className="btn btn-secondary btn-sm" onClick={exportarChecklistPdf}>📄 Exportar Checklist em PDF</button>}
                </div>
                <div className="checklist-grid">
                  {form.checklist.map((c, idx) => (
                    <div className="checklist-item" key={c.item}>
                      <span className="name">{c.item}</span>
                      <div className="checklist-status-group">
                        <button type="button" className={`chk-btn ${c.status === 'ok' ? 'active-ok' : ''}`} onClick={() => setChecklistStatus(idx, 'ok')}>✓</button>
                        <button type="button" className={`chk-btn ${c.status === 'avaria' ? 'active-avaria' : ''}`} onClick={() => setChecklistStatus(idx, 'avaria')}>✗</button>
                        <button type="button" className={`chk-btn ${c.status === 'na' ? 'active-na' : ''}`} onClick={() => setChecklistStatus(idx, 'na')}>—</button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="section-title">Fotos do Aparelho</div>
                {!form.equipamento_id && <p className="muted" style={{ fontSize: 12 }}>Selecione o equipamento na aba "Dados Gerais" para anexar fotos.</p>}
                {form.equipamento_id && (
                  <div style={{ marginBottom: 10 }}>
                    <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>Registre o estado do aparelho na entrada. As fotos aparecem automaticamente no PDF da OS.</p>
                    <input type="file" accept="image/*" multiple onChange={handleFotosOs} disabled={equipFotosLoading} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      {equipFotos.map((f, i) => (
                        <div key={i} style={{ position: 'relative' }}>
                          <img src={f} style={{ width: 70, height: 70, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                          <button type="button" onClick={() => removeFotoOs(i)} style={{ position: 'absolute', top: -6, right: -6, background: 'var(--danger)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, fontSize: 11, cursor: 'pointer' }}>✕</button>
                        </div>
                      ))}
                      {equipFotos.length === 0 && !equipFotosLoading && <span className="muted" style={{ fontSize: 12 }}>Nenhuma foto anexada ainda.</span>}
                    </div>
                  </div>
                )}

                <div className="section-title">Acessórios Entregues</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
                  {ACESSORIOS_OPCOES.map((a) => (
                    <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, background: 'var(--bg-elev-2)', border: '1px solid var(--border)', padding: '5px 10px', borderRadius: 999 }}>
                      <input type="checkbox" checked={(form.checklist_acessorios || []).includes(a)} onChange={() => toggleAcessorioChecklist(a)} />
                      {a}
                    </label>
                  ))}
                </div>

                <div className="section-title">Senha / PIN / Padrão de Desbloqueio</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button type="button" className={`tab-btn ${form.senha_tipo !== 'padrao' ? 'active' : ''}`} onClick={() => set('senha_tipo', 'texto')}>Senha / PIN (texto)</button>
                  <button type="button" className={`tab-btn ${form.senha_tipo === 'padrao' ? 'active' : ''}`} onClick={() => set('senha_tipo', 'padrao')}>Padrão de Desbloqueio</button>
                </div>
                {form.senha_tipo === 'padrao' ? (
                  <PatternLock value={form.senha_valor} onChange={(v) => set('senha_valor', v)} />
                ) : (
                  <div className="field" style={{ maxWidth: 320 }}>
                    <input placeholder="Ex: 1234 ou 0000" value={form.senha_valor} onChange={(e) => set('senha_valor', e.target.value)} />
                  </div>
                )}

                <div className="section-title">8. Termos e Declarações</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
                  {TERMOS_ACEITE_ITENS.map((texto, idx) => (
                    <label key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, lineHeight: 1.4 }}>
                      <input type="checkbox" style={{ marginTop: 3 }} checked={!!form.termos_aceite[idx]} onChange={() => toggleTermo(idx)} />
                      <span>{texto}</span>
                    </label>
                  ))}
                </div>
                <div className="section-title">Declaração de Condição do Aparelho</div>
                <p className="muted" style={{ fontSize: 11.5, lineHeight: 1.5, background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>{DECLARACAO_CONDICAO_APARELHO}</p>
              </div>
            )}

            {tab === 'orcamento' && (
              <div>
                <div className="form-grid cols-3">
                  <div className="field">
                    <label>Serviços executados</label>
                    <textarea value={form.servicos_executados} onChange={(e) => set('servicos_executados', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Peças utilizadas (observações livres)</label>
                    <textarea value={form.pecas_utilizadas} onChange={(e) => set('pecas_utilizadas', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                      {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                <div className="section-title">Peças do estoque utilizadas</div>
                {form.estoque_baixado ? (
                  <p className="muted" style={{ fontSize: 12 }}>✅ O estoque já foi baixado para as peças abaixo (não é possível editar após a baixa).</p>
                ) : (
                  <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Ao salvar, a quantidade será baixada automaticamente do estoque (apenas uma vez).</p>
                )}
                {form.itens_pecas.map((it, idx) => (
                  <div className="item-row" key={idx}>
                    <div className="field">
                      <label>Produto do estoque</label>
                      <select value={it.produto_id} onChange={(e) => setItemPeca(idx, 'produto_id', e.target.value)} disabled={!!form.estoque_baixado}>
                        <option value="">Selecione...</option>
                        {produtos.map((p) => <option key={p.id} value={p.id}>{p.nome} (estoque: {p.quantidade})</option>)}
                      </select>
                    </div>
                    <div className="field"><label>Descrição</label><input value={it.descricao} onChange={(e) => setItemPeca(idx, 'descricao', e.target.value)} disabled={!!form.estoque_baixado} /></div>
                    <div className="field"><label>Qtd</label><input type="text" inputMode="numeric" value={it.quantidade} onChange={(e) => setItemPeca(idx, 'quantidade', sanitizeIntegerInput(e.target.value))} disabled={!!form.estoque_baixado} /></div>
                    <div className="field"><label>Valor Unit.</label><input type="text" inputMode="decimal" placeholder="0,00" value={it.valor_unit} onChange={(e) => setItemPeca(idx, 'valor_unit', sanitizeDecimalInput(e.target.value))} disabled={!!form.estoque_baixado} /></div>
                    {!form.estoque_baixado && <button type="button" className="icon-btn" onClick={() => removeItemPeca(idx)}>🗑️</button>}
                  </div>
                ))}
                {!form.estoque_baixado && <button type="button" className="btn btn-secondary btn-sm" onClick={addItemPeca}>+ Adicionar peça do estoque</button>}

                <div className="form-grid cols-3" style={{ marginTop: 18 }}>
                  <div className="field">
                    <label>Valor Mão de Obra (R$)</label>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={form.valor_mao_obra} onChange={(e) => set('valor_mao_obra', sanitizeDecimalInput(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>Valor Peças (R$) {form.itens_pecas.length > 0 && <span className="muted">(sugerido pelas peças abaixo — pode editar)</span>}</label>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={form.valor_pecas} onChange={(e) => set('valor_pecas', sanitizeDecimalInput(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>Desconto (R$)</label>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={form.desconto} onChange={(e) => set('desconto', sanitizeDecimalInput(e.target.value))} />
                  </div>

                  <div className="field">
                    <label>Garantia (dias)</label>
                    <input type="text" inputMode="numeric" value={form.garantia_dias} onChange={(e) => set('garantia_dias', sanitizeIntegerInput(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>Data de Saída</label>
                    <input type="date" value={form.data_saida} onChange={(e) => set('data_saida', e.target.value)} />
                  </div>
                  <div className="field">
                    <label>Valor Total</label>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)', paddingTop: 6 }}>{formatCurrency(total)}</div>
                  </div>
                </div>

                {form.status === 'Entregue' && (
                  <div className="field" style={{ marginTop: 14, maxWidth: 320 }}>
                    <label>Forma de Pagamento {!form.financeiro_lancado && <span style={{ color: 'var(--danger)' }}>*</span>}</label>
                    <select value={form.forma_pagamento || ''} onChange={(e) => set('forma_pagamento', e.target.value)} disabled={!!form.financeiro_lancado}>
                      <option value="">Selecione...</option>
                      {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                    {form.financeiro_lancado ? (
                      <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>✅ Recebimento já lançado no Financeiro.</p>
                    ) : (
                      <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Ao salvar com o status "Entregue" e a forma de pagamento selecionada, o recebimento é lançado automaticamente no Financeiro (e no Caixa, se for em Dinheiro e houver caixa aberto).</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'assinatura' && (
              <div>
                <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Assinatura do cliente confirmando o recebimento das condições do checklist e orçamento.</p>
                <SignaturePad value={form.assinatura_cliente} onChange={(v) => set('assinatura_cliente', v)} />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Ordem de Serviço</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
