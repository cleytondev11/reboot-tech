// ---------- PDF NO NAVEGADOR (versão web/celular) ----------
// Usa os MESMOS modelos de documento do programa instalado (src/pdf-builders.js,
// gerado a partir de electron/pdf.cjs). Em vez de salvar o arquivo direto, abre o
// documento numa nova aba já na tela de impressão do navegador: é só escolher
// "Salvar como PDF" (no celular: "Salvar como PDF" / "Compartilhar") ou imprimir.
import {
  buildOsHtml, buildChecklistOnlyHtml, buildGarantiaHtml, buildOrcamentoHtml, buildComprovanteHtml,
  buildVendaGarantiaHtml, buildVendaReciboHtml, buildRelatorioHtml,
  headerTemplate, footerTemplateHtml, wrapBodyHtml, escapeHtml,
} from './pdf-builders.js';

// CSS só da versão web: cabeçalho/rodapé repetidos em toda página (via
// thead/tfoot, que o navegador repete ao quebrar a página) e a barra de ajuda.
const CSS_WEB = `
  @page { size: A4; margin: 8mm 6mm 12mm; }
  @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  table.print-wrap { width: 100%; border-collapse: collapse; margin: 0; }
  table.print-wrap > thead > tr > td, table.print-wrap > tbody > tr > td, table.print-wrap > tfoot > tr > td { border: none; padding: 0; background: none; }
  table.print-wrap > thead { display: table-header-group; }
  table.print-wrap > tfoot { display: table-footer-group; }
  .print-head { padding-bottom: 4mm; }
  .print-foot { padding-top: 4mm; }
  .no-print.bar { position: sticky; top: 0; z-index: 10; background: #1f2937; color: #fff; padding: 10px 14px; margin: 0 -4mm 4mm; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 13px; }
  .no-print.bar button { background: #d4af37; color: #1a1a1a; border: 0; border-radius: 6px; padding: 9px 16px; font-size: 14px; font-weight: bold; cursor: pointer; }
  .no-print.bar span { opacity: .85; }
`;

function agoraBr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function nomeArquivoSeguro(nome) {
  return String(nome || 'documento').replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'documento';
}

