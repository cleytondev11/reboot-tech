import React, { useEffect, useState } from 'react';
import { useApp } from '../context.jsx';
import { formatDateTime } from '../utils.js';

const EMPTY_EMPRESA = {
  nome: '', nome_fantasia: '', logo: '', cnpj: '', ie: '', endereco: '', numero: '', bairro: '',
  cidade: '', uf: '', cep: '', telefone: '', whatsapp: '', email: '', site: '', redes_sociais: '',
};

export default function Configuracoes() {
  const { theme, toggleTheme, showToast, user } = useApp();
  const [tab, setTab] = useState('geral');
  const [logs, setLogs] = useState([]);
  const [version, setVersion] = useState('');
  const [empresa, setEmpresa] = useState(EMPTY_EMPRESA);
  const [empresaLoaded, setEmpresaLoaded] = useState(false);

  // Notificações push (só existem na versão web/celular)
  const pushApi = typeof window !== 'undefined' ? window.api?.push : null;
  const [pushAtivo, setPushAtivo] = useState(false);
  const PUSH_PREFS_PADRAO = { os_nova: true, os_status: true, os_pronta: true, orc_novo: true, orc_status: true, orc_convertido: true, venda: true, estoque_baixo: true, contas_pagar: true };
  const [pushPrefs, setPushPrefs] = useState(PUSH_PREFS_PADRAO);
  // Grupos de avisos exibidos na aba Notificações (todos mostram o valor).
  const PUSH_GRUPOS = [
    { titulo: 'Ordens de serviço', itens: [
      { chave: 'os_nova', texto: <>📥 Quando uma <b>nova OS</b> for aberta</> },
      { chave: 'os_status', texto: <>🔧 A cada <b>mudança de status</b> da OS (Em análise, Em manutenção, Aguardando peça, Pronto, Entregue...)</> },
      { chave: 'os_pronta', texto: <>✅ Só quando uma OS ficar <b>Pronto</b></> },
    ] },
    { titulo: 'Orçamentos', itens: [
      { chave: 'orc_novo', texto: <>📝 Quando um <b>novo orçamento</b> for criado</> },
      { chave: 'orc_status', texto: <>📊 A cada <b>mudança de status</b> do orçamento (Enviado, Aprovado, Recusado, Expirado, Convertido)</> },
      { chave: 'orc_convertido', texto: <>🔄 Só quando um orçamento for <b>convertido em OS</b></> },
    ] },
    { titulo: 'Vendas', itens: [
      { chave: 'venda', texto: <>💰 Quando uma <b>venda</b> for realizada (com o valor e a descrição dos itens)</> },
    ] },
    { titulo: 'Estoque', itens: [
      { chave: 'estoque_baixo', texto: <>⚠️ Quando um produto chegar no <b>estoque mínimo</b> ou acabar (venda, uso em OS ou ajuste manual)</> },
    ] },
    { titulo: 'Financeiro', itens: [
      { chave: 'contas_pagar', texto: <>💸 <b>Resumo diário</b> (por volta das 8h) das contas a pagar <b>atrasadas</b>, que vencem <b>hoje</b> ou <b>amanhã</b></> },
    ] },
  ];
  const [pushCarregando, setPushCarregando] = useState(false);

  async function carregarPush() {
    if (!pushApi) return;
    const st = await pushApi.status();
    setPushAtivo(st.ativo);
    if (st.prefs) setPushPrefs({ ...PUSH_PREFS_PADRAO, ...st.prefs });
  }
  async function ativarPush() {
    setPushCarregando(true);
    try {
      await pushApi.ativar(pushPrefs);
      setPushAtivo(true);
      showToast('Notificações ativadas neste aparelho!');
    } catch (e) { showToast(e.message, 'error'); }
    setPushCarregando(false);
  }
  async function desativarPush() {
    setPushCarregando(true);
    try { await pushApi.desativar(); setPushAtivo(false); showToast('Notificações desativadas neste aparelho.'); }
    catch (e) { showToast(e.message, 'error'); }
    setPushCarregando(false);
  }
  async function alterarPref(chave, valor) {
    const novas = { ...pushPrefs, [chave]: valor };
    setPushPrefs(novas);
    if (!pushAtivo) return;
    try { await pushApi.salvarPrefs(novas); showToast('Preferência salva.'); }
    catch (e) { setPushPrefs(pushPrefs); showToast(e.message, 'error'); }
  }
  async function testarPush() {
    try { await pushApi.testar(); showToast('Notificação de teste enviada!'); }
    catch (e) { showToast(e.message, 'error'); }
  }

  const [impressoras, setImpressoras] = useState([]);
  const [impCfg, setImpCfg] = useState({ impressora_padrao: '', largura_papel: 80, formato: 'termica', copias: 1 });
  const [testandoImpressao, setTestandoImpressao] = useState(false);
  // Programa instalado (Electron) lista as impressoras; no navegador a lista aparece na janela de impressão.
  const ehNavegador = typeof navigator !== 'undefined' && !/Electron/i.test(navigator.userAgent);

  async function loadLogs() { setLogs(await window.api.logs.list(100)); }
  async function loadEmpresa() {
    const res = await window.api.empresa.get();
    setEmpresa({ ...EMPTY_EMPRESA, ...res });
    setEmpresaLoaded(true);
  }
  async function loadImpressora() {
    const [lista, cfg] = await Promise.all([window.api.impressora.listar(), window.api.impressora.configuracao()]);
    setImpressoras(lista);
    setImpCfg({ impressora_padrao: cfg.impressora_padrao || '', largura_papel: cfg.largura_papel || 80, formato: cfg.formato || 'termica', copias: cfg.copias || 1 });
  }

  useEffect(() => {
    loadLogs();
    loadEmpresa();
    loadImpressora();
    window.api.app.getVersion().then(setVersion);
  }, []);

  async function salvarImpressora(e) {
    e.preventDefault();
    try {
      await window.api.impressora.salvarConfiguracao(user, impCfg.impressora_padrao, impCfg.largura_papel, impCfg.copias, impCfg.formato);
      showToast('Configuração de impressora salva.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function testarImpressora() {
    if (!ehNavegador && !impCfg.impressora_padrao) return showToast('Selecione uma impressora primeiro.', 'error');
    setTestandoImpressao(true);
    try {
      await window.api.impressora.testar(impCfg.impressora_padrao, impCfg.largura_papel, impCfg.formato);
      if (!ehNavegador) showToast('Impressão de teste enviada para a impressora.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setTestandoImpressao(false);
    }
  }

  async function doBackup() {
    const res = await window.api.backup.manual();
    if (res.ok && !res.web) showToast('Backup salvo em: ' + res.filePath);
  }

  function setE(field, value) { setEmpresa((e) => ({ ...e, [field]: value })); }

  function handleLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setE('logo', reader.result);
    reader.readAsDataURL(file);
  }

  async function salvarEmpresa(e) {
    e.preventDefault();
    if (!empresa.nome.trim()) return showToast('Informe o nome da empresa.', 'error');
    try {
      await window.api.empresa.save(user, empresa);
      showToast('Dados da empresa salvos. Os próximos PDFs já usarão essas informações.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  return (
    <div>
      <div className="tabs-sub">
        <button className={`tab-btn ${tab === 'geral' ? 'active' : ''}`} onClick={() => setTab('geral')}>⚙️ Geral</button>
        <button className={`tab-btn ${tab === 'empresa' ? 'active' : ''}`} onClick={() => setTab('empresa')}>🏢 Dados da Empresa</button>
        <button className={`tab-btn ${tab === 'impressora' ? 'active' : ''}`} onClick={() => setTab('impressora')}>🖨️ Impressora Térmica</button>
        {pushApi && <button className={`tab-btn ${tab === 'notificacoes' ? 'active' : ''}`} onClick={() => { setTab('notificacoes'); carregarPush(); }}>🔔 Notificações</button>}
        <button className={`tab-btn ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>🧾 Logs do Sistema</button>
      </div>

      {tab === 'geral' && (
        <div>
          <div className="grid grid-2">
            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>Aparência</div>
              <p className="muted" style={{ fontSize: 12.5 }}>Alterne entre tema claro e escuro.</p>
              <button className="btn btn-secondary" onClick={toggleTheme}>
                {theme === 'dark' ? '☀️ Ativar tema claro' : '🌙 Ativar tema escuro'}
              </button>
            </div>

            <div className="card">
              <div className="section-title" style={{ marginTop: 0 }}>Backup</div>
              <p className="muted" style={{ fontSize: 12.5 }}>Gere uma cópia manual do banco de dados a qualquer momento. O sistema também mantém o arquivo local salvo automaticamente a cada alteração.</p>
              <button className="btn btn-primary" onClick={doBackup}>💾 Gerar Backup Agora</button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <div className="section-title" style={{ marginTop: 0 }}>Sobre</div>
            <p className="muted" style={{ fontSize: 12.5 }}>Sistema de Gestão de Assistência Técnica · Versão {version}</p>
          </div>
        </div>
      )}

      {tab === 'empresa' && empresaLoaded && (
        <form className="card" onSubmit={salvarEmpresa}>
          <div className="section-title" style={{ marginTop: 0 }}>Dados da Empresa</div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -6, marginBottom: 16 }}>
            Essas informações são usadas automaticamente no cabeçalho de todos os PDFs gerados pelo sistema (Orçamentos, Ordens de Serviço, Checklists, Relatórios e Comprovantes). Não é preciso preenchê-las novamente em cada documento.
          </p>

          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginBottom: 18 }}>
            <div style={{ width: 140, height: 140, border: '1px dashed var(--border)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elev-2)', overflow: 'hidden', flexShrink: 0 }}>
              {empresa.logo ? (
                <img src={empresa.logo} alt="Logo" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              ) : (
                <span className="muted" style={{ fontSize: 11, textAlign: 'center', padding: 10 }}>Nenhuma logo enviada</span>
              )}
            </div>
            <div>
              <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                📤 Enviar Logomarca
                <input type="file" accept="image/*" onChange={handleLogo} style={{ display: 'none' }} />
              </label>
              {empresa.logo && (
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setE('logo', '')}>Remover</button>
              )}
              <p className="muted" style={{ fontSize: 11, marginTop: 8, maxWidth: 260 }}>
                A imagem é redimensionada proporcionalmente nos documentos, sem distorção. Prefira PNG com fundo transparente ou quadrado.
              </p>
            </div>
          </div>

          <div className="form-grid">
            <div className="field"><label>Nome da Empresa (Razão Social) *</label><input value={empresa.nome} onChange={(e) => setE('nome', e.target.value)} /></div>
            <div className="field"><label>Nome Fantasia</label><input value={empresa.nome_fantasia} onChange={(e) => setE('nome_fantasia', e.target.value)} /></div>

            <div className="field"><label>CNPJ</label><input value={empresa.cnpj} onChange={(e) => setE('cnpj', e.target.value)} /></div>
            <div className="field"><label>Inscrição Estadual</label><input value={empresa.ie} onChange={(e) => setE('ie', e.target.value)} /></div>

            <div className="field"><label>Endereço</label><input value={empresa.endereco} onChange={(e) => setE('endereco', e.target.value)} /></div>
            <div className="field"><label>Número</label><input value={empresa.numero} onChange={(e) => setE('numero', e.target.value)} /></div>

            <div className="field"><label>Bairro</label><input value={empresa.bairro} onChange={(e) => setE('bairro', e.target.value)} /></div>
            <div className="field"><label>CEP</label><input value={empresa.cep} onChange={(e) => setE('cep', e.target.value)} /></div>

            <div className="field"><label>Cidade</label><input value={empresa.cidade} onChange={(e) => setE('cidade', e.target.value)} /></div>
            <div className="field"><label>UF</label><input maxLength={2} style={{ textTransform: 'uppercase' }} value={empresa.uf} onChange={(e) => setE('uf', e.target.value.toUpperCase())} /></div>

            <div className="field"><label>Telefone</label><input value={empresa.telefone} onChange={(e) => setE('telefone', e.target.value)} /></div>
            <div className="field"><label>WhatsApp</label><input value={empresa.whatsapp} onChange={(e) => setE('whatsapp', e.target.value)} /></div>

            <div className="field"><label>E-mail</label><input type="email" value={empresa.email} onChange={(e) => setE('email', e.target.value)} /></div>
            <div className="field"><label>Site</label><input data-sem-maiuscula value={empresa.site} onChange={(e) => setE('site', e.target.value)} /></div>

            <div className="field span-2"><label>Redes Sociais</label><input data-sem-maiuscula placeholder="Ex: @reboottech (Instagram)" value={empresa.redes_sociais} onChange={(e) => setE('redes_sociais', e.target.value)} /></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="submit" className="btn btn-primary">Salvar Dados da Empresa</button>
          </div>
        </form>
      )}

      {tab === 'impressora' && (
        <div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
            Configure a impressora usada por <b>este computador</b> para imprimir recibos de Venda e de Ordem de Serviço — em cupom térmico estreito (58/80mm) ou em folha A4 comum. Cada computador pode ter sua própria impressora configurada — essa opção não é compartilhada pela rede.
          </p>
          <form className="card" onSubmit={salvarImpressora}>
            <div className="section-title" style={{ marginTop: 0 }}>Impressora</div>
            {ehNavegador && (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                Ao tocar em <b>🖨️ Imprimir</b>, o documento abre numa tela (com o botão <b>← Voltar</b>) e o navegador mostra a lista de impressoras do computador/celular para você escolher. Aqui você define só o formato do papel.
              </p>
            )}
            <div className="form-grid cols-3">
              {!ehNavegador && <div className="field span-2">
                <label>Impressora</label>
                <select value={impCfg.impressora_padrao} onChange={(e) => setImpCfg((c) => ({ ...c, impressora_padrao: e.target.value }))}>
                  <option value="">Usar impressora padrão do Windows</option>
                  {impressoras.map((p) => <option key={p.nome} value={p.nome}>{p.nome}{p.padrao ? ' (padrão)' : ''}</option>)}
                </select>
                {impressoras.length === 0 && (
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Nenhuma impressora detectada. Verifique se a impressora está instalada no Windows (Painel de Controle → Dispositivos e Impressoras).</p>
                )}
              </div>}
              <div className="field">
                <label>Formato do papel</label>
                <select value={impCfg.formato} onChange={(e) => setImpCfg((c) => ({ ...c, formato: e.target.value }))}>
                  <option value="termica">Cupom térmico (58/80mm)</option>
                  <option value="a4">Folha A4 (impressora comum)</option>
                </select>
              </div>
              {impCfg.formato === 'termica' && (
                <div className="field">
                  <label>Largura do Papel</label>
                  <select value={impCfg.largura_papel} onChange={(e) => setImpCfg((c) => ({ ...c, largura_papel: parseInt(e.target.value, 10) }))}>
                    <option value={80}>80mm</option>
                    <option value={58}>58mm</option>
                  </select>
                </div>
              )}
              <div className="field">
                <label>Cópias por impressão</label>
                <input type="text" inputMode="numeric" value={impCfg.copias} onChange={(e) => setImpCfg((c) => ({ ...c, copias: parseInt(e.target.value.replace(/\D/g, ''), 10) || 1 }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" disabled={testandoImpressao} onClick={testarImpressora}>
                {testandoImpressao ? 'Abrindo...' : (ehNavegador ? '🖨️ Abrir teste de impressão' : '🖨️ Imprimir Teste')}
              </button>
              <button type="submit" className="btn btn-primary">Salvar Configuração de Impressora</button>
            </div>
          </form>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
            O formato térmico funciona com qualquer impressora térmica USB/rede já instalada como impressora do Windows (Elgin, Bematech, Epson, etc.). O formato A4 funciona com qualquer impressora comum (jato de tinta/laser) já instalada. O leitor de código de barras USB não precisa de configuração aqui — basta usá-lo nos campos de busca do Estoque e nas Vendas, como se fosse um teclado.
          </p>
        </div>
      )}

      {tab === 'notificacoes' && pushApi && (
        <div className="card" style={{ maxWidth: 560 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Notificações no celular</div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            Receba um aviso neste aparelho, mesmo com o app fechado. A configuração vale só para o aparelho que você está usando agora.
          </p>
          {!pushApi.suportado() ? (
            <p style={{ fontSize: 13 }}>Este navegador não suporta notificações. No iPhone/iPad, abra o site no Safari, toque em Compartilhar → <b>Adicionar à Tela de Início</b> e abra o app por lá (iOS 16.4 ou superior).</p>
          ) : (
            <>
              {PUSH_GRUPOS.map((g) => (
                <div key={g.titulo} style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{g.titulo}</div>
                  {g.itens.map((it) => (
                    <label key={it.chave} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '8px 0', cursor: 'pointer' }}>
                      <input type="checkbox" style={{ marginTop: 3 }} checked={!!pushPrefs[it.chave]} onChange={(e) => alterarPref(it.chave, e.target.checked)} />
                      <span>{it.texto}</span>
                    </label>
                  ))}
                </div>
              ))}
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                As notificações de OS, orçamento e venda mostram o <b>valor</b> (a venda também lista os itens). Se "toda mudança de status" estiver ligada, o aviso de "Pronto" já vem junto (você não recebe duas vezes).
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
                {pushAtivo ? (
                  <>
                    <button className="btn btn-secondary" onClick={testarPush}>Enviar teste</button>
                    <button className="btn btn-secondary" disabled={pushCarregando} onClick={desativarPush}>Desativar neste aparelho</button>
                  </>
                ) : (
                  <button className="btn btn-primary" disabled={pushCarregando} onClick={ativarPush}>
                    {pushCarregando ? 'Ativando...' : '🔔 Ativar notificações neste aparelho'}
                  </button>
                )}
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                Status: {pushAtivo ? 'ativado ✅' : pushApi.permissao() === 'denied' ? 'bloqueado nas configurações do navegador ⛔' : 'desativado'}
              </p>
            </>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Logs do Sistema</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>Detalhes</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>{formatDateTime(l.criado_em)}</td>
                    <td>{l.usuario_nome}</td>
                    <td><span className="pill">{l.acao}</span></td>
                    <td>{l.entidade} {l.entidade_id ? `#${l.entidade_id}` : ''}</td>
                    <td className="muted">{l.detalhes}</td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={5}><div className="empty-state">Nenhum log registrado ainda.</div></td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
