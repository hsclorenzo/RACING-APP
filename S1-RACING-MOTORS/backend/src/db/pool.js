import pg from 'pg'
import dotenv from 'dotenv'
import { contextoAtual } from '../lib/contextoRls.js'

dotenv.config()

const { Pool } = pg

// ---------------------------------------------------------------------
// ARMADILHA CARA, corrigida na raiz.
//
// Por padrão o driver `pg` converte a coluna `date` do Postgres num
// objeto Date do JavaScript — meia-noite NO FUSO DO SERVIDOR. Daí saem
// dois estragos silenciosos:
//   - `String(data).slice(0,10)` vira "Mon Sep 08", não "2026-09-08",
//     e qualquer comparação de vigência passa a mentir;
//   - `data.toISOString()` num servidor em São Paulo devolve o DIA
//     ANTERIOR, porque meia-noite local é 03:00 UTC do mesmo dia... mas
//     meia-noite local de um fuso a leste já é o dia anterior em UTC.
//
// `date` é um dia do calendário, não um instante. Então ela chega aqui
// como a string que o Postgres mandou ("2026-09-08") e pronto. Isso vale
// para TODO o sistema, não só para o motor de taxas.
//
// `timestamptz` (1184) continua virando Date, e deve mesmo: aquilo É um
// instante no tempo.
pg.types.setTypeParser(1082, (v) => v)

const url = process.env.DATABASE_URL || ''
const ehLocal = url.includes('localhost') || url.includes('127.0.0.1')

// Rodando em Netlify Functions o processo e efemero: cada invocacao pode
// ganhar um container novo. Pool grande nao ajuda e o Neon tem teto de
// conexoes no plano gratuito — por isso `max` baixo. O pooler do Neon
// (a URL com `-pooler`) e quem realmente multiplexa.
const ehServerless = Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME)

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ehLocal ? false : { rejectUnauthorized: false },
  // PG_POOL_MAX existe para o preview local: o Postgres em WASM servido
  // por socket atende UMA conexão por vez, e um pool de 10 o derruba com
  // ECONNRESET no meio de qualquer tela que faça duas consultas juntas.
  // Em produção a variável não existe e valem os números de sempre.
  max: Number(process.env.PG_POOL_MAX) || (ehServerless ? 2 : 10),
  min: 0,
  // O default do `pg` para connectionTimeoutMillis e 0 = ESPERAR PARA
  // SEMPRE. Num banco que dorme (Neon free suspende apos 5 min ocioso),
  // isso vira request pendurado sem erro e sem log. 10s cobre o
  // cold start do Neon e falha alto depois disso.
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: ehServerless ? 5000 : 30000,
  statement_timeout: 20000,
  keepAlive: true,
})

pool.on('error', (err) => {
  console.error('Erro inesperado no pool do Postgres:', err.message)
})

// ---------------------------------------------------------------------
// Arma o RLS de verdade. Toda conexao emprestada do pool passa por aqui
// ANTES de rodar qualquer query do handler — inclusive as pedidas por
// pool.query(), que abaixo passa a usar este mesmo connect().
//
// set_config(..., false) e de SESSAO, nao de transacao. So e seguro
// porque a conexao volta pro pool e, ao ser reaproveitada, passa por
// aqui de novo e sobrescreve o valor. Nunca vaza usuario entre requests.
// ---------------------------------------------------------------------
const conectarOriginal = pool.connect.bind(pool)

pool.connect = async function armarContextoRls(...args) {
  const cliente = await conectarOriginal(...args)
  const { usuarioId, sistema } = contextoAtual()
  try {
    await cliente.query(
      `select set_config('app.usuario_id', $1, false),
              set_config('app.bypass_rls', $2, false)`,
      [usuarioId || '', sistema ? 'on' : 'off']
    )
  } catch (erro) {
    // Nao derruba a requisicao — mas tambem nao finge que deu certo. Sem
    // o set_config as policies enxergam um deslogado e negam tudo, que e
    // o lado seguro de falhar.
    console.error('Nao foi possivel armar o contexto de RLS:', erro.message)
  }
  return cliente
}

pool.query = async function queryComRls(texto, parametros) {
  const cliente = await pool.connect()
  try {
    return await cliente.query(texto, parametros)
  } finally {
    cliente.release()
  }
}

// Transacao com o contexto ja armado. Usada pela fechar_os e por tudo
// que precisa ser atomico.
export async function emTransacao(fn) {
  const cliente = await pool.connect()
  try {
    await cliente.query('begin')
    const resultado = await fn(cliente)
    await cliente.query('commit')
    return resultado
  } catch (erro) {
    try {
      await cliente.query('rollback')
    } catch {
      /* conexao ja morta; o rollback e implicito */
    }
    throw erro
  } finally {
    cliente.release()
  }
}
