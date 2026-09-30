# Racing Motors — Sistema de Gestão
## O que foi feito, como foi feito, e o que falta

**Data:** 24/09/2026
**Estado:** etapas E1 a E4 concluídas de 7. **214 testes automatizados, todos passando.**
**Onde mora:** `E:\S1-RACING-MOTORS`
**Ainda não está na internet** — falta você criar as contas (Neon + Netlify). Instruções em `COMO-SUBIR.md`.

---

## 1. O RESUMO EM UMA PÁGINA

O sistema já faz, de ponta a ponta:

- Cadastrar **clientes e veículos** (e achar o cliente digitando a placa do carro).
- Cadastrar **peças, serviços, fornecedores e maquininhas com suas taxas**.
- Abrir uma **ordem de serviço**, lançar peças e mão de obra, **ver a margem na hora**, tirar
  fotos do carro e imprimir o orçamento pro cliente.
- Lançar a **nota de compra** do fornecedor, converter balde em litro e calcular o **custo real**
  de cada peça.
- **Dar baixa no estoque sozinho** quando a OS entra em execução, e devolver se for cancelada.
- Responder **"vendi R$ 1.000 em 6x, quanto cai na minha conta e quando?"**

O que ele **ainda não faz**: fechar a OS gerando as contas a receber, conciliar o extrato da
maquininha, e mostrar o painel com o faturamento do mês. É a etapa E5, a próxima.

---

## 2. AS DUAS DORES QUE JUSTIFICAM O SISTEMA

Tudo aqui foi construído em volta de dois problemas concretos que a oficina tem hoje:

**1. A taxa da maquininha some.** A oficina vende R$ 1.000 em 6x, acha que faturou R$ 1.000 e
recebe uns R$ 940 trinta dias depois. A diferença nunca é lançada em lugar nenhum.

**2. O óleo e o material não têm custo real.** Compra em balde de 20 L, usa 4,5 L numa troca, e
cobra um valor de chute. Sem saber o custo do litro, a margem de cada serviço é ficção.

Consequência das duas: o sistema tem que responder **"esta OS deu lucro?"** na tela, no momento
em que a peça é lançada — não num relatório no fim do mês.

---

## 3. O QUE FOI FEITO, ETAPA POR ETAPA

### ✅ E1 — Fundação

O alicerce: banco de dados, login, papéis de acesso e a estrutura de deploy.

- **`BANCO-COMPLETO.sql`** — um arquivo só, com as 22 tabelas. É **idempotente**: você pode
  rodar quantas vezes quiser que nada quebra, nada duplica, nada é apagado.
- **Três papéis de acesso:** administrador (vê tudo, inclusive dinheiro), balcão (atende, abre
  OS, cobra) e mecânico (lança serviço e peça, **não vê custo nem margem**).
- **Instalação pelo navegador.** Você não roda comando nenhum: a tela `/instalar` tem dois
  botões — "criar as tabelas" e "criar a oficina e o primeiro acesso".
- O banco nasce **multi-oficina** mesmo servindo uma só. Custa quase nada agora e evita uma
  reescrita inteira se um dia virar produto.

### ✅ E2 — Cadastros

Clientes, veículos, peças, serviços, fornecedores, maquininhas e taxas.

- **A placa é normalizada.** `abc-1d23`, `ABC1D23` e `abc 1d23` são o mesmo carro. Sem isso o
  histórico do veículo se parte em dois.
- **Busca de cliente pela placa** — é como o balcão procura de verdade.
- **O simulador de taxa está na primeira tela:** digita o valor e a forma de pagamento, e ele
  mostra o que cai na conta, o que a maquininha come, o que o imposto leva e em que dia entra.
- **Peça: compra numa unidade, controla em outra.** Cadastra "balde" como unidade de compra,
  "litro" como unidade de uso e 20 como fator. O resto o sistema faz.

### ✅ E3 — Ordem de serviço

O coração do dia a dia.

- **Kanban por etapa:** orçamento → aprovado → em execução → pronto → entregue → faturado.
- **Margem ao vivo.** Cada peça lançada atualiza o total, o custo e o lucro na hora.
- **Fotos pelo celular**, comprimidas no próprio aparelho antes de subir.
- **Orçamento impresso** com o cabeçalho da oficina — no celular, o botão Compartilhar manda
  direto pro WhatsApp do cliente.

### ✅ E4 — Estoque

O que transforma a margem de chute em número.

- **Nota de compra com fracionamento.** Lançou "3 baldes por R$ 890" → entram **60 litros** no
  estoque a **R$ 14,8333 o litro**. Essa é a conta que a planilha nunca fez.
- **Custo médio ponderado.** Tinha 10 L a R$ 12 e entram 60 L a R$ 14,83? O litro passa a valer
  R$ 14,42, e toda OS daí pra frente usa esse número.
- **Baixa automática:** a OS entra em execução, as peças saem da prateleira sozinhas. Cancelou,
  voltam.
