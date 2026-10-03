import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDiaCurto, diasAte, toInputDate, FORMAS_PAGAMENTO_COM_PRAZO, FORMA_A_PRAZO } from '../utils.js';
import PrazoCampos from '../components/PrazoCampos.jsx';
import AvisoProntoModal from '../components/AvisoProntoModal.jsx';

// Bancada (Kanban): arraste a OS entre as colunas (ou toque em → / ⋮ no celular).
// Cada movimento troca o status da OS e o sistema faz a parte financeira sozinho:
//   Pronto   -> lança "A receber";
//   Entregue -> pede a forma de pagamento e dá baixa (ou gera as parcelas, se for "A prazo");
//   voltar de Pronto para uma etapa anterior -> desfaz o "A receber" automático.
const COLUNAS = [
  { key: 'analise', titulo: 'Em análise', icon: '🔍', destino: 'Em análise', status: ['Recebido', 'Em análise', 'Aguardando aprovação'] },
  { key: 'peca', titulo: 'Aguardando peça', icon: '📦', destino: 'Aguardando peça', status: ['Aguardando peça'] },
  { key: 'manutencao', titulo: 'Em manutenção', icon: '🔧', destino: 'Em manutenção', status: ['Em manutenção', 'Teste'] },
  { key: 'pronto', titulo: 'Pronto', icon: '✅', destino: 'Pronto', status: ['Pronto'] },
  { key: 'entregue', titulo: 'Entregue', icon: '🤝', destino: 'Entregue', status: ['Entregue'] },
];

function colunaDe(os) {
  return COLUNAS.find((c) => c.status.includes(os.status)) || null; // Cancelado não aparece na bancada
}

// OS entregue com o pagamento já lançado: o financeiro fica travado (para alterar, usar a tela de OS).
function bloqueada(os) {
  return os.status === 'Entregue' && Number(os.financeiro_lancado) === 1;
}

function tempoDesde(iso) {
  const d = diasAte(toInputDate(iso));
  if (d === null) return '';
  if (d >= 0) return 'hoje';
  return `há ${-d} dia${d === -1 ? '' : 's'}`;
}

function dataDaEntrega(os) {
  return toInputDate(os.data_saida) || toInputDate(os.atualizado_em) || toInputDate(os.criado_em);
}

