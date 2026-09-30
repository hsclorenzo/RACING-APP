import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../db/pool.js'
import { executarComoSistema } from '../lib/contextoRls.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const rotasMigrations = express.Router()

// Porteiro: so quem tem a ADMIN_KEY roda migration.
rotasMigrations.use((req, res, next) => {
  const chave = req.headers['x-admin-key'] || req.query.chave
  if (!process.env.ADMIN_KEY || chave !== process.env.ADMIN_KEY) {
    return res.status(403).json({ erro: 'Acesso restrito — ADMIN_KEY invalida' })
  }
  next()
})

// ARMADILHA: rodando local, o arquivo esta em backend/BANCO-COMPLETO.sql
// relativo a ESTE modulo. Rodando em Netlify Function, o esbuild junta
// tudo num bundle e o `included_files` do netlify.toml deposita o .sql
// relativo ao cwd da funcao — o caminho relativo ao modulo aponta pro
// vazio. Testar so na maquina nao pega isso: quebra so em producao.
function caminhoDoBanco() {
  const candidatos = [
    path.resolve(__dirname, '..', '..', 'BANCO-COMPLETO.sql'),
    path.resolve(process.cwd(), 'backend', 'BANCO-COMPLETO.sql'),
    path.resolve(process.cwd(), 'BANCO-COMPLETO.sql'),
  ]
  return candidatos.find((c) => fs.existsSync(c)) || candidatos[0]
}

// ---------------------------------------------------------------------
// DE PROPOSITO nao existe divisor de statements aqui.
//
// A tentacao e quebrar o arquivo no ';' e rodar um por um pra dar erro
// bonitinho. Isso exige entender bloco $$ ... $$, tag customizada
// $fn$ ... $fn$, string com aspas e comentario — e cada um desses e um
// bug esperando. Pior: com o arquivo quebrado, uma falha no meio deixa o
// banco METADE migrado.
//
// Mandar o arquivo inteiro numa query so usa o protocolo simples do
// Postgres, que embrulha tudo numa transacao implicita: ou aplica tudo,
// ou nao aplica nada. O erro perde o numero do statement, mas ganha o
// `position` (byte dentro do arquivo) — e a funcao abaixo traduz isso
// pra linha e coluna, que e a informacao que a gente realmente queria.
// ---------------------------------------------------------------------
function localizar(sql, posicao) {
  if (!posicao) return null
  const antes = sql.slice(0, Number(posicao) - 1)
  const linhas = antes.split('\n')
  return {
    linha: linhas.length,
    coluna: linhas[linhas.length - 1].length + 1,
    trecho: sql.split('\n')[linhas.length - 1],
  }
}

async function aplicar(res) {
  const arquivo = caminhoDoBanco()
  if (!fs.existsSync(arquivo)) {
    return res.status(500).json({ erro: `BANCO-COMPLETO.sql nao encontrado em ${arquivo}` })
  }
  const sql = fs.readFileSync(arquivo, 'utf8')

  return executarComoSistema(async () => {
    const cliente = await pool.connect()
    try {
      await cliente.query(sql)
      const r = await cliente.query(
        `select table_name from information_schema.tables
          where table_schema = 'public' order by 1`
      )
      res.json({
        ok: true,
        mensagem: 'Banco aplicado com sucesso.',
        tabelas: r.rows.map((x) => x.table_name),
        total_tabelas: r.rows.length,
      })
    } catch (erro) {
      const onde = localizar(sql, erro.position)
      console.error('Falha ao aplicar o banco:', erro.message, onde)
      res.status(500).json({
        ok: false,
        erro: erro.message,
        detalhe: erro.detail || null,
        onde,
        aviso: 'Nada foi aplicado — a transacao inteira voltou atras.',
      })
    } finally {
      cliente.release()
    }
  })
}

// POST e o certo (muda estado). O GET existe porque o Lorenzo aplica pelo
// navegador, e navegador so faz GET na barra de endereco.
rotasMigrations.post('/', (req, res) => aplicar(res))
rotasMigrations.get('/', (req, res) => aplicar(res))

// Diagnostico: o banco esta de pe? Quais tabelas existem?
rotasMigrations.get('/estado', async (req, res) => {
  try {
    await executarComoSistema(async () => {
      const r = await pool.query(
        `select table_name from information_schema.tables
          where table_schema = 'public' order by 1`
      )
      const m = await pool
        .query(`select nome, aplicado_em from migrations_aplicadas order by id`)
        .catch(() => ({ rows: [] }))
      res.json({ ok: true, tabelas: r.rows.map((x) => x.table_name), aplicadas: m.rows })
    })
  } catch (erro) {
    res.status(500).json({ ok: false, erro: erro.message })
  }
})
