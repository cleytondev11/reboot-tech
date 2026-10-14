import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';

// Dashboard de entregas no prazo: compara, mês a mês, as OS entregues dentro e fora da previsão.
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const rotuloMes = (m) => { const [a, n] = String(m).split('-'); return `${MESES[Number(n) - 1] || n}/${String(a).slice(2)}`; };
const pct = (v) => (v == null ? '—' : `${String(v).replace('.', ',')}%`);
const num = (v, d = 1) => (v == null ? '—' : String(Math.round(v * 10 ** d) / 10 ** d).replace('.', ','));
const dataBr = (s) => { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}` : '-'; };

// Variação: seta + valor. "melhor" diz se subir é bom (true) ou ruim (false).
function Variacao({ atual, antes, sufixo = '', subirEBom = true, casas = 1 }) {
  if (atual == null || antes == null) return null;
  const d = Math.round((atual - antes) * 10 ** casas) / 10 ** casas;
  if (d === 0) return <span className="muted" style={{ fontSize: 12, marginLeft: 6 }}>= igual</span>;
  const bom = subirEBom ? d > 0 : d < 0;
  return <span style={{ fontSize: 12, fontWeight: 800, marginLeft: 6, color: bom ? 'var(--success)' : 'var(--danger)' }}>{d > 0 ? '▲ +' : '▼ −'}{String(Math.abs(d)).replace('.', ',')}{sufixo}</span>;
}

export default function EntregasPrazo() {
  const { showToast } = useApp();
  const [meses, setMeses] = useState(6);
  const [mes, setMes] = useState('');
  const [d, setD] = useState(null);

  useEffect(() => {
    let vivo = true;
    window.api.relatorios.entregasPrazo({ meses, mes: mes || undefined })
      .then((r) => { if (vivo) setD(r); })
      .catch((e) => { if (vivo) { showToast(String((e && e.message) || e), 'error'); setD({ serie: [], atrasadas: [] }); } });
    return () => { vivo = false; };
  }, [meses, mes]);

  if (!d) return <div className="empty-state">Carregando...</div>;
  const a = d.atual || {}; const p = d.anterior || {};
  const comPrev = (a.noPrazo || 0) + (a.fora || 0);
  const maxTotal = Math.max(1, ...(d.serie || []).map((x) => x.noPrazo + x.fora));

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <b style={{ fontSize: 15 }}>⏱️ Entregas no prazo — comparativo mensal</b>
        </div>
        <div className="toolbar-right" style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>Mês: <input type="month" value={mes || d.mes || ''} onChange={(e) => setMes(e.target.value)} /></label>
          <select value={meses} onChange={(e) => setMeses(Number(e.target.value))}>
            {[3, 6, 12].map((n) => <option key={n} value={n}>Últimos {n} meses</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 14 }}>
        <div className="card"><div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Entregues no prazo ({rotuloMes(d.mes || '')})</div>
          <b style={{ fontSize: 26, color: 'var(--success)' }}>{pct(a.taxa)}</b><Variacao atual={a.taxa} antes={p.taxa} sufixo=" pts" />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{a.noPrazo || 0} de {comPrev} entregas · mês anterior {pct(p.taxa)}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>OS entregues no mês</div>
          <b style={{ fontSize: 26 }}>{a.total || 0}</b><Variacao atual={a.total} antes={p.total} casas={0} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{a.noPrazo || 0} no prazo · {a.fora || 0} fora do prazo</div></div>
        <div className="card"><div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Atraso médio (fora do prazo)</div>
          <b style={{ fontSize: 26, color: 'var(--warning)' }}>{a.fora ? `${num(a.atrasoMedio)} dias` : '—'}</b><Variacao atual={a.fora ? a.atrasoMedio : null} antes={p.fora ? p.atrasoMedio : null} subirEBom={false} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>mês anterior: {p.fora ? `${num(p.atrasoMedio)} dias` : '—'}</div></div>
        <div className="card"><div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Tempo médio de reparo</div>
          <b style={{ fontSize: 26 }}>{a.tempoMedio != null ? `${num(a.tempoMedio)} dias` : '—'}</b><Variacao atual={a.tempoMedio} antes={p.tempoMedio} subirEBom={false} />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>entrada → entrega</div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14, marginBottom: 14 }}>
        <div className="card" style={{ gridColumn: 'span 1' }}>
          <div className="section-title" style={{ marginTop: 0 }}>📊 % de entregas no prazo por mês</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 200, borderBottom: '1px solid var(--border)', padding: '0 4px' }}>
            {(d.serie || []).map((x) => {
              const alto = 140; const hOk = ((x.noPrazo) / maxTotal) * alto; const hNo = ((x.fora) / maxTotal) * alto;
              return (
                <div key={x.mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${rotuloMes(x.mes)}: ${x.noPrazo} no prazo, ${x.fora} fora, ${x.semPrev} sem previsão`}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--success)', marginBottom: 3 }}>{x.taxa != null ? pct(x.taxa) : '—'}</div>
                  <div style={{ width: '70%', maxWidth: 44, height: hNo, background: 'var(--danger)', borderRadius: '5px 5px 0 0', minHeight: x.fora ? 3 : 0 }} />
                  <div style={{ width: '70%', maxWidth: 44, height: hOk, background: 'var(--success)', minHeight: x.noPrazo ? 3 : 0, borderRadius: x.fora ? 0 : '5px 5px 0 0' }} />
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, padding: '6px 4px 0' }}>
            {(d.serie || []).map((x) => <div key={x.mes} className="muted" style={{ flex: 1, textAlign: 'center', fontSize: 11 }}>{rotuloMes(x.mes)}</div>)}
          </div>
          <div className="muted" style={{ display: 'flex', gap: 14, fontSize: 11.5, marginTop: 10 }}>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--success)', marginRight: 5 }} />No prazo</span>
            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--danger)', marginRight: 5 }} />Fora do prazo</span>
            <span style={{ marginLeft: 'auto' }}>Número em cima = % no prazo</span>
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>🔁 Este mês × mês anterior</div>
          {[
            ['Taxa no prazo', pct(a.taxa), pct(p.taxa)],
            ['Entregas', a.total || 0, p.total ?? '—'],
            ['No prazo', a.noPrazo || 0, p.noPrazo ?? '—'],
            ['Fora do prazo', a.fora || 0, p.fora ?? '—'],
            ['Sem previsão informada', a.semPrev || 0, p.semPrev ?? '—'],
          ].map(([l, x, y]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <span className="muted">{l}</span><b>{x} <span className="muted" style={{ fontWeight: 500 }}>× {y}</span></b>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', fontSize: 13 }}>
            <span className="muted">Melhor mês do período</span><b>{d.melhor ? `${rotuloMes(d.melhor.mes)} · ${pct(d.melhor.taxa)}` : '—'}</b>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>⚠️ OS entregues fora do prazo em {rotuloMes(d.mes || '')}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>OS</th><th>Cliente</th><th>Aparelho</th><th>Previsão</th><th>Entrega</th><th>Atraso</th><th>Técnico</th></tr></thead>
            <tbody>
              {(d.atrasadas || []).map((o) => (
                <tr key={o.id}>
                  <td><b>{o.numero}</b></td><td>{o.cliente}</td><td>{o.aparelho || '-'}</td><td>{dataBr(o.previsao)}</td><td>{dataBr(o.saida)}</td>
                  <td><span className="badge badge-ForaDoPrazo">+{o.atraso} dia{o.atraso > 1 ? 's' : ''}</span></td><td>{o.tecnico || '-'}</td>
                </tr>
              ))}
              {(d.atrasadas || []).length === 0 && <tr><td colSpan={7}><div className="empty-state">Nenhuma OS entregue fora do prazo neste mês. 🎉</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
