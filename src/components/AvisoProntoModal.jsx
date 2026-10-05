import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatCurrency } from '../utils.js';

// Aviso "sua OS está pronta": aparece sozinho assim que uma Ordem de Serviço
// passa para o status "Pronto". A mensagem já vem escrita; basta tocar em enviar.
//
// Por que não envia 100% sozinho? O WhatsApp só deixa um programa mandar mensagem
// sem toque humano pela API oficial paga (WhatsApp Business / Meta). Pelo link
// normal, o WhatsApp abre com a conversa e o texto prontos e falta só o "enviar".

const CHAVE_AVISADOS = 'rt-os-avisadas';

function lerAvisadas() {
  try { return JSON.parse(localStorage.getItem(CHAVE_AVISADOS) || '{}'); } catch { return {}; }
}

export function foiAvisada(osId) {
  return !!lerAvisadas()[osId];
}

function marcarAvisada(osId) {
  try {
    const todas = lerAvisadas();
    todas[osId] = new Date().toISOString();
    localStorage.setItem(CHAVE_AVISADOS, JSON.stringify(todas));
  } catch { /* sem armazenamento: só não marca */ }
}

function primeiroNome(nome) {
  return String(nome || '').trim().split(/\s+/)[0] || '';
}

export function montarMensagemPronto({ dados, empresaNome }) {
  const nome = primeiroNome(dados.cliente_nome);
  const linhas = [
    `Olá${nome ? ', ' + nome : ''}! 👋`,
    '',
    `Sua ordem de serviço *${dados.numero}*${dados.equipamento ? ` (${dados.equipamento})` : ''} está *pronta* ✅`,
  ];
  if (Number(dados.valor_total) > 0) linhas.push(`Valor total: ${formatCurrency(dados.valor_total)}`);
  linhas.push('', 'Você já pode vir retirar o seu aparelho.');
  linhas.push(empresaNome ? `Atenciosamente, ${empresaNome}.` : 'Obrigado!');
  return linhas.join('\n');
}

export default function AvisoProntoModal({ dados, onClose }) {
  const { showToast } = useApp();
  const [mensagem, setMensagem] = useState('');
  const [empresaNome, setEmpresaNome] = useState('');
  const [pronto, setPronto] = useState(false);
  const telefone = dados.whatsapp || dados.telefone || '';

  useEffect(() => {
    let vivo = true;
    (async () => {
      let nome = '';
      try {
        const emp = await window.api.empresa.get();
        nome = (emp && (emp.nome_fantasia || emp.razao_social || emp.nome)) || '';
      } catch { /* segue sem o nome da empresa */ }
      if (!vivo) return;
      setEmpresaNome(nome);
      setMensagem(montarMensagemPronto({ dados, empresaNome: nome }));
      setPronto(true);
    })();
    return () => { vivo = false; };
  }, [dados]);

  function enviar() {
    // Chamado direto do toque no botão: assim o celular permite abrir o WhatsApp.
    window.api.whatsapp.abrirConversa(telefone, mensagem)
      .then(() => {
        marcarAvisada(dados.id);
        showToast('WhatsApp aberto com a mensagem. Toque em enviar para avisar o cliente.');
        onClose(true);
      })
      .catch((err) => showToast(String((err && err.message) || err), 'error'));
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagem);
      showToast('Mensagem copiada.');
    } catch {
      showToast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error');
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" style={{ width: 'min(520px, 94vw)' }}>
        <div className="modal-header">
          <h3>🔔 Avisar cliente: OS pronta</h3>
          <button type="button" className="icon-btn" onClick={() => onClose(false)}>✕</button>
        </div>

        <p style={{ marginTop: 0 }}>
          A <b>{dados.numero}</b> foi marcada como <b>Pronto</b>. Avise <b>{dados.cliente_nome || 'o cliente'}</b>
          {telefone ? <> pelo WhatsApp <span className="muted">({telefone})</span></> : null}:
        </p>

        {!telefone && (
          <p style={{ color: 'var(--danger, #e5484d)', fontSize: 13 }}>
            ⚠️ Este cliente não tem WhatsApp/telefone cadastrado. Cadastre o número em Clientes ou copie a mensagem.
          </p>
        )}

        <div className="field">
          <label>Mensagem (você pode editar antes de enviar)</label>
          <textarea data-sem-maiuscula rows={8} value={mensagem} disabled={!pronto} onChange={(e) => setMensagem(e.target.value)} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={!pronto || !telefone} onClick={enviar}>💬 Enviar pelo WhatsApp</button>
          <button type="button" className="btn btn-secondary" disabled={!pronto} onClick={copiar}>📋 Copiar mensagem</button>
          <button type="button" className="btn btn-ghost" onClick={() => onClose(false)}>Agora não</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
          O WhatsApp abre com a conversa e o texto prontos; falta só tocar em enviar.
        </p>
      </div>
    </div>
  );
}
