import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency, formatDiaCurto, diasAte, hojeLocal, somarMesesDia, FORMAS_PAGAMENTO } from '../utils.js';

// Cobranças: tudo que os clientes ainda devem (vendas e OS "a prazo", "A receber" de OS prontas e
// lançamentos manuais a receber). Daqui dá para cobrar pelo WhatsApp, receber e prorrogar o vencimento.

function situacao(l) {
  const d = diasAte(l.data_vencimento);
  if (d === null) return { tipo: 'sem', texto: 'Sem vencimento', dias: null };
  if (d < 0) return { tipo: 'vencida', texto: `Vencida há ${-d} dia${d === -1 ? '' : 's'}`, dias: d };
  if (d === 0) return { tipo: 'hoje', texto: 'Vence hoje', dias: d };
  return { tipo: 'futura', texto: `Vence em ${d} dia${d === 1 ? '' : 's'}`, dias: d };
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

function montarMensagem({ cliente, itens, empresaNome }) {
  const nome = primeiroNome(cliente);
  const total = itens.reduce((s, l) => s + (parseFloat(l.valor) || 0), 0);
  const linhas = [`Olá${nome ? ', ' + nome : ''}! 👋`, '', itens.length > 1 ? 'Passando para lembrar dos pagamentos em aberto conosco:' : 'Passando para lembrar de um pagamento em aberto conosco:', ''];
  for (const l of itens) {
    const s = situacao(l);
    const venc = l.data_vencimento ? `venc. ${formatDiaCurto(l.data_vencimento)}${s.tipo === 'vencida' ? ` (${s.texto.toLowerCase()})` : ''}` : '';
    linhas.push(`• ${l.descricao} — *${formatCurrency(l.valor)}*${venc ? ' — ' + venc : ''}`);
  }
  if (itens.length > 1) linhas.push('', `Total: *${formatCurrency(total)}*`);
  linhas.push('', 'Se você já fez o pagamento, é só desconsiderar esta mensagem (e, se puder, nos enviar o comprovante). 🙏');
  linhas.push(empresaNome ? `Atenciosamente, ${empresaNome}.` : 'Obrigado!');
  return linhas.join('\n');
}

export default function Cobrancas() {
  const { user, showToast } = useApp();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState('todas'); // todas | vencidas | semana | futuras
  const [termo, setTermo] = useState('');
  const [cobrar, setCobrar] = useState(null);   // { cliente, telefone, itens }
  const [receber, setReceber] = useState(null); // lançamento
  const [prorrogar, setProrrogar] = useState(null);

  async function carregar() {
    try {
      setLista(await window.api.financeiro.list('receita', 'Pendente', termo));
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

  const resumo = useMemo(() => {
    let total = 0; let vencido = 0; let qtdVencidas = 0; let semana = 0;
    for (const l of lista) {
      const v = parseFloat(l.valor) || 0;
      const s = situacao(l);
      total += v;
      if (s.tipo === 'vencida') { vencido += v; qtdVencidas += 1; }
      if (s.dias !== null && s.dias >= 0 && s.dias <= 7) semana += v;
    }
    return { total, vencido, qtdVencidas, semana };
  }, [lista]);

  const grupos = useMemo(() => {
    const passa = (l) => {
      const s = situacao(l);
      if (filtro === 'vencidas') return s.tipo === 'vencida';
      if (filtro === 'semana') return s.dias !== null && s.dias >= 0 && s.dias <= 7;
      if (filtro === 'futuras') return s.dias !== null && s.dias > 7;
      return true;
    };
    const mapa = new Map();
    for (const l of lista.filter(passa)) {
      const chave = `${l.cliente_nome || ''}|${l.cliente_whatsapp || l.cliente_telefone || ''}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, { chave, cliente: l.cliente_nome || '', telefone: l.cliente_whatsapp || l.cliente_telefone || '', itens: [] });
      }
      mapa.get(chave).itens.push(l);
    }
    const out = [...mapa.values()];
    for (const g of out) {
      g.itens.sort((a, b) => String(a.data_vencimento || '9999').localeCompare(String(b.data_vencimento || '9999')));
      g.total = g.itens.reduce((s, l) => s + (parseFloat(l.valor) || 0), 0);
      g.vencido = g.itens.filter((l) => situacao(l).tipo === 'vencida').reduce((s, l) => s + (parseFloat(l.valor) || 0), 0);
      g.maisAntiga = g.itens[0] ? situacao(g.itens[0]).dias : null;
    }
    // Quem tem mais atraso aparece primeiro.
    out.sort((a, b) => (a.maisAntiga ?? 99999) - (b.maisAntiga ?? 99999));
    return out;
  }, [lista, filtro]);

  // Itens que entram na mensagem de cobrança do cliente: vencidos; se não houver, os que vencem em até 7 dias; senão todos.
  function itensParaCobrar(g) {
    const vencidos = g.itens.filter((l) => situacao(l).tipo === 'vencida');
    if (vencidos.length) return vencidos;
    const proximos = g.itens.filter((l) => { const d = situacao(l).dias; return d !== null && d <= 7; });
    return proximos.length ? proximos : g.itens;
  }

  const FILTROS = [
    ['todas', 'Todas'],
    ['vencidas', `Vencidas${resumo.qtdVencidas ? ` (${resumo.qtdVencidas})` : ''}`],
    ['semana', 'Vencem em 7 dias'],
    ['futuras', 'A vencer'],
  ];

  return (
    <div>
      <div className="grid grid-3" style={{ marginBottom: 16 }}>
        <div className="card kpi-card"><span className="kpi-icon">💰</span><span className="kpi-label">Total a receber</span><span className="kpi-value">{formatCurrency(resumo.total)}</span></div>
        <div className="card kpi-card"><span className="kpi-icon">⚠️</span><span className="kpi-label">Vencido ({resumo.qtdVencidas})</span><span className="kpi-value" style={{ color: resumo.vencido > 0 ? 'var(--danger)' : undefined }}>{formatCurrency(resumo.vencido)}</span></div>
        <div className="card kpi-card"><span className="kpi-icon">📅</span><span className="kpi-label">Vence em 7 dias</span><span className="kpi-value">{formatCurrency(resumo.semana)}</span></div>
      </div>

      <div className="toolbar">
        <div className="toolbar-left">
          <input className="search-input" placeholder="Buscar cliente, OS ou venda..." value={termo} onChange={(e) => setTermo(e.target.value)} />
        </div>
      </div>
      <div className="tabs-sub">
        {FILTROS.map(([k, rotulo]) => (
          <button key={k} className={`tab-btn ${filtro === k ? 'active' : ''}`} onClick={() => setFiltro(k)}>{rotulo}</button>
        ))}
      </div>

      {carregando ? (
        <div className="empty-state">Carregando...</div>
      ) : grupos.length === 0 ? (
        <div className="empty-state">{lista.length === 0 ? '🎉 Nenhuma cobrança pendente. Vendas e OS "a prazo" aparecem aqui.' : 'Nenhuma cobrança neste filtro.'}</div>
      ) : (
        grupos.map((g) => (
          <div className="card cb-cliente" key={g.chave}>
            <div className="cb-head">
              <div>
                <div className="cb-nome">{g.cliente || 'Sem cliente vinculado'}</div>
                <div className="muted" style={{ fontSize: 12 }}>{g.telefone ? `📱 ${g.telefone}` : 'Sem WhatsApp/telefone cadastrado'} · {g.itens.length} conta{g.itens.length === 1 ? '' : 's'}</div>
              </div>
              <div className="cb-head-right">
                <div className="cb-total">{formatCurrency(g.total)}</div>
                {g.vencido > 0 && <div className="cb-vencido">{formatCurrency(g.vencido)} vencido</div>}
                {g.cliente && (
                  <button className="btn btn-primary btn-sm" onClick={() => setCobrar({ cliente: g.cliente, telefone: g.telefone, itens: itensParaCobrar(g) })}>💬 Cobrar</button>
                )}
              </div>
            </div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead><tr><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Última cobrança</th><th style={{ textAlign: 'right' }}>Ações</th></tr></thead>
                <tbody>
                  {g.itens.map((l) => {
                    const s = situacao(l);
                    return (
                      <tr key={l.id}>
                        <td>{l.descricao}{l.parcela && <span className="pill" style={{ marginLeft: 6 }}>{l.parcela}</span>}</td>
                        <td>
                          {formatDiaCurto(l.data_vencimento)}{' '}
                          <span className={`badge ${s.tipo === 'vencida' ? 'badge-Vencido' : s.tipo === 'hoje' ? 'badge-Pendente' : 'badge-Aguardando'}`}>{s.texto}</span>
                        </td>
                        <td><b>{formatCurrency(l.valor)}</b></td>
                        <td className="muted">{l.cobrado_em ? formatDiaCurto(String(l.cobrado_em).slice(0, 10)) : '—'}</td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {g.cliente && <button className="icon-btn" title="Cobrar esta conta no WhatsApp" onClick={() => setCobrar({ cliente: g.cliente, telefone: g.telefone, itens: [l] })}>💬</button>}
                          <button className="icon-btn" title="Registrar recebimento" onClick={() => setReceber(l)}>✅</button>
                          <button className="icon-btn" title="Prorrogar vencimento" onClick={() => setProrrogar(l)}>📅</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {cobrar && <CobrancaModal dados={cobrar} onClose={() => setCobrar(null)} onEnviada={() => { setCobrar(null); carregar(); }} />}
      {receber && <ReceberModal user={user} lanc={receber} onClose={() => setReceber(null)} onOk={() => { setReceber(null); carregar(); }} />}
      {prorrogar && <ProrrogarModal lanc={prorrogar} onClose={() => setProrrogar(null)} onOk={() => { setProrrogar(null); carregar(); }} />}
    </div>
  );
}

function CobrancaModal({ dados, onClose, onEnviada }) {
  const { showToast } = useApp();
  const [mensagem, setMensagem] = useState('');
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      let nome = '';
      try {
        const emp = await window.api.empresa.get();
        nome = (emp && (emp.nome_fantasia || emp.razao_social || emp.nome)) || '';
      } catch { /* segue sem o nome da empresa */ }
      if (!vivo) return;
      setMensagem(montarMensagem({ cliente: dados.cliente, itens: dados.itens, empresaNome: nome }));
      setPronto(true);
    })();
    return () => { vivo = false; };
  }, [dados]);

  function enviar() {
    // Chamado direto do toque no botão: assim o celular permite abrir o WhatsApp.
    window.api.whatsapp.abrirConversa(dados.telefone, mensagem)
      .then(async () => {
        try { await Promise.all(dados.itens.map((l) => window.api.financeiro.registrarCobranca(l.id))); } catch { /* o aviso já foi aberto; só não marca */ }
        showToast('WhatsApp aberto com a mensagem. Toque em enviar para cobrar o cliente.');
        onEnviada();
      })
      .catch((err) => showToast(String((err && err.message) || err), 'error'));
  }

  async function copiar() {
    try { await navigator.clipboard.writeText(mensagem); showToast('Mensagem copiada.'); } catch { showToast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error'); }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(540px, 94vw)' }}>
        <div className="modal-header">
          <h3>💬 Cobrar {dados.cliente}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>✕</button>
        </div>
        {!dados.telefone && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 0 }}>⚠️ Este cliente não tem WhatsApp/telefone cadastrado. Cadastre em Clientes ou copie a mensagem.</p>}
        <div className="field">
          <label>Mensagem (você pode editar antes de enviar)</label>
          <textarea rows={10} value={mensagem} disabled={!pronto} onChange={(e) => setMensagem(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={!pronto || !dados.telefone} onClick={enviar}>💬 Enviar pelo WhatsApp</button>
          <button type="button" className="btn btn-secondary" disabled={!pronto} onClick={copiar}>📋 Copiar mensagem</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Agora não</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>O WhatsApp abre com a conversa e o texto prontos; falta só tocar em enviar. A data da cobrança fica registrada na conta.</p>
      </div>
    </div>
  );
}

function ReceberModal({ user, lanc, onClose, onOk }) {
  const { showToast } = useApp();
  const [forma, setForma] = useState('PIX');
  const [data, setData] = useState(hojeLocal());

  async function confirmar(e) {
    e.preventDefault();
    try {
      await window.api.financeiro.marcarPago(user, lanc.id, forma, data);
      showToast('Recebimento registrado.');
      onOk();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" style={{ width: 'min(460px, 94vw)' }} onSubmit={confirmar}>
        <div className="modal-header"><h3>✅ Registrar recebimento</h3><button type="button" className="icon-btn" onClick={onClose}>✕</button></div>
        <p style={{ marginTop: 0 }}>{lanc.descricao}{lanc.parcela ? ` (${lanc.parcela})` : ''} — <b>{formatCurrency(lanc.valor)}</b></p>
        <div className="form-grid">
          <div className="field">
            <label>Forma de pagamento</label>
            <select value={forma} onChange={(e) => setForma(e.target.value)}>
              {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="field"><label>Data do recebimento</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>Entra no faturamento na data informada e, se for em Dinheiro com o caixa aberto, também no Caixa.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Confirmar recebimento</button>
        </div>
      </form>
    </div>
  );
}

function ProrrogarModal({ lanc, onClose, onOk }) {
  const { showToast } = useApp();
  const sugestao = diasAte(lanc.data_vencimento) !== null && diasAte(lanc.data_vencimento) >= 0 ? lanc.data_vencimento : hojeLocal();
  const [data, setData] = useState(sugestao);

  async function confirmar(e) {
    e.preventDefault();
    if (!data) return showToast('Informe a nova data.', 'error');
    try {
      await window.api.financeiro.reprogramar(lanc.id, data);
      showToast('Vencimento alterado.');
      onOk();
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  const atalhos = [['+7 dias', 7], ['+15 dias', 15]];
  const base = hojeLocal();
  function somarDiasHoje(n) {
    const [a, m, d] = base.split('-').map(Number);
    return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal" style={{ width: 'min(440px, 94vw)' }} onSubmit={confirmar}>
        <div className="modal-header"><h3>📅 Prorrogar vencimento</h3><button type="button" className="icon-btn" onClick={onClose}>✕</button></div>
        <p style={{ marginTop: 0 }}>{lanc.descricao}{lanc.parcela ? ` (${lanc.parcela})` : ''} — <b>{formatCurrency(lanc.valor)}</b><br /><span className="muted">Vencimento atual: {formatDiaCurto(lanc.data_vencimento)}</span></p>
        <div className="field"><label>Nova data de vencimento</label><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {atalhos.map(([rot, n]) => <button key={n} type="button" className="btn btn-secondary btn-sm" onClick={() => setData(somarDiasHoje(n))}>{rot} (a partir de hoje)</button>)}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setData(somarMesesDia(lanc.data_vencimento || base, 1))}>+1 mês</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary">Salvar nova data</button>
        </div>
      </form>
    </div>
  );
}
