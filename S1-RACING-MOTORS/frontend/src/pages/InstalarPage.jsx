import { useState } from 'react'
import { api, sessao } from '../lib/api.js'
import { Marca } from '../components/Marca.jsx'

// ---------------------------------------------------------------------
// Instalacao pelo NAVEGADOR, nao pelo terminal. Os dois passos que num
// projeto normal seriam comandos de linha (`migrate` e `seed`) viraram
// dois botoes, protegidos pela mesma ADMIN_KEY que fica so nas variaveis
// do Netlify.
// ---------------------------------------------------------------------
export function InstalarPage({ aoEntrar }) {
  const [chave, setChave] = useState('')
  const [estado, setEstado] = useState(null)
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [ocupado, setOcupado] = useState('')

  const [oficina, setOficina] = useState('Racing Motors')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')

  async function rodar(acao, fn) {
    setErro('')
    setOk('')
    setOcupado(acao)
    try {
      await fn()
    } catch (e) {
      setErro(e.message)
    } finally {
      setOcupado('')
    }
  }

  const criarTabelas = () =>
    rodar('tabelas', async () => {
      const r = await api('/migrations', { metodo: 'POST', chaveAdmin: chave })
      setEstado(r)
      setOk(`Banco aplicado: ${r.total_tabelas} tabelas no ar.`)
    })

  const criarAdmin = () =>
    rodar('admin', async () => {
      const r = await api('/auth/instalar', {
        metodo: 'POST',
        chaveAdmin: chave,
        corpo: { oficina, nome, email, senha },
      })
      // Entra direto. Quem acabou de instalar não deve ver tela de login
      // uma única vez — e a sessão dura 10 anos, então nunca mais verá.
      sessao.gravar(r.token)
      setOk('Pronto. Entrando...')
      if (aoEntrar) aoEntrar({ usuario: r.usuario, oficinas: r.oficinas })
    })

  return (
    <div className="tela-centro">
      <div style={{ maxWidth: 460 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <Marca altura={34} />
        </div>

        {erro && <div className="aviso aviso-erro">{erro}</div>}
        {ok && <div className="aviso aviso-ok">{ok}</div>}

        <div className="cartao" style={{ marginBottom: 14 }}>
          <h2>1. Chave de administrador</h2>
          <p className="sutil" style={{ marginTop: 0 }}>
            E a variavel <code>ADMIN_KEY</code> configurada no Netlify. Sem ela os dois passos
            abaixo ficam bloqueados.
          </p>
          <div className="campo">
            <label htmlFor="chave">ADMIN_KEY</label>
            <input
              id="chave"
              type="password"
              value={chave}
              onChange={(e) => setChave(e.target.value)}
              autoComplete="off"
            />
          </div>
        </div>

        <div className="cartao" style={{ marginBottom: 14 }}>
          <h2>2. Criar as tabelas</h2>
          <p className="sutil" style={{ marginTop: 0 }}>
            Pode apertar quantas vezes quiser: o arquivo do banco e idempotente, nada e apagado e
            nada e duplicado. Se falhar no meio, nada e aplicado.
          </p>
          <button
            className="btn-secundario btn-bloco"
            onClick={criarTabelas}
            disabled={!chave || ocupado === 'tabelas'}
          >
            {ocupado === 'tabelas' ? 'Aplicando...' : 'Aplicar BANCO-COMPLETO.sql'}
          </button>
          {estado && (
            <p className="sutil" style={{ marginBottom: 0, marginTop: 12 }}>
              {estado.tabelas.join(', ')}
            </p>
          )}
        </div>

        <div className="cartao">
          <h2>3. Criar a oficina e o primeiro acesso</h2>
          <p className="sutil" style={{ marginTop: 0 }}>
            So funciona uma vez. Depois disso, novos usuarios entram pela tela de Equipe.
          </p>
          <div className="campo">
            <label htmlFor="of">Nome da oficina</label>
            <input id="of" type="text" value={oficina} onChange={(e) => setOficina(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="n">Seu nome</label>
            <input id="n" type="text" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="e">Seu e-mail</label>
            <input
              id="e"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoCapitalize="none"
            />
          </div>
          <div className="campo">
            <label htmlFor="s">Senha (8+ caracteres)</label>
            <input id="s" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} />
          </div>
          <button
            className="btn-primario btn-bloco"
            onClick={criarAdmin}
            disabled={!chave || !nome || !email || senha.length < 8 || ocupado === 'admin'}
          >
            {ocupado === 'admin' ? 'Criando...' : 'Criar oficina e administrador'}
          </button>
        </div>

        <p className="sutil" style={{ textAlign: 'center', marginTop: 18 }}>
          <a href="/">Voltar para o login</a>
        </p>
      </div>
    </div>
  )
}
