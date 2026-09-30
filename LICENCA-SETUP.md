# Sistema de licença e bloqueio de clientes — Reboot Tech System

Este documento explica como configurar (uma única vez) a verificação online de
licença, e como usar isso no dia a dia para **bloquear o acesso de um cliente**
que pediu reembolso dentro dos 7 dias de garantia — mesmo o produto sendo
vitalício.

## Como funciona, em resumo

- O sistema roda no computador do cliente (Electron, banco local). Sem
  nenhuma conexão online, não existe forma de "avisar" o programa depois que
  ele já foi entregue.
- Para resolver isso, criamos uma tabelinha **na nuvem** (grátis, no Supabase)
  com uma linha por cliente/venda. Cada linha tem uma `chave` (o código de
  licença que o cliente usa para ativar o sistema) e um `status`
  (`ativa` ou `bloqueada`).
- Ao abrir o sistema (e a cada 1 hora enquanto ele fica aberto), o app consulta
  essa tabela pela internet. Se o status estiver `bloqueada`, ele trava a tela
  de login e mostra "Acesso bloqueado".
- Para bloquear alguém, você só precisa **editar essa linha** e mudar o status
  — sem mexer em código.
- Se o cliente ficar sem internet por alguns dias, o sistema continua
  funcionando normalmente (usa a última confirmação). Só exige internet de
  novo se passar 7 dias sem conseguir confirmar (esse prazo dá para ajustar).

## Passo 1 — Criar o projeto no Supabase (grátis)

1. Acesse https://supabase.com e crie uma conta (dá para usar login do
   Google/GitHub).
2. Clique em **New project**. Escolha um nome (ex.: `reboot-tech-licencas`) e
   uma senha de banco (guarde essa senha, mas ela não será usada no app).
3. Aguarde alguns minutos até o projeto ficar pronto.

## Passo 2 — Criar a tabela `licencas`

1. No menu lateral do projeto, abra **SQL Editor**.
2. Cole e execute o SQL abaixo (botão **Run**):

```sql
create table licencas (
  chave text primary key,
  cliente_nome text,
  status text not null default 'ativa', -- 'ativa' ou 'bloqueada'
  observacao text,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now()
);

-- Protege a tabela: só permite LEITURA pela chave pública (anon).
-- Ninguém consegue alterar o status usando essa chave, só o painel do Supabase.
alter table licencas enable row level security;

create policy "Permitir leitura publica"
on licencas for select
to anon
using (true);
```

Isso cria a tabela e garante que a chave pública do app só consiga **ler**
o status — nunca alterar. Só você, logado no painel do Supabase, consegue
mudar o status de um cliente.

## Passo 3 — Pegar a URL e a chave pública (anon)

1. No menu lateral, vá em **Project Settings → API**.
2. Copie o **Project URL** (algo como `https://xxxxx.supabase.co`).
3. Copie a chave em **Project API keys → anon / public**.

## Passo 4 — Configurar no código

Abra o arquivo `electron/licenca.cjs` e preencha estas duas linhas com os
valores copiados no passo anterior:

```js
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_ANON_KEY = 'a-chave-anon-copiada-aqui';
```

Depois disso, gere o instalador normalmente (`npm run dist`).

> Enquanto essas duas linhas não forem preenchidas, o sistema funciona
> normalmente para todo mundo, sem nenhum bloqueio — ou seja, você pode
> configurar isso com calma, sem pressa.

## Passo 5 — No dia da venda: cadastrar o cliente

Sugestão simples (não precisa de automação): use o **número do pedido do
Kiwify** como chave de licença — ele já é único e já aparece pro cliente
automaticamente no e-mail/recibo da compra.

Quando cair uma venda:
1. No Supabase, abra **Table Editor → licencas**.
2. Clique em **Insert row** e preencha:
   - `chave`: o número do pedido Kiwify (ex.: `KFY123456`)
   - `cliente_nome`: nome do cliente (opcional, só para você se localizar)
   - `status`: `ativa`
3. Pronto. Quando o cliente abrir o sistema pela primeira vez, ele digita
   esse mesmo código na tela de ativação.

## Passo 6 — Bloquear um cliente (reembolso dentro dos 7 dias)

1. No Supabase, abra **Table Editor → licencas**.
2. Encontre a linha do cliente (pelo `chave` ou `cliente_nome`).
3. Edite o campo `status` para `bloqueada`.
4. Pronto. Na próxima vez que o sistema dele conseguir conexão com a internet
   (na abertura do programa, ou em até 1 hora se ele já estiver com o
   programa aberto), o acesso será travado automaticamente.

Para desbloquear, é só voltar o `status` para `ativa`.

## Bloqueio de licença na versão web/nuvem (Render)

A versão instalada (Electron) já usa esse sistema de licença desde sempre. A
versão web/celular (o site publicado no Render, veja `server/DEPLOY.md`), por
padrão, **não tem nenhum bloqueio** — qualquer um que souber o link consegue
tentar fazer login (o que já é uma proteção, já que precisa de usuário/senha
válidos).

