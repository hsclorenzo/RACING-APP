# BRIEFING DE ARRANQUE — Sistema de Gestão de Oficina Mecânica — Chat 1

> Cole este arquivo inteiro como primeira mensagem no Claude Code. Ele carrega todo o contexto necessário — não existe código anterior deste projeto, este é o marco zero.

---

## 0. PASSO ZERO — antes de escrever qualquer código

1. **Escolher o disco com mais espaço livre.** Varrer os volumes montados na máquina, identificar o de maior espaço disponível e criar a raiz do projeto nele. Reportar ao Lorenzo qual disco foi escolhido e quanto espaço livre tem, antes de prosseguir.
2. **Criar a estrutura de pastas:**

```
<DISCO_ESCOLHIDO>/oficina/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── db/
│   │   │   └── migrations/
│   │   ├── middleware/
│   │   └── server.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── lib/
│   └── package.json
└── docs/
    └── BRIEFING-Oficina-Chat1.md   (este arquivo)
```

3. **Confirmar com o Lorenzo o nome definitivo do sistema** antes de gerar código. Enquanto não vier, usar o literal `[NOME_SISTEMA]` como marcador — **nunca inventar um nome** e nunca usar "SkyBase", "MD Aerospace" ou qualquer derivado. Este produto **não** é da marca MD Aerospace.

---

## 1. Identidade do projeto

- **Produto**: `[NOME_SISTEMA]` — sistema de gestão para uma oficina mecânica única. **Sem relação de marca com MD Aerospace / SkyBase.**
- **Natureza**: solução emergencial e provisória, para amigos do Lorenzo cuja oficina hoje é gerida por planilhas de Excel. Objetivo: esboço funcional que quebre o galho agora e vá sendo lapidado depois.
- **Dono do projeto**: Lorenzo — fundador solo, **não-técnico**. Não roda comandos de terminal. Toda entrega pra ele é arquivo pronto pra colar/subir ou botão no navegador. (Esta regra vale para o Lorenzo, não para o Claude Code — o Claude Code roda o que precisar na máquina.)
- **Stack** (mesma do outro produto do Lorenzo, deliberadamente, pra ele conseguir operar sem aprender nada novo):
  - Frontend: React 18 + Vite, deploy Netlify com auto-deploy conectado ao GitHub
  - Backend: Node.js + Express, deploy Railway com auto-deploy conectado ao GitHub
  - Banco: PostgreSQL no Railway
- **Repositório**: **separado** do SkyBase. Nunca monorepo — o risco de quebrar o SkyBase Escola mexendo na oficina é inaceitável.
- **Idioma**: todo o sistema, schema, rotas e UI em português. Nomes de tabela e coluna em português, sem acento.
- **Usuário final real**: mecânico e balconista de oficina, no celular, com a mão suja. Cada campo obrigatório a mais é uma chance de o sistema ser abandonado e a planilha voltar.

---

## 2. Estado atual — ponto exato

**Marco zero. Nenhuma linha de código escrita, nenhum banco criado, nenhum deploy feito.**

O que existe: o plano de escopo e a modelagem descritos nas seções 3 e 4 deste documento, aprovados pelo Lorenzo em conversa.

O que a oficina usa hoje: Excel. Existe uma planilha de controle de material/óleo que o Lorenzo ajudou a montar — **pedir esse arquivo ao Lorenzo antes da Etapa 2**, ela é a fonte de migração dos cadastros iniciais.

Ponto exato de partida: Etapa 1 (Fundação) — ver seção 5.

---

## 3. Decisões travadas, com porquê