// Monta a página completa a ser impressa.
export function montarDocumento({ empresa, title, subtitle, innerHtml, footerSubtitulo, nomeArquivo }) {
  let html = wrapBodyHtml({ title, subtitle, innerHtml });

  // Cabeçalho/rodapé do modelo de impressão do Electron, sem o recuo lateral
  // (aqui o recuo já vem do corpo da página).
  const cabecalho = headerTemplate(empresa || {}).replace(/padding:0 12mm;/g, '');
  const rodape = footerTemplateHtml(footerSubtitulo)
    .replace(/padding:0 12mm;/g, '')
    .replace('<span class="date"></span>', escapeHtml(agoraBr()))
    .replace(/<span>Página <span class="pageNumber"><\/span> de <span class="totalPages"><\/span><\/span>/, '<span></span>');

  const barra = `<div class="no-print bar"><button onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button><span>Na janela que abrir, escolha “Salvar como PDF” como destino.</span></div>`;

  html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(nomeArquivoSeguro(nomeArquivo || title))}</title>`);
  html = html.replace('</style>', `${CSS_WEB}</style>`);
  html = html.replace(/<body>([\s\S]*)<\/body>/, (_, corpo) =>
    `<body>${barra}<table class="print-wrap"><thead><tr><td><div class="print-head">${cabecalho}</div></td></tr></thead>`
    + `<tfoot><tr><td><div class="print-foot">${rodape}</div></td></tr></tfoot>`
    + `<tbody><tr><td>${corpo}</td></tr></tbody></table>`
    + `<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},400);});</script></body>`);
  return html;
}

// Precisa ser chamado DENTRO do clique (antes de qualquer espera), senão o
// navegador do celular bloqueia a nova aba como "pop-up".
function abrirJanela() {
  let w = null;
  try { w = window.open('', '_blank'); } catch (e) { w = null; }
  if (w) {
    try {
      w.document.write('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gerando documento…</title><body style="font-family:Arial,sans-serif;padding:24px;color:#444">Gerando documento…</body>');
    } catch (e) { /* ignora */ }
  }
  return w;
}

function imprimirEmIframe(html) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  f.srcdoc = html;
  document.body.appendChild(f);
  setTimeout(() => { try { f.remove(); } catch (e) { /* ignora */ } }, 120000);
}

function entregar(janela, html) {
  if (janela && !janela.closed) {
    janela.document.open();
    janela.document.write(html);
    janela.document.close();
    return;
  }
  // Pop-up bloqueado: imprime por uma moldura invisível na própria página.
  imprimirEmIframe(html);
}

export function criarPdfApi(invoke) {
  async function gerar(montar) {
    const janela = abrirJanela();
    try {
      const doc = await montar();
      entregar(janela, montarDocumento(doc));
      return { ok: true };
    } catch (err) {
      if (janela && !janela.closed) janela.close();
      throw err;
    }
  }

  async function empresaDados() {
    try { return (await invoke('empresa:get')) || {}; } catch (e) { return {}; }
  }

  return {
    exportarOS: (id) => gerar(async () => {
      const os = await invoke('os:get', { id });
      if (!os) throw new Error('Ordem de Serviço não encontrada.');
      return {
        empresa: await empresaDados(), nomeArquivo: os.numero,
        title: `Ordem de Serviço Nº ${os.numero}`, subtitle: 'Vistoria técnica, orçamento e acompanhamento do reparo',
        innerHtml: buildOsHtml(os), footerSubtitulo: `OS ${os.numero}`,
      };
    }),

    exportarChecklist: (id) => gerar(async () => {
      const os = await invoke('os:get', { id });
      if (!os) throw new Error('Ordem de Serviço não encontrada.');
      return {
        empresa: await empresaDados(), nomeArquivo: `Checklist_${os.numero}`,
        title: `Checklist de Entrada — ${os.numero}`, subtitle: 'Vistoria técnica e recebimento do equipamento',
        innerHtml: buildChecklistOnlyHtml(os), footerSubtitulo: `Checklist ${os.numero}`,
      };
    }),

    exportarGarantia: (id) => gerar(async () => {
      const os = await invoke('os:get', { id });
      if (!os) throw new Error('Ordem de Serviço não encontrada.');
      const empresa = await empresaDados();
      return {
        empresa, nomeArquivo: `Termo_Garantia_${os.numero}`,
        title: 'Termo de Garantia', subtitle: `Referente à Ordem de Serviço ${os.numero}`,
        innerHtml: buildGarantiaHtml(os, empresa), footerSubtitulo: `Termo de Garantia — ${os.numero}`,
      };
    }),

    exportarOrcamento: (id) => gerar(async () => {
      const orc = await invoke('orcamentos:get', { id });
      if (!orc) throw new Error('Orçamento não encontrado.');
      return {
        empresa: await empresaDados(), nomeArquivo: orc.numero,
        title: `Orçamento Nº ${orc.numero}`, subtitle: `Válido por ${orc.validade_dias || 7} dias a partir da data de emissão`,
        innerHtml: buildOrcamentoHtml(orc), footerSubtitulo: `Orçamento ${orc.numero}`,
      };
    }),

    exportarComprovante: (id) => gerar(async () => {
      const l = await invoke('financeiro:get', { id });
      if (!l) throw new Error('Lançamento não encontrado.');
      return {
        empresa: await empresaDados(), nomeArquivo: `Comprovante_${l.referencia || l.id}`,
        title: `Comprovante de ${l.tipo === 'receita' ? 'Recebimento' : 'Pagamento'}`, subtitle: l.referencia ? `Referência: ${l.referencia}` : '',
        innerHtml: buildComprovanteHtml(l), footerSubtitulo: 'Comprovante Financeiro',
      };
    }),

    exportarVendaGarantia: (id) => gerar(async () => {
      const venda = await invoke('vendas:get', { id });
      if (!venda) throw new Error('Venda não encontrada.');
      const empresa = await empresaDados();
      return {
        empresa, nomeArquivo: `Garantia_${venda.numero}`,
        title: 'Termo de Garantia', subtitle: `Referente à Venda ${venda.numero}`,
        innerHtml: buildVendaGarantiaHtml(venda, empresa), footerSubtitulo: `Termo de Garantia — ${venda.numero}`,
      };
    }),

    exportarVendaRecibo: (id) => gerar(async () => {
      const venda = await invoke('vendas:get', { id });
      if (!venda) throw new Error('Venda não encontrada.');
      const empresa = await empresaDados();
      return {
        empresa, nomeArquivo: `Comprovante_Compra_${venda.numero}`,
        title: 'Comprovante de Compra', subtitle: `Venda Nº ${venda.numero}`,
        innerHtml: buildVendaReciboHtml(venda, empresa), footerSubtitulo: `Comprovante de Compra — ${venda.numero}`,
      };
    }),

    // (atual, titulo, periodoTexto, resumo, columns, rows) — "atual" é ignorado:
    // quem está logado já vem do token e o servidor controla as permissões.
    exportarRelatorio: (atual, titulo, periodoTexto, resumo, columns, rows) => gerar(async () => ({
      empresa: await empresaDados(), nomeArquivo: String(titulo || 'Relatorio').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_'),
      title: titulo, subtitle: 'Relatório gerencial',
      innerHtml: buildRelatorioHtml({ periodoTexto, resumo, columns, rows }), footerSubtitulo: titulo,
    })),
  };
}
