// ---------- VISUALIZADOR (versão web/celular) ----------
// Abre o documento (PDF, recibo ou cupom) numa tela cheia com o botão "← Voltar",
// e as ações: Imprimir (abre a janela do navegador com a lista de impressoras),
// Baixar PDF e Enviar pelo WhatsApp (mesma tela do aviso "OS pronta": mensagem
// editável + botões). O celular só deixa abrir o compartilhamento/WhatsApp a
// partir de um toque do usuário — por isso o envio é feito pelos botões.

export function linkWhatsapp(telefone, mensagem) {
  let digitos = String(telefone || '').replace(/\D/g, '');
  if (!digitos) throw new Error('Este cliente não possui telefone/WhatsApp cadastrado.');
  if (digitos.length <= 11) digitos = '55' + digitos; // assume Brasil quando não há DDI
  return `https://wa.me/${digitos}${mensagem ? '?text=' + encodeURIComponent(mensagem) : ''}`;
}

export function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function el(tag, props, filhos) {
  const e = document.createElement(tag);
  Object.assign(e, props || {});
  (filhos || []).forEach((f) => e.appendChild(typeof f === 'string' ? document.createTextNode(f) : f));
  return e;
}

function toque() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function podeCompartilharArquivo(arquivo) {
  try { return !!(navigator.canShare && navigator.canShare({ files: [arquivo] })); } catch { return false; }
}

// Mesma "tela" do aviso de OS pronta: texto da mensagem editável + botões.
function abrirEnvioWhatsapp({ blob, nome, titulo, whatsapp }) {
  const arquivo = new File([blob], nome, { type: 'application/pdf' });
  const podeCompartilhar = podeCompartilharArquivo(arquivo);
  const telefone = whatsapp.telefone || '';

  const fundo = el('div', { className: 'modal-backdrop' });
  fundo.style.zIndex = '300';
  const fechar = () => fundo.remove();

  const aviso = el('p', { className: 'muted' });
  aviso.style.cssText = 'margin:10px 0 0;font-size:12.5px;';
  const area = el('textarea', { rows: 7, value: whatsapp.mensagem || '' });
  area.setAttribute('data-sem-maiuscula', ''); // mensagem do WhatsApp: mantém como está escrita

  const botoes = el('div');
  botoes.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-top:12px;';

  if (podeCompartilhar) {
    botoes.appendChild(el('button', {
      type: 'button', className: 'btn btn-primary', textContent: '📤 Compartilhar PDF (escolha o WhatsApp)',
      onclick: async () => {
        try {
          await navigator.share({ files: [arquivo], title: titulo, text: area.value });
        } catch (e) {
          if (e && e.name !== 'AbortError') aviso.textContent = 'Não foi possível abrir o compartilhamento. Use "Baixar PDF" e anexe no WhatsApp.';
        }
      },
    }));
  }
  botoes.appendChild(el('button', {
    type: 'button', className: podeCompartilhar ? 'btn btn-secondary' : 'btn btn-primary',
    textContent: '💬 Abrir conversa do cliente no WhatsApp',
    onclick: () => {
      let url;
      try { url = linkWhatsapp(telefone, area.value); } catch (e) { aviso.textContent = String((e && e.message) || e); return; }
      window.open(url, '_blank'); // primeiro o WhatsApp (precisa ser direto do toque)
      baixarBlob(blob, nome);      // e já deixa o PDF baixado para anexar
      aviso.textContent = 'O PDF foi baixado. Na conversa do WhatsApp, toque em anexar (📎) › Documento e escolha o arquivo ' + nome + '.';
    },
  }));
  botoes.appendChild(el('button', {
    type: 'button', className: 'btn btn-secondary', textContent: '📋 Copiar mensagem',
    onclick: async () => {
      try { await navigator.clipboard.writeText(area.value); aviso.textContent = 'Mensagem copiada.'; } catch { aviso.textContent = 'Não foi possível copiar. Selecione o texto e copie manualmente.'; }
    },
  }));
  botoes.appendChild(el('button', { type: 'button', className: 'btn btn-secondary', textContent: '⬇️ Baixar PDF', onclick: () => baixarBlob(blob, nome) }));
  botoes.appendChild(el('button', { type: 'button', className: 'btn btn-ghost', textContent: 'Agora não', onclick: fechar }));

  const caixa = el('div', { className: 'modal' }, [
    el('div', { className: 'modal-header' }, [
      el('h3', { textContent: '💬 Enviar ao cliente pelo WhatsApp' }),
      el('button', { type: 'button', className: 'icon-btn', textContent: '✕', onclick: fechar }),
    ]),
    el('p', { textContent: `O PDF ${nome} está pronto.${telefone ? ' Cliente: ' + telefone + '.' : ''}` }),
  ]);
  if (!telefone) {
    const w = el('p', { textContent: '⚠️ Este cliente não tem WhatsApp/telefone cadastrado. Cadastre o número em Clientes ou copie a mensagem.' });
    w.style.cssText = 'color:var(--danger);font-size:13px;';
    caixa.appendChild(w);
  }
  const campo = el('div', { className: 'field' }, [el('label', { textContent: 'Mensagem (você pode editar antes de enviar)' }), area]);
  caixa.appendChild(campo);
  caixa.appendChild(botoes);
  caixa.appendChild(aviso);
  caixa.style.width = 'min(520px, 94vw)';
  fundo.appendChild(caixa);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(); });
  document.body.appendChild(fundo);
}

