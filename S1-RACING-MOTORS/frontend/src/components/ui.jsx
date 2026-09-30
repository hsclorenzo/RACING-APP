import { useEffect, useState } from 'react'

// Peças de tela reusadas por todos os cadastros. Existem para que o
// balcão veja a MESMA caixa e o MESMO botão em toda tela — e para que
// mudar o jeito de mostrar erro seja um arquivo, não vinte.

export function Campo({ rotulo, tipo = 'text', valor, aoMudar, dica, largura, ...resto }) {
  return (
    <div className="campo" style={largura ? { gridColumn: `span ${largura}` } : undefined}>
      <label>{rotulo}</label>
      {tipo === 'textarea' ? (
        <textarea rows={3} value={valor ?? ''} onChange={(e) => aoMudar(e.target.value)} {...resto} />
      ) : (
        <input
          type={tipo}
          value={valor ?? ''}
          onChange={(e) => aoMudar(e.target.value)}
          {...resto}
        />
      )}
      {dica && <div className="sutil" style={{ marginTop: 5 }}>{dica}</div>}
    </div>
  )
}

export function Selecao({ rotulo, valor, aoMudar, opcoes, dica, vazio }) {
  return (
    <div className="campo">
      <label>{rotulo}</label>
      <select value={valor ?? ''} onChange={(e) => aoMudar(e.target.value)}>
        {vazio && <option value="">{vazio}</option>}
        {opcoes.map((o) => (
          <option key={o.valor} value={o.valor}>{o.rotulo}</option>
        ))}
      </select>
      {dica && <div className="sutil" style={{ marginTop: 5 }}>{dica}</div>}
    </div>
  )
}

export function Modal({ titulo, aoFechar, children }) {
  // Esc fecha. Num tablet com teclado isso é o reflexo de todo mundo, e
  // sem isso o único jeito de sair é achar o X.
  useEffect(() => {
    const tecla = (e) => e.key === 'Escape' && aoFechar()
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [aoFechar])

  return (
    <div className="modal-fundo" onClick={aoFechar}>
      {/* stopPropagation: clicar DENTRO do modal não pode fechá-lo —
          sem isso, arrastar para selecionar texto fecha a janela. */}
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-topo">
          <h2 style={{ margin: 0 }}>{titulo}</h2>
          <button className="btn-fantasma" style={{ padding: '6px 12px', minHeight: 0 }} onClick={aoFechar}>
            Fechar
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Busca({ valor, aoMudar, dica }) {
  return (
    <div className="busca">
      <input type="search" value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={dica} />
    </div>
  )
}

export function Vazio({ children }) {
  return <div className="vazio">{children}</div>
}

export function Aviso({ erro, ok }) {
  if (!erro && !ok) return null
  return <div className={`aviso ${erro ? 'aviso-erro' : 'aviso-ok'}`}>{erro || ok}</div>
}

export function Abas({ atual, aoTrocar, itens }) {
  return (
    <div className="abas">
      {itens.map((i) => (
        <button key={i.id} className={atual === i.id ? 'ativo' : ''} onClick={() => aoTrocar(i.id)}>
          {i.rotulo}
        </button>
      ))}
    </div>
  )
}

export function Cabecalho({ titulo, acao, aoAgir }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
      <h1 style={{ margin: 0 }}>{titulo}</h1>
      {acao && <button className="btn-primario" onClick={aoAgir}>{acao}</button>}
    </div>
  )
}

// Guarda o estado de "carregando / deu erro / deu certo" de um formulário
// num lugar só. Cada tela reescrevendo esses três useState é onde nasce a
// tela que fica travada em "Salvando..." depois de um erro.
export function useEnvio() {
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [enviando, setEnviando] = useState(false)

  async function enviar(fn, mensagemOk) {
    setErro('')
    setOk('')
    setEnviando(true)
    try {
      const r = await fn()
      if (mensagemOk) setOk(mensagemOk)
      return r
    } catch (e) {
      setErro(e.message)
      return null
    } finally {
      setEnviando(false)
    }
  }

  return { erro, ok, enviando, enviar, setErro, setOk }
}
