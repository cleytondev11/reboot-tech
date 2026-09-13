import React, { useEffect, useState, useMemo } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDate, formatDateTime, todayInputValue, monthInputValue, statusClass, FORMAS_PAGAMENTO, CATEGORIAS_DESPESA, sanitizeDecimalInput, parseDecimal } from '../utils.js';

const EMPTY_LANC = {
  id: null, tipo: 'despesa', categoria: '', descricao: '', valor: '', forma_pagamento: '',
  status: 'Pendente', data_vencimento: todayInputValue(), data_pagamento: todayInputValue(), observacoes: '',
};

function isVencido(l) {
  return l.status === 'Pendente' && l.data_vencimento && l.data_vencimento < todayInputValue();
}

export default function Financeiro() {
  const { user, showToast } = useApp();
  const [tab, setTab] = useState('contas');

  return (
    <div>
      <div className="tabs-sub">
        <button className={`tab-btn ${tab === 'contas' ? 'active' : ''}`} onClick={() => setTab('contas')}>💵 Contas a Pagar/Receber</button>
        <button className={`tab-btn ${tab === 'caixa' ? 'active' : ''}`} onClick={() => setTab('caixa')}>🗄️ Caixa</button>
        <button className={`tab-btn ${tab === 'dre' ? 'active' : ''}`} onClick={() => setTab('dre')}>📊 DRE Simplificado</button>
      </div>
      {tab === 'contas' && <Contas user={user} showToast={showToast} />}
      {tab === 'caixa' && <Caixa user={user} showToast={showToast} />}
      {tab === 'dre' && <Dre />}
    </div>
  );
}

