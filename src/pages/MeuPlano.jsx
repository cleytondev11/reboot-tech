import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatDiaCurto } from '../utils.js';
import { statusPlano, renovarPeloWhatsapp, DIAS_PLANO, DIAS_AVISO } from '../plano.js';

// Meu Plano: data contratada, vencimento (30 dias), dias que faltam e botão para renovar pelo WhatsApp.
export default function MeuPlano() {
  const { user, showToast } = useApp();
  const [plano, setPlano] = useState(null);
  const [erro, setErro] = useState('');

  async function carregar() {
    try {
      setPlano(await window.api.plano.get());
      setErro('');
    } catch (err) {
      setErro(String((err && err.message) || err));
    }
  }
  useEffect(() => { carregar(); }, []);

  function renovar() {
    renovarPeloWhatsapp(plano, user).catch((err) => showToast(String((err && err.message) || err), 'error'));
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
            : `Avisamos você quando faltarem ${DIAS_AVISO} dias para o vencimento. Para renovar, fale com o suporte.`}
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button className="btn btn-primary" onClick={renovar}>🔄 Renovar plano</button>
          <button className="btn btn-secondary" onClick={carregar}>Atualizar</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>O botão abre o WhatsApp do suporte com o pedido de renovação pronto.</p>
      </div>
    </div>
  );
}