- **Ajuste de inventário** com motivo obrigatório, e **extrato por peça** que responde "por que
  o saldo é esse?" linha por linha.

---

## 4. COMO FOI FEITO — as decisões que valem saber

Esta seção é a mais importante pra quem for continuar o trabalho. São escolhas que parecem
detalhe e não são.

### A taxa é gravada como fotografia, não como referência

Quando a OS é fechada, a taxa que valia **naquele dia** é copiada pra dentro do recebimento.
Se a Stone renegociar amanhã, o relatório do mês passado continua igual.

*Por quê:* se o histórico recalculasse, o número de ontem mudaria sozinho e o sistema perderia a
credibilidade na primeira renegociação de contrato. Tem teste provando: encerra a taxa de 3,49%,
cadastra a de 2,89%, e a venda de ontem continua valendo exatamente o que valia.

### Nenhuma taxa vem preenchida, e cada venda pode ter a sua

Você foi explícito: *"não é pra deixar as taxas padronizadas, nem mesmo as maquininhas — cada
operação tem uma variável."* Então:

- Todos os campos nascem **em branco**. Não existe "taxa padrão de mercado" sugerida.
- A tabela de taxas é **sugestão**. Em cada venda dá pra digitar outra taxa, outro imposto e
  outro prazo, sem mexer no cadastro.
- O que for digitado à mão fica **marcado como manual** — pra que, quando a gente for calcular
  médias e estatísticas, a exceção não entre como se fosse a regra.

*Por quê:* número sugerido pelo sistema vira número aceito sem conferir.

### O sistema avisa quando está chutando

Uma peça sem histórico de compra tem custo zero. Isso faria a OS mostrar "81% de margem" com
cara de certeza. A tela avisa: **"2 itens entraram sem custo — esta margem está otimista."**
Na lista, essas OSs aparecem em cinza com "?" em vez de verde.

Quando a compra é lançada e a peça sai da prateleira, o custo real preenche a lacuna sozinho — e
**só a lacuna**: item que já tinha custo não é tocado, porque reescrever custo mudaria a margem
do passado.

### Desconto sai do lucro, não do custo

Deu R$ 150 de desconto? Os R$ 150 saem inteiros da sua margem. O custo da peça não muda.
Errar isso faria a margem parecer intacta depois de um desconto de 20%, que é o contrário do que
aconteceu de verdade.

### Estoque negativo é informação, não defeito

Na oficina a peça física existe mesmo que a compra não tenha sido lançada. Travar a baixa por
falta de saldo pararia o trabalho. Então o saldo vai pra negativo e **denuncia a nota que
falta** — a tela separa isso de "acabando" com cor e texto diferentes.

### O mecânico não vê custo nem margem

E não é escondido na tela: o **servidor apaga o campo** antes de responder. Esconder na tela
deixa o número na resposta, e quem abrir o inspetor do navegador lê tudo.

### O custo não sai no orçamento impresso

O papel que vai pra mão do cliente mostra preço, nunca custo. (Esse foi um bug pego na
verificação — estava vazando.)

### Tudo que é cálculo de dinheiro é função pura e testada

O motor de taxas, o cálculo de margem e o custo médio vivem em arquivos separados, sem banco de
dados no meio, e são **as mesmas funções** que a tela usa e que o fechamento vai usar. Se a tela
somasse por um lado e o fechamento por outro, um dia divergiriam por um centavo e ninguém saberia
em qual acreditar.

### O estoque tem uma porta só

Todo movimento — compra, baixa, estorno, ajuste — passa pela mesma função. Não existe
"atualizar o saldo direto, só desta vez". Tem teste que soma todos os movimentos e compara com o
saldo do produto: se alguém abrir uma porta lateral, o teste quebra.

---

## 5. COMO ISSO FOI VERIFICADO

**214 testes automatizados**, rodando num Postgres de verdade, não numa imitação:

| | |
|---|---|
| Fundação (login, papéis, migrations) | 26 |
| Cadastros e motor de taxas | 50 |
| Ordem de serviço | 42 |
| Estoque | 37 |
| Cálculos puros (taxa, margem, custo médio) | 59 |
| **Total** | **214** |

Um comando roda tudo: `node backend/test/rodar-tudo.mjs` — ele sobe o banco, sobe o sistema,
roda as quatro suítes e derruba tudo.

**Além dos testes, cada tela foi aberta no navegador** (celular e computador) e usada de
verdade: abrir OS, lançar peça, dar desconto, subir foto, lançar nota, conferir o extrato.

**Sete bugs reais foram encontrados assim** — e vale listar, porque mostram o tipo de coisa que
só aparece rodando:

1. O preço de R$ 48,90 era recusado pelo banco por um detalhe de tipo. Só quebrava contra banco
   de verdade; lendo o código, parecia certo.
