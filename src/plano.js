import { diasAte, formatDiaCurto, SUPORTE_WHATSAPP } from './utils.js';

// Meu Plano: o plano dura 30 dias. A data contratada e o vencimento são cadastrados pelo dono
// no painel /admin do servidor; aqui só lemos e avisamos o cliente quando faltarem 5 dias ou menos.
export const DIAS_AVISO = 5;
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

// Abre o WhatsApp do suporte com o pedido de renovação já escrito (chamar direto do clique no botão).
export function renovarPeloWhatsapp(plano, usuario) {
  const linhas = [
    'Olá! Quero renovar o meu plano do sistema Reboot Tech.',
    plano && plano.empresa ? `Empresa: ${plano.empresa}` : null,
    plano && plano.dataVencimento ? `Vencimento atual: ${formatDiaCurto(String(plano.dataVencimento).slice(0, 10))}` : null,
    usuario && usuario.nome ? `(Usuário: ${usuario.nome})` : null,
  ].filter(Boolean);
  return window.api.whatsapp.abrirConversa(SUPORTE_WHATSAPP, linhas.join('\n'));
}