function Contas({ user, showToast }) {
  const [list, setList] = useState([]);
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('');
  const [termo, setTermo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_LANC);
  const [modalPagar, setModalPagar] = useState(null);
  const [formaPg, setFormaPg] = useState('Dinheiro');
  const [dataPg, setDataPg] = useState(todayInputValue());

  async function load() { setList(await window.api.financeiro.list(tipoFiltro, statusFiltro, termo)); }
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [tipoFiltro, statusFiltro, termo]);

  function openNew(tipo) { setForm({ ...EMPTY_LANC, tipo }); setModalOpen(true); }
  function set(field, v) { setForm((f) => ({ ...f, [field]: v })); }

  async function save(e) {
    e.preventDefault();
    if (!form.descricao.trim() || !form.valor) return showToast('Preencha descrição e valor.', 'error');
    try {
      await window.api.financeiro.save(user, { ...form, valor: parseDecimal(form.valor) });
      showToast('Lançamento salvo com sucesso.');
      setModalOpen(false);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  function abrirPagar(l) {
    setModalPagar(l);
    setFormaPg(l.forma_pagamento || 'Dinheiro');
    setDataPg(todayInputValue());
  }

  async function confirmarPagamento() {
    try {
      await window.api.financeiro.marcarPago(user, modalPagar.id, formaPg, dataPg);
      showToast(`${modalPagar.tipo === 'receita' ? 'Recebimento' : 'Pagamento'} confirmado.`);
      setModalPagar(null);
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function cancelar(l) {
    if (!confirm(`Cancelar o lançamento "${l.descricao}"?`)) return;
    try {
      await window.api.financeiro.cancelar(user, l.id);
      showToast('Lançamento cancelado.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluir(l) {
    if (!confirm(`Excluir definitivamente o lançamento "${l.descricao}" (${formatCurrency(l.valor)})? Esta ação não pode ser desfeita.`)) return;
    try {
      await window.api.financeiro.delete(user, l.id);
      showToast('Lançamento excluído.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function exportarComprovante(l) {
    try {
      const res = await window.api.pdf.exportarComprovante(l.id);
      if (res.ok) showToast('Comprovante exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar..." value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value)}>
            <option value="">Receitas e Despesas</option>
            <option value="receita">Somente Receitas</option>
            <option value="despesa">Somente Despesas</option>
          </select>
          <select value={statusFiltro} onChange={(e) => setStatusFiltro(e.target.value)}>
            <option value="">Todos os status</option>
            <option value="Pendente">Pendente</option>
            <option value="Pago">Pago</option>
            <option value="Cancelado">Cancelado</option>
          </select>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-secondary" onClick={() => openNew('receita')}>+ Receita</button>
          <button className="btn btn-primary" onClick={() => openNew('despesa')}>+ Despesa</button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map((l) => {
              const vencido = isVencido(l);
              return (
                <tr key={l.id}>
                  <td><b>{l.descricao}</b>{l.referencia ? <div className="muted" style={{ fontSize: 11 }}>{l.referencia}</div> : null}</td>
                  <td>{l.categoria || '-'}</td>
                  <td><span className="pill" style={{ color: l.tipo === 'receita' ? 'var(--success)' : 'var(--danger)' }}>{l.tipo === 'receita' ? 'Receita' : 'Despesa'}</span></td>
                  <td>{formatDate(l.data_vencimento)}</td>
                  <td>{formatCurrency(l.valor)}</td>
                  <td><span className={`badge ${statusClass(vencido ? 'Vencido' : l.status)}`}>{vencido ? 'Vencido' : l.status}</span>{l.origem_automatica ? <div className="muted" style={{ fontSize: 10.5, marginTop: 3 }}>lançado automaticamente</div> : null}</td>
                  <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    {l.status === 'Pendente' && <button className="btn btn-secondary btn-sm" onClick={() => abrirPagar(l)}>{l.tipo === 'receita' ? 'Receber' : 'Pagar'}</button>}
                    {l.status === 'Pago' && <button className="icon-btn" title="Exportar comprovante em PDF" onClick={() => exportarComprovante(l)}>📄</button>}
                    {l.status === 'Pendente' && <button className="icon-btn" title="Cancelar (mantém histórico)" onClick={() => cancelar(l)}>🚫</button>}
                    {user.papel === 'Administrador' && <button className="icon-btn" title="Excluir definitivamente" onClick={() => excluir(l)}>🗑️</button>}
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhum lançamento encontrado.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalOpen(false)}>
          <form className="modal" style={{ width: 480 }} onSubmit={save}>
            <div className="modal-header">
              <h3>Nova {form.tipo === 'receita' ? 'Receita' : 'Despesa'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalOpen(false)}>✕</button>
            </div>
            <div className="field" style={{ marginBottom: 12 }}><label>Descrição *</label><input value={form.descricao} onChange={(e) => set('descricao', e.target.value)} /></div>
            <div className="form-grid">
              <div className="field">
                <label>Categoria</label>
                {form.tipo === 'despesa' ? (
                  <select value={form.categoria} onChange={(e) => set('categoria', e.target.value)}>
                    <option value="">Selecione...</option>
                    {CATEGORIAS_DESPESA.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                ) : (
                  <input value={form.categoria} onChange={(e) => set('categoria', e.target.value)} placeholder="Ex: Vendas de acessórios" />
                )}
              </div>
              <div className="field"><label>Valor (R$) *</label><input type="text" inputMode="decimal" placeholder="0,00" value={form.valor} onChange={(e) => set('valor', sanitizeDecimalInput(e.target.value))} /></div>
              <div className="field"><label>Vencimento</label><input type="date" value={form.data_vencimento} onChange={(e) => set('data_vencimento', e.target.value)} /></div>
              <div className="field">
                <label>Status inicial</label>
                <select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  <option value="Pendente">Pendente</option>
                  <option value="Pago">Já {form.tipo === 'receita' ? 'recebido' : 'pago'}</option>
                </select>
              </div>
              {form.status === 'Pago' && (
                <>
                  <div className="field">
                    <label>Forma de Pagamento</label>
                    <select value={form.forma_pagamento} onChange={(e) => set('forma_pagamento', e.target.value)}>
                      <option value="">Selecione...</option>
                      {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label>Data do {form.tipo === 'receita' ? 'Recebimento' : 'Pagamento'}</label>
                    <input type="date" value={form.data_pagamento} onChange={(e) => set('data_pagamento', e.target.value)} />
                  </div>
                </>
              )}
              <div className="field span-2"><label>Observações</label><textarea value={form.observacoes} onChange={(e) => set('observacoes', e.target.value)} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar</button>
            </div>
          </form>
        </div>
      )}

      {modalPagar && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalPagar(null)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header">
              <h3>Confirmar {modalPagar.tipo === 'receita' ? 'Recebimento' : 'Pagamento'}</h3>
              <button type="button" className="icon-btn" onClick={() => setModalPagar(null)}>✕</button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{modalPagar.descricao} — <b>{formatCurrency(modalPagar.valor)}</b></p>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Forma de Pagamento</label>
              <select value={formaPg} onChange={(e) => setFormaPg(e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Data</label>
              <input type="date" value={dataPg} onChange={(e) => setDataPg(e.target.value)} />
            </div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={confirmarPagamento}>Confirmar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Caixa({ user, showToast }) {
  const [atual, setAtual] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [modalAbrir, setModalAbrir] = useState(false);
  const [valorAbertura, setValorAbertura] = useState('');
  const [modalMov, setModalMov] = useState(null); // 'suprimento' | 'sangria'
  const [movValor, setMovValor] = useState('');
  const [movDesc, setMovDesc] = useState('');
  const [modalFechar, setModalFechar] = useState(false);
  const [valorFechamento, setValorFechamento] = useState('');
  const [resultadoFechamento, setResultadoFechamento] = useState(null);

  async function load() {
    setAtual(await window.api.caixa.atual());
    setHistorico(await window.api.caixa.historico(10));
  }
  useEffect(() => { load(); }, []);

  async function abrirCaixa() {
    if (!valorAbertura) return showToast('Informe o valor de abertura.', 'error');
    try {
      await window.api.caixa.abrir(user, parseDecimal(valorAbertura), '');
      showToast('Caixa aberto com sucesso.');
      setModalAbrir(false);
      setValorAbertura('');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function confirmarMov() {
    if (!movValor) return showToast('Informe o valor.', 'error');
    try {
      await window.api.caixa.movimentar(user, modalMov, parseDecimal(movValor), 'Dinheiro', movDesc);
      showToast(modalMov === 'suprimento' ? 'Suprimento registrado.' : 'Sangria registrada.');
      setModalMov(null);
      setMovValor('');
      setMovDesc('');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function excluirCaixa(h) {
    if (!window.confirm(`Excluir definitivamente a abertura de caixa de ${formatDateTime(h.data_abertura)}? Essa ação não pode ser desfeita.`)) return;
    try {
      await window.api.caixa.excluir(user, h.id);
      showToast('Abertura de caixa excluída.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function fecharCaixa() {
    try {
      const res = await window.api.caixa.fechar(user, parseDecimal(valorFechamento), '');
      setResultadoFechamento(res);
      showToast('Caixa fechado com sucesso.');
      load();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  if (!atual) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 50 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Nenhum caixa aberto no momento</div>
        <p className="muted" style={{ fontSize: 13 }}>Abra o caixa para começar a registrar entradas e saídas em dinheiro.</p>
        <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => setModalAbrir(true)}>🗄️ Abrir Caixa</button>

        {historico.length > 0 && (
          <div style={{ marginTop: 30, textAlign: 'left' }}>
            <div className="section-title">Histórico de caixas</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Abertura</th><th>Fechamento</th><th>Valor Abertura</th><th>Calculado</th><th>Informado</th><th>Status</th>
                    {user.papel === 'Administrador' && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {historico.map((h) => (
                    <tr key={h.id}>
                      <td>{formatDateTime(h.data_abertura)}</td>
                      <td>{h.data_fechamento ? formatDateTime(h.data_fechamento) : '-'}</td>
                      <td>{formatCurrency(h.valor_abertura)}</td>
                      <td>{h.valor_fechamento_calculado != null ? formatCurrency(h.valor_fechamento_calculado) : '-'}</td>
                      <td>{h.valor_fechamento_informado != null ? formatCurrency(h.valor_fechamento_informado) : '-'}</td>
                      <td><span className="pill">{h.status}</span></td>
                      {user.papel === 'Administrador' && (
                        <td>
                          <button className="icon-btn" title="Excluir abertura de caixa" onClick={() => excluirCaixa(h)}>🗑️</button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {modalAbrir && (
          <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalAbrir(false)}>
            <div className="modal" style={{ width: 380 }}>
              <div className="modal-header"><h3>Abrir Caixa</h3><button className="icon-btn" onClick={() => setModalAbrir(false)}>✕</button></div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Valor inicial em caixa (R$)</label>
                <input type="text" inputMode="decimal" placeholder="0,00" value={valorAbertura} onChange={(e) => setValorAbertura(sanitizeDecimalInput(e.target.value))} autoFocus />
              </div>
              <button className="btn btn-primary" style={{ width: '100%' }} onClick={abrirCaixa}>Confirmar Abertura</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-3">
        <div className="card kpi-card">
          <div className="kpi-label">Aberto desde</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{formatDateTime(atual.sessao.data_abertura)}</div>
          <div className="muted" style={{ fontSize: 11.5 }}>por {atual.sessao.usuario_abertura_nome}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Valor de Abertura</div>
          <div className="kpi-value">{formatCurrency(atual.sessao.valor_abertura)}</div>
        </div>
        <div className="card kpi-card">
          <div className="kpi-label">Saldo Calculado Agora</div>
          <div className="kpi-value" style={{ color: 'var(--gold)' }}>{formatCurrency(atual.saldoCalculado)}</div>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 18 }}>
        <div className="toolbar-left">
          <button className="btn btn-secondary" onClick={() => setModalMov('suprimento')}>⬆️ Suprimento</button>
          <button className="btn btn-secondary" onClick={() => setModalMov('sangria')}>⬇️ Sangria</button>
        </div>
        <div className="toolbar-right">
          <button className="btn btn-danger" onClick={() => { setValorFechamento(''); setResultadoFechamento(null); setModalFechar(true); }}>🔒 Fechar Caixa</button>
        </div>
      </div>

      <div className="section-title">Movimentações desta sessão</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Data/Hora</th><th>Tipo</th><th>Descrição</th><th>Ref.</th><th>Valor</th></tr></thead>
          <tbody>
            {atual.movimentos.map((m) => (
              <tr key={m.id}>
                <td>{formatDateTime(m.criado_em)}</td>
                <td><span className="pill">{m.tipo}</span></td>
                <td className="muted">{m.descricao}</td>
                <td className="muted">{m.referencia}</td>
                <td style={{ color: (m.tipo === 'entrada' || m.tipo === 'suprimento') ? 'var(--success)' : 'var(--danger)' }}>
                  {(m.tipo === 'entrada' || m.tipo === 'suprimento') ? '+' : '-'} {formatCurrency(m.valor)}
                </td>
              </tr>
            ))}
            {atual.movimentos.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhuma movimentação ainda nesta sessão.</div></td></tr>}
          </tbody>
        </table>
      </div>

      {modalMov && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalMov(null)}>
          <div className="modal" style={{ width: 400 }}>
            <div className="modal-header"><h3>{modalMov === 'suprimento' ? 'Suprimento de Caixa' : 'Sangria de Caixa'}</h3><button className="icon-btn" onClick={() => setModalMov(null)}>✕</button></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Valor (R$)</label><input type="text" inputMode="decimal" placeholder="0,00" value={movValor} onChange={(e) => setMovValor(sanitizeDecimalInput(e.target.value))} autoFocus /></div>
            <div className="field" style={{ marginBottom: 12 }}><label>Motivo/Descrição</label><input value={movDesc} onChange={(e) => setMovDesc(e.target.value)} /></div>
            <button className="btn btn-primary" style={{ width: '100%' }} onClick={confirmarMov}>Confirmar</button>
          </div>
        </div>
      )}

      {modalFechar && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setModalFechar(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-header"><h3>Fechar Caixa</h3><button className="icon-btn" onClick={() => setModalFechar(false)}>✕</button></div>
            {!resultadoFechamento ? (
              <>
                <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>Saldo calculado pelo sistema: <b>{formatCurrency(atual.saldoCalculado)}</b></p>
                <div className="field" style={{ marginBottom: 12 }}>
                  <label>Valor contado no caixa (R$)</label>
                  <input type="text" inputMode="decimal" placeholder="0,00" value={valorFechamento} onChange={(e) => setValorFechamento(sanitizeDecimalInput(e.target.value))} autoFocus />
                </div>
                <button className="btn btn-danger" style={{ width: '100%' }} onClick={fecharCaixa}>Confirmar Fechamento</button>
              </>
            ) : (
              <div>
                <p>Saldo calculado: <b>{formatCurrency(atual.saldoCalculado)}</b></p>
                <p>Valor informado: <b>{formatCurrency(parseDecimal(valorFechamento))}</b></p>
                <p style={{ color: Math.abs(resultadoFechamento.diferenca) < 0.01 ? 'var(--success)' : 'var(--danger)' }}>
                  Diferença: <b>{formatCurrency(resultadoFechamento.diferenca)}</b>
                  {Math.abs(resultadoFechamento.diferenca) < 0.01 ? ' — Caixa bateu certinho! ✅' : ''}
                </p>
                <button className="btn btn-secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setModalFechar(false)}>Fechar</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Dre() {
  const [mes, setMes] = useState(monthInputValue());
  const [dre, setDre] = useState(null);

  async function load() { setDre(await window.api.financeiro.dre(mes)); }
  useEffect(() => { load(); }, [mes]);

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            Mês de referência:
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
          </label>
        </div>
      </div>

      {dre && (
        <div>
          <div className="grid grid-3">
            <div className="card kpi-card">
              <div className="kpi-label">Total de Receitas</div>
              <div className="kpi-value" style={{ color: 'var(--success)' }}>{formatCurrency(dre.totalReceitas)}</div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-label">Total de Despesas</div>
              <div className="kpi-value" style={{ color: 'var(--danger)' }}>{formatCurrency(dre.totalDespesas)}</div>
            </div>
            <div className="card kpi-card">
              <div className="kpi-label">Resultado do Período</div>
              <div className="kpi-value" style={{ color: dre.resultado >= 0 ? 'var(--gold)' : 'var(--danger)' }}>{formatCurrency(dre.resultado)}</div>
            </div>
          </div>

          <div className="grid grid-2" style={{ marginTop: 18 }}>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>Receitas por Categoria</div>
              {dre.receitas.length === 0 && <div className="muted">Sem receitas neste período.</div>}
              {dre.receitas.map((r) => (
                <div key={r.categoria} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{r.categoria || 'Sem categoria'}</span>
                  <b style={{ color: 'var(--success)' }}>{formatCurrency(r.total)}</b>
                </div>
              ))}
            </div>
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>Despesas por Categoria</div>
              {dre.despesas.length === 0 && <div className="muted">Sem despesas neste período.</div>}
              {dre.despesas.map((d) => (
                <div key={d.categoria} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>{d.categoria || 'Sem categoria'}</span>
                  <b style={{ color: 'var(--danger)' }}>{formatCurrency(d.total)}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
