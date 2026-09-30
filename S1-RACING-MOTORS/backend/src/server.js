// Entrada para rodar o backend como servidor normal (dev na maquina, ou
// um Railway/Render no futuro). O app em si vive em app.js e NAO sabe
// que existe servidor — e por isso o mesmo codigo roda em Netlify
// Functions (ver netlify/functions/api.js) sem uma linha de diferenca.
import { app, conferirAmbiente } from './app.js'

const fatais = conferirAmbiente()
if (fatais.length > 0) {
  fatais.forEach((f) => console.error('[ambiente] FATAL:', f))
  process.exit(1)
}

const porta = Number(process.env.PORT) || 3333
app.listen(porta, () => {
  console.log(`Racing Motors — backend no ar em http://localhost:${porta}`)
})
