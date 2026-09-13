import React, { useEffect, useState, useCallback } from 'react';

// Preencha com o WhatsApp de suporte da sua empresa (com DDI+DDD, só números).
// Ex.: '5511999998888'. Deixe vazio para não mostrar o botão de contato.
const WHATSAPP_SUPORTE = '5561992040024';

// A cada quantos minutos o sistema reconfirma a licença enquanto está aberto.
const INTERVALO_REVERIFICACAO_MIN = 60;

function TelaCarregando() {
  return (
    <div className="login-screen">
      <div className="login-card">
        <p className="sub">Verificando licença...</p>
      </div>
    </div>
  );
}

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

function TelaBloqueada() {
  function abrirSuporte() {
    if (WHATSAPP_SUPORTE) {
      window.api.whatsapp.abrirConversa(WHATSAPP_SUPORTE, 'Olá! Meu acesso ao Reboot Tech System está bloqueado.');
    }
  }
  return (
    <div className="login-screen">
      <div className="login-card">
        <img src="./logo.png" alt="Reboot Tech" onError={(e) => (e.target.style.display = 'none')} />
        <h2>🔒 Acesso bloqueado</h2>
        <p className="sub">
          O acesso a este sistema foi suspenso. Entre em contato com o suporte para regularizar sua situação.
        </p>
        {WHATSAPP_SUPORTE && (
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={abrirSuporte}>
            Falar com o suporte
          </button>
        )}
      </div>
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

export default function LicencaGate({ children }) {
  const [estado, setEstado] = useState('carregando');

  const verificar = useCallback(async () => {
    try {
      const res = await window.api.licenca.status();
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
    return () => clearInterval(id);
  }, [verificar]);

  if (estado === 'carregando') return <TelaCarregando />;
  if (estado === 'ativacao_necessaria') return <TelaAtivacao onAtivado={verificar} />;
  if (estado === 'bloqueada') return <TelaBloqueada />;
  if (estado === 'requer_conexao') return <TelaRequerConexao onTentarNovamente={verificar} />;

  return children;
}
