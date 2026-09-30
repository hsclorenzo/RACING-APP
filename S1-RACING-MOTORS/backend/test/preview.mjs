// Sobe o sistema inteiro na máquina, com dados de demonstração, para
// olhar no navegador. Banco em disco (.dev-banco), então o que você
// cadastrar continua lá na próxima vez.
//
//   node backend/test/preview.mjs
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PORTA_PG = 55432
const PORTA_API = Number(process.env.PORT) || 3333

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORTA_PG}/postgres`
process.env.JWT_SECRET = 'preview-local-nao-usar-em-producao'
process.env.ADMIN_KEY = 'chave-de-teste-local'
process.env.PORT = String(PORTA_API)
// Uma conexao so: o PGlite via socket nao atende mais que isso.
process.env.PG_POOL_MAX = '1'

const db = await PGlite.create({ dataDir: path.join(RAIZ, '.dev-banco') })
const pg = new PGLiteSocketServer({ db, port: PORTA_PG, host: '127.0.0.1' })
await pg.start()

const { app } = await import('../src/app.js')
app.listen(PORTA_API)

const B = `http://localhost:${PORTA_API}/api`
const emFila = (lista) => Promise.all(lista)

// Fila global: cada chamada só sai depois que a anterior voltou.
//
// O PGlite servido por socket é um Postgres de brinquedo para uma
// conexão — uma rajada de inserts em paralelo derruba a conexão com
// ECONNRESET no meio da semeadura. O Neon aguenta numa boa; isto é
// muleta só do ambiente local, e por isso mora no script de preview e
// não no código do sistema.
let fila = Promise.resolve()

const j = (caminho, corpo, token) => {
  const proxima = fila.then(() => chamar(caminho, corpo, token))
  fila = proxima.catch(() => {})
  return proxima
}

const chamar = async (caminho, corpo, token) => {
  const r = await fetch(B + caminho, {
    method: corpo ? 'POST' : 'GET',
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      'x-admin-key': process.env.ADMIN_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  })
  return r.json()
}

await j('/migrations', {})

const EMAIL = 'lorenzo@racing.com'
const SENHA = 'racing12345'

