import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDate, firstDayOfMonth, todayInputValue, isCurrencyKey, isDateKey } from '../utils.js';

const REPORTS = [
  { key: 'os', label: 'Ordens de Serviço', icon: '🧾', period: true, extraStatus: true },
  { key: 'financeiro', label: 'Financeiro / Fluxo de Caixa', icon: '💵', period: true },
  { key: 'vendas', label: 'Vendas', icon: '🛒', period: true },
  { key: 'metas', label: 'Metas de Lucro', icon: '🎯', period: true },
  { key: 'clientes', label: 'Ranking de Clientes', icon: '👤', period: true },
  { key: 'tecnicos', label: 'Serviços por Técnico', icon: '🧑‍🔧', period: true },
  { key: 'pecas', label: 'Peças Mais Utilizadas', icon: '🔩', period: true },
  { key: 'estoque', label: 'Estoque Atual', icon: '📦', period: false },
  { key: 'garantias', label: 'Garantias', icon: '🛡️', period: false, garantiaToggle: true },
];

export default function Relatorios() {
  const { user, showToast } = useApp();
  const [activeKey, setActiveKey] = useState('os');
  const [dataInicio, setDataInicio] = useState(firstDayOfMonth());
  const [dataFim, setDataFim] = useState(todayInputValue());
  const [status, setStatus] = useState('');
  const [statusList, setStatusList] = useState([]);
  const [apenasAtivas, setApenasAtivas] = useState(true);
  const [buscaGarantia, setBuscaGarantia] = useState('');
  const [mesGarantia, setMesGarantia] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const active = REPORTS.find((r) => r.key === activeKey);

  const displayData = React.useMemo(() => {
    if (!data || activeKey !== 'garantias') return data;
    let rows = data.rows;
    if (buscaGarantia.trim()) {
      const termo = buscaGarantia.trim().toLowerCase();
      rows = rows.filter((r) =>
        String(r.cliente || '').toLowerCase().includes(termo) ||
        String(r.numero || '').toLowerCase().includes(termo) ||
        String(r.equipamento || '').toLowerCase().includes(termo)
      );
    }
    if (mesGarantia) {
      rows = rows.filter((r) => String(r.data_saida || '').slice(0, 7) === mesGarantia);
    }
    const resumo = {
      'Em Garantia': rows.filter((r) => r.situacao === 'Em garantia').length,
      'Expiradas': rows.filter((r) => r.situacao === 'Expirada').length,
    };
    return { ...data, rows, resumo };
  }, [data, activeKey, buscaGarantia, mesGarantia]);

  useEffect(() => { window.api.os.statusList().then(setStatusList); }, []);

  async function load() {
    setLoading(true);
    try {
      let res;
      switch (activeKey) {
        case 'os': res = await window.api.relatorios.os(user, dataInicio, dataFim, status); break;
        case 'financeiro': res = await window.api.relatorios.financeiro(user, dataInicio, dataFim); break;
        case 'vendas': res = await window.api.relatorios.vendas(user, dataInicio, dataFim); break;
        case 'metas': res = await window.api.relatorios.metas(user, dataInicio, dataFim); break;
        case 'clientes': res = await window.api.relatorios.clientes(user, dataInicio, dataFim); break;
        case 'tecnicos': res = await window.api.relatorios.tecnicos(user, dataInicio, dataFim); break;
        case 'pecas': res = await window.api.relatorios.pecas(user, dataInicio, dataFim); break;
        case 'estoque': res = await window.api.relatorios.estoque(user); break;
        case 'garantias': res = await window.api.relatorios.garantias(user, apenasAtivas); break;
        default: res = null;
      }
      setData(res);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [activeKey, dataInicio, dataFim, status, apenasAtivas]);

  async function exportar() {
    if (!displayData || displayData.rows.length === 0) return showToast('Não há dados para exportar.', 'error');
    let periodoTexto = '';
    if (active.period) periodoTexto = `Período: ${formatDate(dataInicio)} a ${formatDate(dataFim)}`;
    else if (active.key === 'garantias') {
      periodoTexto = apenasAtivas ? 'Somente OS em garantia' : 'Todas as OS entregues';
      if (mesGarantia) periodoTexto += ` · Mês: ${mesGarantia}`;
      if (buscaGarantia) periodoTexto += ` · Busca: "${buscaGarantia}"`;
    }
    try {
      const res = await window.api.pdf.exportarRelatorio(user, active.label, periodoTexto, displayData.resumo, displayData.columns, displayData.rows);
      if (res.ok) showToast('PDF exportado com sucesso.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '230px 1fr', gap: 18 }}>
      <div className="card" style={{ padding: 10, alignSelf: 'start' }}>
        {REPORTS.map((r) => (
          <button
            key={r.key}
            className="nav-item"
            style={{
              width: '100%', color: activeKey === r.key ? 'var(--gold)' : 'var(--text)',
              background: activeKey === r.key ? 'rgba(212, 175, 55, 0.12)' : 'transparent',
              fontWeight: activeKey === r.key ? 700 : 500,
            }}
            onClick={() => setActiveKey(r.key)}
          >
            <span className="icon">{r.icon}</span> {r.label}
          </button>
        ))}
      </div>

      <div>
        <div className="toolbar">
          <div className="toolbar-left">
            {active.period && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  De: <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  Até: <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                </label>
              </>
            )}
            {active.extraStatus && (
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todos os status</option>
                {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {active.garantiaToggle && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input type="checkbox" checked={apenasAtivas} onChange={(e) => setApenasAtivas(e.target.checked)} /> Somente em garantia
                </label>
                <input
                  type="text"
                  placeholder="🔎 Pesquisar cliente, nº ou equipamento"
                  value={buscaGarantia}
                  onChange={(e) => setBuscaGarantia(e.target.value)}
                  style={{ minWidth: 220 }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  Mês:
                  <input type="month" value={mesGarantia} onChange={(e) => setMesGarantia(e.target.value)} />
                </label>
                {(buscaGarantia || mesGarantia) && (
                  <button className="btn btn-secondary" onClick={() => { setBuscaGarantia(''); setMesGarantia(''); }}>Limpar filtros</button>
                )}
              </>
            )}
          </div>
          <div className="toolbar-right">
            <button className="btn btn-primary" onClick={exportar}>📄 Exportar PDF</button>
          </div>
        </div>

        {displayData && (
          <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.min(4, Object.keys(displayData.resumo).length)}, 1fr)`, marginBottom: 16 }}>
            {Object.entries(displayData.resumo).map(([label, value]) => (
              <div className="card kpi-card" key={label}>
                <div className="kpi-label">{label}</div>
                <div className="kpi-value" style={{ fontSize: 20 }}>{typeof value === 'number' && (label.toLowerCase().includes('valor') || label.toLowerCase().includes('total') || label.toLowerCase().includes('gasto') || label.toLowerCase().includes('custo') || label.toLowerCase().includes('faturado') || label.toLowerCase().includes('saldo') || label.toLowerCase().includes('ticket')) ? formatCurrency(value) : value}</div>
              </div>
            ))}
          </div>
        )}

        <div className="table-wrap">
          <table>
            {displayData && (
              <thead>
                <tr>{displayData.columns.map((c) => <th key={c.key}>{c.header}</th>)}</tr>
              </thead>
            )}
            <tbody>
              {loading && <tr><td colSpan={10}><div className="empty-state">Carregando...</div></td></tr>}
              {!loading && displayData && displayData.rows.length === 0 && (
                <tr><td colSpan={displayData.columns.length}><div className="empty-state">Nenhum dado encontrado para o período/filtro selecionado.</div></td></tr>
              )}
              {!loading && displayData && displayData.rows.map((row, idx) => (
                <tr key={idx}>
                  {displayData.columns.map((c) => (
                    <td key={c.key}>
                      {isCurrencyKey(c.key) ? formatCurrency(row[c.key]) : isDateKey(c.key) ? formatDate(row[c.key]) : (row[c.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
