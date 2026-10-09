// ---------- IMPRESSÃO NO NAVEGADOR (versão web/celular) ----------
// Mesmos modelos de recibo/cupom do programa instalado (cupom térmico 58/80mm e folha A4).
// No navegador não existe "imprimir direto na impressora X": o documento abre numa tela com
// o botão "← Voltar" e o botão "Imprimir", que abre a janela do navegador com a lista de
// impressoras (e as opções de cópias, papel etc.) para o usuário escolher.
import { abrirVisualizador } from './visualizador.js';
import { criarApiPdf } from './pdf-web.js';
import { qrSvg } from './qr.js';

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

// QR code para o cliente acompanhar a OS sozinho (aparece só quando o servidor mandou o link).
function blocoQrAcompanhar(os, tamanhoPx) {
  if (!os || !os.link_acompanhamento) return '';
  return `
    <div class="center" style="margin:8px 0;">
      <div class="small bold">Acompanhe seu conserto</div>
      <div style="display:inline-block;margin-top:4px;line-height:0;">${qrSvg(os.link_acompanhamento, { tamanho: tamanhoPx, margem: 2 })}</div>
      <div class="small">Aponte a câmera do celular para o QR code</div>
    </div>`;
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

export function buildCupomVendaHtml(venda, empresa, larguraMm) {
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

export function buildCupomOsHtml(os, empresa, larguraMm) {
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
    <div class="item bold"><span>VALOR TOTAL</span><span>${formatCurrency(os.valor_total)}</span></div>
    <div class="small">Status: ${escapeHtml(os.status)}</div>
    ${os.garantia_dias ? `<div class="small">Garantia: ${os.garantia_dias} dias</div>` : ''}
    ${blocoQrAcompanhar(os, larguraMm === 58 ? 150 : 190)}
    ${rodape('Guarde este recibo para a retirada do aparelho.')}
  `;
  return envelope(larguraMm, conteudo);
}

export function buildCupomTesteHtml(empresa, larguraMm) {
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
  if (empresa && empresa.logo) linhas.push(`<img src="${empresa.logo}" style="height:56px;max-width:170px;object-fit:contain;margin-bottom:6px;" />`);
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

export function buildCupomVendaHtmlA4(venda, empresa) {
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

export function buildCupomOsHtmlA4(os, empresa) {
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
      <div class="item total bold"><span>TOTAL</span><span>${formatCurrency(os.valor_total)}</span></div>
    </div>
    <div class="linha"></div>
    <div class="small">Status: ${escapeHtml(os.status)}${os.garantia_dias ? ` &nbsp;•&nbsp; Garantia: ${os.garantia_dias} dias` : ''}</div>
    ${blocoQrAcompanhar(os, 150)}
    <div class="small" style="margin-top:24px;">Guarde este recibo para a retirada do aparelho.</div>
  `;
  return envelopeA4(conteudo);
}

export function buildCupomTesteHtmlA4(empresa) {
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

const CHAVE_CFG = 'rt-impressora';
const CFG_PADRAO = { impressora_padrao: '', largura_papel: 80, formato: 'termica', copias: 1 };

function lerCfg() {
  try { return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem(CHAVE_CFG) || '{}') }; } catch { return { ...CFG_PADRAO }; }
}

export function criarApiImpressora({ invoke }) {
  // Folha A4 = o MESMO documento do "Exportar PDF" (logomarca, dados e layout da empresa); o botão Imprimir imprime o PDF.
  const pdf = criarApiPdf({ invoke });
  function mostrar(titulo, html, cfg, formato) {
    abrirVisualizador({ titulo, html, formato, larguraMm: Number(cfg.largura_papel) === 58 ? 58 : 80 });
    return { ok: true, web: true };
  }
  return {
    // O navegador não informa quais impressoras existem: elas aparecem na janela de impressão.
    listar: async () => [],
    configuracao: async () => lerCfg(),
    salvarConfiguracao: async (atual, impressora, largura, copias, formato) => {
      localStorage.setItem(CHAVE_CFG, JSON.stringify({ impressora_padrao: '', largura_papel: Number(largura) === 58 ? 58 : 80, copias: copias || 1, formato: formato === 'a4' ? 'a4' : 'termica' }));
      return { ok: true };
    },
    imprimirCupomVenda: async (id, formato) => {
      const cfg = lerCfg();
      const fmt = formato || cfg.formato;
      if (fmt === 'a4') return pdf.exportarVendaRecibo(id);
      const venda = await invoke('dados:vendaCompleta', { id });
      if (!venda) throw new Error('Venda não encontrada.');
      const empresa = await invoke('empresa:get');
      const html = fmt === 'a4' ? buildCupomVendaHtmlA4(venda, empresa) : buildCupomVendaHtml(venda, empresa, Number(cfg.largura_papel) === 58 ? 58 : 80);
      return mostrar(`Comprovante de venda ${venda.numero}`, html, cfg, fmt);
    },
    imprimirCupomOS: async (id, formato) => {
      const cfg = lerCfg();
      const fmt = formato || cfg.formato;
      if (fmt === 'a4') return pdf.exportarOS(id);
      const os = await invoke('dados:osCompleta', { id });
      if (!os) throw new Error('Ordem de Serviço não encontrada.');
      const empresa = await invoke('empresa:get');
      const html = fmt === 'a4' ? buildCupomOsHtmlA4(os, empresa) : buildCupomOsHtml(os, empresa, Number(cfg.largura_papel) === 58 ? 58 : 80);
      return mostrar(`Recibo da ${os.numero}`, html, cfg, fmt);
    },
    testar: async (impressora, largura, formato) => {
      const cfg = { ...lerCfg(), largura_papel: largura || lerCfg().largura_papel };
      const fmt = formato || cfg.formato;
      const empresa = await invoke('empresa:get');
      const larg = Number(cfg.largura_papel) === 58 ? 58 : 80;
      const html = fmt === 'a4' ? buildCupomTesteHtmlA4(empresa) : buildCupomTesteHtml(empresa, larg);
      return mostrar('Impressão de teste', html, cfg, fmt);
    },
  };
}
