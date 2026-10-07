import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency } from '../utils.js';
import { statusPlano, precisaAviso } from '../plano.js';
import { mesLocal, lerLS, gravarLS } from '../mobile.js';

// Sino do celular. Junta avisos úteis e dispara um aviso (uma vez por mês) quando a meta de lucro é batida.
export default function Notificacoes({ plano, goTo }) {
  const { user, showToast } = useApp();
  const [lista, setLista] = useState([]);
  const [aberto, setAberto] = useState(false);
  const planoRef = useRef(plano);
  planoRef.current = plano;

  async function carregar() {
    const itens = [];
    try {
      const mes = mesLocal();
      const meta = await window.api.financas.metaMensal(mes);
      const alvo = Number(meta?.metaLucro) || 0;
      if (alvo > 0 && (meta.statusRitmo === 'atingida' || Number(meta.percentualAlcancado) >= 100)) {
        itens.push({ id: `meta-${mes}`, icon: '🎯', titulo: 'Meta do mês batida!', texto: `Lucro de ${formatCurrency(meta.lucroRealizado)} para a meta de ${formatCurrency(alvo)}. Parabéns! 🎉`, destino: 'dashboard' });
        const k = `rt-meta-ok-${user?.id || 0}-${mes}`;
        if (!lerLS(k)) { gravarLS(k, '1'); showToast('🎉 Parabéns! Você bateu a meta de lucro do mês!'); }
      }
    } catch { /* sem meta */ }
    try {
      const d = await window.api.dashboard.resumo();
      if (d.prontos > 0) itens.push({ id: 'prontos', icon: '✅', titulo: `${d.prontos} aparelho(s) pronto(s) p/ retirada`, texto: 'Avise o cliente.', destino: 'kanban' });
      if (d.estoqueBaixo > 0) itens.push({ id: 'estoque', icon: '⚠️', titulo: `${d.estoqueBaixo} item(ns) com estoque baixo`, texto: 'Confira o estoque.', destino: 'estoque' });
      if (d.contasAPagarQtd > 0) itens.push({ id: 'pagar', icon: '🔴', titulo: `${d.contasAPagarQtd} conta(s) a pagar`, texto: formatCurrency(d.contasAPagar), destino: 'financeiro' });
    } catch { /* ignora */ }
    const p = planoRef.current;
    if (p) {
      const st = statusPlano(p);
      if (precisaAviso(st)) itens.push({ id: 'plano', icon: '🪪', titulo: 'Plano', texto: st.texto, destino: 'plano' });
    }
    setLista(itens);
  }

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 5 * 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (plano) carregar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [plano]);

  const novas = lista.length;
  function abrir() { setAberto((v) => !v); if (!aberto) carregar(); }

  return (
    <div className="notif-wrap">
      <button className="icon-btn" aria-label="Notificações" onClick={abrir}>🔔{novas > 0 && <span className="notif-badge">{novas}</span>}</button>
      {aberto && (
        <>
          <div className="notif-fundo" onClick={() => setAberto(false)} />
          <div className="notif-painel">
            <div className="notif-titulo">Notificações</div>
            {lista.length === 0 && <div className="muted" style={{ padding: 12, fontSize: 13 }}>Nenhuma notificação por enquanto.</div>}
            {lista.map((n) => (
              <button key={n.id} className="notif-item" onClick={() => { setAberto(false); goTo(n.destino); }}>
                <span className="notif-ico">{n.icon}</span>
                <span><b>{n.titulo}</b><br /><span className="muted" style={{ fontSize: 12 }}>{n.texto}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
