# Reboot Tech — Sistema de Gestão de Assistência Técnica

Aplicação desktop (Windows) para gestão de assistência técnica de celulares, tablets e eletrônicos.

**Fase 1:** Login/Permissões · Dashboard · Clientes · Equipamentos · Checklist de Entrada · Ordens de Serviço.
**Fase 2:** Estoque · Fornecedores · Orçamentos avulsos · Conversão de Orçamento em OS.
**Fase 3:** Financeiro · Contas a Pagar/Receber · Caixa · DRE Simplificado.
**Fase 4:** Relatórios completos · Técnico responsável na OS.
**Fase 5:** PDFs profissionais com identidade visual da empresa · Configurações da Empresa.
**v1.4.x:** Sem mão de obra detalhada no PDF do cliente · Desconto visível quando houver · Correção de bugs de digitação · Exportar PDF na listagem.
**v1.5.0:** Checklist de Entrada expandido — Termos e Declarações, Senha/PIN/Padrão de desbloqueio (com desenho), Acessórios entregues · Termo de Garantia em PDF gerado automaticamente para OS entregues.
**v1.6.0:** Troca de senha de usuário restrita ao Administrador · Exclusão de Equipamentos · Dica de login padrão removida da tela inicial · Dashboard com calendário de aniversariantes, gráficos de faturamento (semanal/mensal/anual) e lista detalhada de estoque baixo · Catálogo de Serviços para agilizar Orçamentos · Módulo de Vendas avulsas · Cadastro rápido de Cliente e Equipamento direto no Orçamento · Status "Pronto" da OS lança automaticamente o valor em Contas a Receber · Compartilhamento de PDF (Orçamento/OS) via WhatsApp · Upload de fotos do aparelho na própria tela de OS, exibidas no PDF.
**v1.6.1:** Termo de Garantia da OS sem os tópicos "Dados e Arquivos do Cliente" e "Aparelhos Entregues sem Funcionamento", agora mostrando o serviço realizado e o valor · Relatório de Vendas · Edição de Vendas · Termo de Garantia e Comprovante de Compra em PDF para Vendas (com dados completos da empresa e do cliente) · Data da compra e prazo de garantia editáveis na Venda.
**v1.6.2:** Acesso a Relatórios e a exclusão de qualquer dado do sistema (clientes, equipamentos, OS, estoque, serviços, vendas, orçamentos, lançamentos financeiros) restritos ao Administrador · Dashboard Financeiro com Meta Mensal de Lucro: defina uma meta de lucro por mês e acompanhe o valor já realizado, percentual atingido, ritmo necessário (com aviso quando estiver abaixo do esperado) e quanto falta lucrar por dia até o fim do mês.
**v1.7.0:** Dashboard Financeiro redesenhado no estilo "colorido": navegação entre meses (◀ ▶), KPIs de Faturamento/Despesas/Lucro Líquido/Meta, anel de progresso da meta, projeção de fechamento do mês, comparativo com o mês anterior (faturamento/despesas/lucro), serviços realizados, ticket médio, gráfico de evolução do lucro no mês e cartão de alertas. Novo recurso "Planejar Próximos Meses": defina de uma vez a meta de lucro para os próximos 6 meses.
**v1.7.1:** Seção "Declaração de Condição do Aparelho" do PDF da OS agora aparece em destaque (caixa com borda e fundo diferenciados, ícone de alerta e título em evidência).
**v1.7.2:** Correção: a Declaração de Condição do Aparelho não estava aparecendo no PDF principal da Ordem de Serviço (só existia em outro fluxo interno) — agora ela é exibida corretamente, em destaque, no PDF gerado pelo botão "Exportar PDF" da OS.
**v1.7.3:** Correção: a janela para alterar a senha de um usuário não abria (o botão existia, mas a janela nunca tinha sido criada) — agora funciona corretamente. Adicionadas as opções de **Editar Usuário** (nome, login e papel) e **Excluir Usuário** na tela de Usuários (com proteções: não é possível excluir o próprio usuário logado nem o último Administrador ativo do sistema).
**v1.7.4:** Correção de um bug intermitente do Electron em que, depois que a janela perdia o foco por um instante (ex: ao exportar um PDF, que abre o Explorer do Windows, ou ao usar uma caixa de confirmação), o teclado podia parar de responder por alguns segundos ao voltar para o sistema — causando a sensação de "não consigo digitar" em formulários aleatórios. Isso afetava o sistema como um todo, não uma tela específica.
**v1.8.0:** Novo relatório **"Metas de Lucro"** em Relatórios: lista, mês a mês (dentro do período escolhido), a meta definida, faturamento, despesas, lucro realizado, percentual atingido e status (Meta Atingida / No Ritmo / Abaixo do Ritmo / Meta Não Atingida / Sem Meta Definida / Mês Futuro), com resumo de quantos meses tiveram meta, quantas foram batidas e o total de meta vs. lucro realizado no período.
**v1.9.x:** Sistema de **Licença/Ativação online** (tela de ativação por chave, verificação periódica via Supabase, bloqueio remoto de clientes inadimplentes/reembolsados) · Módulo **Remoção de Vírus** (análise de aparelhos Android conectados via ADB, classificação de risco de apps suspeitos, parar/desativar/desinstalar app, formatação de emergência, histórico de ações por cliente/equipamento).
**v1.10.0 (nova):** Novo módulo **Compras / Pedidos a Fornecedores** (Fase 6): criação de pedidos de compra vinculados a um fornecedor, com itens livres ou vinculados a produtos do estoque, numeração automática (CP-000001...), fluxo de status (Pendente → Enviado → Recebido/Cancelado) e cadastro rápido de fornecedor sem sair do pedido. Ao marcar um pedido como **"Recebido"**, o sistema automaticamente dá entrada na quantidade de cada item vinculado a um produto, atualiza o valor de compra do produto para o preço pago e lança a despesa correspondente em **Contas a Pagar** — sem necessidade de lançamento manual duplicado.

