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

  const [redeStatus, setRedeStatus] = useState(null);
  const [redeForm, setRedeForm] = useState({ modo: 'standalone', servidor_ip: '', porta: 4653, chave_rede: '' });
  const [testandoConexao, setTestandoConexao] = useState(false);

  const [impressoras, setImpressoras] = useState([]);
  const [impCfg, setImpCfg] = useState({ impressora_padrao: '', largura_papel: 80, copias: 1 });
  const [testandoImpressao, setTestandoImpressao] = useState(false);

  async function loadLogs() { setLogs(await window.api.logs.list(100)); }
  async function loadEmpresa() {
    const res = await window.api.empresa.get();
    setEmpresa({ ...EMPTY_EMPRESA, ...res });
    setEmpresaLoaded(true);
  }
  async function loadRede() {
    const res = await window.api.rede.status();
    setRedeStatus(res);
    setRedeForm({ modo: res.modo || 'standalone', servidor_ip: res.servidor_ip || '', porta: res.porta || 4653, chave_rede: res.chave_rede || '' });
  }
  async function loadImpressora() {
    const [lista, cfg] = await Promise.all([window.api.impressora.listar(), window.api.impressora.configuracao()]);
    setImpressoras(lista);
    setImpCfg({ impressora_padrao: cfg.impressora_padrao || '', largura_papel: cfg.largura_papel || 80, copias: cfg.copias || 1 });
  }

  useEffect(() => {
    loadLogs();
    loadEmpresa();
    loadRede();
    loadImpressora();
    window.api.app.getVersion().then(setVersion);
  }, []);

  function setRF(field, value) { setRedeForm((f) => ({ ...f, [field]: value })); }

  function gerarChave() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    setRF('chave_rede', out);
  }

  async function salvarRede(e) {
    e.preventDefault();
    try {
      const res = await window.api.rede.configurar(user, redeForm.modo, redeForm.servidor_ip, redeForm.porta, redeForm.chave_rede);
      setRedeStatus(res.config);
      showToast('Configuração de rede salva.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function testarConexaoRede() {
    setTestandoConexao(true);
    try {
      const res = await window.api.rede.testarConexao(redeForm.servidor_ip, redeForm.porta, redeForm.chave_rede);
      showToast(`Conectado ao servidor "${res.nomeServidor || '?'}" com sucesso (${res.latenciaMs}ms).`);
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setTestandoConexao(false);
    }
  }

  async function salvarImpressora(e) {
    e.preventDefault();
    try {
      await window.api.impressora.salvarConfiguracao(user, impCfg.impressora_padrao, impCfg.largura_papel, impCfg.copias);
      showToast('Configuração de impressora salva.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    }
  }

  async function testarImpressora() {
    if (!impCfg.impressora_padrao) return showToast('Selecione uma impressora primeiro.', 'error');
    setTestandoImpressao(true);
    try {
      await window.api.impressora.testar(impCfg.impressora_padrao, impCfg.largura_papel);
      showToast('Cupom de teste enviado para a impressora.');
    } catch (err) {
      showToast(String(err.message || err), 'error');
    } finally {
      setTestandoImpressao(false);
    }
  }

  async function doBackup() {
    const res = await window.api.backup.manual();
    if (res.ok) showToast('Backup salvo em: ' + res.filePath);
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
        <button className={`tab-btn ${tab === 'rede' ? 'active' : ''}`} onClick={() => setTab('rede')}>🌐 Rede Multi-PC</button>
        <button className={`tab-btn ${tab === 'impressora' ? 'active' : ''}`} onClick={() => setTab('impressora')}>🖨️ Impressora Térmica</button>
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
            <div className="field"><label>Site</label><input value={empresa.site} onChange={(e) => setE('site', e.target.value)} /></div>

            <div className="field span-2"><label>Redes Sociais</label><input placeholder="Ex: @reboottech (Instagram)" value={empresa.redes_sociais} onChange={(e) => setE('redes_sociais', e.target.value)} /></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="submit" className="btn btn-primary">Salvar Dados da Empresa</button>
          </div>
        </form>
      )}

      {tab === 'rede' && (
        <div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
            Permite que vários computadores da loja compartilhem o mesmo banco de dados (clientes, OS, estoque, financeiro etc.), em tempo real, pela rede local. Escolha <b>um</b> computador para ser o <b>Servidor</b> (é nele que os dados ficam guardados) e configure os demais como <b>Cliente</b>, apontando para o IP do servidor.
          </p>

          {redeStatus && redeStatus.modo !== 'standalone' && (
            <div className="card" style={{ marginBottom: 18 }}>
              <div className="section-title" style={{ marginTop: 0 }}>Status Atual</div>
              <p style={{ fontSize: 13, margin: 0 }}>
                Modo: <b>{redeStatus.modo === 'servidor' ? 'Servidor' : 'Cliente'}</b>
                {redeStatus.modo === 'servidor' && (
                  <> — {redeStatus.servidorAtivo ? <span style={{ color: 'var(--gold)' }}>ativo, ouvindo na porta {redeStatus.porta}</span> : <span>parado</span>}</>
                )}
              </p>
              {redeStatus.modo === 'servidor' && redeStatus.ipsLocais?.length > 0 && (
                <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Nos outros computadores (Cliente), use um destes IPs como "IP do Servidor": <b>{redeStatus.ipsLocais.join(' ou ')}</b>
                </p>
              )}
            </div>
          )}

          <form className="card" onSubmit={salvarRede}>
            <div className="section-title" style={{ marginTop: 0 }}>Configuração</div>
            <div className="form-grid cols-3">
              <div className="field">
                <label>Modo deste computador</label>
                <select value={redeForm.modo} onChange={(e) => setRF('modo', e.target.value)}>
                  <option value="standalone">Sozinho (sem rede)</option>
                  <option value="servidor">Servidor (guarda os dados)</option>
                  <option value="cliente">Cliente (conecta a um servidor)</option>
                </select>
              </div>
              {redeForm.modo === 'cliente' && (
                <div className="field"><label>IP do Computador Servidor</label><input placeholder="Ex: 192.168.0.10" value={redeForm.servidor_ip} onChange={(e) => setRF('servidor_ip', e.target.value)} /></div>
              )}
              {redeForm.modo !== 'standalone' && (
                <div className="field"><label>Porta</label><input type="text" inputMode="numeric" value={redeForm.porta} onChange={(e) => setRF('porta', e.target.value.replace(/\D/g, ''))} /></div>
              )}
            </div>
            {redeForm.modo !== 'standalone' && (
              <div className="form-grid">
                <div className="field span-2">
                  <label>Chave de Rede (senha simples para proteger a conexão)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={redeForm.chave_rede} onChange={(e) => setRF('chave_rede', e.target.value)} placeholder="Deixe igual nos dois computadores" />
                    {redeForm.modo === 'servidor' && <button type="button" className="btn btn-secondary btn-sm" onClick={gerarChave}>Gerar</button>}
                  </div>
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Use a mesma chave no Servidor e em todos os Clientes.</p>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              {redeForm.modo === 'cliente' && (
                <button type="button" className="btn btn-secondary" disabled={testandoConexao} onClick={testarConexaoRede}>
                  {testandoConexao ? 'Testando...' : '🔌 Testar Conexão'}
                </button>
              )}
              <button type="submit" className="btn btn-primary">Salvar Configuração de Rede</button>
            </div>
          </form>

          <p className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
            Observações: os dois computadores precisam estar na mesma rede local (mesmo Wi-Fi/roteador). O computador Servidor precisa estar ligado, com o sistema aberto, para os Clientes funcionarem. Backups, PDFs e impressão sempre acontecem no computador que disparou a ação — o backup do banco de dados, porém, só pode ser feito no Servidor.
          </p>
        </div>
      )}

      {tab === 'impressora' && (
        <div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
            Configure a impressora térmica (cupom não-fiscal) usada por <b>este computador</b> para imprimir recibos de Venda e de Ordem de Serviço. Cada computador pode ter sua própria impressora configurada — essa opção não é compartilhada pela rede.
          </p>
          <form className="card" onSubmit={salvarImpressora}>
            <div className="section-title" style={{ marginTop: 0 }}>Impressora</div>
            <div className="form-grid cols-3">
              <div className="field span-2">
                <label>Impressora</label>
                <select value={impCfg.impressora_padrao} onChange={(e) => setImpCfg((c) => ({ ...c, impressora_padrao: e.target.value }))}>
                  <option value="">Usar impressora padrão do Windows</option>
                  {impressoras.map((p) => <option key={p.nome} value={p.nome}>{p.nome}{p.padrao ? ' (padrão)' : ''}</option>)}
                </select>
                {impressoras.length === 0 && (
                  <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>Nenhuma impressora detectada. Verifique se a impressora térmica está instalada no Windows (Painel de Controle → Dispositivos e Impressoras).</p>
                )}
              </div>
              <div className="field">
                <label>Largura do Papel</label>
                <select value={impCfg.largura_papel} onChange={(e) => setImpCfg((c) => ({ ...c, largura_papel: parseInt(e.target.value, 10) }))}>
                  <option value={80}>80mm</option>
                  <option value={58}>58mm</option>
                </select>
              </div>
              <div className="field">
                <label>Cópias por impressão</label>
                <input type="text" inputMode="numeric" value={impCfg.copias} onChange={(e) => setImpCfg((c) => ({ ...c, copias: parseInt(e.target.value.replace(/\D/g, ''), 10) || 1 }))} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="btn btn-secondary" disabled={testandoImpressao} onClick={testarImpressora}>
                {testandoImpressao ? 'Imprimindo...' : '🖨️ Imprimir Teste'}
              </button>
              <button type="submit" className="btn btn-primary">Salvar Configuração de Impressora</button>
            </div>
          </form>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 14 }}>
            Funciona com qualquer impressora térmica USB/rede já instalada como impressora do Windows (Elgin, Bematech, Epson, etc.). O leitor de código de barras USB não precisa de configuração aqui — basta usá-lo nos campos de busca do Estoque e nas Vendas, como se fosse um teclado.
          </p>
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
