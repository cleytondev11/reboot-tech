# Remoção de Vírus (ADB) — como configurar

A nova aba **"Remoção de Vírus"** conecta no celular Android do cliente pelo
cabo USB (usando o ADB, ferramenta oficial do Google) para listar os
aplicativos instalados e ajudar o técnico a identificar apps com
comportamento suspeito — sem precisar instalar nada no celular do cliente.

## Como funciona, em resumo

- O sistema lista **apenas apps de terceiros** (instalados pelo usuário) —
  nunca mexe em apps de sistema do Android.
- Para cada app, verifica sinais como: tem permissão de administrador do
  aparelho, usa serviço de acessibilidade, não aparece na tela inicial
  (ícone escondido), pede permissões sensíveis (SMS, sobrepor outros apps,
  etc.).
- Com base nisso, classifica cada app como **Normal**, **Suspeito** ou
  **Alto risco** — é uma ferramenta de apoio à decisão do técnico, não um
  antivírus com banco de assinaturas. A palavra final é sempre do técnico
  (e, sempre que possível, com o cliente ciente do que está sendo feito no
  aparelho dele).
- O técnico pode, para cada app: **parar**, **remover o admin do
  dispositivo**, **desativar** (reversível) ou **desinstalar**.
- Toda ação fica registrada no histórico do sistema (data, técnico, aparelho
  e resultado) — importante para você ter um respaldo do que foi feito no
  celular do cliente.

## Passo 1 — Baixar o ADB (platform-tools)

1. Acesse a página oficial do Google:
   https://developer.android.com/tools/releases/platform-tools
2. Baixe o pacote **"SDK Platform-Tools for Windows"**.
3. Extraia o `.zip` baixado — dentro dele tem uma pasta chamada
   `platform-tools`, com o arquivo `adb.exe` dentro.

## Passo 2 — Colocar dentro do projeto

Copie a pasta `platform-tools` inteira para dentro de
`reboottech-app/platform-tools` (na raiz do projeto, do lado da pasta
`electron`). Ou seja, o caminho final deve ser:

```
reboottech-app/platform-tools/adb.exe
```

O sistema procura o ADB automaticamente nesse local primeiro. Se não
encontrar, tenta usar um `adb` já instalado no PATH do Windows (se você já
tiver o Android Studio ou o platform-tools instalado separadamente, também
funciona).

> Ao gerar o instalador (`npm run dist`), lembre de configurar o
> `electron-builder` para incluir essa pasta como recurso extra (chave
> `extraResources` no `package.json`), para que o `adb.exe` vá junto do
> programa instalado no computador do cliente.

## Passo 3 — No celular do cliente

1. Vá em **Ajustes → Sobre o telefone** e toque 7 vezes em **"Número da
   versão"** (ou "Build number") até aparecer "Você agora é um
   desenvolvedor".
2. Volte em Ajustes e entre em **Opções do desenvolvedor**.
3. Ative **Depuração USB**.
4. Conecte o cabo USB no computador.
5. Vai aparecer uma caixinha na tela do celular perguntando se autoriza a
   depuração desse computador — toque em **Permitir**.

## Passo 4 — Usar no sistema

1. Abra a aba **Remoção de Vírus**.
2. Clique em **"Buscar aparelho conectado"**.
3. Selecione o aparelho na lista.
4. Clique em **"Analisar aparelho"**.
5. Revise os apps marcados como Suspeito/Alto risco antes de agir — sempre
   dá pra expandir cada linha pra ver os detalhes (permissões, data de
   instalação, pontuação).

## ⚠️ Avisos importantes

- **Use apenas em aparelhos que o cliente trouxe para reparo com essa
  autorização.** Não é uma ferramenta para acessar celular de terceiros sem
  consentimento.
- A classificação de risco é **heurística** (baseada em sinais de
  comportamento), não uma verificação de assinatura de vírus como um
  antivírus tradicional. Ela erra tanto para mais quanto para menos —
  sempre existe a possibilidade de um app legítimo ser sinalizado (falso
  positivo) e de um app malicioso não ser sinalizado.
- Antes de **desinstalar**, prefira **desativar** quando tiver dúvida — é
  reversível.
- Apps de sistema nunca aparecem nessa ferramenta, por segurança — ela só
  lista e mexe em apps instalados pelo usuário.