---

## 1. Como usar (usuário final)

- **`Reboot Tech Assistencia Setup 1.5.0.exe`** — instalador.
- **`RebootTechAssistencia_Portatil_1.5.0.exe`** — versão portátil, sem instalação.

⚠️ O instalador não é assinado digitalmente — o Windows SmartScreen pode avisar "Windows protegeu seu PC". Clique em **"Mais informações" → "Executar assim mesmo"**.

### Primeiro acesso
- **Usuário:** `admin` / **Senha:** `admin123`
- Por segurança, a partir da v1.6.0 a troca de senha de qualquer usuário só pode ser feita por um Administrador, na tela **Usuários**. Recomendamos alterar a senha padrão do admin logo no primeiro acesso.

> Instalar por cima de qualquer versão anterior preserva todos os dados (migração automática de banco).

---

## 2. Novidades da v1.5.0

### Checklist de Entrada expandido
Na aba **"Checklist de Entrada"** da Ordem de Serviço, além dos 25 itens de vistoria física/funcional, agora também é possível registrar:

- **Acessórios entregues** — Capinha, Película, Cartão SIM, Cartão SD, Carregador, Fone de ouvido, Caixa/embalagem (checkboxes rápidos).
- **Senha / PIN / Padrão de Desbloqueio** — alterne entre digitar um PIN/senha em texto ou **desenhar o padrão de desbloqueio** num grid de 3x3 pontos (igual ao padrão Android), clicando e arrastando o mouse sobre os pontos na sequência correta. O padrão desenhado é salvo e reproduzido visualmente no PDF do checklist.
- **Termos e Declarações** — 6 itens de ciência/autorização do cliente (dano preexistente, backup de dados, abertura do aparelho, oxidação, prazo de retirada, custódia de peças), cada um com checkbox próprio, mais o texto completo da **Declaração de Condição do Aparelho**, exibido no formulário e no PDF do checklist.

Tudo isso é exportado automaticamente no **PDF do Checklist** (botão dentro da aba, ou no botão de exportação geral da OS), com a identidade visual da empresa.

### Termo de Garantia em PDF
Quando uma Ordem de Serviço está com status **"Entregue"**, um botão **🛡️ Termo de Garantia** passa a ficar disponível — tanto dentro do formulário da OS quanto diretamente na **listagem de Ordens de Serviço** (sem precisar abrir o registro). Ele gera um documento profissional completo (2 páginas) com:

- Dados do cliente (nome, CPF/CNPJ, telefone), da OS, do aparelho e do prazo de garantia configurado na própria OS;
- As 9 cláusulas do termo (prazo, cobertura, situações que invalidam a garantia, dano por líquido, telas/componentes substituídos, procedimento para acionar, dados do cliente, aparelhos sem funcionamento, condições finais);
- Assinatura do cliente (reaproveitando a assinatura digital já coletada na OS, quando existir) e linha de assinatura do responsável técnico;
- Cabeçalho/rodapé automáticos com os dados da empresa cadastrados em Configurações.

