# Colocar um cliente novo no ar (cada cliente = banco + servidor próprios)

Modelo: **tudo fica nas suas contas** (Turso, Render e Supabase). O cliente recebe só
o endereço do site e o login — ele não vê banco, variáveis nem a licença. Por isso ele
não consegue remover o bloqueio.

Cada cliente tem:
- 1 banco no **Turso** (`rt-nomedocliente`) — dados isolados dos outros clientes;
- 1 **Web Service** no Render (backend) e 1 **Static Site** (o site);
- 1 linha na tabela `licencas` do **Supabase** (chave, datas, status).

## Receita rápida

1. No seu computador, dentro da pasta `server` (só precisa de `npm install` na primeira vez):
   ```
   cd server
   npm install
   node scripts/novo-cliente.js "Paulo Silva" --dias 30 --usuario paulo
   ```
   Opções: `--dias` (padrão 30), `--usuario` (padrão `admin`), `--senha` (padrão: gera uma aleatória).
2. O script imprime, prontos para copiar e colar: nomes sugeridos, comandos do Turso,
   variáveis do Render (com `JWT_SECRET` já gerado), o SQL da licença e o SQL do
   administrador do cliente (senha já criptografada) + a senha para entregar.
3. Siga os 5 passos impressos, na ordem:
   1. **Turso**: criar o banco e copiar URL + token.
   2. **Render (backend)**: Web Service com as variáveis.
   3. **Render (site)**: Static Site com `VITE_API_URL` apontando para o backend do passo 2.
   4. **Supabase**: rodar o `insert` da licença.
   5. **Turso (Shell)**: rodar o `INSERT` do administrador (depois do backend subir pela
      primeira vez — é ele que cria as tabelas).
4. Teste abrindo `https://BACKEND/api/licenca/status` (deve mostrar `"estado":"ativa"`,
   com `dataVencimento` e `diasRestantes`) e faça login no site.
5. Entregue ao cliente: endereço do site, usuário e senha.

## No dia a dia

- **Renovar / bloquear / listar clientes**: SQLs prontos em `LICENCA-SETUP.md`
  (seção "Vencimento automático").
- **Atualizar o sistema para todos**: todos os serviços apontam para o mesmo repositório
  do GitHub. Um `push` e o Render republica todos (confirme que o deploy automático
  está ligado em cada serviço).
- **Backup**: o Turso guarda os dados de cada cliente; vale conferir as opções de
  backup/restauração do seu plano.

## Cuidados

- **Limites dos planos gratuitos**: confira no Render e no Turso os limites atuais
  (horas de execução dos serviços gratuitos, número e tamanho dos bancos). No Render
  gratuito o backend "dorme" após um tempo sem uso e a primeira abertura do dia demora
  alguns segundos; com vários clientes, pode valer migrar os backends para um plano pago.
- **Nunca** coloque `SUPABASE_URL`/`SUPABASE_ANON_KEY` com a chave `service_role` — use
  só a `anon`.
- Cada cliente precisa de `JWT_SECRET` **diferente** (o script já gera um novo).
- Se você se trancar para fora por engano: no Render, apague `LICENCA_CHAVE` do serviço
  (ele reinicia liberado) e corrija a linha no Supabase.
