import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDate, hojeLocal, sanitizeDecimalInput } from '../utils.js';

// Comissões de funcionários: define a % de cada um (sobre OS entregues e sobre vendas),
// mostra o que cada funcionário tem a receber no período e permite dar baixa (pagar).
// Ao pagar, o sistema lança a despesa "Comissões" no Financeiro.

function primeiroDiaMes(delta = 0) {
  const h = hojeLocal(); // AAAA-MM-DD
  const [a, m] = h.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function ultimoDiaMes(delta = 0) {
  const h = hojeLocal();
  const [a, m] = h.split('-').map(Number);
  const d = new Date(a, m + delta, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function Comissoes() {
  const { showToast } = useApp();
  const [aba, setAba] = useState('comissoes'); // comissoes | config
  const [inicio, setInicio] = useState(primeiroDiaMes(0));
  const [fim, setFim] = useState(ultimoDiaMes(0));
  const [funcId, setFuncId] = useState('');
  const [situacao, setSituacao] = useState('pendente'); // todas | pendente | paga
  const [dados, setDados] = useState({ itens: [], funcionarios: [] });
  const [config, setConfig] = useState([]);
  const [sel, setSel] = useState({});
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      const [r, c] = await Promise.all([
        window.api.comissoes.resumo({ inicio, fim, usuario_id: funcId || undefined }),
        window.api.comissoes.config(),
      ]);
      setDados(r); setConfig(c); setSel({});
    } catch (e) { showToast(String(e.message || e), 'error'); }
    setCarregando(false);
  }
  useEffect(() => { carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [inicio, fim, funcId]);

  const itens = useMemo(() => dados.itens.filter((i) => situacao === 'todas' || (situacao === 'paga' ? i.paga : !i.paga)), [dados, situacao]);
  const tot = useMemo(() => dados.itens.reduce((a, i) => { a.total += i.valor; if (i.paga) a.pago += i.valor; else a.pendente += i.valor; return a; }, { total: 0, pago: 0, pendente: 0 }), [dados]);
  const chave = (i) => `${i.tipo}:${i.ref_id}`;
  const selecionados = itens.filter((i) => !i.paga && sel[chave(i)]);
  const somaSel = selecionados.reduce((a, i) => a + i.valor, 0);

  function marcarTodos(v) {
    const n = {}; itens.filter((i) => !i.paga).forEach((i) => { n[chave(i)] = v; }); setSel(n);
  }

  async function pagar(lista) {
    if (lista.length === 0) return showToast('Selecione ao menos uma comissão pendente.', 'error');
    const total = lista.reduce((a, i) => a + i.valor, 0);
    if (!window.confirm(`Pagar ${lista.length} comissão(ões) no total de ${formatCurrency(total)}?\nSerá lançada uma despesa "Comissões" no Financeiro.`)) return;
    try {
      const r = await window.api.comissoes.pagar(lista.map((i) => ({ tipo: i.tipo, ref_id: i.ref_id })));
      showToast(`Comissões pagas: ${formatCurrency(r.total)}.`);
      carregar();
    } catch (e) { showToast(String(e.message || e), 'error'); }
  }

  async function desfazer(i) {
    if (!window.confirm('Desfazer o pagamento desta comissão? O lançamento no Financeiro será ajustado/cancelado.')) return;
    try { await window.api.comissoes.desfazer(i.tipo, i.ref_id); showToast('Pagamento desfeito.'); carregar(); }
    catch (e) { showToast(String(e.message || e), 'error'); }
  }

  function setCfg(id, campo, valor) {
    setConfig((l) => l.map((c) => (c.usuario_id === id ? { ...c, [campo]: valor } : c)));
  }
  async function salvarCfg(c) {
    try {
      await window.api.comissoes.salvarConfig({ usuario_id: c.usuario_id, pct_os: parseFloat(String(c.pct_os).replace(',', '.')) || 0, pct_venda: parseFloat(String(c.pct_venda).replace(',', '.')) || 0, base_os: c.base_os });
      showToast(`Comissão de ${c.nome} salva.`);
      carregar();
    } catch (e) { showToast(String(e.message || e), 'error'); }
  }

  function periodo(delta) { setInicio(primeiroDiaMes(delta)); setFim(ultimoDiaMes(delta)); }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn ${aba === 'comissoes' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAba('comissoes')}>💵 Comissões</button>
        <button className={`btn ${aba === 'config' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAba('config')}>⚙️ Configurar %</button>
      </div>

      {aba === 'config' && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Percentual de comissão por funcionário</div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            <b>OS:</b> vale para ordens <b>Entregues</b> em que o funcionário é o técnico responsável. <b>Venda:</b> vale para vendas lançadas por ele (exceto canceladas). Deixe 0 para quem não recebe comissão.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Funcionário</th><th>% sobre OS</th><th>Base da OS</th><th>% sobre vendas</th><th></th></tr></thead>
              <tbody>
                {config.map((c) => (
                  <tr key={c.usuario_id}>
                    <td><b>{c.nome}</b><div className="muted" style={{ fontSize: 11.5 }}>{c.papel}</div></td>
                    <td><input style={{ width: 80 }} inputMode="decimal" data-sem-maiuscula value={c.pct_os} onChange={(e) => setCfg(c.usuario_id, 'pct_os', sanitizeDecimalInput(e.target.value))} /> %</td>
                    <td>
                      <select value={c.base_os} onChange={(e) => setCfg(c.usuario_id, 'base_os', e.target.value)}>
                        <option value="mao_obra">Só mão de obra</option>
                        <option value="total">Valor total da OS</option>
                      </select>
                    </td>
                    <td><input style={{ width: 80 }} inputMode="decimal" data-sem-maiuscula value={c.pct_venda} onChange={(e) => setCfg(c.usuario_id, 'pct_venda', sanitizeDecimalInput(e.target.value))} /> %</td>
                    <td><button className="btn btn-primary btn-sm" onClick={() => salvarCfg(c)}>Salvar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {aba === 'comissoes' && (
        <>
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <div className="field" style={{ margin: 0 }}><label>De</label><input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
              <div className="field" style={{ margin: 0 }}><label>Até</label><input type="date" value={fim} onChange={(e) => setFim(e.target.value)} /></div>
              <button className="btn btn-secondary btn-sm" onClick={() => periodo(0)}>Este mês</button>
              <button className="btn btn-secondary btn-sm" onClick={() => periodo(-1)}>Mês passado</button>
              <div className="field" style={{ margin: 0 }}>
                <label>Funcionário</label>
                <select value={funcId} onChange={(e) => setFuncId(e.target.value)}>
                  <option value="">Todos</option>
                  {config.map((c) => <option key={c.usuario_id} value={c.usuario_id}>{c.nome}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label>Situação</label>
                <select value={situacao} onChange={(e) => setSituacao(e.target.value)}>
                  <option value="pendente">A pagar</option>
                  <option value="paga">Pagas</option>
                  <option value="todas">Todas</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-3" style={{ marginBottom: 14 }}>
            <div className="card kpi-card"><div className="kpi-icon">💵</div><div className="kpi-label">Total de comissões</div><div className="kpi-value">{formatCurrency(tot.total)}</div></div>
            <div className="card kpi-card"><div className="kpi-icon">⏳</div><div className="kpi-label">A pagar</div><div className="kpi-value" style={{ color: tot.pendente > 0 ? 'var(--warning)' : undefined }}>{formatCurrency(tot.pendente)}</div></div>
            <div className="card kpi-card"><div className="kpi-icon">✅</div><div className="kpi-label">Já pagas</div><div className="kpi-value">{formatCurrency(tot.pago)}</div></div>
          </div>

          {dados.funcionarios.length > 0 && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Por funcionário</div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Funcionário</th><th>Itens</th><th>Total</th><th>A pagar</th><th>Pago</th><th></th></tr></thead>
                  <tbody>
                    {dados.funcionarios.map((f) => (
                      <tr key={f.usuario_id}>
                        <td><b>{f.nome}</b></td><td>{f.qtd}</td><td>{formatCurrency(f.total)}</td>
                        <td style={{ color: f.pendente > 0 ? 'var(--warning)' : undefined }}>{formatCurrency(f.pendente)}</td>
                        <td>{formatCurrency(f.pago)}</td>
                        <td>{f.pendente > 0 && <button className="btn btn-primary btn-sm" onClick={() => pagar(dados.itens.filter((i) => !i.paga && i.usuario_id === f.usuario_id))}>Pagar tudo</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <div className="section-title" style={{ margin: 0 }}>Detalhamento</div>
              {selecionados.length > 0 && <button className="btn btn-primary" onClick={() => pagar(selecionados)}>Pagar selecionadas ({selecionados.length}) — {formatCurrency(somaSel)}</button>}
            </div>
            {carregando && <div className="muted">Carregando...</div>}
            {!carregando && itens.length === 0 && <div className="muted">Nenhuma comissão neste período. Confira se as porcentagens foram configuradas (aba "Configurar %") e se as OS têm técnico responsável e estão Entregues.</div>}
            {itens.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th><input type="checkbox" onChange={(e) => marcarTodos(e.target.checked)} /></th><th>Data</th><th>Origem</th><th>Cliente</th><th>Funcionário</th><th>Base</th><th>%</th><th>Comissão</th><th>Situação</th></tr></thead>
                  <tbody>
                    {itens.map((i) => (
                      <tr key={chave(i)}>
                        <td>{!i.paga && <input type="checkbox" checked={!!sel[chave(i)]} onChange={(e) => setSel((s) => ({ ...s, [chave(i)]: e.target.checked }))} />}</td>
                        <td>{formatDate(i.data)}</td>
                        <td>{i.tipo === 'os' ? '🧾 OS' : '🛒 Venda'} {i.numero}</td>
                        <td>{i.cliente || '—'}</td>
                        <td>{i.usuario_nome}</td>
                        <td>{formatCurrency(i.base)}</td>
                        <td>{i.pct}%</td>
                        <td><b>{formatCurrency(i.valor)}</b></td>
                        <td>{i.paga
                          ? <span>✅ Paga {i.pago_em ? formatDate(i.pago_em) : ''} <button className="btn btn-secondary btn-sm" onClick={() => desfazer(i)}>Desfazer</button></span>
                          : <span style={{ color: 'var(--warning)' }}>A pagar</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
