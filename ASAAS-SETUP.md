# Pix automático pelo Asaas

1. Crie e aprove a conta em asaas.com e cadastre uma chave Pix nela.
2. Integrações → Chaves de API → gere a chave (`$aact_...`). Ela aparece uma única vez.
3. No Render (Web Service) crie as variáveis:
   - `ASAAS_API_KEY` = a chave
   - `ASAAS_WEBHOOK_TOKEN` = uma senha qualquer que você inventar
   - `PUBLIC_URL` = https://reboot-tech.onrender.com
   - (teste) `ASAAS_AMBIENTE` = sandbox, com a chave da conta sandbox.asaas.com
4. No Asaas: Integrações → Webhooks → Novo webhook
   - URL: https://reboot-tech.onrender.com/api/pagamento/webhook
   - Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`
   - Eventos: cobranças (PAYMENT_RECEIVED e PAYMENT_CONFIRMED)
5. Faça o deploy do Web Service e do Static Site.

## Cartão de crédito
- Cartão avulso: paga uma vez e libera o período do plano.
- Cartão recorrente: assinatura no Asaas; a cada ciclo (mensal, trimestral ou anual) o Asaas cobra e o sistema renova sozinho.
- Os dados do cartão são digitados na página segura do Asaas; o sistema nunca recebe nem guarda o cartão.
- Para cancelar uma assinatura: painel do Asaas → Assinaturas.
