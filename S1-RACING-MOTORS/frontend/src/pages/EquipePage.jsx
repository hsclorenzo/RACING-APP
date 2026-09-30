import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'

const PAPEIS = [
  { valor: 'admin', rotulo: 'Administrador', explica: 'Ve tudo, inclusive dinheiro e custo.' },
  { valor: 'balcao', rotulo: 'Balcao', explica: 'Atende, abre OS, cobra. Nao mexe em equipe.' },
  { valor: 'mecanico', rotulo: 'Mecanico', explica: 'Ve as OS que sao dele e lanca servico e peca.' },
]

export function EquipePage({ papel }) {
  const [lista, setLista] = useState([])
  const [erro, setErro] = useState('')
  const [ok, setOk] = useState('')
  const [abrindo, setAbrindo] = useState(false)
  const [form, setForm] = useState({ nome: '', email: '', senha: '', papel: 'mecanico' })

  async function carregar() {
    try {
      setLista(await api('/auth/equipe'))
    } catch (e) {
      setErro(e.message)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  async function criar(e) {
    e.preventDefault()
    setErro('')
    setOk('')
    try {
      await api('/auth/equipe', { metodo: 'POST', corpo: form })
      setOk(`${form.nome} ja pode entrar.`)
      setForm({ nome: '', email: '', senha: '', papel: 'mecanico' })
      setAbrindo(false)
      carregar()
    } catch (err) {
      setErro(err.message)
    }
  }

  async function alternar(u) {
    setErro('')
    try {
      await api(`/auth/equipe/${u.id}`, { metodo: 'PATCH', corpo: { ativo: !u.acesso_ativo } })
      carregar()
    } catch (err) {
      setErro(err.message)
    }
  }

  if (papel !== 'admin') {
    return (
      <div className="cartao">
        <h1>Equipe</h1>
        <p className="sutil">Só o administrador da oficina mexe aqui.</p>
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Equipe</h1>
        <button className="btn-primario" onClick={() => setAbrindo(!abrindo)}>
          {abrindo ? 'Cancelar' : '+ Pessoa'}
        </button>
      </div>

      {erro && <div className="aviso aviso-erro">{erro}</div>}
      {ok && <div className="aviso aviso-ok">{ok}</div>}

      {abrindo && (
        <form className="cartao" style={{ marginBottom: 16 }} onSubmit={criar}>
          <div className="grade grade-2">
            <div className="campo">
              <label>Nome</label>
              <input
                type="text"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                required
              />
            </div>
            <div className="campo">
              <label>E-mail</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoCapitalize="none"
                required
              />
            </div>
            <div className="campo">
              <label>Senha inicial (8+)</label>
              <input
                type="text"
                value={form.senha}
                onChange={(e) => setForm({ ...form, senha: e.target.value })}
                required
              />
            </div>
            <div className="campo">
              <label>Papel</label>
              <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value })}>
                {PAPEIS.map((p) => (
                  <option key={p.valor} value={p.valor}>
                    {p.rotulo}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="sutil" style={{ marginTop: 0 }}>
            {PAPEIS.find((p) => p.valor === form.papel).explica}
          </p>
          <button className="btn-primario btn-bloco">Criar acesso</button>
        </form>
      )}

      <div className="cartao">
        {lista.length === 0 && <p className="sutil">Ninguem cadastrado ainda.</p>}
        {lista.map((u) => (
          <div className="linha-lista" key={u.id}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{u.nome}</div>
              <div className="sutil" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {u.email}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <span className="etiqueta">{PAPEIS.find((p) => p.valor === u.papel)?.rotulo || u.papel}</span>
              <button className="btn-fantasma" style={{ padding: '7px 12px', minHeight: 0, fontSize: 13 }} onClick={() => alternar(u)}>
                {u.acesso_ativo ? 'Desativar' : 'Reativar'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