- **A dor número um é taxa de cartão/maquininha.** A oficina vende R$ 1.000 em 6x, acha que faturou R$ 1.000, recebe algo perto de R$ 940 trinta dias depois, e não lança a diferença em lugar nenhum. O motor de taxas não é uma feature secundária — é a razão de existir do sistema. Se ele não estiver certo, o resto não importa.
- **A dor número dois é consumo de óleo e material sem custo real.** Compram em balde de 20 L, usam 4,5 L, cobram um valor de chute. Sem baixa de estoque com custo médio ponderado, a margem da OS é ficção.
- **Consequência das duas: o sistema tem que responder "esta OS deu lucro?" na tela.** Margem visível no momento em que a peça é lançada, não num relatório mensal.
- **Nasce com `tenant_id` e RLS desde a primeira migration**, mesmo sendo uma oficina só. Motivo: sistema "provisório" que funciona nunca é removido. O custo de já nascer multi-tenant é quase zero agora (o padrão está pronto e testado no outro produto) e economiza uma reescrita inteira depois. Não fazer single-tenant hardcoded "pra ganhar tempo".
- **A taxa aplicada é gravada como snapshot no recebimento**, nunca lida por referência viva da tabela de taxas. Adquirente muda taxa e renegocia contrato o tempo todo; se o histórico recalcular, o relatório do mês passado muda sozinho e o sistema perde credibilidade na hora.
- **Estoque é sempre armazenado na unidade de uso, não na de compra.** Produto tem `unidade_compra` (balde), `unidade_uso` (litro) e `fator_conversao` (20). Entrada de 3 baldes credita 60 L. Sem isso o controle de óleo não fecha, que é exatamente o problema atual da planilha.
- **Custo médio ponderado, recalculado na entrada de estoque.** Não FIFO, não último custo. É o que o dono da oficina entende e o que fecha com a realidade de compra fracionada.
- **Baixa de estoque acontece na transição da OS para `em_execucao`**, e é estornada automaticamente se a OS voltar de status ou for cancelada. Motivo: dar baixa no orçamento inflaria o consumo com orçamento que nunca virou serviço; dar baixa só na entrega deixa a prateleira mentindo por dias.
- **Existe uma única função transacional `fechar_os`** que faz tudo de forma atômica: valida, congela os totais, gera o título a receber, grava os recebimentos com taxa calculada, confirma a baixa de estoque e escreve auditoria. Mesmo padrão da função-coração do outro produto do Lorenzo, e pelo mesmo motivo: nada de fechar OS por uma sequência de UPDATEs soltos no backend.
- **Emissão fiscal (NF-e / NFS-e) fica FORA do escopo.** Continua na contabilidade/prefeitura. O sistema guarda registro interno do documento, nada de integração SEFAZ.
- **Integração via API com maquininha fica FORA do escopo do MVP.** Taxas cadastradas manualmente + importação de CSV do extrato para conciliação. API entra na fase 2, se entrar.
- **Fora do escopo também**: folha de pagamento, ponto, agenda de box, portal do cliente, catálogo integrado de peças. Escopo travado — resistir a pedidos de expansão até o piloto rodar 30 dias na oficina.
- **Fotos do veículo na entrada são obrigatórias na prática**, mesmo que opcionais no schema. É o que elimina discussão de avaria pré-existente com o cliente, e é o que faz o mecânico querer usar o sistema.

---

## 4. Modelagem proposta (a construir)

Convenção: `id uuid default gen_random_uuid()`, `tenant_id uuid not null`, `criado_em timestamptz default now()`, `atualizado_em timestamptz` em todas as tabelas. RLS habilitada em todas.

**Cadastros**
- `clientes` — `nome, tipo_pessoa (pf/pj), documento, telefone, email, endereco, observacoes`
- `veiculos` — `cliente_id, placa (unique por tenant), marca, modelo, ano, cor, chassi, km_atual, motorizacao, observacoes`
- `usuarios` + `memberships` — papéis: `admin`, `balcao`, `mecanico`
- `fornecedores` — `nome, documento, telefone, contato, observacoes`
- `servicos` — catálogo de mão de obra: `descricao, tempo_padrao_horas, valor_hora, valor_fixo (nullable), ativo`
- `produtos` — peças e insumos: `sku, descricao, categoria, unidade_compra, unidade_uso, fator_conversao numeric, custo_medio numeric, preco_venda numeric, estoque_atual numeric, estoque_minimo numeric, ativo`