export default function Kanban() {
  const { user, showToast } = useApp();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [termo, setTermo] = useState('');
  const [entregueDias, setEntregueDias] = useState('30');
  const [arrastando, setArrastando] = useState(null); // id da OS sendo arrastada
  const [colSobre, setColSobre] = useState(null);     // coluna sob o cursor durante o arraste
  const [menuId, setMenuId] = useState(null);         // OS com o menu ⋮ aberto
  const [pagamento, setPagamento] = useState(null);   // OS aguardando a forma de pagamento (entrega)
  const [aviso, setAviso] = useState(null);
  const [ocupada, setOcupada] = useState(false);
  const termoRef = useRef(termo);
  termoRef.current = termo;

  async function carregar() {
    try {
      setLista(await window.api.os.list(termoRef.current || '', ''));
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(carregar, 250);
    return () => clearTimeout(t);
  }, [termo]);

  // Atualiza sozinha de tempos em tempos (outro atendente pode mexer nas OS ao mesmo tempo).
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) carregar(); }, 45000);
    return () => clearInterval(t);
  }, []);

  // Fecha o menu ⋮ ao tocar fora dele.
  useEffect(() => {
    if (menuId === null) return undefined;
    const fechar = (e) => { if (!e.target.closest || !e.target.closest('.kb-menu, .kb-more')) setMenuId(null); };
    document.addEventListener('mousedown', fechar);
    document.addEventListener('touchstart', fechar);
    return () => { document.removeEventListener('mousedown', fechar); document.removeEventListener('touchstart', fechar); };
  }, [menuId]);

  const colunas = useMemo(() => {
    const limite = entregueDias === 'todas' ? null : parseInt(entregueDias, 10);
    const grupos = Object.fromEntries(COLUNAS.map((c) => [c.key, []]));
    for (const os of lista) {
      const col = colunaDe(os);
      if (!col) continue;
      if (col.key === 'entregue' && limite !== null) {
        const d = diasAte(dataDaEntrega(os));
        if (d !== null && d < -limite) continue; // entregue há mais tempo que o filtro
      }
      grupos[col.key].push(os);
    }
    // Mais antigas primeiro nas etapas de trabalho; entregues: as mais recentes primeiro.
    for (const c of COLUNAS) {
      grupos[c.key].sort((a, b) => (c.key === 'entregue' ? b.id - a.id : a.id - b.id));
    }
    return grupos;
  }, [lista, entregueDias]);

  function mover(os, destinoKey) {
    setMenuId(null);
    const col = COLUNAS.find((c) => c.key === destinoKey);
    const atual = colunaDe(os);
    if (!col || (atual && atual.key === destinoKey) || ocupada) return;
    if (bloqueada(os)) {
      showToast('Esta OS já foi entregue e o pagamento já foi lançado. Para alterar, abra a OS em Ordens de Serviço.', 'error');
      return;
    }
    if (destinoKey === 'entregue') { setPagamento(os); return; } // antes de entregar, pergunta como foi pago
    aplicarStatus(os, col.destino);
  }

  function mensagemFinanceira(os, status, res, pg) {
    const total = formatCurrency(os.valor_total);
    switch (res && res.financeiro) {
      case 'a_receber': return `${os.numero} pronta — ${total} lançado em "A receber".`;
      case 'a_receber_removido': return `${os.numero} voltou para "${status}" — o "A receber" foi retirado do financeiro.`;
      case 'recebido': return `${os.numero} entregue — recebimento de ${total} (${pg.forma_pagamento}) lançado no Financeiro.`;
      case 'a_prazo': {
        const n = parseInt(pg.parcelas, 10) || 1;
        return `${os.numero} entregue a prazo — ${n === 1 ? 'conta a receber criada' : `${n} parcelas criadas`} em Cobranças.`;
      }
      default: return 'Status atualizado com sucesso!';
    }
  }

  async function aplicarStatus(os, status, pg) {
    const anterior = lista;
    setOcupada(true);
    // Mostra a OS na nova coluna na hora; se o servidor recusar, volta como estava.
    setLista((l) => l.map((x) => (x.id === os.id ? { ...x, status, ...(pg ? { forma_pagamento: pg.forma_pagamento } : {}) } : x)));
    try {
      const res = await window.api.os.setStatus(user, os.id, status, pg || null);
      showToast(mensagemFinanceira(os, status, res, pg || {}));
      if (status === 'Pronto' && os.status !== 'Pronto') {
        setAviso({
          id: os.id, numero: os.numero, cliente_nome: os.cliente_nome,
          whatsapp: os.cliente_whatsapp, telefone: os.cliente_telefone,
          equipamento: [os.equip_marca, os.equip_modelo].filter(Boolean).join(' '),
          valor_total: os.valor_total,
        });
      }
      await carregar();
    } catch (err) {
      setLista(anterior);
      showToast(String(err.message || err), 'error');
    } finally {
      setOcupada(false);
    }
  }

  async function confirmarEntrega(os, pg) {
    setPagamento(null);
    await aplicarStatus(os, 'Entregue', pg);
  }

  const totalAbertas = COLUNAS.filter((c) => c.key !== 'entregue').reduce((s, c) => s + colunas[c.key].length, 0);

  return (
    <div>
      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar OS, cliente, aparelho..." value={termo} onChange={(e) => setTermo(e.target.value)} />
          <select value={entregueDias} onChange={(e) => setEntregueDias(e.target.value)} title="Período mostrado na coluna Entregue">
            <option value="7">Entregues: últimos 7 dias</option>
            <option value="30">Entregues: últimos 30 dias</option>
            <option value="90">Entregues: últimos 90 dias</option>
            <option value="todas">Entregues: todas</option>
          </select>
          <button className="btn btn-secondary" onClick={carregar}>🔄 Atualizar</button>
        </div>
        <div className="toolbar-right">
          <span className="pill">{totalAbertas} OS em andamento</span>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
        Arraste a OS para a próxima etapa (ou toque em → / ⋮ no celular). Ao mover para <b>Pronto</b> o valor entra em "A receber"; ao mover para <b>Entregue</b> o pagamento é lançado no Financeiro.
      </p>

      {carregando ? (
        <div className="empty-state">Carregando bancada...</div>
      ) : (
        <div className="kb-board">
          {COLUNAS.map((col, idx) => {
            const itens = colunas[col.key];
            const soma = itens.reduce((s, o) => s + (parseFloat(o.valor_total) || 0), 0);
            const proxima = COLUNAS[idx + 1];
            return (
              <div
                key={col.key}
                className={`kb-col kb-col-${col.key} ${colSobre === col.key ? 'over' : ''}`}
                onDragOver={(e) => { if (arrastando !== null) { e.preventDefault(); setColSobre(col.key); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setColSobre((c) => (c === col.key ? null : c)); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const os = lista.find((x) => x.id === arrastando);
                  setColSobre(null); setArrastando(null);
                  if (os) mover(os, col.key);
                }}
              >
                <div className="kb-col-head">
                  <span className="kb-col-title"><span className="kb-col-icon">{col.icon}</span>{col.titulo}</span>
                  <span className="kb-count">{itens.length}</span>
                </div>
                {soma > 0 && <div className="kb-col-sum muted">{formatCurrency(soma)}</div>}

                <div className="kb-list">
                  {itens.length === 0 && <div className="kb-empty">Nenhuma OS</div>}
                  {itens.map((o) => {
                    const trava = bloqueada(o);
                    const previsaoDias = o.previsao && o.status !== 'Pronto' && o.status !== 'Entregue' ? diasAte(toInputDate(o.previsao)) : null;
                    const atrasada = previsaoDias !== null && previsaoDias < 0;
                    const equip = [o.equip_marca, o.equip_modelo].filter(Boolean).join(' ');
                    return (
                      <div
                        key={o.id}
                        className={`kb-card ${trava ? 'locked' : ''} ${arrastando === o.id ? 'dragging' : ''}`}
                        draggable={!trava && !ocupada}
                        onDragStart={(e) => { setArrastando(o.id); setMenuId(null); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(o.id)); }}
                        onDragEnd={() => { setArrastando(null); setColSobre(null); }}
                      >
                        <div className="kb-card-top">
                          <span className="pill">{o.numero}</span>
                          {atrasada && <span className="badge badge-Vencido" title={`Previsão: ${formatDiaCurto(toInputDate(o.previsao))}`}>Atrasada</span>}
                          {trava && <span title="Entregue e com pagamento lançado" className="kb-lock">🔒</span>}
                          <button type="button" className="icon-btn kb-more" aria-label="Mover para..." onClick={() => setMenuId(menuId === o.id ? null : o.id)}>⋮</button>
                        </div>
                        <div className="kb-cliente">{o.cliente_nome || 'Cliente'}</div>
                        {equip && <div className="kb-equip">📱 {equip}</div>}
                        {o.defeito_informado && <div className="kb-defeito muted">{o.defeito_informado}</div>}
                        {o.status !== col.destino && <span className="kb-substatus">{o.status}</span>}
                        <div className="kb-total"><span>Total</span><b>{formatCurrency(o.valor_total)}</b></div>
                        <div className="kb-tags">
                          {o.tecnico_nome && <span className="kb-tag">🔧 {o.tecnico_nome}</span>}
                          {o.status === 'Entregue' && o.forma_pagamento && (
                            <span className={`kb-tag ${o.forma_pagamento === FORMA_A_PRAZO ? 'prazo' : 'pago'}`}>{o.forma_pagamento === FORMA_A_PRAZO ? '🗓️ A prazo' : `💳 ${o.forma_pagamento}`}</span>
                          )}
                        </div>
                        <div className="kb-card-foot">
                          <span className="muted kb-data">📅 {formatDiaCurto(toInputDate(col.key === 'entregue' ? dataDaEntrega(o) : o.data_entrada))} <small>{col.key === 'entregue' ? '' : tempoDesde(o.data_entrada)}</small></span>
                          {proxima && !trava && (
                            <button type="button" className="kb-next" title={`Mover para "${proxima.titulo}"`} disabled={ocupada} onClick={() => mover(o, proxima.key)}>→</button>
                          )}
                        </div>

                        {menuId === o.id && (
                          <div className="kb-menu">
                            <div className="kb-menu-title">Mover para...</div>
                            {COLUNAS.map((c) => (
                              <button key={c.key} type="button" disabled={trava || (colunaDe(o) && colunaDe(o).key === c.key)} onClick={() => mover(o, c.key)}>
                                {c.icon} {c.titulo}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pagamento && <EntregaModal os={pagamento} onClose={() => setPagamento(null)} onConfirm={confirmarEntrega} />}
      {aviso && <AvisoProntoModal dados={aviso} onClose={() => setAviso(null)} />}
    </div>
  );
}

// Pergunta como o cliente pagou antes de marcar a OS como Entregue.
function EntregaModal({ os, onClose, onConfirm }) {
  const { showToast } = useApp();
  const total = parseFloat(os.valor_total) || 0;
  const [forma, setForma] = useState(os.forma_pagamento || '');
  const [prazo, setPrazo] = useState({ parcelas: 1, vencimento: '' });
  const aPrazo = forma === FORMA_A_PRAZO;

  function confirmar(e) {
    e.preventDefault();
    if (total > 0 && !forma) return showToast('Selecione a forma de pagamento.', 'error');
    if (aPrazo && !prazo.vencimento) return showToast('Informe a data do 1º vencimento.', 'error');
    onConfirm(os, total > 0
      ? { forma_pagamento: forma, parcelas: aPrazo ? prazo.parcelas : undefined, primeiro_vencimento: aPrazo ? prazo.vencimento : undefined }
      : null);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" style={{ width: 'min(520px, 94vw)' }} onSubmit={confirmar}>
        <div className="modal-header">
          <h3>🤝 Entregar {os.numero}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <p style={{ marginTop: 0 }}>
          <b>{os.cliente_nome}</b>{[os.equip_marca, os.equip_modelo].filter(Boolean).length ? <> — {[os.equip_marca, os.equip_modelo].filter(Boolean).join(' ')}</> : null}
        </p>
        <div className="kb-total-grande"><span>Valor a receber</span><b>{formatCurrency(total)}</b></div>

        {total > 0 ? (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Forma de pagamento *</label>
              <select value={forma} onChange={(e) => setForma(e.target.value)} autoFocus>
                <option value="">Selecione...</option>
                {FORMAS_PAGAMENTO_COM_PRAZO.map((f) => <option key={f} value={f}>{f === FORMA_A_PRAZO ? 'A prazo (fiado / parcelado)' : f}</option>)}
              </select>
            </div>
            {aPrazo ? (
              <div style={{ marginTop: 12 }}>
                <PrazoCampos total={total} parcelas={prazo.parcelas} vencimento={prazo.vencimento} onChange={setPrazo} />
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
                O recebimento é lançado como pago hoje no Financeiro (e no Caixa, se for em Dinheiro e houver caixa aberto).
              </p>
            )}
          </>
        ) : (
          <p className="muted" style={{ fontSize: 13 }}>Esta OS está sem valor, então será entregue sem lançar recebimento.</p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Confirmar entrega</button>
        </div>
      </form>
    </div>
  );
}
