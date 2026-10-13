import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatDiaCurto, formatCurrency } from '../utils.js';
import { statusPlano, DIAS_PLANO, DIAS_AVISO } from '../plano.js';

// Meu Plano: data contratada, vencimento (30 dias), dias que faltam e botão para renovar pelo WhatsApp.
export default function MeuPlano({ onRenovar }) {
  const [plano, setPlano] = useState(null);
  const [erro, setErro] = useState('');
  const [ass, setAss] = useState(null); // assinatura no cartão: { ativa, ciclo, valor, proximoVencimento }
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [msgAss, setMsgAss] = useState('');
  const [historico, setHistorico] = useState(null); // pagamentos já confirmados

  async function carregar() {
    try {
      setPlano(await window.api.plano.get());
      setErro('');
    } catch (err) {
      setErro(String((err && err.message) || err));
    }
  }
  useEffect(() => {
    carregar();
    if (window.api?.pagamento?.historico) window.api.pagamento.historico().then((r) => setHistorico((r && r.pagamentos) || [])).catch(() => setHistorico([]));
    if (window.api?.pagamento?.assinatura) window.api.pagamento.assinatura().then((r) => setAss(r && r.ativa ? r : null)).catch(() => {});
  }, []);

  async function cancelarAssinatura() {
    setCancelando(true); setMsgAss('');
    const r = await window.api.pagamento.cancelarAssinatura();
    setCancelando(false); setConfirmando(false);
    if (r && r.ok) { setAss(null); setMsgAss('Assinatura cancelada. Seu plano continua valendo até o vencimento.'); }
    else setMsgAss((r && r.error) || 'Não foi possível cancelar agora.');
  }

  if (erro) return <div className="empty-state">Não foi possível carregar o plano: {erro}</div>;
  if (!plano) return <div className="empty-state">Carregando...</div>;

  const st = statusPlano(plano);
  const contratada = plano.dataContratada ? String(plano.dataContratada).slice(0, 10) : '';
  const venc = plano.dataVencimento ? String(plano.dataVencimento).slice(0, 10) : '';
  // Barra: quanto dos 30 dias já foi usado.
  const usado = st.dias === null ? 0 : Math.min(100, Math.max(0, Math.round(((DIAS_PLANO - st.dias) / DIAS_PLANO) * 100)));

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      {(st.nivel === 'aviso' || st.nivel === 'vencido') && (
        <div className={`plano-alerta ${st.nivel}`}>
          <b>{st.nivel === 'vencido' ? '⛔ Plano vencido' : '⚠️ Seu plano está para vencer'}</b>
          <span>{st.texto}</span>
        </div>
      )}

      <div className="card plano-card">
        <div className="plano-topo">
          <div>
            <div className="muted" style={{ fontSize: 12.5 }}>{plano.empresa || 'Sua empresa'}</div>
            <h2 style={{ margin: '2px 0 0' }}>🪪 Meu Plano</h2>
          </div>
          <span className={`plano-selo ${st.nivel}`}>{st.titulo}</span>
        </div>

        <div className="plano-datas">
          <div className="plano-data"><span>Data contratada</span><b>{contratada ? formatDiaCurto(contratada) : '—'}</b></div>
          <div className="plano-data"><span>Vencimento ({DIAS_PLANO} dias)</span><b>{venc ? formatDiaCurto(venc) : '—'}</b></div>
          <div className="plano-data"><span>Dias restantes</span><b>{st.dias === null ? '—' : st.dias < 0 ? `Venceu há ${-st.dias}` : st.dias}</b></div>
        </div>

        {st.dias !== null && (
          <div className="plano-barra" title={`${usado}% do período usado`}>
            <div className={`plano-barra-fill ${st.nivel}`} style={{ width: `${usado}%` }} />
          </div>
        )}
        <p className="muted" style={{ fontSize: 12.5, margin: '10px 0 0' }}>
          {st.nivel === 'sem'
            ? st.texto
            : `Avisamos você quando faltarem ${DIAS_AVISO} dias para o vencimento. Para renovar, toque em "Renovar plano".`}
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={onRenovar}>🔄 Renovar plano</button>
          <button className="btn btn-secondary" onClick={carregar}>Atualizar</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>O botão gera o Pix ou o pagamento no cartão; ao pagar, o plano é renovado automaticamente em instantes.</p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h3 style={{ margin: '0 0 8px' }}>🧾 Histórico de pagamentos</h3>
        {historico === null ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Carregando...</p>
        ) : historico.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nenhum pagamento online registrado ainda. Os pagamentos feitos por Pix ou cartão aparecem aqui.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13.5, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }} className="muted">
                  <th style={{ padding: '4px 8px 6px 0' }}>Data</th><th style={{ padding: '4px 8px 6px 0' }}>Plano</th><th style={{ padding: '4px 8px 6px 0' }}>Forma</th><th style={{ padding: '4px 8px 6px 0', textAlign: 'right' }}>Valor</th><th style={{ padding: '4px 0 6px 8px' }}>Liberado até</th>
                </tr>
              </thead>
              <tbody>
                {historico.map((h) => (
                  <tr key={h.id} style={{ borderTop: '1px solid var(--border, #333)' }}>
                    <td style={{ padding: '6px 8px 6px 0' }}>{h.data ? formatDiaCurto(String(h.data).slice(0, 10)) : '—'}</td>
                    <td style={{ padding: '6px 8px 6px 0' }}>{h.plano || '—'}</td>
                    <td style={{ padding: '6px 8px 6px 0' }}>{h.forma || '—'}</td>
                    <td style={{ padding: '6px 8px 6px 0', textAlign: 'right', fontWeight: 700 }}>{formatCurrency(h.valor)}</td>
                    <td style={{ padding: '6px 0 6px 8px' }}>{h.ate ? formatDiaCurto(String(h.ate).slice(0, 10)) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(ass || msgAss) && (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ margin: '0 0 6px' }}>🔁 Assinatura no cartão</h3>
          {ass && (
            <>
              <p className="muted" style={{ fontSize: 13.5, margin: '0 0 10px' }}>
                Cobrança {ass.ciclo} de <b>{formatCurrency(ass.valor)}</b> no cartão{ass.proximoVencimento ? <>, próxima em <b>{formatDiaCurto(String(ass.proximoVencimento).slice(0, 10))}</b></> : ''}. O plano é renovado sozinho a cada cobrança paga.
              </p>
              {!confirmando ? (
                <button type="button" className="btn btn-secondary" onClick={() => setConfirmando(true)}>Cancelar assinatura</button>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 13.5 }}>Tem certeza? As próximas cobranças deixam de acontecer.</span>
                  <button type="button" className="btn btn-primary" disabled={cancelando} onClick={cancelarAssinatura}>{cancelando ? 'Cancelando…' : 'Sim, cancelar'}</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirmando(false)}>Voltar</button>
                </div>
              )}
            </>
          )}
          {msgAss && <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>{msgAss}</p>}
        </div>
      )}
    </div>
  );
}