Se você também quiser poder bloquear remotamente aquele deploy inteiro (por
exemplo: parou de pagar, quer suspender), dá pra usar a mesma tabela
`licencas` do Supabase que já existe:

1. No Supabase, em **Table Editor → licencas**, cadastre uma linha só pra
   esse deploy — uma `chave` que não seja usada por nenhum cliente do app
   desktop, por exemplo `WEB-NOMEDOCLIENTE`. Deixe `status` como `ativa`.
2. No Render, abra o Web Service do backend (`server/`) → **Environment** e
   adicione três variáveis:
   - `SUPABASE_URL` = o mesmo Project URL usado em `electron/licenca.cjs`
   - `SUPABASE_ANON_KEY` = a mesma chave anon usada em `electron/licenca.cjs`
   - `LICENCA_CHAVE` = a chave que você cadastrou no passo 1 (ex.: `WEB-NOMEDOCLIENTE`)
3. Salve — o Render reinicia o serviço sozinho. A partir daí, o servidor
   confere o status dessa chave a cada 10 minutos.

Pra bloquear, é o mesmo processo do Passo 6 acima: edite essa linha da tabela
e mude `status` para `bloqueada`. Em até 10 minutos o site inteiro passa a
recusar login e qualquer ação (a tela mostra "Acesso bloqueado"), tanto pra
quem já estava logado quanto pra quem tentar entrar depois.

Enquanto essas 3 variáveis não forem configuradas no Render, o site funciona
normalmente, sem bloqueio nenhum — assim como no app desktop.

## Automatizando no futuro (opcional)

Hoje esse processo é manual (você mesmo edita a tabela). Se no futuro você
quiser que o bloqueio aconteça **sozinho** quando o Kiwify avisar de um
reembolso, dá para configurar um webhook do Kiwify que atualiza essa mesma
tabela automaticamente. Isso exige um pequeno serviço extra (ex.: uma Supabase
Edge Function) — quando quiser evoluir para isso, é só pedir.

## Vencimento automático da mensalidade (versão web/nuvem)

Cada cliente da versão web tem **uma linha** na tabela `licencas` com:

| Campo | Para que serve |
|---|---|
| `chave` | identifica o deploy do cliente (vai em `LICENCA_CHAVE` no Render) |
| `cliente_nome` | só para você se localizar |
| `status` | `ativa` ou `bloqueada` (bloqueio manual, vale na hora) |
| `data_inicio` | quando a mensalidade começou |
| `data_vencimento` | **dia em que o acesso é bloqueado sozinho** |

**Regra:** no próprio dia do `data_vencimento` o acesso é bloqueado (à meia-noite de
Brasília). O cliente vê "Mensalidade vencida" com um botão que abre o WhatsApp do
suporte. Nos **5 dias antes**, aparece uma faixa amarela avisando que a mensalidade
vai vencer. Para dar uma folga depois do vencimento, mude `DIAS_DE_TOLERANCIA` em
`server/licenca.js` (0 = bloqueia no dia; 2 = bloqueia 2 dias depois).

Se `data_vencimento` ficar vazio, o cliente não tem vencimento (só vale o `status`).

### Migração (rode UMA vez no Supabase → SQL Editor)

Se você já tinha criado a tabela `licencas`, acrescente as colunas de data:

```sql
alter table licencas add column if not exists data_inicio date;
alter table licencas add column if not exists data_vencimento date;
```

> Faça isso **antes** de subir esta versão no Render. Sem as colunas o servidor
> volta a olhar só o `status` (o vencimento não funciona, mas nada quebra).

### Cadastrar um cliente (ou use o gerador `server/scripts/novo-cliente.js`)

```sql
insert into licencas (chave, cliente_nome, status, data_inicio, data_vencimento)
values ('WEB-PAULO', 'Paulo', 'ativa', current_date, current_date + 30);
```

### Quando o cliente pagar (renovar)

Soma 30 dias a partir do que for maior: do vencimento atual ou de hoje (assim,
quem atrasou não ganha dias "de graça" do passado):

```sql
update licencas
set data_vencimento = greatest(data_vencimento, current_date) + 30,
    status = 'ativa',
    atualizado_em = now()
where chave = 'WEB-PAULO';
```

O acesso volta em até 10 minutos (ou na hora, reiniciando o serviço no Render).

### Bloquear / desbloquear à mão

```sql
update licencas set status = 'bloqueada' where chave = 'WEB-PAULO';
update licencas set status = 'ativa'     where chave = 'WEB-PAULO';
```

### Ver todos os clientes e quanto falta para vencer

```sql
select cliente_nome, chave, status, data_vencimento,
       data_vencimento - current_date as dias_restantes
from licencas
order by data_vencimento;
```
