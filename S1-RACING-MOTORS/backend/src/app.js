import express from 'express'
import cors from 'cors'
import compression from 'compression'
import dotenv from 'dotenv'
import { pool } from './db/pool.js'
import { executarComoSistema } from './lib/contextoRls.js'
import { rotasAuth } from './routes/auth.js'
import { rotasMigrations } from './routes/migrations.js'
import { rotasClientes } from './routes/clientes.js'
import { rotasCatalogo } from './routes/catalogo.js'
import { rotasAdquirentes } from './routes/adquirentes.js'
import { rotasOs } from './routes/os.js'
import { rotasEstoque } from './routes/estoque.js'

dotenv.config()

// O container da nuvem quase sempre sobe em UTC. Sem isto, "vence hoje"
// e "faturamento do mes" viram a data errada durante 3 horas por dia.
process.env.TZ = process.env.TZ || 'America/Sao_Paulo'

// ---------------------------------------------------------------------
// Rede de seguranca do processo. Uma promessa rejeitada sem tratamento
// (handler async que faz await sem try/catch) DERRUBA o Node. Num
// servidor isso vira crash-loop. Aqui a gente registra e segue vivo: o
// request problematico falha, o servico nao cai.
// ---------------------------------------------------------------------
process.on('unhandledRejection', (motivo) => {
  console.error('[unhandledRejection] servidor segue no ar:', motivo)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] servidor segue no ar:', err)
})

// ---------------------------------------------------------------------
// Guarda de ambiente: falha ALTO e CEDO. Sem isto um deploy sem
// DATABASE_URL sobe verde e so quebra em runtime, sem dizer por que.
// ---------------------------------------------------------------------
export function conferirAmbiente() {
  const fatais = []
  const avisos = []
  if (!process.env.DATABASE_URL) fatais.push('DATABASE_URL nao definida — sem banco.')
  if (!process.env.JWT_SECRET) {
    const msg = 'JWT_SECRET nao definida — tokens assinados com segredo do codigo-fonte.'
    if (process.env.NODE_ENV === 'production') fatais.push(msg)
    else avisos.push(msg)
  }
  if (!process.env.ADMIN_KEY) avisos.push('ADMIN_KEY nao definida — /api/migrations fica bloqueada.')
  avisos.forEach((a) => console.warn('[ambiente]', a))
  return fatais
}

export const app = express()

app.set('trust proxy', true)
app.use(compression())
app.use(
  cors({
    origin: process.env.CORS_ORIGEM ? process.env.CORS_ORIGEM.split(',') : true,
    credentials: false,
  })
)
// Fotos chegam em base64 no corpo do POST; o default de 100kb do express
// rejeitaria antes de o handler ver o request.
app.use(express.json({ limit: '12mb' }))

app.get('/api/saude', async (req, res) => {
  const inicio = Date.now()
  try {
    await executarComoSistema(() => pool.query('select 1'))
    res.json({ ok: true, banco: 'ok', ms: Date.now() - inicio })
  } catch (erro) {
    res.status(503).json({ ok: false, banco: 'falhou', erro: erro.message })
  }
})

app.use('/api/auth', rotasAuth)
app.use('/api/migrations', rotasMigrations)
app.use('/api/clientes', rotasClientes)
app.use('/api/catalogo', rotasCatalogo)
app.use('/api/adquirentes', rotasAdquirentes)
app.use('/api/os', rotasOs)
app.use('/api/estoque', rotasEstoque)

app.use('/api', (req, res) => res.status(404).json({ erro: `Rota nao encontrada: ${req.path}` }))

// ---------------------------------------------------------------------
// Tratador de erro final. Mostra o TEXTO REAL do servidor pro usuario —
// "tente novamente" nao ajuda ninguem a consertar nada. Detalhe tecnico
// (stack, SQL) fica no log, nao na tela.
// ---------------------------------------------------------------------
app.use((erro, req, res, next) => {
  const status = erro.status || 500
  if (status >= 500) console.error('[erro]', req.method, req.path, erro)
  res.status(status).json({ erro: erro.message || 'Erro inesperado no servidor' })
})
