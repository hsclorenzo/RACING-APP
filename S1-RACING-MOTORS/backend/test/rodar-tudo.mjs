// Sobe um Postgres de verdade (WASM), sobe o backend, roda as suítes de
// ponta a ponta na ordem e derruba tudo. Um comando, resultado limpo,
// banco novo a cada execução — nenhum teste herda sujeira do anterior.
//
//   node backend/test/rodar-tudo.mjs
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const PORTA_PG = 55433
const PORTA_API = 3399

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${PORTA_PG}/postgres`
process.env.JWT_SECRET = 'teste-local-xyz'
process.env.ADMIN_KEY = 'chave-de-teste-local'
process.env.PORT = String(PORTA_API)
// Uma conexao so: o PGlite via socket nao atende mais que isso.
process.env.PG_POOL_MAX = '1'

const db = await PGlite.create()
const pg = new PGLiteSocketServer({ db, port: PORTA_PG, host: '127.0.0.1' })
await pg.start()

// Importado DEPOIS das variáveis de ambiente: o pool lê DATABASE_URL no
// momento em que o módulo carrega, então importar antes pegaria undefined.
const { app } = await import('../src/app.js')
const api = app.listen(PORTA_API)

function rodar(arquivo) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(AQUI, arquivo)], {
      stdio: 'inherit',
      env: { ...process.env, BASE: `http://localhost:${PORTA_API}/api` },
    })
    p.on('exit', resolve)
  })
}

let codigo = 0
for (const arquivo of ['ponta-a-ponta.mjs', 'e2-cadastros.mjs', 'e3-os.mjs', 'e4-estoque.mjs']) {
  console.log(`\n${'='.repeat(58)}\n  ${arquivo}\n${'='.repeat(58)}`)
  codigo = (await rodar(arquivo)) || codigo
}

api.close()
await pg.stop()
await db.close()
process.exit(codigo)