**Ordem de serviço**
- `ordens_servico` — `numero (sequencial por tenant), cliente_id, veiculo_id, km_entrada, status, mecanico_id, data_abertura, data_aprovacao, data_conclusao, data_entrega, descricao_problema, diagnostico, total_servicos, total_pecas, desconto, total_geral, custo_total, margem_valor, margem_percentual, observacoes`
  - `status`: enum `orcamento`, `aprovado`, `em_execucao`, `pronto`, `entregue`, `faturado`, `cancelado`
- `os_itens` — `os_id, tipo (servico/peca), servico_id (nullable), produto_id (nullable), descricao_livre, quantidade, custo_unitario, preco_unitario, total`
- `os_fotos` — `os_id, momento (entrada/execucao/saida), arquivo, legenda` (compressão via canvas no frontend antes do upload)

**Estoque**
- `movimentos_estoque` — `produto_id, tipo (entrada/saida/ajuste/estorno), quantidade (na unidade de uso), custo_unitario, os_id (nullable), compra_id (nullable), motivo, usuario_id`
- `compras` — `fornecedor_id, numero_nota, data, valor_total, observacoes`
- `compras_itens` — `compra_id, produto_id, quantidade_compra, unidade, custo_total, custo_unitario_uso`

**Financeiro — o núcleo**
- `adquirentes` — `nome` (ex.: Stone, Cielo, InfinitePay, Mercado Pago), `ativo`
- `taxas_adquirente` — `adquirente_id, modalidade (debito/credito_vista/credito_parcelado/pix/dinheiro/transferencia), parcelas_min, parcelas_max, taxa_percentual, taxa_fixa, dias_liquidacao, vigencia_inicio, vigencia_fim (nullable)`
- `recebimentos` — `os_id, adquirente_id (nullable), modalidade, parcelas, valor_bruto, taxa_percentual_aplicada, taxa_fixa_aplicada, valor_taxa, valor_liquido, data_venda, data_prevista_liquidacao, data_liquidacao_real (nullable), status (previsto/liquidado/divergente), observacao`
- `titulos` — AP/AR unificado, mesmo padrão do outro produto: `tipo (pagar/receber), origem (os/compra/despesa_fixa), origem_id, cliente_id (nullable), fornecedor_id (nullable), descricao, valor, parcela_numero, parcela_total, vencimento, pagamento (nullable), status`
  - Parcelamento com divisão exata em centavos (a sobra vai na primeira parcela), mesmo comportamento já validado no outro produto.
- `despesas_fixas` — `descricao, valor, dia_vencimento, ativo` (aluguel, energia, internet — alimentam `titulos` a pagar)

**Função transacional `fechar_os(...)`** — atômica, e o coração do sistema:
1. valida status e itens
2. congela `total_servicos`, `total_pecas`, `desconto`, `total_geral`
3. calcula `custo_total` a partir do custo médio dos produtos consumidos + custo de mão de obra
4. grava `margem_valor` e `margem_percentual`
5. gera os `recebimentos` com taxa buscada na vigência da data da venda e **gravada como snapshot**
6. gera os `titulos` a receber correspondentes
7. confirma os `movimentos_estoque` de saída
8. grava auditoria

**Telas mínimas**: Dashboard, OS (kanban + detalhe), Clientes/Veículos, Produtos/Estoque, Compras, Financeiro (recebimentos + conciliação + contas a pagar), Cadastros (serviços, fornecedores, adquirentes e taxas), Relatórios.

**Dashboard — os números que precisam estar na primeira tela**: faturamento bruto do mês, faturamento líquido do mês, **total pago em taxas no mês**, margem média por OS, OSs abertas por status, produtos abaixo do estoque mínimo, recebíveis que caem esta semana.

---

## 5. Próximos passos (sequência de etapas)

| Etapa | Entrega | Esforço |
|---|---|---|
| E1 | Fundação: `BANCO-COMPLETO.sql` idempotente completo, auth, RBAC (admin/balcao/mecanico), rota de migrations com chave, deploy vazio no ar (Railway + Netlify) | Médio |
| E2 | Cadastros: clientes, veículos, produtos, serviços, fornecedores, **adquirentes e taxas** | Médio |
| E3 | Núcleo OS: kanban, itens, margem em tempo real, fotos, orçamento em PDF | Alto |
| E4 | Estoque: entrada por compra, custo médio, fracionamento, baixa automática pela OS, alerta de mínimo | Médio |
| E5 | Financeiro: `fechar_os`, recebimentos com motor de taxas, previsão de liquidação, conciliação, contas a pagar | Alto |
| E6 | Dashboard e relatórios | Médio |
| E7 | Importação da planilha atual + piloto assistido na oficina | Baixo |

