# S1 Racing Motors — como pôr no ar

Tudo por navegador. **Nenhum comando de terminal.** Custo: **R$ 0/mês.**

Ordem: banco → GitHub → Netlify → variáveis → instalar.

---

## 1. Banco (Neon) — 3 minutos

1. Entre em **neon.tech** e crie a conta (pode ser com o Google).
2. **Create project** → nome `s1-racing-motors` → região **AWS South America (São Paulo)**.
   Região importa: banco no Brasil corta ~180 ms de cada consulta.
3. Terminada a criação, ele mostra a **Connection string**. Clique em **Pooled connection**
   (a URL com `-pooler` no meio) e copie. Guarde — é o `DATABASE_URL`.

> Por que a "pooled": a nossa API roda em funções curtas que abrem e fecham conexão o tempo
> todo. A URL comum estoura o limite de conexões do plano grátis; a pooled não.

O plano grátis dá 0,5 GB e o banco hiberna depois de 5 minutos parado — a primeira tela do dia
demora ~1 segundo a mais. Para uma oficina isso não é problema.

---

## 2. GitHub

Crie um repositório **novo e privado**, chamado `s1-racing-motors`, e suba a pasta
`E:\S1-RACING-MOTORS` inteira nele (GitHub Desktop resolve, ou arrastar os arquivos pelo site).

**Repositório separado do SkyBase, sempre.** Nunca junto.

O `.gitignore` já está pronto: `node_modules`, `dist` e o `.env` (que tem senha) ficam de fora.

---

## 3. Netlify

1. Em **netlify.com** → **Add new site** → **Import an existing project** → GitHub → escolha
   `s1-racing-motors`.
2. **Não mexa em nada** na tela de configuração de build. O arquivo `netlify.toml` do projeto já
   diz o que fazer (comando, pasta publicada, funções e redirecionamentos).
3. **Deploy site**. O primeiro build leva ~2 minutos e vai falhar em runtime até o passo 4 —
   é esperado, ainda faltam as variáveis.

---

## 4. Variáveis de ambiente

No Netlify: **Site configuration → Environment variables → Add a variable** (uma de cada vez).

| Nome | Valor |
|---|---|
| `DATABASE_URL` | a connection string **pooled** do Neon, do passo 1 |
| `JWT_SECRET` | um texto longo e aleatório (40+ caracteres) |
| `ADMIN_KEY` | outro texto longo e aleatório, **diferente** do de cima |
| `NODE_ENV` | `production` |

Para gerar os dois textos aleatórios: qualquer gerador de senha, tamanho máximo, sem símbolos.
**Guarde os dois num lugar seguro.** Trocar o `JWT_SECRET` depois desloga todo mundo.

Depois de salvar as quatro: **Deploys → Trigger deploy → Clear cache and deploy site.**
Variável nova só entra em deploy novo.

---

## 5. Instalar o sistema

1. Abra `https://SEU-SITE.netlify.app/api/saude`.
   Tem que responder `{"ok":true,"banco":"ok"}`. Se não responder, pare aqui — é sinal de que
   o `DATABASE_URL` está errado, e a mensagem na tela diz qual é o problema.
2. Abra `https://SEU-SITE.netlify.app/instalar`.
3. Cole a `ADMIN_KEY` no primeiro campo.
4. **Aplicar BANCO-COMPLETO.sql** — cria as 22 tabelas. Pode apertar quantas vezes quiser:
   é idempotente, não apaga nem duplica nada, e se falhar no meio não aplica nada.
5. Preencha nome, e-mail e senha do administrador → **Criar oficina e administrador**.
6. Vá em `https://SEU-SITE.netlify.app/` e entre.

A tela `/instalar` se tranca sozinha depois do passo 5: mesmo com a chave certa, ela recusa
criar uma segunda oficina. Novos usuários passam a entrar pela tela **Equipe**.

---

## Manutenção

**Mudou o banco (etapa nova).** Abra `/instalar`, cole a `ADMIN_KEY`, aperte
*Aplicar BANCO-COMPLETO.sql*. É sempre esse botão, para sempre.

**Ver o que está aplicado.** `https://SEU-SITE.netlify.app/api/migrations/estado?chave=SUA_ADMIN_KEY`

**Deu erro numa tela.** A mensagem que aparece é o texto real do servidor, não um genérico.
Me mande a frase inteira — ela costuma dizer exatamente o que fazer.

**Backup.** O Neon grátis guarda 7 dias de histórico e dá para voltar o banco a qualquer ponto
desse período (*Branches → Restore*). Quando a oficina começar a depender do sistema de
verdade, vale exportar uma cópia por mês.

---

## Se um dia sair do grátis

Os dois tetos que podem ser atingidos, e o que fazer:

- **0,5 GB no Neon.** Só chega lá com muita foto. As fotos ficam fora do banco de propósito, então
  isso demora anos numa oficina só. Se chegar: Neon Launch, US$ 19/mês.
- **125 mil chamadas/mês nas Functions.** Três pessoas usando o dia inteiro dão ~10 mil. Longe.

Se um dia precisar de rotina automática de madrugada (cobrança, lembrete), aí sim o Netlify não
serve e o backend muda para o Railway (~US$ 5/mês). A troca é barata porque o backend é um
Express comum — só o arquivo `netlify/functions/api.js` sai de cena.
