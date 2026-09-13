import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';

const NIVEL_LABEL = { AltoRisco: 'Alto risco', Suspeito: 'Suspeito', Normal: 'Normal' };

function BadgeRisco({ nivel }) {
  return <span className={`badge badge-${nivel}`}>{NIVEL_LABEL[nivel] || nivel}</span>;
}

export default function RemocaoVirus() {
  const { user, showToast } = useApp();

  const [adbStatus, setAdbStatus] = useState(null); // { disponivel, motivo }
  const [dispositivos, setDispositivos] = useState([]);
  const [buscandoDispositivos, setBuscandoDispositivos] = useState(false);
  const [serialSelecionado, setSerialSelecionado] = useState('');

  const [clientes, setClientes] = useState([]);
  const [clienteId, setClienteId] = useState('');
  const [equipamentos, setEquipamentos] = useState([]);
  const [equipamentoId, setEquipamentoId] = useState('');

  const [analisando, setAnalisando] = useState(false);
  const [resultados, setResultados] = useState(null);
  const [expandido, setExpandido] = useState(null);
  const [acaoEmAndamento, setAcaoEmAndamento] = useState(null);

  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historico, setHistorico] = useState([]);

  const [mostrarFormatar, setMostrarFormatar] = useState(false);
  const [textoConfirmacao, setTextoConfirmacao] = useState('');
  const [formatando, setFormatando] = useState(false);

  const dispositivo = dispositivos.find((d) => d.serial === serialSelecionado) || null;

  useEffect(() => {
    verificarAdb();
    window.api.clientes.list().then(setClientes);
  }, []);

  useEffect(() => {
    if (!clienteId) { setEquipamentos([]); setEquipamentoId(''); return; }
    window.api.equipamentos.listByCliente(clienteId).then(setEquipamentos);
  }, [clienteId]);

  async function verificarAdb() {
    const res = await window.api.seguranca.adbDisponivel();
    setAdbStatus(res);
  }

  async function buscarDispositivos() {
    setBuscandoDispositivos(true);
    setResultados(null);
    try {
      const lista = await window.api.seguranca.listarDispositivos();
      setDispositivos(lista);
      if (lista.length === 0) {
        showToast('Nenhum aparelho encontrado. Confira o cabo e a depuração USB.', 'error');
      } else if (lista.length === 1) {
        setSerialSelecionado(lista[0].serial);
      }
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setBuscandoDispositivos(false);
    }
  }

  async function analisar() {
    if (!dispositivo) return showToast('Selecione um aparelho conectado.', 'error');
    if (dispositivo.status !== 'device') {
      return showToast('Este aparelho ainda não autorizou a depuração USB. Confira a tela do celular.', 'error');
    }
    setAnalisando(true);
    setResultados(null);
    try {
      const res = await window.api.seguranca.analisar(
        user, dispositivo.serial, dispositivo.modelo, clienteId || null, equipamentoId || null
      );
      setResultados(res);
      if (res.length === 0) showToast('Nenhum app de terceiros encontrado neste aparelho.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setAnalisando(false);
    }
  }

  async function executarAcao(item, tipo) {
    const confirmacoes = {
      desinstalar: `Desinstalar "${item.pacote}" do aparelho? Essa ação remove o app do celular do cliente.`,
      desativar: `Desativar "${item.pacote}"? O app deixa de funcionar, mas continua instalado (reversível).`,
      removerAdmin: `Remover a permissão de administrador de "${item.pacote}"? Isso pode ser necessário antes de desinstalar apps que se protegem dessa forma.`,
    };
    if (confirmacoes[tipo] && !confirm(confirmacoes[tipo])) return;

    setAcaoEmAndamento(item.pacote + ':' + tipo);
    try {
      let res;
      if (tipo === 'parar') {
        res = await window.api.seguranca.pararApp(dispositivo.serial, item.pacote);
      } else if (tipo === 'removerAdmin') {
        res = await window.api.seguranca.removerAdmin(
          user, dispositivo.serial, dispositivo.modelo, item.pacote, item.componenteAdmin, item.nivel, clienteId || null, equipamentoId || null
        );
      } else if (tipo === 'desativar') {
        res = await window.api.seguranca.desativarPacote(
          user, dispositivo.serial, dispositivo.modelo, item.pacote, item.nivel, clienteId || null, equipamentoId || null
        );
      } else if (tipo === 'reativar') {
        res = await window.api.seguranca.reativarPacote(
          user, dispositivo.serial, dispositivo.modelo, item.pacote, clienteId || null, equipamentoId || null
        );
      } else if (tipo === 'desinstalar') {
        res = await window.api.seguranca.desinstalar(
          user, dispositivo.serial, dispositivo.modelo, item.pacote, item.nivel, clienteId || null, equipamentoId || null
        );
      }

      if (res && res.ok) {
        showToast('Ação realizada com sucesso.');
        if (tipo === 'desinstalar') {
          setResultados((lst) => lst.filter((r) => r.pacote !== item.pacote));
        }
      } else {
        showToast('O aparelho recusou a ação: ' + (res?.erro || res?.stderr || 'motivo desconhecido'), 'error');
      }
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setAcaoEmAndamento(null);
    }
  }

  async function confirmarFormatacao() {
    if (textoConfirmacao !== 'FORMATAR') {
      return showToast('Digite exatamente "FORMATAR" para confirmar.', 'error');
    }
    setFormatando(true);
    try {
      const res = await window.api.seguranca.formatar(
        user, dispositivo.serial, dispositivo.modelo, textoConfirmacao, clienteId || null, equipamentoId || null
      );
      if (res && res.ok) {
        showToast('Comando de restauração de fábrica enviado. Acompanhe a tela do aparelho.');
        setMostrarFormatar(false);
        setTextoConfirmacao('');
        setResultados(null);
        setDispositivos([]);
        setSerialSelecionado('');
      } else {
        showToast('O aparelho recusou o comando: ' + (res?.erro || res?.stderr || 'motivo desconhecido') + '. Pode ser necessário formatar manualmente pelo menu de recovery.', 'error');
      }
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setFormatando(false);
    }
  }

  async function abrirHistorico() {
    const h = await window.api.seguranca.historico(clienteId || null, equipamentoId || null);
    setHistorico(h);
    setMostrarHistorico(true);
  }

  return (
    <div>
      <div className="alert" style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: 'var(--text-dim)' }}>
        ⚠️ Esta análise é baseada em <strong>sinais de comportamento suspeito</strong> (permissões, ausência de ícone, administrador do dispositivo, acessibilidade) — não é uma verificação de assinatura de vírus. Sempre confirme com o cliente antes de remover um app que ele reconheça.
      </div>

      {/* Passo 1: ADB */}
      {adbStatus && !adbStatus.disponivel && (
        <div className="empty-state" style={{ marginBottom: 16 }}>
          ADB não encontrado ({adbStatus.motivo}). Veja o arquivo <code>ADB-SETUP.md</code> para instalar o platform-tools.
        </div>
      )}

      {/* Vincular a um cliente/equipamento (opcional) */}
      <div className="toolbar">
        <div className="toolbar-left" style={{ gap: 10, display: 'flex' }}>
          <select value={clienteId} onChange={(e) => { setClienteId(e.target.value); setEquipamentoId(''); }}>
            <option value="">Vincular a um cliente (opcional)</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
          {clienteId && (
            <select value={equipamentoId} onChange={(e) => setEquipamentoId(e.target.value)}>
              <option value="">Vincular a um equipamento (opcional)</option>
              {equipamentos.map((eq) => <option key={eq.id} value={eq.id}>{eq.marca} {eq.modelo}</option>)}
            </select>
          )}
        </div>
        <div className="toolbar-right">
          <button className="btn btn-secondary" onClick={abrirHistorico}>Histórico</button>
        </div>
      </div>

      {/* Passo 2: dispositivo */}
      <div className="table-wrap" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={buscarDispositivos} disabled={buscandoDispositivos}>
            {buscandoDispositivos ? 'Buscando...' : '🔌 Buscar aparelho conectado'}
          </button>

          {dispositivos.length > 0 && (
            <select value={serialSelecionado} onChange={(e) => setSerialSelecionado(e.target.value)}>
              <option value="">Selecione o aparelho...</option>
              {dispositivos.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {(d.modelo || d.serial)} — {d.status === 'device' ? 'pronto' : d.status}
                </option>
              ))}
            </select>
          )}

          <button className="btn btn-primary" onClick={analisar} disabled={!dispositivo || analisando}>
            {analisando ? 'Analisando...' : '🔍 Analisar aparelho'}
          </button>
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 10 }}>
          No celular do cliente: ative <strong>Opções do desenvolvedor → Depuração USB</strong>, conecte o cabo e aceite a autorização que aparece na tela dele.
        </p>
      </div>

      {/* Resultados */}
      {resultados && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Aplicativo</th><th>Risco</th><th>Sinais encontrados</th><th></th>
              </tr>
            </thead>
            <tbody>
              {resultados.map((item) => (
                <React.Fragment key={item.pacote}>
                  <tr>
                    <td>
                      <button className="icon-btn" onClick={() => setExpandido(expandido === item.pacote ? null : item.pacote)} style={{ marginRight: 6 }}>
                        {expandido === item.pacote ? '▾' : '▸'}
                      </button>
                      {item.pacote}
                    </td>
                    <td><BadgeRisco nivel={item.nivel} /></td>
                    <td style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {item.temAdmin && 'Administrador do dispositivo · '}
                      {item.temAcessibilidade && 'Serviço de acessibilidade · '}
                      {!item.temLauncher && 'Sem ícone visível · '}
                      {item.permissoesRisco.length > 0 && `${item.permissoesRisco.length} permissão(ões) sensível(is)`}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }}
                        disabled={acaoEmAndamento === item.pacote + ':parar'}
                        onClick={() => executarAcao(item, 'parar')}>Parar</button>{' '}
                      {item.temAdmin && (
                        <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }}
                          disabled={acaoEmAndamento === item.pacote + ':removerAdmin'}
                          onClick={() => executarAcao(item, 'removerAdmin')}>Remover admin</button>
                      )}{' '}
                      <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }}
                        disabled={acaoEmAndamento === item.pacote + ':desativar'}
                        onClick={() => executarAcao(item, 'desativar')}>Desativar</button>{' '}
                      <button className="btn btn-danger" style={{ padding: '5px 10px', fontSize: 12 }}
                        disabled={acaoEmAndamento === item.pacote + ':desinstalar'}
                        onClick={() => executarAcao(item, 'desinstalar')}>Desinstalar</button>
                    </td>
                  </tr>
                  {expandido === item.pacote && (
                    <tr>
                      <td colSpan={4} style={{ background: 'var(--bg-elev-2)', fontSize: 12.5 }}>
                        <div style={{ padding: '8px 4px' }}>
                          <div>Versão: {item.versionName || '-'}</div>
                          <div>Instalado em: {item.firstInstallTime || '-'}</div>
                          <div>Pontuação de risco (heurística): {item.score}</div>
                          {item.permissoesRisco.length > 0 && (
                            <div>Permissões sensíveis: {item.permissoesRisco.join(', ')}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {resultados.length === 0 && (
                <tr><td colSpan={4}><div className="empty-state">Nenhum app de terceiros encontrado neste aparelho.</div></td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Zona de risco: formatação completa do aparelho */}
      {dispositivo && (
        <div className="table-wrap" style={{ padding: 16, marginTop: 16, border: '1px solid var(--danger, #d33)', background: 'rgba(211,51,51,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <strong style={{ color: 'var(--danger, #d33)' }}>⚠️ Zona de risco — Restauração de fábrica</strong>
              <p style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 6, marginBottom: 0 }}>
                Apaga <strong>todos os dados</strong> do aparelho ({dispositivo.modelo || dispositivo.serial}), não apenas os apps suspeitos. Use somente quando a infecção não puder ser resolvida app por app e o cliente já tiver autorizado a formatação (com backup feito, se aplicável). Ação irreversível.
              </p>
            </div>
            <button className="btn btn-danger" onClick={() => setMostrarFormatar(true)}>
              🗑️ Formatar aparelho
            </button>
          </div>
        </div>
      )}

      {mostrarFormatar && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !formatando && setMostrarFormatar(false)}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-header">
              <h3 style={{ color: 'var(--danger, #d33)' }}>Confirmar restauração de fábrica</h3>
              <button type="button" className="icon-btn" onClick={() => !formatando && setMostrarFormatar(false)}>✕</button>
            </div>
            <div style={{ padding: '4px 4px 16px' }}>
              <p style={{ fontSize: 13.5 }}>
                Você está prestes a apagar <strong>todos os dados</strong> do aparelho <strong>{dispositivo?.modelo || dispositivo?.serial}</strong>. Essa ação não pode ser desfeita.
              </p>
              <p style={{ fontSize: 13.5 }}>Confirme que o cliente autorizou e que o backup necessário já foi feito.</p>
              <p style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
                Se o comando for recusado pelo sistema (comum em aparelhos com MDM ou restrições de fabricante), formate manualmente pelo menu de recovery do aparelho.
              </p>
              <label style={{ display: 'block', fontSize: 12.5, marginTop: 12, marginBottom: 4 }}>
                Digite <strong>FORMATAR</strong> para confirmar:
              </label>
              <input
                type="text"
                value={textoConfirmacao}
                onChange={(e) => setTextoConfirmacao(e.target.value)}
                placeholder="FORMATAR"
                style={{ width: '100%' }}
                disabled={formatando}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
                <button className="btn btn-secondary" onClick={() => setMostrarFormatar(false)} disabled={formatando}>Cancelar</button>
                <button className="btn btn-danger" onClick={confirmarFormatacao} disabled={formatando || textoConfirmacao !== 'FORMATAR'}>
                  {formatando ? 'Formatando...' : 'Formatar aparelho'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {mostrarHistorico && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setMostrarHistorico(false)}>
          <div className="modal" style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h3>Histórico de ações</h3>
              <button type="button" className="icon-btn" onClick={() => setMostrarHistorico(false)}>✕</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Data</th><th>Cliente</th><th>Pacote</th><th>Ação</th><th>Resultado</th><th>Técnico</th></tr>
                </thead>
                <tbody>
                  {historico.map((h) => (
                    <tr key={h.id}>
                      <td>{h.criado_em ? new Date(h.criado_em).toLocaleString('pt-BR') : '-'}</td>
                      <td>{h.cliente_nome || '-'}</td>
                      <td>{h.pacote || '-'}</td>
                      <td>{h.acao}</td>
                      <td>{h.resultado}</td>
                      <td>{h.usuario_nome}</td>
                    </tr>
                  ))}
                  {historico.length === 0 && <tr><td colSpan={6}><div className="empty-state">Nenhum registro ainda.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
