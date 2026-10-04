import React, { useState } from 'react';
import { useApp } from '../context.jsx';
import { hojeLocal } from '../utils.js';
import { precisaAviso, statusPlano, renovarPeloWhatsapp } from '../plano.js';

// Faixa no topo do sistema quando faltam 5 dias (ou menos) para o plano vencer, ou se já venceu.
// Pode ser fechada; volta a aparecer no dia seguinte (ou no próximo login) enquanto não renovar.
export default function PlanoAviso({ plano, onVerPlano }) {
  const { user, showToast } = useApp();
  const chave = `rt-plano-aviso-${hojeLocal()}`;
  const [fechado, setFechado] = useState(() => { try { return sessionStorage.getItem(chave) === '1'; } catch { return false; } });
  if (!plano) return null;
  const st = statusPlano(plano);
  if (!precisaAviso(st) || fechado) return null;

  function fechar() {
    try { sessionStorage.setItem(chave, '1'); } catch { /* sem problema */ }
    setFechado(true);
  }

  return (
    <div className={`plano-faixa ${st.nivel}`} role="alert">
      <span className="plano-faixa-texto">{st.nivel === 'vencido' ? '⛔' : '⚠️'} {st.texto}</span>
      <span className="plano-faixa-acoes">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => renovarPeloWhatsapp(plano, user).catch((e) => showToast(String((e && e.message) || e), 'error'))}>Renovar plano</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onVerPlano}>Ver plano</button>
        <button type="button" className="icon-btn" aria-label="Fechar aviso" onClick={fechar}>✕</button>
      </span>
    </div>
  );
}