// opcoes: { titulo, nome?, blob? (PDF), html? (recibo/cupom), larguraMm?, formato?, whatsapp? }
export function abrirVisualizador({ titulo, nome, blob, html, larguraMm, formato, whatsapp }) {
  const ehPdf = !!blob;
  const url = ehPdf ? URL.createObjectURL(blob) : null;
  const celular = toque();
  const arquivo = ehPdf ? new File([blob], nome, { type: 'application/pdf' }) : null;
  const podeCompartilhar = ehPdf && podeCompartilharArquivo(arquivo);

  const fundo = el('div', { className: 'vz-overlay' });
  let quadro = null;
  let fechado = false;
  let usouHistorico = false;

  function fechar(viaBotao) {
    if (fechado) return;
    fechado = true;
    window.removeEventListener('popstate', aoVoltarNoCelular);
    document.removeEventListener('keydown', aoTecla);
    fundo.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (viaBotao && usouHistorico) { try { history.back(); } catch { /* sem problema */ } }
  }
  function aoVoltarNoCelular() { fechar(false); } // botão "voltar" do celular fecha só o visualizador
  function aoTecla(e) { if (e.key === 'Escape') fechar(true); }

  function imprimir() {
    if (!ehPdf) {
      try { quadro.contentWindow.focus(); quadro.contentWindow.print(); } catch { /* o navegador bloqueou */ }
      return;
    }
    // PDF: no computador imprime pelo próprio visualizador; senão abre o PDF em outra aba para imprimir.
    if (!celular && quadro) {
      try { quadro.contentWindow.focus(); quadro.contentWindow.print(); return; } catch { /* cai para a nova aba */ }
    }
    window.open(url, '_blank');
  }

  const btn = (texto, classe, onclick, titleAttr) => el('button', { type: 'button', className: classe, textContent: texto, onclick, title: titleAttr || '' });
  const acoes = el('div', { className: 'vz-acoes' });
  acoes.appendChild(btn('🖨️ Imprimir', 'btn btn-primary btn-sm', imprimir, 'Abre as opções de impressora'));
  if (ehPdf) acoes.appendChild(btn('⬇️ Baixar PDF', 'btn btn-secondary btn-sm', () => baixarBlob(blob, nome)));
  if (ehPdf && podeCompartilhar && !whatsapp) {
    acoes.appendChild(btn('📤 Compartilhar', 'btn btn-secondary btn-sm', async () => {
      try { await navigator.share({ files: [arquivo], title: titulo }); } catch { /* cancelado */ }
    }));
  }
  if (ehPdf && whatsapp) acoes.appendChild(btn('💬 WhatsApp', 'btn btn-secondary btn-sm', () => abrirEnvioWhatsapp({ blob, nome, titulo, whatsapp })));

  const barra = el('div', { className: 'vz-barra' }, [
    btn('← Voltar', 'btn btn-secondary btn-sm vz-voltar', () => fechar(true), 'Voltar para o sistema'),
    el('div', { className: 'vz-titulo', textContent: titulo || nome || 'Documento' }),
    acoes,
  ]);

  const corpo = el('div', { className: 'vz-corpo' });
  if (ehPdf && celular) {
    // Celulares não mostram PDF dentro da página de forma confiável: oferece abrir/baixar/enviar.
    const cartao = el('div', { className: 'vz-cartao' }, [
      el('div', { className: 'vz-cartao-icone', textContent: '📄' }),
      el('b', { textContent: nome }),
      el('span', { className: 'muted', textContent: 'Toque em "Abrir PDF" para ver o documento. Use os botões acima para imprimir, baixar ou enviar pelo WhatsApp.' }),
      btn('📖 Abrir PDF', 'btn btn-primary', () => window.open(url, '_blank')),
    ]);
    corpo.appendChild(cartao);
  } else if (ehPdf) {
    quadro = el('iframe', { className: 'vz-quadro', title: titulo || nome });
    quadro.src = url;
    corpo.appendChild(quadro);
  } else {
    quadro = el('iframe', { className: 'vz-quadro vz-recibo', title: titulo });
    const termica = formato !== 'a4';
    const largura = larguraMm || 80;
    const css = termica
      ? `<style>@page{size:${largura}mm auto;margin:0}</style>`
      : '<style>@page{size:A4;margin:10mm}</style>';
    quadro.srcdoc = String(html).replace('</head>', css + '</head>');
    quadro.style.width = termica ? `calc(${largura}mm + 10mm)` : 'min(210mm, 100%)';
    corpo.appendChild(quadro);
  }

  fundo.appendChild(barra);
  fundo.appendChild(corpo);
  document.body.appendChild(fundo);
  document.addEventListener('keydown', aoTecla);
  try { history.pushState({ vz: true }, ''); usouHistorico = true; window.addEventListener('popstate', aoVoltarNoCelular); } catch { /* sem histórico */ }
  return { fechar: () => fechar(true) };
}
