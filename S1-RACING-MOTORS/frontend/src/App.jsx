import { useEffect, useState } from 'react'
import { api, sessao } from './lib/api.js'
import { MarcaCurta } from './components/Marca.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { InstalarPage } from './pages/InstalarPage.jsx'
import { InicioPage } from './pages/InicioPage.jsx'
import { EquipePage } from './pages/EquipePage.jsx'
import { ClientesPage } from './pages/ClientesPage.jsx'
import { EstoquePage } from './pages/EstoquePage.jsx'
import { CadastrosPage } from './pages/CadastrosPage.jsx'
import { OsPage } from './pages/OsPage.jsx'
import { OsDetalhePage } from './pages/OsDetalhePage.jsx'

// ---------------------------------------------------------------------
// Roteador de 20 linhas em vez de react-router.
// O sistema tem meia dúzia de telas e nenhuma rota aninhada; trazer uma
// dependência inteira pra isso é pagar bundle e atualização de biblioteca
// por um recurso que cabe aqui. Se um dia aparecer rota aninhada de
// verdade, troca — mas não antes.
// ---------------------------------------------------------------------
function useRota() {
  const [rota, setRota] = useState(window.location.pathname)
  useEffect(() => {
    const aoVoltar = () => setRota(window.location.pathname)
    window.addEventListener('popstate', aoVoltar)
    return () => window.removeEventListener('popstate', aoVoltar)
  }, [])
  const ir = (destino) => {
    window.history.pushState({}, '', destino)
    setRota(destino)
    window.scrollTo(0, 0)
  }
  return [rota, ir]
}

// Cada item do menu responde UMA pergunta. "Cadastros" é o balaio do que
// se preenche uma vez e quase não se mexe; o que se usa todo dia (cliente,
// peça) sai de lá e vira item próprio.
const MENU = [
  { destino: '/', rotulo: 'Início', papeis: ['admin', 'balcao', 'mecanico'] },
  { destino: '/os', rotulo: 'OS', papeis: ['admin', 'balcao', 'mecanico'] },
  { destino: '/clientes', rotulo: 'Clientes', papeis: ['admin', 'balcao', 'mecanico'] },
  { destino: '/estoque', rotulo: 'Estoque', papeis: ['admin', 'balcao', 'mecanico'] },
  { destino: '/cadastros', rotulo: 'Cadastros', papeis: ['admin', 'balcao'] },
  { destino: '/equipe', rotulo: 'Equipe', papeis: ['admin'] },
]

export default function App() {
  const [rota, ir] = useRota()
  const [sessaoUsuario, setSessaoUsuario] = useState(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    // Sessão expirada em QUALQUER chamada derruba o app inteiro pro
    // login — sem isso a tela fica meio logada, mostrando esqueleto vazio.
    const deslogar = () => setSessaoUsuario(null)
    window.addEventListener('s1rm:deslogado', deslogar)
    return () => window.removeEventListener('s1rm:deslogado', deslogar)
  }, [])

  useEffect(() => {
    if (!sessao.token()) { setCarregando(false); return }
    api('/auth/eu')
      .then(setSessaoUsuario)
      .catch(() => sessao.limpar())
      .finally(() => setCarregando(false))
  }, [])

  if (rota === '/instalar') {
    return <InstalarPage aoEntrar={(s) => { setSessaoUsuario(s); ir('/') }} />
  }

  if (carregando) {
    return <div className="tela-centro"><p className="sutil" style={{ textAlign: 'center' }}>Carregando...</p></div>
  }

  if (!sessaoUsuario) return <LoginPage aoEntrar={setSessaoUsuario} />

  const { usuario, oficinas } = sessaoUsuario
  const atual = oficinas[0]
  const papel = atual.papel
  const podeEditar = papel === 'admin' || papel === 'balcao'
  const menu = MENU.filter((m) => m.papeis.includes(papel))

  function sair() {
    sessao.limpar()
    setSessaoUsuario(null)
    ir('/')
  }

  // Rota que o papel atual não pode ver cai no Início, em vez de mostrar
  // tela em branco. A trava de verdade é no servidor; isto é a navegação.
  // /os/<id> é a única rota com parâmetro. Reconhecida por split em vez
  // de regex: barra dentro de literal de regex precisa de escape, e um
  // escape errado aqui derruba o app inteiro em branco.
  const partes = rota.split('/').filter(Boolean)
  const osId = partes[0] === 'os' && partes.length === 2 ? partes[1] : null
  const permitida = osId ? '/os' : (menu.some((m) => m.destino === rota) ? rota : '/')

  return (
    <div className="app">
      <nav className="barra">
        {menu.map((m) => (
          <a
            key={m.destino} href={m.destino}
            className={permitida === m.destino ? 'ativo' : ''}
            onClick={(e) => { e.preventDefault(); ir(m.destino) }}
          >
            {m.rotulo}
          </a>
        ))}
      </nav>

      <div style={{ flex: 1, minWidth: 0 }}>
        <header className="topo">
          <MarcaCurta altura={20} />
          <button className="btn-fantasma" style={{ padding: '7px 13px', minHeight: 0, fontSize: 13 }} onClick={sair}>
            Sair
          </button>
        </header>

        <main className="conteudo">
          {permitida === '/os' && (osId
            ? <OsDetalhePage id={osId} papel={papel} aoVoltar={() => ir('/os')} />
            : <OsPage papel={papel} aoAbrir={(novoId) => ir('/os/' + novoId)} />)}
          {permitida === '/clientes' && <ClientesPage podeEditar={podeEditar} />}
          {permitida === '/estoque' && (
            <EstoquePage podeEditar={podeEditar} papel={papel} aoAbrirOs={(i) => ir('/os/' + i)} />
          )}
          {permitida === '/cadastros' && <CadastrosPage podeEditar={podeEditar} papel={papel} />}
          {permitida === '/equipe' && <EquipePage papel={papel} />}
          {permitida === '/' && (
            <InicioPage usuario={usuario} oficina={atual.oficina} papel={papel} aoNavegar={ir} />
          )}
        </main>
      </div>
    </div>
  )
}
