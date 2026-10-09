import React, { useMemo, useState } from 'react';
import { formatCurrency, sanitizeDecimalInput, parseDecimal } from '../utils.js';
import { TABELA_PADRAO } from '../calcpro-dados.js';

// Calculadora Pro: (1) preço do serviço — tabela fixa por modelo + regras de cálculo pela peça;
// (2) simulador de venda — quanto cobrar / quanto receber passando no cartão com a taxa da maquininha.
// Tudo é calculado na tela. A tabela, as regras e as taxas ficam salvas neste aparelho/navegador.

const CHAVE = 'rt-calcpro-v1';

const SERVICOS_TABELA = [
  ['tela', 'Tela'], ['telaSemMsg', 'Tela sem mensagem'], ['telaParalela', 'Tela paralela'],
  ['bateria', 'Bateria'], ['bateriaSemMsg', 'Bateria sem mensagem'],
  ['conector', 'Conector de carga'], ['tampa', 'Tampa traseira'], ['software', 'Software'],
];
const SERVICOS_PECA = ['Tela', 'Bateria', 'Conector de Carga', 'Tampa Traseira'];

const REGRAS_PADRAO = {
  tela: { limite: 100, fixo: 120, mult: 2, acres: 20 },
  bateria: { limite: 100, fixo: 110, mult: 2, acres: 20 },
  conector: { a: 5, fixoA: 110, b: 30, fixoB: 130, mult: 5 },
  tampa: { fixo: 110 },
  arred: { passo: 5, menos: 0.1 },
  desc: { bateria: 5, outros: 10 },
};

// Taxas de EXEMPLO — cada lojista troca pelas da própria maquininha.
const TAXAS_PADRAO = (() => {
  const t = { debito: 1.37 };
  const base = [3.15, 5.39, 6.17, 6.95, 7.73, 8.51, 9.29, 10.07, 10.85, 11.63, 12.41, 13.19, 13.97, 14.75, 15.53, 16.31, 17.09, 17.87];
  base.forEach((v, i) => { t[i + 1] = v; });
  return t;
})();

function carregar() {
  try {
    const s = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (s && typeof s === 'object') return s;
  } catch { /* ignora */ }
  return {};
}
function salvar(estado) { try { localStorage.setItem(CHAVE, JSON.stringify(estado)); } catch { /* ignora */ } }

const num = (v) => (v === '' || v === null || v === undefined ? NaN : parseDecimal(v));
const arred = (v, r) => Math.round(v / r.passo) * r.passo - r.menos;

function calcularPeca(servico, peca, R) {
  if (!(peca >= 0) || Number.isNaN(peca)) return null;
  let preco; let regra;
  if (servico === 'Tela' || servico === 'Bateria') {
    const r = servico === 'Tela' ? R.tela : R.bateria;
    preco = peca < r.limite ? peca + r.fixo : peca * r.mult * (1 + r.acres / 100);
    regra = `Peça < R$${r.limite}: peça + R$${r.fixo} fixo  |  Peça ≥ R$${r.limite}: peça × ${r.mult} × ${(1 + r.acres / 100).toLocaleString('pt-BR')} (${r.acres}%)`;
  } else if (servico === 'Conector de Carga') {
    const r = R.conector;
    preco = peca < r.a ? r.fixoA : peca < r.b ? r.fixoB : peca * r.mult;
    regra = `Peça < R$${r.a}: fixo R$${r.fixoA}  |  R$${r.a} a < R$${r.b}: fixo R$${r.fixoB}  |  Peça ≥ R$${r.b}: peça × ${r.mult}`;
  } else {
    preco = peca + R.tampa.fixo;
    regra = `Peça + R$${R.tampa.fixo}`;
  }
  return { preco, regra };
}

