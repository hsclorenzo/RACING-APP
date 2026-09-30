// Postgres de verdade, em WASM, na porta 55432 — sem instalar nada na
// máquina. Serve para o `npm run dev` local e para os testes de ponta a
// ponta rodarem contra o mesmo driver `pg` que roda em produção.
// Não sobe em produção: é devDependency.
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const db = await PGlite.create()
const servidor = new PGLiteSocketServer({ db, port: 55432, host: '127.0.0.1' })
await servidor.start()
console.log('PGlite ouvindo em postgresql://postgres@127.0.0.1:55432/postgres')

process.on('SIGINT', async () => {
  await servidor.stop()
  await db.close()
  process.exit(0)
})
