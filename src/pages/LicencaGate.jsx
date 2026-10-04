import React, { useEffect, useState, useCallback } from 'react';

// Preencha com o WhatsApp de suporte da sua empresa (com DDI+DDD, só números).
// Ex.: '5511999998888'. Deixe vazio para não mostrar o botão de contato.
const WHATSAPP_SUPORTE = '5561992040024';

// A cada quantos minutos o sistema reconfirma a licença enquanto está aberto.
const INTERVALO_REVERIFICACAO_MIN = 60;

function TelaAtivacao({ onAtivado }) {
  const [chave, setChave] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await window.api.licenca.ativar(chave.trim());
      if (res.ok) {
        onAtivado();
      } else {
        setError(res.error || 'Não foi possível ativar a licença.');
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={handleSubmit}>
        <img src="./logo.png" alt="Reboot Tech" onError={(e) => (e.target.style.display = 'none')} />
        <h2>Ativação do sistema</h2>
        <p className="sub">Digite a chave de licença que você recebeu na compra para liberar o uso.</p>

        <div className="field">
          <label>Chave de licença</label>
          <input
            autoFocus
            value={chave}
            onChange={(e) => setChave(e.target.value)}
            placeholder="Ex.: RT-XXXX-XXXX"
          />
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Verificando...' : 'Ativar'}
        </button>
        {error && <div className="login-error">{error}</div>}
        <p className="login-hint">Não recebeu sua chave? Entre em contato com o suporte.</p>
      </form>
    </div>
  );
}

function formatarData(iso) {
  if (!iso) return '';
  const [a, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function TelaBloqueada({ info }) {
  const vencida = info && info.motivo === 'vencida';
  function abrirSuporte() {
    if (WHATSAPP_SUPORTE) {
      const msg = vencida
        ? 'Olá! A mensalidade do meu sistema Reboot Tech venceu e quero pagar para liberar o acesso.'
        : 'Olá! Meu acesso ao Reboot Tech System está bloqueado.';
      window.api.whatsapp.abrirConversa(WHATSAPP_SUPORTE, msg);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./logo.png" alt="Reboot Tech" onError={(e) => (e.target.style.display = 'none')} />
        <h2>{vencida ? '⏰ Mensalidade vencida' : '🔒 Acesso bloqueado'}</h2>
        <p className="sub">
          {vencida
            ? `O acesso a este sistema foi suspenso porque a mensalidade venceu${info.dataVencimento ? ' em ' + formatarData(info.dataVencimento) : ''}. Entre em contato com o suporte para efetuar o pagamento e liberar o acesso.`
            : 'O acesso a este sistema foi suspenso. Entre em contato com o suporte para regularizar sua situação.'}
        </p>
        {WHATSAPP_SUPORTE && (
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={abrirSuporte}>
            {vencida ? 'Falar com o suporte para pagar' : 'Falar com o suporte'}
          </button>
        )}
      </div>
    </div>
  );
}

// Faixa fina de aviso nos últimos dias antes de vencer
function FaixaVencimento({ info }) {
  const dias = info.diasRestantes;
  const quando = dias === 1 ? 'amanhã' : `em ${dias} dias`;
  function renovar() {
    if (WHATSAPP_SUPORTE) {
      window.api.whatsapp.abrirConversa(WHATSAPP_SUPORTE, 'Olá! Quero renovar a mensalidade do meu sistema Reboot Tech.');
    }
  }
  return (
    <div className="faixa-vencimento">
      <span>⚠️ Sua mensalidade vence {quando} ({formatarData(info.dataVencimento)}). Renove para não perder o acesso.</span>
      {WHATSAPP_SUPORTE && <button type="button" onClick={renovar}>Renovar</button>}
    </div>
  );
}

function TelaRequerConexao({ onTentarNovamente }) {
  const [loading, setLoading] = useState(false);
  async function tentar() {
    setLoading(true);
    await onTentarNovamente();
    setLoading(false);
  }
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./logo.png" alt="Reboot Tech" onError={(e) => (e.target.style.display = 'none')} />
        <h2>Conexão necessária</h2>
        <p className="sub">
          Já faz um tempo que este sistema não consegue confirmar sua licença. Conecte-se à internet para continuar usando.
        </p>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={tentar} disabled={loading}>
          {loading ? 'Verificando...' : 'Tentar novamente'}
        </button>
      </div>
    </div>
  );
}

const DIAS_PARA_AVISAR = 5; // a faixa amarela aparece nos últimos X dias

export default function LicencaGate({ children }) {
  const [estado, setEstado] = useState('carregando');
  const [info, setInfo] = useState(null);

  const verificar = useCallback(async () => {
    try {
      const res = await window.api.licenca.status();
      setInfo(res);
      setEstado(res.estado);
    } catch (err) {
      // Em caso de falha inesperada na checagem, não deixa o usuário travado
      // numa tela de carregamento infinita.
      setEstado('ativa');
    }
  }, []);

  useEffect(() => {
    verificar();
    const id = setInterval(verificar, INTERVALO_REVERIFICACAO_MIN * 60 * 1000);
    // O servidor recusou uma ação por licença bloqueada/vencida: confere já.
    window.addEventListener('rt-licenca-bloqueada', verificar);
    return () => { clearInterval(id); window.removeEventListener('rt-licenca-bloqueada', verificar); };
  }, [verificar]);

  // Enquanto confere a licença, já mostra o sistema (sem a tela "Verificando licença...").
  // Se a licença estiver bloqueada/vencida, a tela de bloqueio aparece assim que a resposta chegar.
  if (estado === 'carregando') return children;
  if (estado === 'ativacao_necessaria') return <TelaAtivacao onAtivado={verificar} />;
  if (estado === 'bloqueada') return <TelaBloqueada info={info} />;
  if (estado === 'requer_conexao') return <TelaRequerConexao onTentarNovamente={verificar} />;

  const avisar = info && typeof info.diasRestantes === 'number' && info.diasRestantes > 0 && info.diasRestantes <= DIAS_PARA_AVISAR;
  if (avisar) {
    return (
      <div className="licenca-wrap">
        <FaixaVencimento info={info} />
        {children}
      </div>
    );
  }
  return children;
}
