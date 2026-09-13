# Rede Multi-PC e Impressora Térmica / Leitor de Código de Barras

Este guia explica como configurar as duas novidades da versão 1.11.0 do
Reboot Tech Assistência.

---

## 1. Modo Rede Multi-PC

Permite que vários computadores da loja compartilhem o **mesmo banco de
dados** (clientes, OS, orçamentos, vendas, estoque, financeiro, usuários),
em tempo real, pela rede local — sem precisar de internet nem de um
servidor externo.

### Como funciona

- Um computador é escolhido como **Servidor**: é nele que o banco de dados
  (`reboot.sqlite`) realmente fica gravado.
- Os demais computadores rodam em modo **Cliente**: eles não guardam os
  dados localmente — cada ação (abrir uma OS, registrar uma venda, dar
  baixa no estoque, etc.) é enviada pela rede para o Servidor e a resposta
  volta na hora.
- Tudo acontece dentro do próprio aplicativo: não é preciso instalar banco
  de dados, nem programas extras.

### Passo a passo

**No computador que será o Servidor:**
1. Abra **Configurações → 🌐 Rede Multi-PC**.
2. Em "Modo deste computador", escolha **Servidor**.
3. Clique em **Gerar** para criar uma Chave de Rede (uma senha simples que
   protege a conexão) — ou defina a sua.
4. Salve. A tela vai mostrar o(s) IP(s) local(is) deste computador (por
   exemplo `192.168.0.10`) — anote um deles.
5. Deixe este computador ligado e com o sistema aberto durante o
   expediente; é dele que os outros PCs dependem.

**Em cada computador Cliente:**
1. Abra **Configurações → 🌐 Rede Multi-PC**.
2. Em "Modo deste computador", escolha **Cliente**.
3. Preencha o **IP do Computador Servidor** (o IP anotado acima) e a
   **mesma Chave de Rede** definida no Servidor.
4. Clique em **🔌 Testar Conexão** para confirmar que os dois PCs se
   enxergam na rede.
5. Salve.

Pronto — a partir daí, um cliente cadastrado em qualquer PC, uma OS aberta,
uma venda registrada etc. já aparece instantaneamente nos outros
computadores (basta atualizar a tela/lista).

### Pontos importantes

- Os computadores precisam estar na **mesma rede local** (mesmo
  Wi-Fi/roteador). Não funciona entre redes diferentes ou pela internet.
- Se o Servidor for desligado ou fechar o sistema, os Clientes ficam sem
  acesso aos dados até ele voltar.
- **Backup do banco de dados**: só pode ser feito a partir do computador
  Servidor (é lá que o arquivo realmente existe).
- **PDFs e impressão** de cupom continuam sendo gerados no computador que
  clicou no botão — os dados são buscados no Servidor, mas o arquivo/cupom
  sai localmente, como esperado.
- Cada computador continua precisando da própria licença ativada
  normalmente; isso não muda com o modo rede.
- Se o firewall do Windows perguntar se o aplicativo pode "acessar redes
  públicas e privadas" na primeira vez que o modo Servidor for ligado,
  permita o acesso — caso contrário os Clientes não conseguirão conectar.

---

## 2. Impressora Térmica (cupom 58mm/80mm)

Imprime um cupom não-fiscal compacto de **Venda** e de **Ordem de
Serviço**, direto para uma impressora térmica.

### Requisitos

Não é necessário nenhum driver especial do sistema: basta que a impressora
térmica já esteja instalada como uma impressora comum do **Windows**
(praticamente toda impressora térmica USB — Elgin, Bematech, Epson TM-T20,
etc. — já vem com esse driver). Se ela aparece em *Painel de Controle →
Dispositivos e Impressoras*, já está pronta para ser usada aqui.

### Configuração

1. Abra **Configurações → 🖨️ Impressora Térmica**.
2. Selecione a impressora na lista (ou deixe em "impressora padrão do
   Windows").
3. Escolha a largura do papel (58mm ou 80mm).
4. Clique em **🖨️ Imprimir Teste** para conferir alinhamento e legibilidade.
5. Salve.

> Essa configuração é **por computador** — cada PC/caixa pode ter sua
> própria impressora térmica configurada; ela não é compartilhada pela
> rede.

### Uso do dia a dia

- Em **Vendas**, clique no ícone 🖨️ (na listagem ou dentro da venda) para
  imprimir o cupom.
- Em **Ordens de Serviço**, clique no ícone 🖨️ para imprimir o recibo da
  OS (entrada do aparelho e valores).

---

## 3. Leitor de Código de Barras

Funciona com qualquer leitor **USB tipo teclado** (a grande maioria do
mercado): ele não precisa de driver nem configuração — o sistema
operacional já o reconhece como um teclado comum, que "digita" o código
lido e, no final, envia um Enter.

### Onde usar

- **Estoque**: clique no campo de busca ("Buscar por nome, categoria,
  código...") e escaneie o produto. Se o código bater com o código de
  barras (ou código interno) de um único produto, a tela de **Movimentar
  Estoque** já abre automaticamente — agilizando entradas e saídas rápidas
  no balcão.
- **Vendas**: dentro de uma venda (nova ou em edição), use o campo
  **🔫 Leitor de Código de Barras**, no topo do formulário. Cada produto
  escaneado é adicionado automaticamente aos itens da venda — se o mesmo
  produto for lido de novo, a quantidade é somada.

### Cadastrando o código de barras de um produto

Em **Estoque → Novo/Editar Produto**, preencha o campo **Código de
Barras** (pode escanear a etiqueta original do produto direto nesse
campo, já que o leitor funciona como um teclado em qualquer campo de
texto).
