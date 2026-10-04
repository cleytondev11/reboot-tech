import { diasAte, formatDiaCurto, formatCurrency, SUPORTE_WHATSAPP } from './utils.js';
import { lerPix } from './qr.js';

// Meu Plano: o plano dura 30 dias. A data contratada e o vencimento são cadastrados pelo dono
// no painel /admin do servidor; aqui só lemos e avisamos o cliente quando faltarem 5 dias ou menos.
export const DIAS_AVISO = 5;

// Pix "copia e cola" da renovação (o QR Code da tela é gerado a partir dele). Para trocar a chave
// ou o valor da mensalidade, basta colocar aqui o novo código Pix.
export const PIX_RENOVACAO = '00020126580014BR.GOV.BCB.PIX01367e158db6-1929-40ae-86d0-7484c64a9c84520400005303986540539.905802BR5923Cleyton de Souza Santos6009SAO PAULO62140510U3umYLJ8Xo630443A6';
export const DADOS_PIX = lerPix(PIX_RENOVACAO); // { valor, nome, cidade }
export const DIAS_PLANO = 30;

export function statusPlano(plano) {
  const venc = plano && plano.dataVencimento ? String(plano.dataVencimento).slice(0, 10) : '';
  const dias = venc ? diasAte(venc) : null;
  if (dias === null) return { nivel: 'sem', dias: null, titulo: 'Sem datas cadastradas', texto: 'As datas do seu plano ainda não foram cadastradas. Fale com o suporte.' };
  if (dias < 0) return { nivel: 'vencido', dias, titulo: 'Plano vencido', texto: `Seu plano venceu há ${-dias} dia${dias === -1 ? '' : 's'}. Entre em contato com o suporte para renovar.` };
  if (dias === 0) return { nivel: 'aviso', dias, titulo: 'Vence hoje', texto: 'Seu plano vence hoje. Entre em contato com o suporte para renovar.' };
  if (dias <= DIAS_AVISO) return { nivel: 'aviso', dias, titulo: `Vence em ${dias} dia${dias === 1 ? '' : 's'}`, texto: `Seu plano está para vencer (faltam ${dias} dia${dias === 1 ? '' : 's'}). Entre em contato com o suporte para renovar.` };
  return { nivel: 'ok', dias, titulo: 'Plano ativo', texto: `Faltam ${dias} dias para o vencimento.` };
}

export function precisaAviso(status) {
  return status.nivel === 'aviso' || status.nivel === 'vencido';
}

// Depois de pagar o Pix: abre o WhatsApp do suporte com a mensagem pronta para enviar o comprovante
// (chamar direto do clique no botão). O cliente só precisa anexar a foto/PDF do comprovante.
export function enviarComprovantePeloWhatsapp(plano, usuario) {
  const valor = DADOS_PIX.valor ? ` de ${formatCurrency(DADOS_PIX.valor)}` : '';
  const linhas = [
    `Olá! Fiz o pagamento via Pix${valor} para renovar o meu plano do sistema Reboot Tech. Segue o comprovante em anexo.`,
    plano && plano.empresa ? `Empresa: ${plano.empresa}` : null,
    plano && plano.dataVencimento ? `Vencimento atual: ${formatDiaCurto(String(plano.dataVencimento).slice(0, 10))}` : null,
    usuario && usuario.nome ? `(Usuário: ${usuario.nome})` : null,
  ].filter(Boolean);
  return window.api.whatsapp.abrirConversa(SUPORTE_WHATSAPP, linhas.join('\n'));
}
