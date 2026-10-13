# Renovação por Pix automática (Mercado Pago)

Na tela de login, quando o teste acabou ou o plano venceu, o cliente toca em **Renovar plano**, escolhe o plano e o sistema gera um Pix único.
Quando o Mercado Pago confirma o pagamento, o plano é renovado sozinho e o dono recebe um aviso no celular.

## No Render (Environment)
| Variável | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | Access Token de **produção** da sua conta Mercado Pago (começa com `APP_USR-`) |
| `PUBLIC_URL` | `https://reboot-tech.onrender.com` (endereço onde o sistema roda; usado no aviso do Mercado Pago) |

Sem `MP_ACCESS_TOKEN` o sistema continua usando o Pix fixo + comprovante no WhatsApp.

## No Mercado Pago
1. Entre em mercadopago.com.br/developers e abra **Suas integrações → Criar aplicação** (tipo Pagamentos online / Checkout API).
2. Em **Credenciais de produção**, copie o **Access Token**. Se pedir, ative as credenciais de produção (dados do negócio).
3. Em **Webhooks / Notificações**, a URL é enviada em cada cobrança (`/api/pagamento/webhook`), então não precisa cadastrar nada. Se quiser cadastrar mesmo assim: `https://reboot-tech.onrender.com/api/pagamento/webhook`, evento **Pagamentos**.
4. Na conta Mercado Pago, cadastre uma **chave Pix** (Pix → Minhas chaves). Sem chave não gera Pix.

## Teste
1. Use um cliente de teste vencido (Central → Editar → vencimento no passado).
2. Na tela de login digite o usuário e a senha → **Renovar plano** → **Gerar Pix**.
3. Pague o menor plano e veja o acesso liberar em poucos segundos.