let entrada = await j('/auth/login', { email: EMAIL, senha: SENHA })
if (!entrada.token) {
  entrada = await j('/auth/instalar', {
    oficina: 'Racing Motors', nome: 'Lorenzo', email: EMAIL, senha: SENHA,
  })
  const T = entrada.token
  const p = (c, b) => j(c, b, T)

  // Dados que parecem uma oficina de verdade, não "teste 1 / teste 2".
  const clientes = await emFila([
    p('/clientes', { nome: 'Maria Souza', telefone: '(11) 98812-4477', documento: '182.334.556-09' }),
    p('/clientes', { nome: 'Transportes Bandeira LTDA', tipo_pessoa: 'pj', telefone: '(11) 3341-9080', documento: '12.884.310/0001-70' }),
    p('/clientes', { nome: 'Jonas Ribeiro', telefone: '(11) 99604-1132' }),
    p('/clientes', { nome: 'Cláudia Menezes', telefone: '(11) 97711-5520' }),
  ])
  const carros = [
    { c: 0, placa: 'FXR-4C81', marca: 'Volkswagen', modelo: 'Gol 1.6', ano: 2019, cor: 'Prata', km_atual: 84210, motorizacao: '1.6 flex' },
    { c: 0, placa: 'KLM-2233', marca: 'Fiat', modelo: 'Argo', ano: 2021, cor: 'Branco', km_atual: 41880, motorizacao: '1.3 flex' },
    { c: 1, placa: 'RTB-8090', marca: 'Mercedes-Benz', modelo: 'Sprinter', ano: 2020, cor: 'Branco', km_atual: 210400, motorizacao: '2.2 diesel' },
    { c: 1, placa: 'RTB-8091', marca: 'Renault', modelo: 'Master', ano: 2018, cor: 'Branco', km_atual: 288750, motorizacao: '2.3 diesel' },
    { c: 2, placa: 'GHT-1D04', marca: 'Honda', modelo: 'Civic', ano: 2017, cor: 'Preto', km_atual: 132600, motorizacao: '2.0 flex' },
    { c: 3, placa: 'QAB-7E55', marca: 'Toyota', modelo: 'Corolla', ano: 2022, cor: 'Cinza', km_atual: 29340, motorizacao: '2.0 flex' },
  ]
  for (const v of carros) await p('/clientes/veiculos', { ...v, cliente_id: clientes[v.c].id })

  await emFila([
    p('/catalogo/produtos', { descricao: 'Óleo 5W30 sintético', sku: 'OL-5W30', categoria: 'Óleo', unidade_compra: 'balde', unidade_uso: 'L', fator_conversao: 20, preco_venda: 52.90, estoque_minimo: 15 }),
    p('/catalogo/produtos', { descricao: 'Óleo 15W40 mineral', sku: 'OL-15W40', categoria: 'Óleo', unidade_compra: 'balde', unidade_uso: 'L', fator_conversao: 20, preco_venda: 38.50, estoque_minimo: 20 }),
    p('/catalogo/produtos', { descricao: 'Filtro de óleo Tecfil PSL560', sku: 'FO-560', categoria: 'Filtro', preco_venda: 34.90, estoque_minimo: 4 }),
    p('/catalogo/produtos', { descricao: 'Filtro de ar Mann C25114', sku: 'FA-25114', categoria: 'Filtro', preco_venda: 62.00, estoque_minimo: 3 }),
    p('/catalogo/produtos', { descricao: 'Pastilha de freio dianteira Cobreq', sku: 'PF-D01', categoria: 'Freio', preco_venda: 189.00, estoque_minimo: 2 }),
    p('/catalogo/produtos', { descricao: 'Fluido de freio DOT4', sku: 'FL-DOT4', categoria: 'Freio', unidade_compra: 'caixa', unidade_uso: 'L', fator_conversao: 12, preco_venda: 29.90, estoque_minimo: 6 }),
    p('/catalogo/produtos', { descricao: 'Aditivo radiador concentrado', sku: 'AD-RAD', categoria: 'Arrefecimento', unidade_compra: 'galão', unidade_uso: 'L', fator_conversao: 5, preco_venda: 41.00, estoque_minimo: 5 }),
    p('/catalogo/produtos', { descricao: 'Vela de ignição NGK iridium', sku: 'VE-NGK-IR', categoria: 'Ignição', preco_venda: 78.00, estoque_minimo: 8 }),
  ])

  await emFila([
    p('/catalogo/servicos', { descricao: 'Troca de óleo e filtro', valor_fixo: 90, custo_hora: 42 }),
    p('/catalogo/servicos', { descricao: 'Revisão completa 20.000 km', tempo_padrao_horas: 2.5, valor_hora: 130, custo_hora: 42 }),
    p('/catalogo/servicos', { descricao: 'Troca de pastilhas dianteiras', tempo_padrao_horas: 1.5, valor_hora: 130, custo_hora: 42 }),
    p('/catalogo/servicos', { descricao: 'Diagnóstico eletrônico (scanner)', valor_fixo: 150, custo_hora: 42 }),
    p('/catalogo/servicos', { descricao: 'Alinhamento e balanceamento', valor_fixo: 130, custo_hora: 38 }),
    p('/catalogo/servicos', { descricao: 'Troca de correia dentada', tempo_padrao_horas: 4, valor_hora: 130, custo_hora: 42 }),
  ])

  await emFila([
    p('/catalogo/fornecedores', { nome: 'Auto Peças Silva', contato: 'Rogério', telefone: '(11) 3322-8890' }),
    p('/catalogo/fornecedores', { nome: 'Distribuidora Lubrimax', contato: 'Fátima', telefone: '(11) 4002-1180' }),
    p('/catalogo/fornecedores', { nome: 'Freios & Cia', contato: 'Marcelo', telefone: '(11) 2871-4409' }),
  ])

  // MAQUININHA E TAXA NAO SAO SEMEADAS, de proposito.
  //
  // O Lorenzo nao tem os numeros reais da oficina, e taxa inventada
  // e pior que taxa ausente: o sistema passa a responder com cara de
  // certeza um valor que ninguem conferiu. Sem taxa, a tela AVISA que
  // esta sem desconto — que e a verdade.
  //
  // Cadastrar e por a tela Cadastros > Maquininhas e taxas.

  await p('/auth/equipe', { nome: 'João Pereira', email: 'joao@racing.com', senha: 'racing12345', papel: 'mecanico' })
  await p('/auth/equipe', { nome: 'Ana Lima', email: 'ana@racing.com', senha: 'racing12345', papel: 'balcao' })

  console.log('dados de demonstração criados')
}

console.log(`
Racing Motors — preview no ar
  API .......... http://localhost:${PORTA_API}/api/saude
  Entrar com ... ${EMAIL} / ${SENHA}
  Banco ........ ${path.join(RAIZ, '.dev-banco')} (fica salvo entre execuções)
`)

process.on('SIGINT', async () => { await pg.stop(); await db.close(); process.exit(0) })
