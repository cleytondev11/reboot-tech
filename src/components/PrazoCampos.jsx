import React, { useEffect, useMemo } from 'react';
import { formatCurrency, formatDiaCurto, somarMesesDia, hojeLocal } from '../utils.js';

// Campos da venda "A prazo": quantas parcelas e quando vence a primeira.
// As demais parcelas vencem de mês em mês (mesmo dia). Usado na Venda, na OS e na Bancada.
// Nada entra no caixa na hora: cada parcela vira uma conta a receber (menu Cobranças).
const OPCOES_PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24];

export function dividirParcelas(total, n) {
  const totalCent = Math.round((parseFloat(total) || 0) * 100);
  const base = Math.floor(totalCent / n);
  const resto = totalCent - base * n; // sobra de centavos vai na última parcela
  return Array.from({ length: n }, (_, i) => (base + (i === n - 1 ? resto : 0)) / 100);
}

export default function PrazoCampos({ total, parcelas, vencimento, onChange, disabled }) {
  const n = Math.min(24, Math.max(1, parseInt(parcelas, 10) || 1));

  // Sugere o 1º vencimento (daqui a 1 mês) assim que os campos aparecem.
  useEffect(() => {
    if (!vencimento) onChange({ parcelas: n, vencimento: somarMesesDia(hojeLocal(), 1) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const opcoes = OPCOES_PARCELAS.includes(n) ? OPCOES_PARCELAS : [...OPCOES_PARCELAS, n].sort((a, b) => a - b);
  const valores = useMemo(() => dividirParcelas(total, n), [total, n]);
  const primeiro = vencimento || '';
  const ultimo = primeiro ? somarMesesDia(primeiro, n - 1) : '';

  return (
    <div className="prazo-box">
      <div className="form-grid">
        <div className="field">
          <label>Nº de parcelas</label>
          <select value={n} disabled={disabled} onChange={(e) => onChange({ parcelas: parseInt(e.target.value, 10), vencimento })}>
            {opcoes.map((o) => <option key={o} value={o}>{o === 1 ? '1x (pagamento único)' : `${o}x`}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{n === 1 ? 'Vencimento' : '1º vencimento'}</label>
          <input type="date" value={primeiro} disabled={disabled} onChange={(e) => onChange({ parcelas: n, vencimento: e.target.value })} />
        </div>
      </div>
      {Number(total) > 0 && (
        <p className="muted prazo-resumo">
          {n === 1
            ? <>1x de <b>{formatCurrency(valores[0])}</b> — vence em {formatDiaCurto(primeiro)}.</>
            : valores[0] === valores[n - 1]
              ? <>{n}x de <b>{formatCurrency(valores[0])}</b> — de {formatDiaCurto(primeiro)} até {formatDiaCurto(ultimo)}.</>
              : <>{n}x de <b>{formatCurrency(valores[0])}</b> (a última de {formatCurrency(valores[n - 1])}) — de {formatDiaCurto(primeiro)} até {formatDiaCurto(ultimo)}.</>}
          {' '}Entra no caixa só quando o cliente pagar (menu Cobranças).
        </p>
      )}
    </div>
  );
}
