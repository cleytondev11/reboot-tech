// Tudo o que é digitado nos campos de texto do sistema vira LETRA MAIÚSCULA automaticamente
// (nomes, endereços, defeitos, observações, descrições...). Isso vale para qualquer tela nova também.
//
// Ficam de fora (para não estragar o dado):
//   • campos de senha, e-mail, data, número, busca e os que não são de digitação livre;
//   • campos marcados com data-sem-maiuscula (login, site, código de barras, senha do aparelho,
//     chave de licença, mensagens de WhatsApp...).
const TIPOS_DE_TEXTO = new Set(['', 'text']);

function deveConverter(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.tagName === 'INPUT') {
    const tipo = (el.getAttribute('type') || 'text').toLowerCase();
    if (!TIPOS_DE_TEXTO.has(tipo)) return false;
    if (el.classList.contains('search-input')) return false; // caixas de busca ficam como o usuário digita
  } else if (el.tagName !== 'TEXTAREA') {
    return false;
  }
  if (el.closest && el.closest('[data-sem-maiuscula]')) return false;
  return true;
}

const setterInput = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
const setterTextarea = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;

function maiuscula(texto) {
  return texto.toLocaleUpperCase('pt-BR');
}

// Troca o texto do campo por maiúsculas sem perder a posição do cursor. Usa o "setter" original do
// navegador para o React perceber a mudança e atualizar o estado da tela normalmente.
function converter(el) {
  const antes = el.value;
  const depois = maiuscula(antes);
  if (depois === antes) return false;
  const ini = el.selectionStart;
  const fim = el.selectionEnd;
  (el.tagName === 'TEXTAREA' ? setterTextarea : setterInput).call(el, depois);
  try {
    if (ini !== null && fim !== null) el.setSelectionRange(maiuscula(antes.slice(0, ini)).length, maiuscula(antes.slice(0, fim)).length);
  } catch { /* alguns tipos de campo não aceitam cursor */ }
  return true;
}

export function ativarMaiusculas() {
  // Fase de captura: roda antes do React ler o valor digitado.
  document.addEventListener('input', (e) => {
    if (e.isComposing) return; // acento em composição (tecla morta/celular): espera terminar
    if (deveConverter(e.target)) converter(e.target);
  }, true);
  document.addEventListener('compositionend', (e) => {
    if (deveConverter(e.target) && converter(e.target)) e.target.dispatchEvent(new Event('input', { bubbles: true }));
  }, true);
}
