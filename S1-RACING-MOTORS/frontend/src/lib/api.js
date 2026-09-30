// Cliente HTTP unico do sistema. Toda chamada passa por aqui — assim o
// token, o tratamento de sessao expirada e a mensagem de erro tem um
// lugar so pra mudar.
//
// Em producao a API vive no mesmo dominio (o netlify.toml redireciona
// /api/* pra Function), entao base vazia. Em dev, VITE_API aponta pro
// localhost:3333.
const BASE = import.meta.env.VITE_API || ''

const CHAVE = 's1rm.token'

export const sessao = {
  token: () => localStorage.getItem(CHAVE),
  gravar: (t) => localStorage.setItem(CHAVE, t),
  limpar: () => localStorage.removeItem(CHAVE),
}

export class ErroApi extends Error {
  constructor(mensagem, status) {
    super(mensagem)
    this.status = status
  }
}

export async function api(caminho, opcoes = {}) {
  const token = sessao.token()
  let resposta
  try {
    resposta = await fetch(`${BASE}/api${caminho}`, {
      method: opcoes.metodo || 'GET',
      headers: {
        ...(opcoes.corpo ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opcoes.chaveAdmin ? { 'x-admin-key': opcoes.chaveAdmin } : {}),
      },
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    })
  } catch {
    // fetch so rejeita por rede/CORS. Dizer "sem conexao" e util; dizer
    // "Failed to fetch" nao e.
    throw new ErroApi('Sem conexao com o servidor. Confira a internet.', 0)
  }

  const texto = await resposta.text()
  let dados = null
  try {
    dados = texto ? JSON.parse(texto) : null
  } catch {
    dados = null
  }

  if (!resposta.ok) {
    if (resposta.status === 401) {
      sessao.limpar()
      window.dispatchEvent(new Event('s1rm:deslogado'))
    }
    // MOSTRA O TEXTO REAL DO SERVIDOR. "Tente novamente" nao conserta nada.
    const msg =
      (dados && (dados.erro || dados.mensagem)) ||
      texto.slice(0, 200) ||
      `Erro ${resposta.status}`
    throw new ErroApi(msg, resposta.status)
  }

  return dados
}

export const dinheiro = (v) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Percentual em português: vírgula decimal, não ponto. `toFixed` sempre
// devolve ponto — "1.37%" num sistema em português parece tradução malfeita.
export const percentual = (v, casas = 2) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }) + '%'

// Plural de dias, incluindo o caso do PIX (zero = mesmo dia).
export const emDias = (n) => {
  const d = Number(n) || 0
  if (d === 0) return 'cai no mesmo dia'
  if (d === 1) return 'cai em 1 dia'
  return `cai em ${d} dias`
}

// Data ISO sem passar por `new Date`, que interpreta "2026-09-08" como
// meia-noite UTC e mostra dia 7 em qualquer fuso a oeste de Greenwich.
export const dataBR = (iso) => {
  if (!iso) return '—'
  const [a, m, d] = String(iso).slice(0, 10).split('-')
  return `${d}/${m}/${a}`
}
