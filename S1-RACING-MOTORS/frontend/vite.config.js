import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A porta vem do ambiente, com 5173 só como último recurso. Numa máquina
// que roda mais de um projeto, a 5173 vive ocupada — e `strictPort` fica
// desligado (o padrão) de propósito, para o Vite escorregar para a
// próxima livre em vez de falhar o boot.
const PORTA = Number(process.env.PORT) || 5173

// Em dev o backend roda separado. `API_URL` existe para o caso de ele não
// estar na 3333; sem ela, vale o padrão. Assim o frontend chama /api/...
// exatamente como chama em produção, onde quem redireciona é o
// netlify.toml — dev e produção usando o mesmo caminho, e nenhuma
// diferença que só apareceria no deploy.
const API = process.env.API_URL || 'http://localhost:3333'

export default defineConfig({
  plugins: [react()],
  server: {
    port: PORTA,
    proxy: {
      '/api': { target: API, changeOrigin: true },
    },
  },
})
