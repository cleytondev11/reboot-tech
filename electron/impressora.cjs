// ---------- IMPRESSORA TÉRMICA (cupons não-fiscais 58/80mm) ----------
// Em vez de falar diretamente com o hardware (protocolo ESC/POS cru), este módulo
// usa a própria impressora instalada no Windows: praticamente toda impressora
// térmica USB (Elgin, Bematech, Epson TM-T20, etc.) já instala um driver que a
// deixa disponível como uma impressora comum do sistema. Assim, basta montar um
// pequeno HTML no tamanho do papel (58mm ou 80mm) e mandar imprimir "silenciosamente"
// (sem abrir a janela de impressão do Windows) na impressora escolhida.
const { BrowserWindow } = require('electron');

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCurrency(v) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDateTime(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('pt-BR');
  } catch (e) {
    return String(iso);
  }
}

function baseCss(larguraMm) {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 11.5px;
      line-height: 1.35;
      color: #000;
      width: ${larguraMm}mm;
      padding: 2mm 2.5mm;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .linha { border-top: 1px dashed #000; margin: 5px 0; }
    .item { display: flex; justify-content: space-between; gap: 6px; }
    .titulo { font-size: 14px; font-weight: 800; letter-spacing: 0.3px; }
    .small { font-size: 10px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 1px 0; vertical-align: top; }
  `;
}

function cabecalhoEmpresa(empresa) {
  const linhas = [];
  linhas.push(`<div class="center titulo">${escapeHtml((empresa && (empresa.nome_fantasia || empresa.nome)) || 'Assistência Técnica')}</div>`);
  if (empresa && empresa.cnpj) linhas.push(`<div class="center small">CNPJ: ${escapeHtml(empresa.cnpj)}</div>`);
  const end = [empresa && empresa.endereco, empresa && empresa.numero, empresa && empresa.bairro].filter(Boolean).join(', ');
  if (end) linhas.push(`<div class="center small">${escapeHtml(end)}</div>`);
  const cidadeUf = [empresa && empresa.cidade, empresa && empresa.uf].filter(Boolean).join('/');
  if (cidadeUf) linhas.push(`<div class="center small">${escapeHtml(cidadeUf)}</div>`);
  const contato = (empresa && (empresa.telefone || empresa.whatsapp)) || '';
  if (contato) linhas.push(`<div class="center small">Tel/WhatsApp: ${escapeHtml(contato)}</div>`);
  return linhas.join('\n');
}

function rodape(texto) {
  return `
    <div class="linha"></div>
    <div class="center small">${escapeHtml(texto)}</div>
    <div style="height:10mm"></div>
  `;
}

function envelope(larguraMm, conteudo) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${baseCss(larguraMm)}</style></head><body>${conteudo}</body></html>`;
}

function buildCupomVendaHtml(venda, empresa, larguraMm) {
  let itens = [];
  try { itens = JSON.parse(venda.itens || '[]'); } catch (e) { itens = []; }
  const linhasItens = itens.map((it) => {
    const qtd = parseFloat(it.quantidade) || 0;
    const unit = parseFloat(it.valor_unit) || 0;
    const total = qtd * unit;
    return `
      <tr><td colspan="2">${escapeHtml(it.descricao)}</td></tr>
      <tr><td class="small">${qtd} x ${formatCurrency(unit)}</td><td class="right">${formatCurrency(total)}</td></tr>
    `;
  }).join('');

  const conteudo = `
    ${cabecalhoEmpresa(empresa)}
    <div class="linha"></div>
    <div class="center bold">COMPROVANTE DE VENDA</div>
    <div class="center small">${escapeHtml(venda.numero)} — ${formatDateTime(venda.criado_em)}</div>
    <div class="linha"></div>
    <div class="small">Cliente: ${escapeHtml(venda.cliente_nome || 'Consumidor não identificado')}</div>
    <div class="linha"></div>
    <table>${linhasItens}</table>
    <div class="linha"></div>
    ${parseFloat(venda.desconto) > 0 ? `<div class="item small"><span>Desconto</span><span>-${formatCurrency(venda.desconto)}</span></div>` : ''}
    <div class="item bold"><span>TOTAL</span><span>${formatCurrency(venda.valor_total)}</span></div>
    <div class="small">Forma de pagamento: ${escapeHtml(venda.forma_pagamento || '-')}</div>
    ${venda.garantia_dias ? `<div class="small">Garantia: ${venda.garantia_dias} dias</div>` : ''}
    ${rodape('Obrigado pela preferência!')}
  `;
  return envelope(larguraMm, conteudo);
}

function buildCupomOsHtml(os, empresa, larguraMm) {
  const equip = [os.equip_marca, os.equip_modelo].filter(Boolean).join(' ');
  const conteudo = `
    ${cabecalhoEmpresa(empresa)}
    <div class="linha"></div>
    <div class="center bold">RECIBO — ORDEM DE SERVIÇO</div>
    <div class="center small">${escapeHtml(os.numero)} — ${formatDateTime(os.data_entrada)}</div>
    <div class="linha"></div>
    <div class="small">Cliente: ${escapeHtml(os.cliente_nome || '-')}</div>
    <div class="small">Equipamento: ${escapeHtml(equip || '-')}</div>
    <div class="linha"></div>
    <div class="small bold">Defeito informado:</div>
    <div class="small">${escapeHtml(os.defeito_informado || '-')}</div>
    <div class="linha"></div>
    <div class="item small"><span>Mão de obra</span><span>${formatCurrency(os.valor_mao_obra)}</span></div>
    <div class="item small"><span>Peças</span><span>${formatCurrency(os.valor_pecas)}</span></div>
    ${parseFloat(os.desconto) > 0 ? `<div class="item small"><span>Desconto</span><span>-${formatCurrency(os.desconto)}</span></div>` : ''}
    <div class="item bold"><span>TOTAL</span><span>${formatCurrency(os.valor_total)}</span></div>
    <div class="small">Status: ${escapeHtml(os.status)}</div>
    ${os.garantia_dias ? `<div class="small">Garantia: ${os.garantia_dias} dias</div>` : ''}
    ${rodape('Guarde este recibo para a retirada do aparelho.')}
  `;
  return envelope(larguraMm, conteudo);
}

function buildCupomTesteHtml(empresa, larguraMm) {
  const conteudo = `
    ${cabecalhoEmpresa(empresa)}
    <div class="linha"></div>
    <div class="center bold">IMPRESSÃO DE TESTE</div>
    <div class="center small">${formatDateTime(new Date().toISOString())}</div>
    <div class="linha"></div>
    <div class="small">Papel: ${larguraMm}mm</div>
    <div class="item small"><span>Exemplo de item</span><span>${formatCurrency(19.9)}</span></div>
    <div class="item bold"><span>TOTAL</span><span>${formatCurrency(19.9)}</span></div>
    ${rodape('Se este cupom saiu legível e alinhado, a configuração está correta.')}
  `;
  return envelope(larguraMm, conteudo);
}

function baseCssA4() {
  return `
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      color: #111;
      width: 190mm;
      padding: 12mm 10mm;
    }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .linha { border-top: 1px solid #bbb; margin: 10px 0; }
    .item { display: flex; justify-content: space-between; gap: 10px; }
    .titulo { font-size: 20px; font-weight: 800; letter-spacing: 0.2px; }
    .subtitulo { font-size: 14px; font-weight: 700; margin-top: 4px; }
    .small { font-size: 12px; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { text-align: left; font-size: 11.5px; color: #555; border-bottom: 1px solid #bbb; padding: 4px 2px; }
    td { padding: 6px 2px; vertical-align: top; border-bottom: 1px solid #eee; }
    .totais { margin-top: 14px; width: 260px; margin-left: auto; }
    .totais .item { padding: 3px 0; }
    .totais .total { font-size: 16px; border-top: 2px solid #111; padding-top: 8px; margin-top: 4px; }
  `;
}

function envelopeA4(conteudo) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>${baseCssA4()}</style></head><body>${conteudo}</body></html>`;
}

function cabecalhoEmpresaA4(empresa) {
  const linhas = [];
  linhas.push(`<div class="titulo">${escapeHtml((empresa && (empresa.nome_fantasia || empresa.nome)) || 'Assistência Técnica')}</div>`);
  const dados = [
    empresa && empresa.cnpj ? `CNPJ: ${empresa.cnpj}` : null,
    [empresa && empresa.endereco, empresa && empresa.numero, empresa && empresa.bairro].filter(Boolean).join(', ') || null,
    [empresa && empresa.cidade, empresa && empresa.uf].filter(Boolean).join('/') || null,
    (empresa && (empresa.telefone || empresa.whatsapp)) ? `Tel/WhatsApp: ${empresa.telefone || empresa.whatsapp}` : null,
  ].filter(Boolean);
  if (dados.length) linhas.push(`<div class="small">${dados.map(escapeHtml).join(' &nbsp;•&nbsp; ')}</div>`);
  return linhas.join('\n');
}

function buildCupomVendaHtmlA4(venda, empresa) {
  let itens = [];
  try { itens = JSON.parse(venda.itens || '[]'); } catch (e) { itens = []; }
  const linhasItens = itens.map((it) => {
    const qtd = parseFloat(it.quantidade) || 0;
    const unit = parseFloat(it.valor_unit) || 0;
    return `<tr><td>${escapeHtml(it.descricao)}</td><td class="right">${qtd}</td><td class="right">${formatCurrency(unit)}</td><td class="right">${formatCurrency(qtd * unit)}</td></tr>`;
  }).join('');

  const conteudo = `
    ${cabecalhoEmpresaA4(empresa)}
    <div class="linha"></div>
    <div class="subtitulo">COMPROVANTE DE VENDA — ${escapeHtml(venda.numero)}</div>
    <div class="small">${formatDateTime(venda.criado_em)} &nbsp;•&nbsp; Cliente: ${escapeHtml(venda.cliente_nome || 'Consumidor não identificado')}</div>
    <table>
      <thead><tr><th>Item</th><th class="right">Qtd</th><th class="right">Valor Unit.</th><th class="right">Total</th></tr></thead>
      <tbody>${linhasItens}</tbody>
    </table>
    <div class="totais">
      ${parseFloat(venda.desconto) > 0 ? `<div class="item"><span>Desconto</span><span>-${formatCurrency(venda.desconto)}</span></div>` : ''}
      <div class="item total bold"><span>TOTAL</span><span>${formatCurrency(venda.valor_total)}</span></div>
    </div>
    <div class="linha"></div>
    <div class="small">Forma de pagamento: ${escapeHtml(venda.forma_pagamento || '-')}${venda.garantia_dias ? ` &nbsp;•&nbsp; Garantia: ${venda.garantia_dias} dias` : ''}</div>
    <div class="small" style="margin-top:24px;">Obrigado pela preferência!</div>
  `;
  return envelopeA4(conteudo);
}

function buildCupomOsHtmlA4(os, empresa) {
  const equip = [os.equip_marca, os.equip_modelo].filter(Boolean).join(' ');
  const conteudo = `
    ${cabecalhoEmpresaA4(empresa)}
    <div class="linha"></div>
    <div class="subtitulo">RECIBO — ORDEM DE SERVIÇO ${escapeHtml(os.numero)}</div>
    <div class="small">${formatDateTime(os.data_entrada)} &nbsp;•&nbsp; Cliente: ${escapeHtml(os.cliente_nome || '-')} &nbsp;•&nbsp; Equipamento: ${escapeHtml(equip || '-')}</div>
    <div class="linha"></div>
    <div class="bold small">Defeito informado</div>
    <div class="small">${escapeHtml(os.defeito_informado || '-')}</div>
    <div class="totais">
      <div class="item"><span>Mão de obra</span><span>${formatCurrency(os.valor_mao_obra)}</span></div>
      <div class="item"><span>Peças</span><span>${formatCurrency(os.valor_pecas)}</span></div>
      ${parseFloat(os.desconto) > 0 ? `<div class="item"><span>Desconto</span><span>-${formatCurrency(os.desconto)}</span></div>` : ''}
      <div class="item total bold"><span>TOTAL</span><span>${formatCurrency(os.valor_total)}</span></div>
    </div>
    <div class="linha"></div>
    <div class="small">Status: ${escapeHtml(os.status)}${os.garantia_dias ? ` &nbsp;•&nbsp; Garantia: ${os.garantia_dias} dias` : ''}</div>
    <div class="small" style="margin-top:24px;">Guarde este recibo para a retirada do aparelho.</div>
  `;
  return envelopeA4(conteudo);
}

function buildCupomTesteHtmlA4(empresa) {
  const conteudo = `
    ${cabecalhoEmpresaA4(empresa)}
    <div class="linha"></div>
    <div class="subtitulo">IMPRESSÃO DE TESTE — Folha A4</div>
    <div class="small">${formatDateTime(new Date().toISOString())}</div>
    <table>
      <thead><tr><th>Item</th><th class="right">Qtd</th><th class="right">Valor Unit.</th><th class="right">Total</th></tr></thead>
      <tbody><tr><td>Exemplo de item</td><td class="right">1</td><td class="right">${formatCurrency(19.9)}</td><td class="right">${formatCurrency(19.9)}</td></tr></tbody>
    </table>
    <div class="totais"><div class="item total bold"><span>TOTAL</span><span>${formatCurrency(19.9)}</span></div></div>
    <div class="small" style="margin-top:24px;">Se esta página saiu legível e bem formatada, a configuração está correta.</div>
  `;
  return envelopeA4(conteudo);
}

async function listarImpressoras(parentWindow) {
  if (!parentWindow || parentWindow.isDestroyed()) return [];
  const lista = await parentWindow.webContents.getPrintersAsync();
  return lista.map((p) => ({ nome: p.name, padrao: !!p.isDefault, status: p.status }));
}

async function imprimir({ parentWindow, html, nomeImpressora, copias, larguraMm, formato }) {
  return new Promise((resolve, reject) => {
    const janela = new BrowserWindow({
      show: false,
      parent: parentWindow || undefined,
      webPreferences: { offscreen: false },
    });
    janela.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    const limpar = () => { if (!janela.isDestroyed()) janela.destroy(); };

    janela.webContents.once('did-fail-load', () => {
      limpar();
      reject(new Error('Falha ao preparar o conteúdo para impressão.'));
    });

    janela.webContents.once('did-finish-load', () => {
      const opcoes = {
        silent: true,
        printBackground: true,
        copies: copias && copias > 0 ? copias : 1,
      };
      if (formato === 'a4') {
        opcoes.margins = { marginType: 'default' };
        opcoes.pageSize = 'A4';
      } else {
        const largura = larguraMm || 80;
        opcoes.margins = { marginType: 'none' };
        opcoes.pageSize = { width: Math.round(largura * 1000), height: 300000 }; // largura em microns; altura generosa p/ não paginar
      }
      if (nomeImpressora) opcoes.deviceName = nomeImpressora;
      janela.webContents.print(opcoes, (sucesso, motivoErro) => {
        limpar();
        if (sucesso) resolve({ ok: true });
        else reject(new Error(motivoErro || 'Falha ao imprimir. Verifique se a impressora está ligada, conectada e selecionada corretamente.'));
      });
    });
  });
}

module.exports = {
  buildCupomVendaHtml,
  buildCupomOsHtml,
  buildCupomTesteHtml,
  buildCupomVendaHtmlA4,
  buildCupomOsHtmlA4,
  buildCupomTesteHtmlA4,
  listarImpressoras,
  imprimir,
};
