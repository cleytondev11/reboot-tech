import React, { useEffect, useMemo } from 'react';
import { formatCurrency, formatDiaCurto, somarMesesDia, hojeLocal, sanitizeDecimalInput, parseDecimal, FORMAS_PAGAMENTO } from '../utils.js';

// Campos da venda "A prazo / parcelado": entrada (opcional) + parcelas + 1º vencimento.
// O que sobra depois da entrada é dividido nas parcelas, que vencem de mês em mês (mesmo dia).
// Entrada "recebida agora" entra no caixa/faturamento na hora; entrada "a receber" e as parcelas
// ficam em Cobranças e só entram quando o cliente pagar.
const OPCOES_PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24];

export function dividirParcelas(total, n) {
  const totalCent = Math.round((parseFloat(total) || 0) * 100);
  const base = Math.floor(totalCent / n);
  const resto = totalCent - base * n; // sobra de centavos vai na última parcela
  return Array.from({ length: n }, (_, i) => (base + (i === n - 1 ? resto : 0)) / 100);
}

// Valor da entrada (número) a partir do texto digitado.
export function valorEntrada(v) {
  return parseDecimal(v) || 0;
}

export default function PrazoCampos({ total, parcelas, vencimento, entrada, entradaForma, entradaRecebida, onChange, disabled }) {
  const n = Math.min(24, Math.max(1, parseInt(parcelas, 10) || 1));
  const ent = valorEntrada(entrada);
  const forma = entradaForma || 'Dinheiro';
  const recebida = entradaRecebida === undefined || entradaRecebida === null || entradaRecebida === '' ? 1 : Number(entradaRecebida) ? 1 : 0;
  const totalNum = parseFloat(total) || 0;
  const restante = Math.max(0, Math.round((totalNum - ent) * 100) / 100);
  const entradaInvalida = ent > 0 && totalNum > 0 && ent >= totalNum;

  const atual = { parcelas: n, vencimento: vencimento || '', entrada: entrada || '', entradaForma: forma, entradaRecebida: recebida };
  const mudar = (parte) => onChange({ ...atual, ...parte });

  // Sugere o 1º vencimento (daqui a 1 mês) assim que os campos aparecem.
  useEffect(() => {
    if (!vencimento) mudar({ vencimento: somarMesesDia(hojeLocal(), 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opcoes = OPCOES_PARCELAS.includes(n) ? OPCOES_PARCELAS : [...OPCOES_PARCELAS, n].sort((a, b) => a - b);
  const valores = useMemo(() => dividirParcelas(restante, n), [restante, n]);
  const primeiro = vencimento || '';
  const ultimo = primeiro ? somarMesesDia(primeiro, n - 1) : '';

  return (
    <div className="prazo-box">
      <div className="form-grid">
        <div className="field">
          <label>Entrada (opcional)</label>
          <input inputMode="decimal" placeholder="R$ 0,00" value={entrada || ''} disabled={disabled} onChange={(e) => mudar({ entrada: sanitizeDecimalInput(e.target.value) })} />
        </div>
        {ent > 0 && (
          <div className="field">
            <label>Entrada paga em</label>
            <select value={forma} disabled={disabled} onChange={(e) => mudar({ entradaForma: e.target.value })}>
              {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}
        {ent > 0 && (
          <div className="field">
            <label>A entrada está</label>
            <select value={recebida} disabled={disabled} onChange={(e) => mudar({ entradaRecebida: Number(e.target.value) })}>
              <option value={1}>Recebida agora</option>
              <option value={0}>A receber (vai para Cobranças)</option>
            </select>
          </div>
        )}
        <div className="field">
          <label>Nº de parcelas</label>
          <select value={n} disabled={disabled} onChange={(e) => mudar({ parcelas: parseInt(e.target.value, 10) })}>
            {opcoes.map((o) => <option key={o} value={o}>{o === 1 ? '1x (pagamento único)' : `${o}x`}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{n === 1 ? 'Vencimento' : '1º vencimento'}</label>
          <input type="date" value={primeiro} disabled={disabled} onChange={(e) => mudar({ vencimento: e.target.value })} />
        </div>
      </div>
      {entradaInvalida && <p style={{ color: 'var(--danger)', fontSize: 12.5, margin: '10px 0 0' }}>A entrada deve ser menor que o total ({formatCurrency(totalNum)}).</p>}
      {totalNum > 0 && !entradaInvalida && (
        <p className="muted prazo-resumo">
          {ent > 0 && <>Entrada de <b>{formatCurrency(ent)}</b> ({recebida ? 'recebida agora' : 'a receber'}) + </>}
          {n === 1
            ? <>1x de <b>{formatCurrency(valores[0])}</b> — vence em {formatDiaCurto(primeiro)}.</>
            : valores[0] === valores[n - 1]
              ? <>{n}x de <b>{formatCurrency(valores[0])}</b> — de {formatDiaCurto(primeiro)} até {formatDiaCurto(ultimo)}.</>
              : <>{n}x de <b>{formatCurrency(valores[0])}</b> (a última de {formatCurrency(valores[n - 1])}) — de {formatDiaCurto(primeiro)} até {formatDiaCurto(ultimo)}.</>}
          {' '}Parcelas{ent > 0 && !recebida ? ' e entrada' : ''} entram no caixa só quando o cliente pagar (menu Cobranças).
        </p>
      )}
    </div>
  );
}
