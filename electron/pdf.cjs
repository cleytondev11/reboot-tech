const { BrowserWindow, dialog, shell } = require('electron');
const fs = require('fs');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(v) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDate(iso) {
  if (!iso) return '-';
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function addDays(dateStr, days) {
  if (!dateStr) return null;
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + (parseInt(days, 10) || 0));
  return d.toISOString().slice(0, 10);
}

// ---------- Cabeçalho / Rodapé (repetem em toda página, via CDP printToPDF) ----------

function enderecoCompleto(empresa) {
  const partes = [];
  if (empresa.endereco) {
    let linha = empresa.endereco;
    if (empresa.numero) linha += `, ${empresa.numero}`;
    if (empresa.bairro) linha += ` — ${empresa.bairro}`;
    partes.push(linha);
  }
  const cidadeUf = [empresa.cidade, empresa.uf].filter(Boolean).join('/');
  if (cidadeUf) partes.push(cidadeUf);
  if (empresa.cep) partes.push('CEP ' + empresa.cep);
  return partes.join(' — ');
}

function headerTemplate(empresa) {
  empresa = empresa || {};
  const logoImg = empresa.logo
    ? `<img src="${empresa.logo}" style="height:56px; max-width:170px; object-fit:contain;" />`
    : '';
  const nome = escapeHtml(empresa.nome_fantasia || empresa.nome || '');

  const linhaEndereco = [];
  if (empresa.endereco) {
    let l = empresa.endereco;
    if (empresa.numero) l += `, ${empresa.numero}`;
    if (empresa.bairro) l += ` — ${empresa.bairro}`;
    linhaEndereco.push(escapeHtml(l));
  }
  const cidadeUf = [empresa.cidade, empresa.uf].filter(Boolean).join('/');
  const linhaCidade = [];
  if (cidadeUf) linhaCidade.push(escapeHtml(cidadeUf));
  if (empresa.cep) linhaCidade.push('CEP ' + escapeHtml(empresa.cep));

  const contatos = [];
  if (empresa.telefone) contatos.push(`Tel: ${escapeHtml(empresa.telefone)}`);
  if (empresa.whatsapp) contatos.push(`WhatsApp: ${escapeHtml(empresa.whatsapp)}`);
  if (empresa.email) contatos.push(escapeHtml(empresa.email));
  if (empresa.site) contatos.push(escapeHtml(empresa.site));

  const cnpjLine = empresa.cnpj ? `CNPJ: ${escapeHtml(empresa.cnpj)}${empresa.ie ? ' · IE: ' + escapeHtml(empresa.ie) : ''}` : '';

  return `
    <div style="width:100%; font-size:9.5px; color:#333; padding:0 12mm; box-sizing:border-box; font-family:Arial,sans-serif;">
      <div style="display:flex; align-items:center; gap:14px; border-bottom:2px solid #a8841f; padding-bottom:8px;">
        ${logoImg}
        <div style="flex:1; line-height:1.5;">
          ${nome ? `<div style="font-size:19px; font-weight:bold; color:#111; letter-spacing:.2px; margin-bottom:2px;">${nome}</div>` : ''}
          ${cnpjLine ? `<div style="font-size:9.5px; color:#555;">${cnpjLine}</div>` : ''}
          ${linhaEndereco.length ? `<div style="font-size:9.5px; color:#555;">${linhaEndereco.join(' ')}${linhaCidade.length ? ' — ' + linhaCidade.join(' · ') : ''}</div>` : ''}
          ${contatos.length ? `<div style="font-size:9.5px; color:#555; margin-top:1px;">${contatos.join('  ·  ')}</div>` : ''}</div>
      </div>
    </div>
  `;
}

function footerTemplateHtml(subtitulo) {
  return `
    <div style="width:100%; font-size:8px; color:#666; padding:0 12mm; box-sizing:border-box; font-family:Arial,sans-serif; display:flex; justify-content:space-between; border-top:1px solid #ccc; padding-top:3px;">
      <span>${escapeHtml(subtitulo || 'Sistema de Gestão de Assistência Técnica')} · Emitido em <span class="date"></span></span>
      <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
    </div>
  `;
}

// ---------- Layout compartilhado do corpo do documento ----------

