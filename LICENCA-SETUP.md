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

## Automatizando no futuro (opcional)

Hoje esse processo é manual (você mesmo edita a tabela). Se no futuro você
quiser que o bloqueio aconteça **sozinho** quando o Kiwify avisar de um
reembolso, dá para configurar um webhook do Kiwify que atualiza essa mesma
tabela automaticamente. Isso exige um pequeno serviço extra (ex.: uma Supabase
Edge Function) — quando quiser evoluir para isso, é só pedir.