export default function CalculadoraPro() {
  const salvo = useMemo(carregar, []);
  const [aba, setAba] = useState('preco'); // preco | simulador
  const [regras, setRegras] = useState(salvo.regras || REGRAS_PADRAO);
  const [tabela, setTabela] = useState(salvo.tabela || TABELA_PADRAO);
  const [taxas, setTaxas] = useState(salvo.taxas || TAXAS_PADRAO);
  const [editando, setEditando] = useState(false);

  const [aparelho, setAparelho] = useState('iPhone 14 Pro Max');
  const [servicoT, setServicoT] = useState('tela');
  const [servicoP, setServicoP] = useState('Tela');
  const [peca, setPeca] = useState('');

  const [modo, setModo] = useState('receber'); // receber (repasso a taxa ao cliente) | cobrar (eu absorvo a taxa)
  const [valor, setValor] = useState('');
  const [custo, setCusto] = useState('');
  const [ate, setAte] = useState(12);
  const [editTaxas, setEditTaxas] = useState(false);

  function persistir(r = regras, t = tabela, x = taxas) { salvar({ regras: r, tabela: t, taxas: x }); }
  const setR = (grupo, campo, v) => { const n = { ...regras, [grupo]: { ...regras[grupo], [campo]: parseDecimal(v) } }; setRegras(n); persistir(n); };
  const setTx = (k, v) => { const n = { ...taxas, [k]: parseDecimal(v) }; setTaxas(n); persistir(regras, tabela, n); };
  const setCel = (i, campo, v) => {
    const n = tabela.map((l, k) => (k !== i ? l : { ...l, [campo]: campo === 'modelo' ? v : (v === '' ? null : parseDecimal(v)) }));
    setTabela(n); persistir(regras, n);
  };
  function novoModelo() { const n = [...tabela, { modelo: 'Novo modelo', tela: null, telaSemMsg: null, telaParalela: null, bateria: null, bateriaSemMsg: null, conector: null, tampa: null, software: null }]; setTabela(n); persistir(regras, n); }
  function removerModelo(i) { const n = tabela.filter((_, k) => k !== i); setTabela(n); persistir(regras, n); }
  function restaurar() {
    if (!window.confirm('Voltar a tabela, as regras e as taxas para o padrão?')) return;
    setRegras(REGRAS_PADRAO); setTabela(TABELA_PADRAO); setTaxas(TAXAS_PADRAO);
    try { localStorage.removeItem(CHAVE); } catch { /* ignora */ }
  }

  // ---------- preço do serviço ----------
  const linha = tabela.find((l) => l.modelo === aparelho);
  const modoTabela = !!linha;
  let resultado = null; // { base, regra, origem, indisponivel }
  if (modoTabela) {
    const v = linha[servicoT];
    resultado = v == null ? { indisponivel: true, origem: `Tabela fixa · ${linha.modelo}` } : { base: v, origem: `Tabela fixa · ${linha.modelo}`, tabela: true };
  } else {
    const c = calcularPeca(servicoP, num(peca), regras);
    resultado = c ? { base: c.preco, regra: c.regra, origem: `Regra: ${servicoP}` } : { vazio: true };
  }
  const nomeServicoAtual = modoTabela ? (servicoT.startsWith('bateria') ? 'Bateria' : '') : servicoP;
  const pctDesc = /^Bateria/.test(nomeServicoAtual) ? regras.desc.bateria : regras.desc.outros;
  const final = resultado && resultado.base != null ? (resultado.tabela ? resultado.base : arred(resultado.base, regras.arred)) : null;
  const minimo = final != null ? final * (1 - pctDesc / 100) : null;

  function irParaCartao() {
    setValor(String(final).replace('.', ','));
    setCusto(!modoTabela && peca ? String(peca) : '');
    setModo('receber');
    setAba('simulador');
  }

  // ---------- simulador ----------
  const V = num(valor); const C = num(custo) || 0;
  const linhas = useMemo(() => {
    if (!(V > 0)) return [];
    const formas = [{ k: 'debito', rotulo: 'Débito', n: 1 }];
    for (let i = 1; i <= ate; i++) formas.push({ k: i, rotulo: i === 1 ? 'Crédito à vista' : `Crédito ${i}x`, n: i });
    return formas.map((f) => {
      const t = (taxas[f.k] || 0) / 100;
      let total; let recebe;
      if (modo === 'receber') { total = V / (1 - t); recebe = V; } else { total = V; recebe = V * (1 - t); }
      return { ...f, taxa: taxas[f.k] || 0, total, parcela: total / f.n, juros: total - V, descTaxa: total - recebe, recebe, lucro: recebe - C };
    });
  }, [V, C, modo, taxas, ate]);

  const campoNum = (v, on, props = {}) => <input type="text" inputMode="decimal" value={v ?? ''} onChange={(e) => on(sanitizeDecimalInput(e.target.value))} {...props} />;

  return (
    <div data-sem-maiuscula>
      <div style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 30 }}>Calculadora Pro</h1>
        <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>Quanto cobrar pelo serviço e quanto passar na maquininha para receber o valor certo.</div>
      </div>

      <div className="tabs-sub" style={{ marginBottom: 16 }}>
        <button className={`tab-btn ${aba === 'preco' ? 'active' : ''}`} onClick={() => setAba('preco')}>Preço do serviço</button>
        <button className={`tab-btn ${aba === 'simulador' ? 'active' : ''}`} onClick={() => setAba('simulador')}>Simulador de venda</button>
      </div>

      {aba === 'preco' && (
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
          <div className="card">
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <div className="field"><label>Aparelho</label>
                <select value={aparelho} onChange={(e) => setAparelho(e.target.value)}>
                  <option value="">Outro aparelho (calcular pela peça)</option>
                  {tabela.map((l, i) => <option key={i} value={l.modelo}>{l.modelo}</option>)}
                </select></div>
              {modoTabela ? (
                <div className="field"><label>Serviço</label>
                  <select value={servicoT} onChange={(e) => setServicoT(e.target.value)}>
                    {SERVICOS_TABELA.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select></div>
              ) : (
                <>
                  <div className="field"><label>Serviço</label>
                    <select value={servicoP} onChange={(e) => setServicoP(e.target.value)}>
                      {SERVICOS_PECA.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select></div>
                  <div className="field"><label>Valor da peça (R$)</label>{campoNum(peca, setPeca, { placeholder: '0,00' })}</div>
                </>
              )}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 12 }}>
              ⓘ {modoTabela ? 'Preço da tabela fixa da loja. Sempre confira antes de passar ao cliente.' : 'Para iPhone abaixo do 11 e outros aparelhos: informe a peça e a regra calcula o preço.'}
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setEditando((v) => !v)}>⚙️ Ajustar regras e tabela de preços</button>
          </div>

          <div className="card">
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Preço para o cliente</div>
            {resultado.indisponivel && <div style={{ fontSize: 22, fontWeight: 800, margin: '8px 0' }}>Indisponível para este modelo</div>}
            {resultado.vazio && <div style={{ fontSize: 20, fontWeight: 700, margin: '8px 0', color: 'var(--text-dim)' }}>Preencha o valor da peça</div>}
            {final != null && <div style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.1, margin: '6px 0' }}>{formatCurrency(final)}</div>}
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>{resultado.origem}</div>
            {resultado.regra && <div style={{ fontSize: 12.5, marginTop: 8, color: 'var(--text-dim)' }}>{resultado.regra}</div>}
            {final != null && (
              <div style={{ marginTop: 14, display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                {!resultado.tabela && <div><div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>PREÇO CALCULADO</div><b>{formatCurrency(resultado.base)}</b></div>}
                <div><div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>VALOR MÍNIMO À VISTA (-{pctDesc}%)</div><b>{formatCurrency(minimo)}</b></div>
              </div>
            )}
            {final != null && <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={irParaCartao}>Ver quanto cobrar no cartão</button>}
          </div>
        </div>
      )}

      {aba === 'preco' && editando && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Regras de cálculo (para quando usa a peça)</h3>
          <div className="form-grid cols-3">
            {[['tela', 'Tela', [['limite', 'Peça menor que (R$)'], ['fixo', 'Soma fixa (R$)'], ['mult', 'Multiplicar peça por'], ['acres', 'Acréscimo (%)']]],
              ['bateria', 'Bateria', [['limite', 'Peça menor que (R$)'], ['fixo', 'Soma fixa (R$)'], ['mult', 'Multiplicar peça por'], ['acres', 'Acréscimo (%)']]],
              ['conector', 'Conector de carga', [['a', 'Faixa 1 até (R$)'], ['fixoA', 'Preço fixo faixa 1'], ['b', 'Faixa 2 até (R$)'], ['fixoB', 'Preço fixo faixa 2'], ['mult', 'Acima: peça ×']]],
              ['tampa', 'Tampa traseira', [['fixo', 'Peça + fixo (R$)']]],
              ['arred', 'Arredondamento', [['passo', 'Múltiplo de (R$)'], ['menos', 'Menos (R$)']]],
              ['desc', 'Desconto à vista', [['bateria', 'Bateria (%)'], ['outros', 'Demais (%)']]],
            ].map(([g, t, campos]) => (
              <div key={g} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12 }}>
                <b>{t}</b>
                {campos.map(([c, rot]) => (
                  <div className="field" key={c} style={{ marginTop: 8 }}><label>{rot}</label>
                    <input type="text" inputMode="decimal" value={regras[g][c]} onChange={(e) => setR(g, c, sanitizeDecimalInput(e.target.value))} /></div>
                ))}
              </div>
            ))}
          </div>

          <h3 style={{ marginTop: 22 }}>Tabela fixa de preços</h3>
          <div className="table-wrap sem-fixo" style={{ maxHeight: 420 }}>
            <table>
              <thead><tr><th>Modelo</th>{SERVICOS_TABELA.map(([k, n]) => <th key={k}>{n}</th>)}<th /></tr></thead>
              <tbody>
                {tabela.map((l, i) => (
                  <tr key={i}>
                    <td><input style={{ width: 150 }} value={l.modelo} onChange={(e) => setCel(i, 'modelo', e.target.value)} /></td>
                    {SERVICOS_TABELA.map(([k]) => (
                      <td key={k}><input style={{ width: 78 }} inputMode="decimal" placeholder="—" value={l[k] ?? ''} onChange={(e) => setCel(i, k, sanitizeDecimalInput(e.target.value))} /></td>
                    ))}
                    <td><button className="btn btn-ghost btn-sm" title="Remover" onClick={() => removerModelo(i)}>🗑️</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>Deixe a célula vazia para "indisponível". As alterações são salvas automaticamente neste aparelho.</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn btn-secondary btn-sm" onClick={novoModelo}>+ Adicionar modelo</button>
            <button className="btn btn-ghost btn-sm" onClick={restaurar}>Restaurar padrão</button>
          </div>
        </div>
      )}

      {aba === 'simulador' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(280px, 380px) 1fr', alignItems: 'start' }}>
          <div className="card">
            <div className="tabs-sub" style={{ marginBottom: 12 }}>
              <button className={`tab-btn ${modo === 'receber' ? 'active' : ''}`} onClick={() => setModo('receber')}>Quero receber</button>
              <button className={`tab-btn ${modo === 'cobrar' ? 'active' : ''}`} onClick={() => setModo('cobrar')}>Vou cobrar</button>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12 }}>
              {modo === 'receber' ? 'Informe quanto quer que caia na sua conta. O sistema mostra quanto passar na maquininha (a taxa vai para o cliente).' : 'Informe o valor da venda. O sistema mostra quanto cai na sua conta depois da taxa (a taxa sai de você).'}
            </div>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              <div className="field"><label>{modo === 'receber' ? 'Valor que quero receber (R$)' : 'Valor da venda (R$)'}</label>{campoNum(valor, setValor, { placeholder: '0,00' })}</div>
              <div className="field"><label>Custo da peça/produto (R$) — opcional</label>{campoNum(custo, setCusto, { placeholder: '0,00' })}</div>
              <div className="field"><label>Parcelar em até</label>
                <select value={ate} onChange={(e) => setAte(Number(e.target.value))}>
                  {[6, 10, 12, 18].map((n) => <option key={n} value={n}>{n}x</option>)}
                </select></div>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setEditTaxas((v) => !v)}>{editTaxas ? '✔ Concluir taxas' : '⚙️ Editar taxas da maquininha'}</button>
            {editTaxas && <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}>Digite a taxa (%) de cada linha na tabela ao lado. As taxas mostradas são exemplos: troque pelas da sua maquininha.</div>}
          </div>

          <div>
            {!(V > 0) ? (
              <div className="card" style={{ color: 'var(--text-dim)' }}>Digite um valor para simular as parcelas.</div>
            ) : (
              <div className="table-wrap sem-fixo">
                <table>
                  <thead><tr>
                    <th>Forma</th><th>Taxa</th><th>Cliente paga</th><th>Parcela</th>
                    <th>{modo === 'receber' ? 'Juros p/ cliente' : 'Taxa (R$)'}</th><th>Você recebe</th>{C > 0 && <th>Lucro</th>}
                  </tr></thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.k}>
                        <td><b>{l.rotulo}</b></td>
                        <td>{editTaxas
                          ? <input style={{ width: 70 }} inputMode="decimal" value={taxas[l.k] ?? ''} onChange={(e) => setTx(l.k, sanitizeDecimalInput(e.target.value))} />
                          : `${l.taxa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%`}</td>
                        <td>{formatCurrency(l.total)}</td>
                        <td>{l.n > 1 ? `${l.n}x de ${formatCurrency(l.parcela)}` : '—'}</td>
                        <td style={{ color: 'var(--danger)' }}>{formatCurrency(modo === 'receber' ? l.juros : l.descTaxa)}</td>
                        <td><b>{formatCurrency(l.recebe)}</b></td>
                        {C > 0 && <td style={{ color: l.lucro >= 0 ? 'var(--success, #4ade80)' : 'var(--danger)' }}><b>{formatCurrency(l.lucro)}</b></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
