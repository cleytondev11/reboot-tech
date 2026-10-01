# Colocando o Reboot Tech "na nuvem" (acesso web + celular)

Este guia usa duas ferramentas **gratuitas para começar**:

- **[Turso](https://turso.tech)** — banco de dados na nuvem, compatível com o
  mesmo formato (SQLite) que o app já usa. Plano grátis: 100 bancos, 5GB.
- **[Render](https://render.com)** — hospeda o backend (`server/`) e também o
  site (`dist/`), sem precisar de cartão de crédito para começar. O plano
  grátis "dorme" depois de 15 minutos sem uso e demora ~1 minuto para acordar
  na primeira visita seguinte — perfeitamente aceitável para começar; dá pra
  mudar para o plano pago (a partir de uns poucos dólares/mês) depois, se
  quiser que fique sempre ligado na hora.

> Confira sempre os preços/limites atuais nos sites oficiais — mudam de vez em
> quando.

---

## Parte 1 — Criar o banco de dados (Turso)

1. Crie uma conta em https://turso.tech (dá pra entrar com GitHub).
2. Instale a CLI do Turso **ou** use o painel web deles para criar um banco —
   qualquer um dos dois funciona. Pelo painel web:
   - Clique em "Create Database".
   - Dê um nome, por exemplo `reboot-tech`.
   - Escolha uma região próxima de você/seus clientes.
3. Depois de criado, procure:
   - A **URL de conexão** (começa com `libsql://...`) — isso é o
     `TURSO_DATABASE_URL`.
   - Um **token de acesso** (Create Token / Auth Token) — isso é o
     `TURSO_AUTH_TOKEN`.
4. Guarde os dois valores — vai precisar deles no próximo passo.

---

## Parte 2 — Publicar o backend (Render)

1. Suba a pasta do projeto para um repositório no GitHub (se ainda não tiver
   um). É a forma mais simples do Render enxergar o código.
2. Em https://render.com, crie uma conta e clique em **New → Web Service**.
3. Conecte o repositório do projeto.
4. Configure:
   - **Root Directory**: deixe em branco (raiz do repositório) — os comandos
     abaixo já entram na pasta certa sozinhos.
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `node server/index.js`
   - **Instance Type**: Free
5. Em **Environment Variables**, adicione:
   - `TURSO_DATABASE_URL` = (o valor que você guardou)
   - `TURSO_AUTH_TOKEN` = (o valor que você guardou)
   - `JWT_SECRET` = uma frase longa e aleatória, só sua (ex.: gere uma em
     https://www.uuidgenerator.net/ e cole duas ou três juntas)
   - (opcional) `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `LICENCA_CHAVE`, se
     você quiser poder bloquear remotamente o acesso a este deploy — veja o
     passo a passo em `LICENCA-SETUP.md`, seção "Bloqueio de licença na
     versão web/nuvem".
6. Clique em **Create Web Service**. O primeiro deploy demora alguns minutos.
7. Quando terminar, o Render te dá uma URL pública, tipo
   `https://reboot-tech-server.onrender.com`. Teste abrindo
   `https://SEU-ENDERECO.onrender.com/api/ping` no navegador — deve responder
   algo como `{"ok":true,...}`.

> Na primeira vez que o backend rodar, ele já cria sozinho todas as tabelas no
> banco Turso (não precisa rodar nenhum comando de banco manualmente). Porém
> ele **não cria automaticamente um usuário administrador** — veja "Criar o
> primeiro usuário" mais abaixo.

---

## Parte 3 — Publicar o site (frontend web)

1. Na raiz do projeto, copie `.env.example` para `.env` e coloque a URL do
   backend que você acabou de publicar:
   ```
   VITE_API_URL=https://SEU-ENDERECO.onrender.com
   ```
2. Gere os arquivos do site:
   ```
   npm install
   npm run build:vite
   ```
   Isso cria a pasta `dist/` — são só arquivos estáticos (HTML/JS/CSS).
3. No Render, clique em **New → Static Site**, aponte para o mesmo
   repositório, e configure:
   - **Build Command**: `npm install && npm run build:vite`
   - **Publish Directory**: `dist`
   - Em **Environment Variables**, adicione `VITE_API_URL` com a mesma URL do
     backend (o build usa essa variável para saber com quem falar).
4. Publique. Você recebe uma segunda URL, tipo
   `https://reboot-tech.onrender.com` — é esse o endereço que você (e sua
   equipe) vão acessar no navegador do computador **ou do celular**, de
   qualquer lugar com internet.

   O site já é um PWA: quem abrir esse endereço no Chrome/Edge/Android verá
   a opção "Instalar app" / "Adicionar à tela inicial", e no iPhone dá pra
   adicionar pela Safari em Compartilhar → "Adicionar à Tela de Início". Uma
   vez instalado, abre em tela cheia com ícone próprio, sem precisar de loja
   de aplicativos.
5. (Opcional) Em **Settings → Custom Domain**, você pode apontar um domínio
   próprio (ex. `sistema.suaempresa.com.br`) para essa URL.

> Dica: no celular, depois de abrir o link, use a opção do navegador
> "Adicionar à tela inicial" — fica com carinha de aplicativo, sem precisar de
> loja de apps.

---

## Criar o primeiro usuário (administrador)

Como o backend novo começa com o banco vazio, use o painel do Turso para
inserir o primeiro administrador diretamente (só dessa vez — depois disso,
crie os demais usuários normalmente pela tela **Usuários** do próprio
sistema).

1. No painel do Turso, abra o seu banco e vá em "Shell" / "Console SQL".
2. Gere um hash de senha com bcrypt — mais fácil rodando isto no seu
   computador (com Node instalado), no terminal:
   ```
   node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_AQUI', 10))"
   ```
   (troque `SUA_SENHA_AQUI` pela senha que você quer usar). Copie o texto que
   aparecer (começa com `$2a$` ou `$2b$`).
3. No console SQL do Turso, rode (trocando os valores entre aspas):
   ```sql
   INSERT INTO usuarios (nome, usuario, senha_hash, papel, ativo, criado_em)
   VALUES ('Administrador', 'admin', 'COLE_O_HASH_AQUI', 'Administrador', 1, datetime('now'));
   ```
4. Pronto — já dá pra fazer login no site com usuário `admin` e a senha que
   você escolheu.

---

## O que já funciona na versão web (v1) e o que ainda não

**Já funciona:** login, Dashboard, Clientes, Equipamentos, Dados da Empresa,
Logs, Ordens de Serviço, Orçamentos, Compras, Estoque (Produtos e
Fornecedores), Serviços, Vendas, Financeiro (incluindo metas mensais e DRE)
e Caixa, e Relatórios. Ou seja: todos os módulos de dados do sistema já
funcionam pela nuvem, exatamente como no programa instalado.

**Continuam sendo recursos exclusivos do programa instalado** (por
dependerem do computador físico e não terem equivalente possível num
navegador): geração de PDF, impressão térmica, leitor de código de barras
(esse funciona igual no navegador, só não tem o atalho automático de Estoque
ainda), Rede Multi-PC local, backup manual do arquivo local e Remoção de
Vírus via cabo USB (o histórico de ações, esse sim, já aparece também na
versão web). A tela mostra uma mensagem clara avisando disso, em vez de
travar, sempre que algum desses recursos é acessado pelo navegador.

---

## Segurança — pontos de atenção

- Nunca compartilhe o `JWT_SECRET` nem o `TURSO_AUTH_TOKEN`.
- Troque a senha do usuário `admin` criado manualmente assim que possível.
- Cada pessoa deve ter seu próprio usuário (evite compartilhar login).
- O token de sessão expira em 12 horas — depois disso, é pedido login de novo.


---

## Notificações no celular (push)

O sistema avisa no celular, **sempre mostrando o valor**, quando:

- **OS:** é aberta uma nova OS, **muda qualquer status** (Em análise, Em manutenção, Aguardando peça, Pronto, Entregue, Cancelado...) ou só quando fica "Pronto";
- **Orçamento:** é criado, **muda qualquer status** (Enviado, Aprovado, Recusado, Expirado, Convertido) ou só quando é convertido em OS;
- **Venda:** uma venda é realizada (com o valor total e a descrição de cada item vendido);
- **Estoque:** um produto chega no estoque mínimo ou acaba (avisa uma vez ao cruzar o mínimo, não a cada venda; produto com mínimo 0 avisa quando zera);
- **Contas a pagar:** resumo diário (a partir das 8h, horário de Brasília) das despesas pendentes atrasadas, que vencem hoje ou amanhã, com valor e total.

**Resumo de contas a pagar no plano grátis do Render:** o servidor "dorme" sem uso e só confere as contas enquanto está acordado. Para garantir o aviso todo dia de manhã:
1. No Render (Environment), crie a variável `CRON_TOKEN` com uma senha longa qualquer.
2. Em um serviço de agendamento gratuito (ex.: [cron-job.org](https://cron-job.org)), crie uma tarefa que abra `https://SEU-ENDERECO.onrender.com/api/cron/avisos?token=SUA_SENHA` todo dia às 08:05 (pode repetir a cada 30 min até as 18h: o aviso do dia não duplica).
3. Opcional: `AVISO_HORA` muda a hora do resumo (padrão 8) e `FUSO_HORAS` o fuso (padrão -3, Brasília).

Cada aparelho escolhe quais avisos quer em **Configurações → 🔔 Notificações**. Aparelhos que já tinham as notificações ativadas passam a receber as novas opções (todas ligadas) e podem desligar o que não quiserem.

- Nada para configurar: as chaves de notificação (VAPID) são geradas sozinhas na primeira execução e guardadas no banco. (Opcional: defina `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` no Render para fixar suas próprias chaves — gere com `npx web-push generate-vapid-keys`.)
- O site precisa estar em **HTTPS** (o Render já está).
- Em cada celular: abra o sistema → **Configurações → 🔔 Notificações → Ativar**, escolha os avisos desejados e permita as notificações.
- **iPhone:** só funciona com o app instalado na Tela de Início (Safari → Compartilhar → Adicionar à Tela de Início), iOS 16.4+.
- Depois de atualizar, rode `npm install` na pasta `server/` (nova dependência: `web-push`).