Corte de emergência, se precisar entrar antes na oficina: **E1 → E2 → E3 → E5** já substitui a planilha e resolve a dor principal. E4 e E6 entram na sequência.

---

## 6. Pendências / questões em aberto

- **Nome definitivo do sistema**: pendente com o Lorenzo. Marcador `[NOME_SISTEMA]` até lá.
- **Adquirentes reais e taxas reais da oficina**: pendente. Precisa da lista (quais maquininhas usam) e das taxas por modalidade e faixa de parcelas, senão o motor de taxas nasce com número inventado. Perguntar também se usam antecipação de recebíveis e a que taxa.
- **Quantidade de usuários e papéis reais**: pendente. O RBAC da E1 depende disso.
- **Planilha atual de material/óleo**: precisa ser enviada pelo Lorenzo antes da E2, é a fonte de migração dos cadastros.
- **Precificação de mão de obra**: confirmar se cobram por hora, por serviço tabelado, ou os dois. A tabela `servicos` já contempla os dois, mas a UX muda conforme o padrão real deles.
- **Volume**: quantas OS por mês e quantos produtos em estoque — define se paginação e busca precisam ser sérias na E2 ou podem ser triviais.
- **Conta Railway e Netlify**: confirmar se serão contas novas ou as mesmas do Lorenzo (implica em custo e em separação de faturamento).
- **Risco declarado ao Lorenzo, ainda não mitigado**: sistema só funciona se a oficina alimentar. A tela de lançamento precisa ser mobile-first e mínima. Se exigir muitos campos, volta pra planilha em duas semanas.

---

## 7. Modo de trabalho (regras permanentes)

- Comunicação em português, direto ao ponto, sem tutorial.
- Explicação de código: só lógica que muda, decisão de arquitetura, armadilha — nunca linha a linha do óbvio.
- **Lorenzo não roda comando de terminal.** Toda entrega para ele é arquivo pronto pra colar/subir, ou botão no navegador. Migrations aplicam por rota HTTP com chave, nunca por CLI.
- **Migration sempre idempotente** (`if not exists` / `drop ... if exists` + `create`), nunca destrutiva sem aviso explícito.
- **Arquivo único consolidado `BANCO-COMPLETO.sql`**, atualizado a cada mudança de schema. Nunca uma pilha de arquivos numerados soltos.
- **Toda migration que mude a assinatura de uma função SQL existente deve dropar explicitamente as versões antigas antes de recriar** (laço sobre `pg_proc` se necessário). `create or replace` sozinho não substitui quando a assinatura muda — cria sobrecarga silenciosa. Esse erro já custou caro no outro produto do Lorenzo.
- **`fechar_os` nunca é editada "de cabeça"**: extrair o texto exato da versão anterior, aplicar só a mudança pontual, comparar programaticamente antes de entregar.
- **Todo handler async precisa de try/catch ou wrapper.** Handler async solto derruba o processo por unhandled rejection e põe o Railway em loop de restart — incidente real, já pago no outro produto. Guard global de `unhandledRejection` no `server.js` desde a E1.
- **Antes de propor ou construir qualquer coisa nova, varrer o código atrás de implementação já existente.**
- **Mensagem de erro pro usuário final mostra o texto real do servidor** quando disponível, nunca só "tente novamente".
- Nenhuma biblioteca nova sem aprovação do Lorenzo.
- Fim de cada etapa formal: `✅ Etapa concluída | Próxima: [nome] — Modelo: [x] | Effort: [x]`
- "Migrar" ou "handoff" → gerar documento neste mesmo formato de 7 seções, com literais exatos (nomes de tabela, arquivo, valor), sem parafrasear.