2. Datas voltavam do banco num formato que fazia toda comparação de vigência mentir.
3. Quantidade zero num item virava 1 silenciosamente.
4. Fator de conversão zero virava 1 do mesmo jeito.
5. O custo da oficina saía no orçamento impresso do cliente.
6. O custo médio vazava pro mecânico numa tela específica.
7. A suíte de testes quebrou sozinha uma semana depois de escrita — as taxas nasciam vigentes "a
   partir de hoje" e as vendas testadas eram datadas no passado. **O sistema estava certo; o
   teste é que tinha prazo de validade.**

---

## 6. O QUE FALTA

### 🔜 E5 — Financeiro (a próxima)

É a etapa que fecha o ciclo do dinheiro.

- A função **`fechar_os`**: uma operação única e indivisível que congela os totais, calcula a
  margem final, gera a conta a receber, grava os recebimentos com a taxa fotografada, confirma a
  baixa de estoque e registra tudo na auditoria. Ou faz tudo, ou não faz nada.
- **Parcelamento** com divisão exata em centavos (a sobra vai na primeira parcela).
- **Previsão de recebimento:** quanto cai, e em que dia.
- **Conciliação:** importar o extrato da maquininha em CSV e casar com o que o sistema previu —
  é o que revela a taxa cobrada errado.
- **Contas a pagar**, incluindo as despesas fixas (aluguel, energia, internet).

### 🔜 E6 — Painel e relatórios

Os números na primeira tela: faturamento bruto do mês, faturamento líquido, **total pago em
taxas no mês**, margem média por OS, OSs abertas por etapa, peças abaixo do mínimo, recebíveis
que caem esta semana.

### 🔜 E7 — Importar a planilha e rodar na oficina

- Importar a planilha de material/óleo que a oficina usa hoje. **Preciso desse arquivo.**
- Piloto acompanhado na oficina.

### 🔜 Pôr no ar (pode ser feito agora, em paralelo)

O sistema está pronto pra subir. Falta só criar duas contas gratuitas:

1. **Neon** (banco de dados) — grátis, escolher região São Paulo.
2. **Netlify** (site + servidor) — grátis, conectado ao GitHub.

**Custo total: R$ 0/mês.** O passo a passo completo, com onde clicar, está em `COMO-SUBIR.md`.

### Fora do escopo, por decisão

- **Nota fiscal eletrônica** — continua na contabilidade. O sistema guarda o registro interno.
- **Integração direta com a maquininha** — na fase 2, se entrar. Por ora é taxa cadastrada à mão
  + importação do extrato.
- Folha de pagamento, controle de ponto, agenda de box, portal do cliente.

---

## 7. O QUE EU AINDA PRECISO DE VOCÊ

| O que | Trava o quê |
|---|---|
| **A planilha de material/óleo** que a oficina usa hoje | E7 (importação) |
| Criar as contas Neon + Netlify | Pôr no ar |
| Quantas OS por mês, mais ou menos? | Define se busca e paginação precisam ser reforçadas |

**Já resolvido, não precisa mais:** as taxas reais das maquininhas. Como você não tem esses
números, em vez de esperar eu deixei tudo em branco e editável em cada operação.

---

## 8. COMO MEXER NISTO (referência técnica)

### Rodar na sua máquina

```
node backend/test/preview.mjs
```

Sobe o sistema inteiro com dados de demonstração. Entrar com `lorenzo@racing.com` /
`racing12345`. O banco fica salvo em `.dev-banco` entre execuções.

O frontend sobe separado, com o Vite.

### Rodar os testes

```
node backend/test/rodar-tudo.mjs
```

### Estrutura

```
backend/
  BANCO-COMPLETO.sql     ← as 22 tabelas, arquivo único e idempotente
  src/lib/               ← as regras de negócio (funções puras, testáveis)
      taxas.js             motor de taxa e imposto
      os.js                totais, margem e máquina de estados da OS
      estoque.js           custo médio, fracionamento, delta de baixa
      movimentos.js        a única porta de entrada/saída do estoque
      rotas.js             papéis de acesso e o que o mecânico não vê
  src/routes/            ← as rotas HTTP
  test/                  ← 214 testes
frontend/
  src/pages/             ← as telas
  src/components/        ← peças reusadas (Simulador, campos, modal)
```

### Regras permanentes deste projeto

- **Migration sempre idempotente.** Um arquivo só (`BANCO-COMPLETO.sql`), nunca uma pilha de
  arquivos numerados.
- **Migration aplica por rota HTTP com chave**, nunca por linha de comando.
- **Toda conta de dinheiro é função pura com teste.** A tela e o servidor usam a mesma.
- **Mensagem de erro mostra o texto real do servidor**, nunca "tente novamente".
- **Nenhuma biblioteca nova sem aprovação.** Até aqui foram só as previstas — a única adição foi
  `serverless-http` (um arquivo, é o que faz o backend caber no Netlify de graça).
- **O repositório é separado do SkyBase. Nunca junto.**

---

*Documento gerado em 24/09/2026, com o sistema verificado rodando e 214/214 testes passando.*
