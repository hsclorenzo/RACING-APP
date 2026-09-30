import { useState } from 'react'
import { api, sessao } from '../lib/api.js'
import { Marca } from '../components/Marca.jsx'

export function LoginPage({ aoEntrar }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      const r = await api('/auth/login', { metodo: 'POST', corpo: { email, senha } })
      sessao.gravar(r.token)
      aoEntrar(r)
    } catch (err) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="tela-centro">
      <form onSubmit={enviar}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
          <Marca altura={38} />
        </div>

        <div className="cartao">
          <h1 style={{ fontSize: 18, marginBottom: 18 }}>Entrar</h1>

          {erro && <div className="aviso aviso-erro">{erro}</div>}

          <div className="campo">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
            />
          </div>

          <div className="campo">
            <label htmlFor="senha">Senha</label>
            <input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button className="btn-primario btn-bloco" disabled={carregando}>
            {carregando ? 'Entrando...' : 'Entrar'}
          </button>
        </div>

        <p className="sutil" style={{ textAlign: 'center', marginTop: 18 }}>
          Primeira vez? A instalacao fica em{' '}
          <a href="/instalar">/instalar</a>.
        </p>
      </form>
    </div>
  )
}