function wrapBodyHtml({ title, subtitle, innerHtml }) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #222; margin: 0; padding: 0 4mm; }
  h1.doc-title { font-size: 18px; color: #1a1a1a; margin: 4mm 0 1mm; text-transform: uppercase; letter-spacing: .4px; }
  .doc-subtitle { font-size: 11px; color: #666; margin-bottom: 6mm; }
  .section-title { font-size: 12px; font-weight: bold; color: #a8841f; border-bottom: 1px solid #eee; padding-bottom: 2px; margin: 6mm 0 3mm; text-transform: uppercase; letter-spacing: .3px; }
  p { line-height: 1.5; margin: 0 0 3mm; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 4mm; }
  th, td { border: 1px solid #ddd; padding: 4px 6px; font-size: 10px; text-align: left; }
  th { background: #f5f5f5; font-weight: bold; color: #444; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; margin-bottom: 4mm; }
  .info-grid .span-2 { grid-column: 1 / -1; }
  .info-item .label { font-size: 8.5px; color: #888; text-transform: uppercase; }
  .info-item .value { font-size: 11px; color: #222; }
  .total-box { text-align: right; font-size: 16px; font-weight: bold; color: #a8841f; margin-top: 2mm; }
  .totals-table { width: auto; margin-left: auto; margin-bottom: 0; border: none; }
  .totals-table td { border: none; padding: 2px 0 2px 18px; font-size: 11px; text-align: right; }
  .totals-table td:first-child { color: #666; }
  .totals-table td.desconto-value { color: #d3453f; font-weight: bold; }
  .muted { color: #888; font-size: 9.5px; }
  .signature-box { margin-top: 12mm; text-align: center; page-break-inside: avoid; }
  .signature-line { border-top: 1px solid #333; width: 70mm; margin: 0 auto; padding-top: 2mm; font-size: 9px; color: #555; }
  .checklist-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 2mm 4mm; margin-bottom: 4mm; }
  .termos-list { display: flex; flex-direction: column; gap: 2mm; margin-bottom: 2mm; }
  .termo-item { display: flex; align-items: flex-start; gap: 6px; font-size: 9.5px; line-height: 1.4; }
  .termo-check { font-size: 12px; flex-shrink: 0; margin-top: -1px; }
  .declaracao-box { background: #fff8ec; border: 1.5px solid #d4af37; border-left: 5px solid #a8841f; border-radius: 4px; padding: 4mm 5mm; margin: 2mm 0 4mm; page-break-inside: avoid; }
  .declaracao-titulo { font-size: 11.5px; font-weight: bold; color: #8a6a10; text-transform: uppercase; letter-spacing: .3px; margin-bottom: 2mm; display: flex; align-items: center; gap: 2mm; }
  .declaracao-texto { font-size: 9px; line-height: 1.55; color: #333; text-align: justify; }
  .checklist-item { display:flex; justify-content:space-between; border:1px solid #eee; padding: 2px 6px; font-size: 9.5px; border-radius: 3px; }
  .ok { color: #2f9e63; font-weight:bold; }
  .avaria { color: #d3453f; font-weight:bold; }
  .na { color: #999; }
  .resumo-grid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 5mm; }
  .resumo-card { border:1px solid #eee; border-radius: 4px; padding: 3mm; }
  .resumo-card .label { font-size: 8px; color:#888; text-transform:uppercase; }
  .resumo-card .value { font-size: 14px; font-weight:bold; color:#1a1a1a; }
</style>
</head><body>
  <h1 class="doc-title">${escapeHtml(title)}</h1>
  ${subtitle ? `<div class="doc-subtitle">${escapeHtml(subtitle)}</div>` : ''}
  ${innerHtml}
</body></html>`;
}

// ---------- Geração / salvamento ----------

async function gerarPdf({ parentWindow, empresa, dialogTitle, defaultFileName, title, subtitle, innerHtml, footerSubtitulo }) {
  const { canceled, filePath } = await dialog.showSaveDialog(parentWindow, {
    title: dialogTitle || 'Salvar PDF',
    defaultPath: defaultFileName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } });
  const html = wrapBodyHtml({ title, subtitle, innerHtml });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 1.5, bottom: 0.8, left: 0.4, right: 0.4 },
      displayHeaderFooter: true,
      headerTemplate: headerTemplate(empresa),
      footerTemplate: footerTemplateHtml(footerSubtitulo),
    });
    fs.writeFileSync(filePath, pdfData);
    shell.showItemInFolder(filePath);
    // O Explorer abre e rouba o foco do sistema; ao voltar para o app, o Chromium
    // às vezes não reconecta o foco do teclado ao campo ativo (o campo parece
    // clicável, mas não recebe as teclas). Forçar o foco de volta corrige isso.
    if (parentWindow && !parentWindow.isDestroyed()) {
      [150, 500, 1000].forEach((ms) => {
        setTimeout(() => {
          if (parentWindow && !parentWindow.isDestroyed()) {
            parentWindow.focus();
            parentWindow.webContents.focus();
          }
        }, ms);
      });
    }
    return { ok: true, filePath };
  } finally {
    win.destroy();
  }
}

// ---------- Construtores de corpo por tipo de documento ----------

function buildOsHtml(os) {
  let checklist = [];
  try { checklist = JSON.parse(os.checklist || '[]'); } catch { checklist = []; }
  const checklistPreenchido = checklist.filter((c) => c.status);
  const checklistHtml = checklistPreenchido.length ? `
    <div class="section-title">Checklist de Entrada</div>
    <div class="checklist-grid">
      ${checklistPreenchido.map((c) => {
        const cls = c.status === 'ok' ? 'ok' : c.status === 'avaria' ? 'avaria' : 'na';
        const label = c.status === 'ok' ? '✓ OK' : c.status === 'avaria' ? '✗ Avaria' : '— N/A';
        return `<div class="checklist-item"><span>${escapeHtml(c.item)}</span><span class="${cls}">${label}</span></div>`;
      }).join('')}
    </div>
  ` : '';

  const assinaturaHtml = os.assinatura_cliente ? `
    <div class="signature-box">
      <img src="${os.assinatura_cliente}" style="height:70px;" />
      <div class="signature-line">Assinatura do Cliente — ${escapeHtml(os.cliente_nome || '')}</div>
    </div>
  ` : '';

  let fotosEquip = [];
  try { fotosEquip = JSON.parse(os.equip_fotos || '[]'); } catch { fotosEquip = []; }
  const fotosHtml = fotosEquip.length ? `
    <div class="section-title">Fotos do Aparelho</div>
    <div style="display:flex; flex-wrap:wrap; gap:3mm; margin-bottom:4mm; page-break-inside: avoid;">
      ${fotosEquip.map((f) => `<img src="${f}" style="width:38mm; height:38mm; object-fit:cover; border:1px solid #ddd; border-radius:3px;" />`).join('')}
    </div>
  ` : '';

  let itensPecas = [];
  try { itensPecas = JSON.parse(os.itens_pecas || '[]'); } catch { itensPecas = []; }
  itensPecas = itensPecas.filter((i) => i.descricao);
  const itensTableHtml = itensPecas.length ? `
    <div class="section-title">Itens / Peças</div>
    <table>
      <thead><tr><th>Descrição</th><th style="width:60px;">Qtd.</th><th style="width:100px;">Valor Unit.</th><th style="width:110px;">Subtotal</th></tr></thead>
      <tbody>
        ${itensPecas.map((it) => `
          <tr>
            <td>${escapeHtml(it.descricao)}</td>
            <td style="text-align:center;">${it.quantidade}</td>
            <td style="text-align:right;">${formatCurrency(os.valor_total)}</td>
            <td style="text-align:right;">${formatCurrency(os.valor_total)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '';

  const descontoOs = parseFloat(os.desconto) || 0;
  const subtotalOs = (parseFloat(os.valor_mao_obra) || 0) + (parseFloat(os.valor_pecas) || 0);
  const totalsHtml = descontoOs > 0 ? `
    <table class="totals-table">
      <tbody>
        <tr><td>Subtotal</td><td>${formatCurrency(subtotalOs)}</td></tr>
        <tr><td>Desconto concedido</td><td class="desconto-value">- ${formatCurrency(descontoOs)}</td></tr>
      </tbody>
    </table>
  ` : '';

  return `
    <div class="info-grid">
      <div class="info-item"><div class="label">Cliente</div><div class="value">${escapeHtml(os.cliente_nome)}</div></div>
      <div class="info-item"><div class="label">Telefone</div><div class="value">${escapeHtml(os.cliente_telefone || os.cliente_whatsapp || '-')}</div></div>
      <div class="info-item"><div class="label">Equipamento</div><div class="value">${escapeHtml(os.equip_marca)} ${escapeHtml(os.equip_modelo)}</div></div>
      <div class="info-item"><div class="label">IMEI</div><div class="value">${escapeHtml(os.equip_imei || '-')}</div></div>
      <div class="info-item"><div class="label">Técnico Responsável</div><div class="value">${escapeHtml(os.tecnico_nome || '-')}</div></div>
      <div class="info-item"><div class="label">Status</div><div class="value">${escapeHtml(os.status)}</div></div>
      <div class="info-item"><div class="label">Data de Entrada</div><div class="value">${formatDate(os.data_entrada)}</div></div>
      <div class="info-item"><div class="label">Previsão / Saída</div><div class="value">${formatDate(os.previsao)} / ${formatDate(os.data_saida)}</div></div>
      <div class="info-item"><div class="label">Garantia</div><div class="value">${os.garantia_dias || 0} dias</div></div>
    </div>

    <div class="section-title">Defeito Informado</div>
    <p>${os.defeito_informado ? escapeHtml(os.defeito_informado) : '<span class="muted">Não informado.</span>'}</p>

    ${os.diagnostico ? `<div class="section-title">Diagnóstico Técnico</div><p>${escapeHtml(os.diagnostico)}</p>` : ''}
    ${os.servicos_executados ? `<div class="section-title">Serviços Executados</div><p>${escapeHtml(os.servicos_executados)}</p>` : ''}
    ${os.pecas_utilizadas ? `<div class="section-title">Peças Utilizadas (observações)</div><p>${escapeHtml(os.pecas_utilizadas)}</p>` : ''}

    ${checklistHtml}

    <div class="declaracao-box">
      <div class="declaracao-titulo">⚠️ Declaração de Condição do Aparelho</div>
      <p class="declaracao-texto">${escapeHtml(DECLARACAO_CONDICAO_APARELHO)}</p>
    </div>

    ${fotosHtml}

    ${itensTableHtml}

    ${totalsHtml}
    <div class="total-box">Valor Total: ${formatCurrency(os.valor_total)}</div>

    ${os.observacoes ? `<div class="section-title">Observações</div><p>${escapeHtml(os.observacoes)}</p>` : ''}

    ${assinaturaHtml}
  `;
}

const TERMOS_ACEITE_ITENS = [
  'Se o celular entrar sem funcionamento na assistência, a assistência não se responsabiliza por qualquer dano, a não ser o serviço que foi executado (exemplos de dano: som não funcionando, chip, etc.).',
  'O cliente foi informado de que a assistência não se responsabiliza por dados armazenados no aparelho (fotos, contatos, arquivos), sendo recomendado backup prévio.',
  'O cliente autoriza a abertura do aparelho para diagnóstico técnico.',
  'O cliente está ciente de que aparelhos com sinais de oxidação/líquido podem apresentar defeitos ocultos não cobertos por garantia.',
  'O cliente foi informado sobre o prazo para retirada do aparelho após conclusão ou desistência do serviço.',
  'Peças e componentes substituídos ficam sob custódia da assistência, salvo solicitação em contrário.',
];

const DECLARACAO_CONDICAO_APARELHO = 'O cliente declara estar ciente de que, caso o aparelho seja entregue à assistência técnica sem funcionamento total ou parcial, a assistência se responsabilizará exclusivamente pela execução do serviço contratado. Não nos responsabilizamos por defeitos, falhas ou funcionalidades que já apresentavam problemas antes da realização do serviço, bem como por itens não relacionados ao reparo solicitado. Exemplos incluem, mas não se limitam a: alto-falante (som), microfone, câmeras, leitor de chip (SIM), sinal de rede, Wi-Fi, Bluetooth, sensores, biometria, carregamento, touchscreen ou quaisquer outros componentes que já estivessem inoperantes ou apresentassem defeito no momento da entrada do aparelho. A responsabilidade da assistência técnica limita-se exclusivamente ao reparo descrito na ordem de serviço, não abrangendo defeitos preexistentes ou não relacionados ao serviço executado.';

function buildPatternSvg(patternStr) {
  const nums = String(patternStr || '').split(',').filter(Boolean).map(Number);
  if (nums.length === 0) return '<span class="muted">Nenhum padrão desenhado.</span>';
  const SIZE = 90, PAD = 15, STEP = (SIZE - PAD * 2) / 2;
  const pos = (n) => { const idx = n - 1; return { x: PAD + (idx % 3) * STEP, y: PAD + Math.floor(idx / 3) * STEP }; };
  let lines = '';
  for (let i = 1; i < nums.length; i++) {
    const a = pos(nums[i - 1]); const b = pos(nums[i]);
    lines += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#a8841f" stroke-width="3" stroke-linecap="round"/>`;
  }
  let dots = '';
  for (let n = 1; n <= 9; n++) {
    const p = pos(n); const active = nums.includes(n);
    dots += `<circle cx="${p.x}" cy="${p.y}" r="10" fill="none" stroke="${active ? '#a8841f' : '#ccc'}" stroke-width="1.5"/><circle cx="${p.x}" cy="${p.y}" r="${active ? 4 : 2.5}" fill="${active ? '#a8841f' : '#999'}"/>`;
  }
  return `<svg width="${SIZE}" height="${SIZE}" style="background:#fafafa;border:1px solid #eee;border-radius:6px;">${lines}${dots}</svg>`;
}

function buildChecklistOnlyHtml(os) {
  let checklist = [];
  try { checklist = JSON.parse(os.checklist || '[]'); } catch { checklist = []; }
  const rows = checklist.map((c) => {
    const cls = c.status === 'ok' ? 'ok' : c.status === 'avaria' ? 'avaria' : c.status === 'na' ? 'na' : 'na';
    const label = c.status === 'ok' ? '✓ OK' : c.status === 'avaria' ? '✗ Avaria' : c.status === 'na' ? '— N/A' : 'Não avaliado';
    return `<div class="checklist-item"><span>${escapeHtml(c.item)}</span><span class="${cls}">${label}</span></div>`;
  }).join('');

  let acessorios = [];
  try { acessorios = JSON.parse(os.checklist_acessorios || '[]'); } catch { acessorios = []; }
  const acessoriosHtml = `
    <div class="section-title">Acessórios Entregues</div>
    <p>${acessorios.length ? acessorios.map(escapeHtml).join(' · ') : '<span class="muted">Nenhum acessório informado.</span>'}</p>
  `;

  const senhaHtml = os.senha_tipo ? `
    <div class="section-title">Senha / PIN / Padrão de Desbloqueio</div>
    ${os.senha_tipo === 'padrao'
      ? `<div style="display:flex; align-items:center; gap:12px;">${buildPatternSvg(os.senha_valor)}<span class="muted">Padrão informado pelo cliente para testes técnicos.</span></div>`
      : `<p>${os.senha_valor ? escapeHtml(os.senha_valor) : '<span class="muted">Não informada.</span>'}</p>`}
  ` : '';

  let termos = [];
  try { termos = JSON.parse(os.termos_aceite || '[]'); } catch { termos = []; }
  const termosHtml = `
    <div class="section-title">Termos e Declarações</div>
    <div class="termos-list">
      ${TERMOS_ACEITE_ITENS.map((texto, i) => `
        <div class="termo-item"><span class="termo-check">${termos[i] ? '☑' : '☐'}</span><span>${escapeHtml(texto)}</span></div>
      `).join('')}
    </div>
    <div class="declaracao-box">
      <div class="declaracao-titulo">⚠️ Declaração de Condição do Aparelho</div>
      <p class="declaracao-texto">${escapeHtml(DECLARACAO_CONDICAO_APARELHO)}</p>
    </div>
  `;

  const assinaturaHtml = os.assinatura_cliente ? `
    <div class="signature-box">
      <img src="${os.assinatura_cliente}" style="height:70px;" />
      <div class="signature-line">Assinatura do Cliente — ${escapeHtml(os.cliente_nome || '')}</div>
    </div>` : `
    <div class="signature-box">
      <div class="signature-line">Assinatura do Cliente — ${escapeHtml(os.cliente_nome || '')}</div>
    </div>`;

  return `
    <div class="info-grid">
      <div class="info-item"><div class="label">OS Nº</div><div class="value">${escapeHtml(os.numero)}</div></div>
      <div class="info-item"><div class="label">Data de Entrada</div><div class="value">${formatDate(os.data_entrada)}</div></div>
      <div class="info-item"><div class="label">Cliente</div><div class="value">${escapeHtml(os.cliente_nome)}</div></div>
      <div class="info-item"><div class="label">Telefone</div><div class="value">${escapeHtml(os.cliente_telefone || os.cliente_whatsapp || '-')}</div></div>
      <div class="info-item"><div class="label">Equipamento</div><div class="value">${escapeHtml(os.equip_marca)} ${escapeHtml(os.equip_modelo)}</div></div>
      <div class="info-item"><div class="label">IMEI</div><div class="value">${escapeHtml(os.equip_imei || '-')}</div></div>
    </div>
    ${os.defeito_informado ? `<div class="section-title">Defeito Informado</div><p>${escapeHtml(os.defeito_informado)}</p>` : ''}
    <div class="section-title">Checklist de Vistoria de Entrada</div>
    <div class="checklist-grid">${rows || '<span class="muted">Nenhum item avaliado.</span>'}</div>
    ${acessoriosHtml}
    ${senhaHtml}
    ${termosHtml}
    ${assinaturaHtml}
  `;
}

function buildGarantiaHtml(os, empresa) {
  const nomeEmpresa = escapeHtml(empresa?.nome_fantasia || empresa?.nome || 'Assistência Técnica');
  const dataReparo = formatDate(os.data_entrada);
  const dataEntrega = formatDate(os.data_saida) !== '-' ? formatDate(os.data_saida) : formatDate(nowStr());
  const garantiaDias = os.garantia_dias || 90;

  const assinaturaHtml = os.assinatura_cliente
    ? `<img src="${os.assinatura_cliente}" style="height:60px; display:block; margin-bottom:2px;" />`
    : '';

  return `
    <div class="info-grid">
      <div class="info-item"><div class="label">Cliente</div><div class="value">${escapeHtml(os.cliente_nome)}</div></div>
      <div class="info-item"><div class="label">CPF/CNPJ</div><div class="value">${escapeHtml(os.cliente_cpf_cnpj || '-')}</div></div>
      <div class="info-item"><div class="label">Telefone</div><div class="value">${escapeHtml(os.cliente_telefone || os.cliente_whatsapp || '-')}</div></div>
      <div class="info-item"><div class="label">OS Nº</div><div class="value">${escapeHtml(os.numero)}</div></div>
      <div class="info-item"><div class="label">Aparelho</div><div class="value">${escapeHtml(os.equip_marca)} ${escapeHtml(os.equip_modelo)}</div></div>
      <div class="info-item"><div class="label">IMEI</div><div class="value">${escapeHtml(os.equip_imei || '-')}</div></div>
      <div class="info-item"><div class="label">Data do Reparo</div><div class="value">${dataReparo}</div></div>
      <div class="info-item"><div class="label">Data de Entrega</div><div class="value">${dataEntrega}</div></div>
      <div class="info-item span-2"><div class="label">Serviço Realizado</div><div class="value">${escapeHtml(os.servicos_executados || os.diagnostico || '-')}</div></div>
      <div class="info-item"><div class="label">Valor do Serviço</div><div class="value">${formatCurrency(os.valor_total)}</div></div>
    </div>

    <div class="section-title">1. Prazo de Garantia</div>
    <p>A ${nomeEmpresa} oferece ${garantiaDias} (${numeroPorExtenso(garantiaDias)}) dias de garantia sobre o serviço realizado e/ou peça substituída, contados a partir da data de entrega do aparelho ao cliente, salvo quando houver condição específica informada na Ordem de Serviço.</p>
    <p>A garantia é válida exclusivamente para o serviço executado e/ou a peça substituída, não abrangendo outros componentes ou defeitos que não estejam relacionados ao reparo realizado.</p>

    <div class="section-title">2. Cobertura da Garantia</div>
    <p>A garantia poderá ser acionada quando for constatado que o problema apresentado está diretamente relacionado ao serviço realizado ou à peça substituída pela assistência.</p>
    <p>Após a entrada do aparelho, será realizada uma avaliação técnica para verificar a causa do problema. Sendo constatado defeito coberto pela garantia, a ${nomeEmpresa} realizará o reparo necessário, sem cobrança de mão de obra referente ao mesmo serviço, observadas as condições deste termo.</p>

    <div class="section-title">3. Situações que Invalidam a Garantia</div>
    <p>A garantia será considerada inválida quando forem identificados danos ou intervenções posteriores ao serviço, incluindo: queda, impacto ou esmagamento do aparelho; contato com água, umidade ou outros líquidos; oxidação ou corrosão; quebra ou trincas na tela, carcaça ou componentes; tentativa de abertura ou reparo por terceiros; alteração ou remoção de componentes; danos causados por acessórios, carregadores, fontes ou cabos inadequados; mau uso ou utilização em condições inadequadas; danos elétricos ou variações de tensão; problemas em componentes diferentes daqueles reparados; ou qualquer alteração que impeça a assistência de realizar a análise técnica.</p>

    <div class="section-title">4. Aparelhos com Dano por Líquido</div>
    <p>Aparelhos que tenham sofrido contato com água, umidade ou outros líquidos podem apresentar problemas futuros mesmo após o reparo. Nesses casos, a garantia não cobre defeitos decorrentes de oxidação, corrosão ou danos causados por líquidos, salvo quando expressamente acordado por escrito na Ordem de Serviço.</p>

    <div class="section-title">5. Tela e Componentes Substituídos</div>
    <p>A garantia da tela e de outros componentes substituídos está condicionada à ausência de danos físicos, líquidos, quedas, pressão, mau uso ou intervenção de terceiros. Trincas, quebras ou riscos decorrentes de impacto ou danos físicos posteriores à entrega não são considerados defeitos de fabricação.</p>

    <div class="section-title">6. Procedimento para Acionar a Garantia</div>
    <p>Para solicitar a garantia, o cliente deverá apresentar o aparelho à ${nomeEmpresa}, preferencialmente acompanhado da Ordem de Serviço ou comprovante de atendimento. O aparelho será submetido a uma avaliação técnica para verificar se o problema está dentro das condições de garantia. O prazo para análise poderá variar conforme a complexidade do problema e a necessidade de testes ou peças.</p>

    <div class="section-title">7. Condições Finais</div>
    <p>A garantia não representa cobertura integral do aparelho, sendo limitada ao serviço realizado e/ou componente substituído, conforme descrito na respectiva Ordem de Serviço. Ao receber o aparelho, o cliente declara que teve a oportunidade de conferir seu funcionamento e as condições externas do equipamento.</p>
    <p><b>Declaro que li e estou de acordo com as condições deste Termo de Garantia.</b></p>

    <div class="signature-box">
      ${assinaturaHtml}
      <div class="signature-line">Assinatura do Cliente — ${escapeHtml(os.cliente_nome || '')}</div>
    </div>
    <div class="signature-box" style="margin-top:8mm;">
      <div class="signature-line">Responsável Técnico — ${nomeEmpresa}</div>
    </div>
  `;
}

function numeroPorExtenso(n) {
  const extensos = { 30: 'trinta', 60: 'sessenta', 90: 'noventa', 180: 'cento e oitenta', 365: 'trezentos e sessenta e cinco' };
  return extensos[n] || String(n);
}

function nowStr() {
  return new Date().toISOString().slice(0, 10);
}

// Cada item pode ter valor de peça (valor_peca) e mão de obra própria (valor_mao_obra).
// "valor_unit" é mantido apenas como fallback para orçamentos salvos antes dessa mudança.
function valorItemOrcamento(it) {
  const qtd = parseFloat(it.quantidade) || 0;
  const peca = it.valor_peca !== undefined ? (parseFloat(it.valor_peca) || 0) : (parseFloat(it.valor_unit) || 0);
  const maoObra = parseFloat(it.valor_mao_obra) || 0;
  return qtd * peca + maoObra;
}

function buildOrcamentoHtml(orc) {
  let itens = [];
  try { itens = JSON.parse(orc.itens || '[]'); } catch { itens = []; }
  // A mão de obra de cada item é somada ao valor do próprio item e exibida ao
  // cliente como um valor único por item — o detalhamento de quanto é peça e
  // quanto é mão de obra é apenas para controle interno e NÃO aparece aqui.
  // "valor_servicos" é mantido apenas como fallback para orçamentos salvos antes
  // da mão de obra passar a ser por item (mão de obra única do orçamento inteiro).
  const valorServicosLegado = parseFloat(orc.valor_servicos) || 0;
  const itensRows = itens.map((it) => `
    <tr>
      <td>${escapeHtml(it.descricao)}</td>
      <td style="text-align:center;">${it.quantidade}</td>
      <td style="text-align:right;">${formatCurrency(valorItemOrcamento(it))}</td>
    </tr>
  `).join('');
  const validade = orc.data_orcamento ? addDays(orc.data_orcamento, orc.validade_dias) : null;
  const subtotalItens = itens.reduce((s, it) => s + valorItemOrcamento(it), 0);
  const subtotalOrc = subtotalItens + valorServicosLegado;
  const descontoOrc = parseFloat(orc.desconto) || 0;
  const totalsHtmlOrc = descontoOrc > 0 ? `
    <table class="totals-table">
      <tbody>
        <tr><td>Subtotal</td><td>${formatCurrency(subtotalOrc)}</td></tr>
        <tr><td>Desconto concedido</td><td class="desconto-value">- ${formatCurrency(descontoOrc)}</td></tr>
      </tbody>
    </table>
  ` : '';

  return `
    <div class="info-grid">
      <div class="info-item"><div class="label">Cliente</div><div class="value">${escapeHtml(orc.cliente_nome)}</div></div>
      <div class="info-item"><div class="label">Telefone</div><div class="value">${escapeHtml(orc.cliente_telefone || orc.cliente_whatsapp || '-')}</div></div>
      ${orc.equip_marca ? `<div class="info-item"><div class="label">Equipamento</div><div class="value">${escapeHtml(orc.equip_marca)} ${escapeHtml(orc.equip_modelo)}</div></div>` : ''}
      <div class="info-item"><div class="label">Data do Orçamento</div><div class="value">${formatDate(orc.data_orcamento)}</div></div>
      <div class="info-item"><div class="label">Válido até</div><div class="value">${validade ? formatDate(validade) : '-'}</div></div>
      <div class="info-item"><div class="label">Status</div><div class="value">${escapeHtml(orc.status)}</div></div>
    </div>

    <div class="section-title">Itens / Peças</div>
    <table>
      <thead><tr><th>Descrição</th><th style="width:60px;">Qtd.</th><th style="width:120px;">Valor</th></tr></thead>
      <tbody>${itensRows || '<tr><td colspan="3" class="muted">Nenhuma peça/produto neste orçamento.</td></tr>'}</tbody>
    </table>

    ${totalsHtmlOrc}
    <div class="total-box">Valor Total: ${formatCurrency(orc.valor_total)}</div>

    ${orc.descricao ? `<div class="section-title">Descrição do Serviço</div><p>${escapeHtml(orc.descricao)}</p>` : ''}
    ${orc.observacoes ? `<div class="section-title">Observações</div><p>${escapeHtml(orc.observacoes)}</p>` : ''}
  `;
}

function buildRelatorioHtml({ periodoTexto, resumo, columns, rows }) {
  const isMoneyLabel = (label) => /valor|total|gasto|custo|saldo|ticket|faturado/i.test(label);
  const resumoHtml = `
    <div class="resumo-grid">
      ${Object.entries(resumo || {}).map(([label, value]) => {
        const money = typeof value === 'number' && isMoneyLabel(label);
        return `<div class="resumo-card"><div class="label">${escapeHtml(label)}</div><div class="value">${money ? formatCurrency(value) : escapeHtml(value)}</div></div>`;
      }).join('')}
    </div>
  `;
  const isMoneyCol = (key) => /valor|total|custo|gasto|desconto|saldo/i.test(key);
  const isDateCol = (key) => /^data|_saida$|_entrada$|fim_garantia|data_orcamento|criado_em/i.test(key);
  const theadHtml = `<tr>${columns.map((c) => `<th>${escapeHtml(c.header)}</th>`).join('')}</tr>`;
  const tbodyHtml = rows.length ? rows.map((r) => `<tr>${columns.map((c) => {
    let v = r[c.key];
    if (isMoneyCol(c.key)) v = formatCurrency(v);
    else if (isDateCol(c.key)) v = formatDate(v);
    else v = (v === null || v === undefined || v === '') ? '-' : escapeHtml(v);
    return `<td>${v}</td>`;
  }).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="muted" style="text-align:center;">Nenhum dado encontrado para o período/filtro selecionado.</td></tr>`;

  return `
    ${periodoTexto ? `<p class="muted">${escapeHtml(periodoTexto)}</p>` : ''}
    ${resumoHtml}
    <table><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table>
  `;
}

function buildComprovanteHtml(l) {
  return `
    <div class="info-grid">
      <div class="info-item"><div class="label">Tipo</div><div class="value">${l.tipo === 'receita' ? 'Recebimento' : 'Pagamento'}</div></div>
      <div class="info-item"><div class="label">Categoria</div><div class="value">${escapeHtml(l.categoria || '-')}</div></div>
      <div class="info-item"><div class="label">Descrição</div><div class="value">${escapeHtml(l.descricao)}</div></div>
      <div class="info-item"><div class="label">Referência</div><div class="value">${escapeHtml(l.referencia || '-')}</div></div>
      <div class="info-item"><div class="label">Forma de Pagamento</div><div class="value">${escapeHtml(l.forma_pagamento || '-')}</div></div>
      <div class="info-item"><div class="label">Data</div><div class="value">${formatDate(l.data_pagamento)}</div></div>
    </div>
    <div class="total-box">Valor: ${formatCurrency(l.valor)}</div>
    ${l.observacoes ? `<div class="section-title">Observações</div><p>${escapeHtml(l.observacoes)}</p>` : ''}
  `;
}

function buildVendaGarantiaHtml(venda, empresa) {
  const nomeEmpresa = escapeHtml(empresa?.nome_fantasia || empresa?.nome || 'Assistência Técnica');
  let itens = [];
  try { itens = JSON.parse(venda.itens || '[]'); } catch { itens = []; }
  const garantiaDias = venda.garantia_dias || 90;
  const itensRows = itens.map((it) => `
    <tr>
      <td>${escapeHtml(it.descricao)}</td>
      <td style="text-align:center;">${it.quantidade}</td>
      <td style="text-align:right;">${formatCurrency(venda.valor_total)}</td>
      <td style="text-align:right;">${formatCurrency(venda.valor_total)}</td>
    </tr>
  `).join('');

  return `
    <div class="info-grid">
      <div class="info-item"><div class="label">Cliente</div><div class="value">${escapeHtml(venda.cliente_nome || 'Consumidor não identificado')}</div></div>
      <div class="info-item"><div class="label">CPF/CNPJ</div><div class="value">${escapeHtml(venda.cliente_cpf_cnpj || '-')}</div></div>
      <div class="info-item"><div class="label">Telefone</div><div class="value">${escapeHtml(venda.cliente_telefone || venda.cliente_whatsapp || '-')}</div></div>
      <div class="info-item"><div class="label">Venda Nº</div><div class="value">${escapeHtml(venda.numero)}</div></div>
      <div class="info-item"><div class="label">Data da Compra</div><div class="value">${formatDate(venda.criado_em)}</div></div>
      <div class="info-item"><div class="label">Prazo de Garantia</div><div class="value">${garantiaDias} dias</div></div>
    </div>

    <div class="section-title">Produto(s) / Serviço(s) Cobertos</div>
    <table>
      <thead><tr><th>Descrição</th><th style="width:60px;">Qtd.</th><th style="width:100px;">Valor Unit.</th><th style="width:110px;">Subtotal</th></tr></thead>
      <tbody>${itensRows || '<tr><td colspan="4" class="muted">Nenhum item cadastrado.</td></tr>'}</tbody>
    </table>
    <div class="total-box">Valor Total da Compra: ${formatCurrency(venda.valor_total)}</div>

    <div class="section-title">1. Prazo de Garantia</div>
    <p>A ${nomeEmpresa} oferece ${garantiaDias} (${numeroPorExtenso(garantiaDias)}) dias de garantia sobre o(s) produto(s) e/ou serviço(s) acima, contados a partir da data da compra, cobrindo exclusivamente defeitos de fabricação ou falhas relacionadas ao item vendido.</p>

    <div class="section-title">2. Situações que Invalidam a Garantia</div>
    <p>A garantia não cobre danos decorrentes de mau uso, queda, impacto, contato com líquidos, oxidação, abertura ou intervenção por terceiros não autorizados, alteração das características originais do produto, ou desgaste natural de uso.</p>

    <div class="section-title">3. Procedimento para Acionar a Garantia</div>
    <p>Para acionar a garantia, o cliente deverá apresentar este documento (ou o número da venda) junto ao produto na ${nomeEmpresa}. O item passará por avaliação técnica para confirmação de que o problema está coberto pelos termos acima.</p>

    <p style="margin-top:6mm;"><b>Declaro que li e estou de acordo com as condições deste Termo de Garantia.</b></p>
  `;
}

// Documento entregue ao cliente comprovando a compra, com os dados completos da empresa
// (vindos do cabeçalho do PDF) e do cliente. Importante: este NÃO é uma Nota Fiscal
// Eletrônica (NF-e) emitida perante a SEFAZ — é um recibo/comprovante de venda interno,
// válido como comprovante comercial e para acionamento de garantia, mas sem validade fiscal
// tributária, já que isso exigiria integração com o sistema da Receita/SEFAZ e certificado
// digital, o que está fora do escopo deste sistema.
function buildVendaReciboHtml(venda, empresa) {
  let itens = [];
  try { itens = JSON.parse(venda.itens || '[]'); } catch { itens = []; }
  const itensRows = itens.map((it) => `
    <tr>
      <td>${escapeHtml(it.descricao)}</td>
      <td style="text-align:center;">${it.quantidade}</td>
      <td style="text-align:right;">${formatCurrency(venda.valor_total)}</td>
      <td style="text-align:right;">${formatCurrency(venda.valor_total)}</td>
    </tr>
  `).join('');
  const enderecoCliente = [venda.cliente_endereco, venda.cliente_numero].filter(Boolean).join(', ');
  const cidadeUfCliente = [venda.cliente_cidade, venda.cliente_uf].filter(Boolean).join('/');
  const descontoVenda = parseFloat(venda.desconto) || 0;
  const totalsHtml = descontoVenda > 0 ? `
    <table class="totals-table">
      <tbody>
        <tr><td>Subtotal</td><td>${formatCurrency(venda.valor_itens)}</td></tr>
        <tr><td>Desconto concedido</td><td class="desconto-value">- ${formatCurrency(descontoVenda)}</td></tr>
      </tbody>
    </table>
  ` : '';

  return `
    <div class="section-title">Dados do Cliente</div>
    <div class="info-grid">
      <div class="info-item"><div class="label">Nome</div><div class="value">${escapeHtml(venda.cliente_nome || 'Consumidor não identificado')}</div></div>
      <div class="info-item"><div class="label">CPF/CNPJ</div><div class="value">${escapeHtml(venda.cliente_cpf_cnpj || '-')}</div></div>
      <div class="info-item"><div class="label">Telefone</div><div class="value">${escapeHtml(venda.cliente_telefone || venda.cliente_whatsapp || '-')}</div></div>
      <div class="info-item"><div class="label">E-mail</div><div class="value">${escapeHtml(venda.cliente_email || '-')}</div></div>
      <div class="info-item span-2"><div class="label">Endereço</div><div class="value">${escapeHtml(enderecoCliente || '-')}${cidadeUfCliente ? ' — ' + escapeHtml(cidadeUfCliente) : ''}</div></div>
    </div>

    <div class="section-title">Dados da Venda</div>
    <div class="info-grid">
      <div class="info-item"><div class="label">Venda Nº</div><div class="value">${escapeHtml(venda.numero)}</div></div>
      <div class="info-item"><div class="label">Data da Compra</div><div class="value">${formatDate(venda.criado_em)}</div></div>
      <div class="info-item"><div class="label">Forma de Pagamento</div><div class="value">${escapeHtml(venda.forma_pagamento || '-')}</div></div>
      <div class="info-item"><div class="label">Status</div><div class="value">${escapeHtml(venda.status)}</div></div>
    </div>

    <div class="section-title">Itens Adquiridos</div>
    <table>
      <thead><tr><th>Descrição</th><th style="width:60px;">Qtd.</th><th style="width:100px;">Valor Unit.</th><th style="width:110px;">Subtotal</th></tr></thead>
      <tbody>${itensRows || '<tr><td colspan="4" class="muted">Nenhum item cadastrado.</td></tr>'}</tbody>
    </table>
    ${totalsHtml}
    <div class="total-box">Valor Total: ${formatCurrency(venda.valor_total)}</div>

    ${venda.observacoes ? `<div class="section-title">Observações</div><p>${escapeHtml(venda.observacoes)}</p>` : ''}

    <p class="muted" style="margin-top:8mm; font-size:9px;">Este documento é um comprovante/recibo de compra emitido pela empresa e não substitui a Nota Fiscal Eletrônica (NF-e), quando exigida.</p>
  `;
}

module.exports = {
  gerarPdf,
  buildOsHtml,
  buildChecklistOnlyHtml,
  buildOrcamentoHtml,
  buildRelatorioHtml,
  buildComprovanteHtml,
  buildGarantiaHtml,
  buildVendaGarantiaHtml,
  buildVendaReciboHtml,
  formatCurrency,
  formatDate,
  addDays,
};
