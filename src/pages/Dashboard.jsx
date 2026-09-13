import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatDateTime, formatCurrency, statusClass, sanitizeDecimalInput, parseDecimal } from '../utils.js';

function mesAtualStr() {
  return new Date().toISOString().slice(0, 7);
}

function deslocarMes(mes, delta) {
  const [ano, mesNum] = mes.split('-').map((n) => parseInt(n, 10));
  const d = new Date(ano, mesNum - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

export default function Dashboard({ goTo }) {
  const { user, showToast } = useApp();
  const [data, setData] = useState(null);
  const [mesSelecionado, setMesSelecionado] = useState(mesAtualStr());
  const [meta, setMeta] = useState(null);
  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaInput, setMetaInput] = useState('0');
  const [planejarOpen, setPlanejarOpen] = useState(false);
  const [metasFuturas, setMetasFuturas] = useState([]);

  async function load() {
    const res = await window.api.dashboard.resumo();
    setData(res);
  }

  async function loadMeta(mes) {
    const res = await window.api.financas.metaMensal(mes || mesSelecionado);
    setMeta(res);
  }

  useEffect(() => { load(); }, []);
  useEffect(() => { loadMeta(mesSelecionado); }, [mesSelecionado]);

  function abrirDefinirMeta() {
    setMetaInput(meta?.metaLucro != null ? String(meta.metaLucro) : '0');
    setMetaModalOpen(true);
  }

  async function salvarMeta(e) {
    e.preventDefault();
    try {
      await window.api.financas.definirMeta(user, mesSelecionado, parseDecimal(metaInput));
      showToast('Meta de lucro atualizada.');
      setMetaModalOpen(false);
      loadMeta(mesSelecionado);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function abrirPlanejarMetas() {
    const res = await window.api.financas.metasFuturas(6);
    setMetasFuturas(res.map((m) => ({ ...m, input: m.metaLucro != null ? String(m.metaLucro) : '' })));
    setPlanejarOpen(true);
  }

  function setMetaFuturaInput(mes, value) {
    setMetasFuturas((list) => list.map((m) => (m.mes === mes ? { ...m, input: value } : m)));
  }

  async function salvarMetasFuturas(e) {
    e.preventDefault();
    try {
      for (const m of metasFuturas) {
        if (m.input === '' || m.input === null) continue;
        await window.api.financas.definirMeta(user, m.mes, parseDecimal(m.input));
      }
      showToast('Metas dos próximos meses salvas com sucesso.');
      setPlanejarOpen(false);
      loadMeta(mesSelecionado);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  if (!data) return <div className="empty-state">Carregando...</div>;

  const cards = [
    { label: 'OS em aberto', value: data.abertas, icon: '🛠️' },
    { label: 'Aguardando peça', value: data.aguardandoPeca, icon: '📦' },
    { label: 'Prontos p/ retirada', value: data.prontos, icon: '✅' },
    { label: 'Entregues hoje', value: data.entreguesHoje, icon: '🚚' },
  ];

  const cards2 = [
    { label: 'Faturamento do dia', value: formatCurrency(data.faturamentoDia), icon: '💰' },
    { label: 'Total de Clientes', value: data.totalClientes, icon: '👥' },
    { label: 'Itens com estoque baixo', value: data.estoqueBaixo, icon: '⚠️', warn: data.estoqueBaixo > 0 },
  ];

  const cards3 = [
    { label: 'Contas a Receber', value: `${formatCurrency(data.contasAReceber)} (${data.contasAReceberQtd})`, icon: '🟢' },
    { label: 'Contas a Pagar', value: `${formatCurrency(data.contasAPagar)} (${data.contasAPagarQtd})`, icon: '🔴', warn: data.contasAPagarQtd > 0 },
    { label: 'Status do Caixa', value: data.caixaAberto ? 'Aberto' : 'Fechado', icon: '🗄️', warn: !data.caixaAberto },
  ];

  return (
    <div>
      <div className="grid grid-4">
        {cards.map((c) => (
          <div className="card kpi-card" key={c.label}>
            <div className="kpi-icon">{c.icon}</div>
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-value">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {cards2.map((c) => (
          <div className="card kpi-card" key={c.label}>
            <div className="kpi-icon">{c.icon}</div>
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-value" style={c.warn ? { color: 'var(--danger)' } : undefined}>{c.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {cards3.map((c) => (
          <div className="card kpi-card" key={c.label}>
            <div className="kpi-icon">{c.icon}</div>
            <div className="kpi-label">{c.label}</div>
            <div className="kpi-value" style={c.warn ? { color: 'var(--danger)', fontSize: 22 } : { fontSize: 22 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <FinancialDashboardSection
        meta={meta}
        user={user}
        mesSelecionado={mesSelecionado}
        onMudarMes={(delta) => setMesSelecionado((m) => deslocarMes(m, delta))}
        onDefinirMeta={abrirDefinirMeta}
        onPlanejarMetas={abrirPlanejarMetas}
        goTo={goTo}
      />

      {metaModalOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMetaModalOpen(false)}>
          <form className="modal" style={{ width: 420 }} onSubmit={salvarMeta}>
            <div className="modal-header">
              <h3>Meta de Lucro — {mesLabel(mesSelecionado)}</h3>
              <button type="button" className="icon-btn" onClick={() => setMetaModalOpen(false)}>✕</button>
            </div>
            <div className="field">
              <label>Meta de Lucro do Mês (R$)</label>
              <input type="text" inputMode="decimal" placeholder="0,00" autoFocus value={metaInput} onChange={(e) => setMetaInput(sanitizeDecimalInput(e.target.value))} />
            </div>
            <p className="muted" style={{ fontSize: 11.5 }}>
              Lucro = receitas pagas − despesas pagas do mês (todos os lançamentos já registrados no Financeiro, incluindo OS, Vendas etc.).
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setMetaModalOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Meta</button>
            </div>
          </form>
        </div>
      )}

      {planejarOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPlanejarOpen(false)}>
          <form className="modal" style={{ width: 480 }} onSubmit={salvarMetasFuturas}>
            <div className="modal-header">
              <h3>📅 Planejar Metas dos Próximos Meses</h3>
              <button type="button" className="icon-btn" onClick={() => setPlanejarOpen(false)}>✕</button>
            </div>
            <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
              Defina de uma vez a meta de lucro para os próximos meses. Deixe em branco o mês que não quiser alterar.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {metasFuturas.map((m) => (
                <div key={m.mes} className="field" style={{ display: 'grid', gridTemplateColumns: '1fr 160px', alignItems: 'center', gap: 10 }}>
                  <label style={{ marginBottom: 0 }}>{m.label}</label>
                  <input type="text" inputMode="decimal" placeholder="R$ 0,00" value={m.input} onChange={(e) => setMetaFuturaInput(m.mes, sanitizeDecimalInput(e.target.value))} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button type="button" className="btn btn-secondary" onClick={() => setPlanejarOpen(false)}>Cancelar</button>
              <button type="submit" className="btn btn-primary">Salvar Metas</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Últimas Ordens de Serviço</div>
          {data.ultimasOs.length === 0 && <div className="muted">Nenhuma OS cadastrada ainda.</div>}
          {data.ultimasOs.map((o) => (
            <div key={o.numero} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{o.numero} — {o.cliente_nome || 'Cliente'}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>{formatDateTime(o.criado_em)}</div>
              </div>
              <span className={`badge ${statusClass(o.status)}`}>{o.status}</span>
            </div>
          ))}
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => goTo('os')}>Ver todas as OS</button>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>OS por Status</div>
          {data.porStatus.length === 0 && <div className="muted">Sem dados ainda.</div>}
          {data.porStatus.map((s) => (
            <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span className={`badge ${statusClass(s.status)}`} style={{ minWidth: 150, justifyContent: 'center' }}>{s.status}</span>
              <div style={{ flex: 1, background: 'var(--bg-elev-2)', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, s.qtd * 12)}%`, background: 'var(--gold)', height: '100%' }} />
              </div>
              <b style={{ fontSize: 12.5 }}>{s.qtd}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>📅 Aniversariantes do Mês</div>
          {(!data.aniversariantesMes || data.aniversariantesMes.length === 0) && (
            <div className="muted">Nenhum cliente com data de nascimento cadastrada faz aniversário este mês.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {(data.aniversariantesMes || []).map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 8, background: c.jaPassou ? 'var(--bg-elev-2)' : 'var(--bg-elev-2)', border: `1px solid ${c.jaPassou ? 'var(--border)' : 'var(--gold)'}`, opacity: c.jaPassou ? 0.55 : 1 }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--bg-elev-3, #222)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, flexShrink: 0, border: '1px solid var(--border)' }}>
                  {String(c.dia).padStart(2, '0')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.nome}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{c.telefone || c.whatsapp || 'Sem telefone cadastrado'}</div>
                </div>
                {!c.jaPassou && <span className="badge badge-Pendente" style={{ fontSize: 10 }}>Este mês</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>📦 Estoque Baixo</div>
          {(!data.estoqueBaixoList || data.estoqueBaixoList.length === 0) && (
            <div className="muted">Nenhum produto está abaixo do estoque mínimo. 🎉</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
            {(data.estoqueBaixoList || []).map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-elev-2)', border: '1px solid var(--danger)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{p.nome}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{p.categoria || 'Sem categoria'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: 'var(--danger)', fontWeight: 800, fontSize: 14 }}>{p.quantidade}</div>
                  <div className="muted" style={{ fontSize: 10.5 }}>mín. {p.estoque_minimo}</div>
                </div>
              </div>
            ))}
          </div>
          {data.estoqueBaixoList && data.estoqueBaixoList.length > 0 && (
            <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={() => goTo('estoque')}>Ver Estoque</button>
          )}
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>📊 Faturamento — Últimos 7 dias</div>
          <BarChart data={data.faturamentoSemana || []} />
        </div>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>📈 Faturamento — Últimos 12 meses</div>
          <BarChart data={data.faturamentoMensal || []} compact />
          <div className="muted" style={{ fontSize: 11.5, marginTop: 10, textAlign: 'right' }}>Total no ano: <b>{formatCurrency(data.faturamentoAno)}</b></div>
        </div>
      </div>
    </div>
  );
}

function mesLabel(mes) {
  if (!mes) return '';
  const [ano, mesNum] = mes.split('-').map((n) => parseInt(n, 10));
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[mesNum - 1]} / ${ano}`;
}

const RITMO_INFO = {
  atingida: { label: '🏆 Meta Atingida!', color: 'var(--success)' },
  no_ritmo: { label: '✅ No Ritmo', color: 'var(--info)' },
  atrasado: { label: '⚠️ Abaixo do Ritmo', color: 'var(--danger)' },
  nao_atingida: { label: '✖️ Meta Não Atingida', color: 'var(--danger)' },
};

// ---------- Seção "Dashboard Financeiro — Meta de Lucro" ----------
function FinancialDashboardSection({ meta, user, mesSelecionado, onMudarMes, onDefinirMeta, onPlanejarMetas, goTo }) {
  const podeEditar = user.papel === 'Administrador' || user.papel === 'Financeiro';
  if (!meta) return null;

  const temMeta = meta.metaLucro != null && meta.metaLucro > 0;
  const percentual = temMeta ? Math.max(0, Math.min(100, meta.percentualAlcancado)) : 0;
  const ritmo = temMeta && meta.statusRitmo ? RITMO_INFO[meta.statusRitmo] : null;
  const lucroNegativo = meta.lucroRealizado < 0;
  const corGauge = ritmo ? ritmo.color : 'var(--gold)';

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <div className="section-title" style={{ marginTop: 0, marginBottom: 0 }}>💹 Dashboard Financeiro — Meta de Lucro</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" className="icon-btn" title="Mês anterior" onClick={() => onMudarMes(-1)}>◀</button>
          <span style={{ fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{mesLabel(mesSelecionado)}</span>
          <button type="button" className="icon-btn" title="Próximo mês" onClick={() => onMudarMes(1)}>▶</button>
          {podeEditar && <button className="btn btn-secondary btn-sm" onClick={onPlanejarMetas}>📅 Planejar Próximos Meses</button>}
          {podeEditar && <button className="btn btn-secondary btn-sm" onClick={onDefinirMeta}>{temMeta ? 'Editar Meta' : '+ Definir Meta'}</button>}
        </div>
      </div>

      {/* Linha de KPIs coloridos */}
      <div className="grid grid-4" style={{ gap: 12 }}>
        <FinKpi icon="💰" color="var(--info)" label="Faturamento" value={formatCurrency(meta.receitas)} />
        <FinKpi icon="🧾" color="var(--danger)" label="Despesas" value={formatCurrency(meta.despesas)} />
        <FinKpi icon="💵" color={lucroNegativo ? 'var(--danger)' : 'var(--success)'} label="Lucro Líquido" value={formatCurrency(meta.lucroRealizado)} />
        <FinKpi icon="🎯" color="var(--gold)" label="Meta de Lucro" value={temMeta ? formatCurrency(meta.metaLucro) : 'Não definida'} />
      </div>

      {!temMeta && (
        <div className="muted" style={{ marginTop: 16 }}>
          Nenhuma meta de lucro definida para {mesLabel(mesSelecionado)}.
          {podeEditar ? ' Clique em "Definir Meta" para acompanhar seu progresso.' : ' Peça a um Administrador ou responsável pelo Financeiro para definir a meta.'}
        </div>
      )}

      {temMeta && (
        <div className="grid grid-3" style={{ marginTop: 18, gap: 14, alignItems: 'stretch' }}>
          {/* Progresso da Meta */}
          <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <DonutGauge percentual={percentual} color={corGauge} />
              <div>
                <div className="kpi-label">PROGRESSO DA META</div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{formatCurrency(meta.lucroRealizado)}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>de {formatCurrency(meta.metaLucro)}</div>
              </div>
            </div>
            <div style={{ background: 'var(--bg-elev)', borderRadius: 8, height: 12, overflow: 'hidden', marginTop: 14 }}>
              <div style={{ width: `${percentual}%`, background: corGauge, height: '100%', transition: 'width 0.3s ease' }} />
            </div>
            {ritmo && <div style={{ marginTop: 8, fontWeight: 700, fontSize: 12.5, color: ritmo.color }}>{ritmo.label}</div>}
            <div className="grid grid-3" style={{ marginTop: 14, gap: 8 }}>
              <div>
                <div className="kpi-label" style={{ fontSize: 10 }}>Falta atingir</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{formatCurrency(meta.faltaAtingir)}</div>
              </div>
              <div>
                <div className="kpi-label" style={{ fontSize: 10 }}>Dias restantes</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{meta.ehMesFuturo ? meta.diasNoMes : meta.diasRestantes}</div>
              </div>
              <div>
                <div className="kpi-label" style={{ fontSize: 10 }}>Lucrar por dia</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{meta.mediaDiariaNecessaria != null ? formatCurrency(meta.mediaDiariaNecessaria) : '-'}</div>
              </div>
            </div>
          </div>

          {/* Projeção de Lucro */}
          <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none' }}>
            <div className="kpi-label">PROJEÇÃO DE LUCRO</div>
            {meta.projecaoLucro != null ? (
              <>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Com o ritmo atual, o fechamento estimado é de:</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--gold)', marginTop: 4 }}>{formatCurrency(meta.projecaoLucro)}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                  {meta.projecaoLucro >= meta.metaLucro
                    ? <span style={{ color: 'var(--success)' }}>Você deve superar a meta em {formatCurrency(meta.projecaoLucro - meta.metaLucro)} 🚀</span>
                    : <span style={{ color: 'var(--danger)' }}>Nesse ritmo, faltariam {formatCurrency(meta.metaLucro - meta.projecaoLucro)} para a meta</span>}
                </div>
                <div style={{ marginTop: 10 }}>
                  <LineChartSVG points={meta.evolucaoDiaria.map((p) => p.valor)} height={90} color="var(--gold)" metaLine={meta.metaLucro} />
                </div>
              </>
            ) : (
              <div className="muted" style={{ marginTop: 10, fontSize: 12.5 }}>
                {meta.ehMesFuturo ? 'A projeção fica disponível quando o mês começar.' : 'Sem dados suficientes para projetar este mês.'}
              </div>
            )}
          </div>

          {/* Comparativo com Mês Anterior */}
          <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none' }}>
            <div className="kpi-label">COMPARATIVO COM MÊS ANTERIOR</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 10 }}>
              <ComparativoLinha label="Faturamento" valor={meta.comparativo.faturamento} variacao={meta.comparativo.faturamentoVar} />
              <ComparativoLinha label="Despesas" valor={meta.comparativo.despesas} variacao={meta.comparativo.despesasVar} inverterCor />
              <ComparativoLinha label="Lucro" valor={meta.comparativo.lucro} variacao={meta.comparativo.lucroVar} />
            </div>
          </div>
        </div>
      )}

      {/* Linha inferior: serviços realizados, ticket médio, evolução do lucro, alertas */}
      <div className="grid grid-4" style={{ marginTop: 14, gap: 14, alignItems: 'stretch' }}>
        <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none' }}>
          <div className="kpi-label">SERVIÇOS/VENDAS REALIZADOS</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{meta.servicosRealizados}</div>
          {meta.servicosRealizadosVar !== 0 && (
            <div style={{ fontSize: 11.5, color: meta.servicosRealizadosVar > 0 ? 'var(--success)' : 'var(--danger)', marginTop: 4 }}>
              {meta.servicosRealizadosVar > 0 ? '↑' : '↓'} {Math.abs(meta.servicosRealizadosVar)} vs mês anterior
            </div>
          )}
        </div>
        <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none' }}>
          <div className="kpi-label">TICKET MÉDIO</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>{formatCurrency(meta.ticketMedio)}</div>
          {meta.ticketMedio > 0 && (
            <div style={{ fontSize: 11.5, color: meta.ticketMedioVar >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 4 }}>
              {meta.ticketMedioVar >= 0 ? '↑' : '↓'} {Math.abs(meta.ticketMedioVar).toFixed(1)}% vs mês anterior
            </div>
          )}
        </div>
        <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none', gridColumn: 'span 1' }}>
          <div className="kpi-label">EVOLUÇÃO DO LUCRO NO MÊS</div>
          {meta.evolucaoDiaria.length > 0 ? (
            <LineChartSVG points={meta.evolucaoDiaria.map((p) => p.valor)} height={70} color="var(--gold)" />
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Sem lançamentos ainda neste mês.</div>
          )}
        </div>
        <AlertaCard meta={meta} temMeta={temMeta} goTo={goTo} />
      </div>
    </div>
  );
}

function FinKpi({ icon, color, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elev-2)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, background: `color-mix(in srgb, ${color} 18%, transparent)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div className="kpi-label" style={{ fontSize: 10.5 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      </div>
    </div>
  );
}

function ComparativoLinha({ label, valor, variacao, inverterCor }) {
  const subiu = variacao >= 0;
  const bom = inverterCor ? !subiu : subiu;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{formatCurrency(valor)}</div>
        <div style={{ fontSize: 11, color: bom ? 'var(--success)' : 'var(--danger)' }}>{subiu ? '↑' : '↓'} {Math.abs(variacao).toFixed(1)}%</div>
      </div>
    </div>
  );
}

function AlertaCard({ meta, temMeta, goTo }) {
  let mensagem = 'Defina uma meta de lucro para acompanhar seu progresso.';
  let cor = 'var(--info)';
  let icone = 'ℹ️';
  if (temMeta) {
    if (meta.statusRitmo === 'atingida') { mensagem = 'Meta atingida! Parabéns pelo resultado. 🎉'; cor = 'var(--success)'; icone = '✅'; }
    else if (meta.statusRitmo === 'no_ritmo') { mensagem = 'Você está no caminho certo para atingir sua meta!'; cor = 'var(--success)'; icone = '✅'; }
    else if (meta.statusRitmo === 'atrasado') { mensagem = 'Você está abaixo do ritmo necessário. Reforce vendas/serviços ou revise despesas.'; cor = 'var(--danger)'; icone = '⚠️'; }
    else if (meta.statusRitmo === 'nao_atingida') { mensagem = 'A meta não foi atingida neste mês.'; cor = 'var(--danger)'; icone = '✖️'; }
    else if (meta.ehMesFuturo) { mensagem = 'Meta definida. Acompanhe aqui quando o mês começar.'; cor = 'var(--info)'; icone = '🗓️'; }
  }
  return (
    <div className="card" style={{ background: 'var(--bg-elev-2)', boxShadow: 'none', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div className="kpi-label">ALERTAS</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
          <span style={{ fontSize: 16 }}>{icone}</span>
          <span style={{ fontSize: 12.5, color: cor, fontWeight: 600 }}>{mensagem}</span>
        </div>
      </div>
      <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={() => goTo('financeiro')}>Ver Financeiro completo →</button>
    </div>
  );
}

// Gráfico de linha simples em SVG puro (sem dependências externas)
function LineChartSVG({ points, height = 90, color = 'var(--gold)', metaLine }) {
  if (!points || points.length === 0) return <div className="muted" style={{ fontSize: 12 }}>Sem dados ainda.</div>;
  const width = 100; // usa viewBox percentual, escala com o container
  const allValues = metaLine != null ? [...points, metaLine] : points;
  const min = Math.min(0, ...allValues);
  const max = Math.max(1, ...allValues);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const toY = (v) => height - ((v - min) / range) * (height - 10) - 5;
  const coords = points.map((v, i) => [i * stepX, toY(v)]);
  const pathLine = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const pathArea = `${pathLine} L${coords[coords.length - 1][0].toFixed(2)},${height} L0,${height} Z`;
  const metaY = metaLine != null ? toY(metaLine) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      <path d={pathArea} fill={color} opacity="0.12" stroke="none" />
      {metaY != null && <line x1="0" y1={metaY} x2={width} y2={metaY} stroke="var(--text-dim)" strokeDasharray="2,2" strokeWidth="0.6" />}
      <path d={pathLine} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      {coords.length <= 40 && coords.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.3" fill={color} />
      ))}
    </svg>
  );
}

// Anel de progresso (donut gauge) em SVG puro
function DonutGauge({ percentual, color, size = 64 }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, percentual));
  const offset = c - (pct / 100) * c;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.3s ease' }} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>
        {pct.toFixed(0)}%
      </div>
    </div>
  );
}

function BarChart({ data, compact }) {
  if (!data || data.length === 0) return <div className="muted">Sem dados ainda.</div>;
  const max = Math.max(1, ...data.map((d) => d.valor || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: compact ? 4 : 10, height: 150, paddingTop: 10 }}>
      {data.map((d, i) => {
        const h = Math.max(2, Math.round(((d.valor || 0) / max) * 120));
        return (
          <div key={i} title={`${d.label}: ${formatCurrency(d.valor)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: compact ? 9 : 10, color: 'var(--text-dim)', height: 14 }}>
              {d.valor > 0 && !compact ? formatCurrency(d.valor).replace('R$', '').trim() : ''}
            </div>
            <div style={{ width: '100%', maxWidth: compact ? 14 : 28, height: h, background: 'var(--gold)', borderRadius: '4px 4px 0 0' }} />
            <div style={{ fontSize: compact ? 9 : 10.5, color: 'var(--text-dim)', textTransform: 'capitalize' }}>{d.label}</div>
          </div>
        );
      })}
    </div>
  );
}