O texto usa automaticamente o **nome da empresa** e o **prazo de garantia** (em dias) definidos na Ordem de Serviço — nada é fixo ou precisa ser reescrito manualmente.

## 3. O que está incluso (visão geral completa)

| Módulo | Recursos |
|---|---|
| **Login / Permissões** | Autenticação com senha criptografada (bcrypt), papéis: Administrador, Atendente, Técnico, Financeiro |
| **Dashboard** | OS em aberto, faturamento, contas a pagar/receber, status do caixa, alerta de estoque baixo |
| **Clientes** | PF/PJ, CPF/CNPJ, contatos, endereço, histórico de OS |
| **Equipamentos** | Vinculados ao cliente, marca/modelo/IMEI/série, fotos |
| **Checklist de Entrada** | 25 itens de vistoria, acessórios, senha/padrão de desbloqueio, termos e declarações — exportável em PDF |
| **Ordens de Serviço** | Numeração automática, técnico responsável, peças do estoque, desconto visível no PDF, Termo de Garantia automático, PDF direto da listagem |
| **Orçamentos** | Itens do estoque ou livres, desconto visível no PDF, PDF direto da listagem, converter em OS |
| **Compras** | Pedidos de compra a fornecedores, itens do estoque ou livres, numeração automática, recebimento dá entrada automática no estoque e lança a despesa em Contas a Pagar |
| **Estoque** | Produtos, fornecedores, estoque mínimo, movimentações |
| **Financeiro** | Contas a Pagar/Receber, comprovante em PDF, custo de peças automático |
| **Caixa** | Abertura, suprimento, sangria, fechamento com conferência |
| **DRE Simplificado** | Receitas/despesas por categoria |
| **Relatórios** | 7 relatórios operacionais e financeiros em PDF |
| **Configurações da Empresa** | Dados institucionais usados automaticamente em todos os documentos |
| **Usuários** | Cadastro e papéis (somente Administrador) |
| **Configurações Gerais** | Tema claro/escuro, backup manual, log de operações |

## 4. O que ainda NÃO está incluso (Fase 6 — roadmap)

Ordem de prioridade definida com base na demanda dos clientes (item 1 — Compras a fornecedores — já implementado na v1.10.0, ver módulo "Compras" acima):

1. Notificações automáticas (WhatsApp/SMS/e-mail)
2. Comissões de técnicos
3. Modo rede (múltiplos PCs)
4. Integrações com impressora térmica e leitor de código de barras

---

## 5. Para desenvolvedores

### Rodar em desenvolvimento
```bash
cd reboottech-app
npm install
npm run dev:vite
```
Em outro terminal: `npx electron .`

### Gerar o `.exe`
```bash
npm run build:vite
npx electron-builder --win --x64
```
No Linux/Mac, o `electron-builder` precisa do **Wine** para embutir ícone/metadados no `.exe`.

### Estrutura do projeto
```
reboottech-app/
├── electron/
│   ├── main.cjs         → handlers IPC
│   ├── preload.cjs      → ponte segura React ↔ backend
│   ├── db.cjs           → SQLite via sql.js + migrações
│   └── pdf.cjs           → motor de geração de PDF (inclui Checklist expandido e Termo de Garantia)
├── src/
│   ├── pages/            → uma página por módulo (inclui Compras.jsx — pedidos a fornecedores)
│   ├── components/
│   │   ├── SignaturePad.jsx  → assinatura digital
│   │   └── PatternLock.jsx    → desenho de padrão de desbloqueio (novo)
│   └── utils.js           → formatação, sanitização de entrada, constantes (TERMOS_ACEITE_ITENS, ACESSORIOS_OPCOES...)
├── assets/
└── test/smoke.cjs
```

### Padrão para campos de valor monetário/quantidade
Nunca use `<input type="number">` para valores monetários. Use `type="text"` + `inputMode="decimal"` com `sanitizeDecimalInput`/`parseDecimal` (ver `src/utils.js`), como já padronizado em todo o sistema desde a v1.4.2.

### Rodar o teste automatizado do backend
```bash
node test/smoke.cjs
```
