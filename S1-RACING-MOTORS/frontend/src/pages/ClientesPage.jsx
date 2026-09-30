import { useEffect, useState, useCallback } from 'react'
import { api } from '../lib/api.js'
import { Campo, Selecao, Modal, Busca, Vazio, Aviso, Abas, Cabecalho, useEnvio } from '../components/ui.jsx'

const VAZIO_CLIENTE = { nome: '', tipo_pessoa: 'pf', documento: '', telefone: '', email: '', endereco: '', observacoes: '' }
const VAZIO_VEICULO = { placa: '', cliente_id: '', marca: '', modelo: '', ano: '', cor: '', chassi: '', km_atual: '', motorizacao: '', observacoes: '' }

export function ClientesPage({ podeEditar }) {
  const [aba, setAba] = useState('clientes')
  const [busca, setBusca] = useState('')
  const [clientes, setClientes] = useState([])
  const [veiculos, setVeiculos] = useState([])
  const [editando, setEditando] = useState(null)
  const { erro, ok, enviando, enviar, setErro } = useEnvio()

  const carregar = useCallback(async () => {
    try {
      const q = busca ? `?busca=${encodeURIComponent(busca)}` : ''
      if (aba === 'clientes') setClientes(await api(`/clientes${q}`))
      else setVeiculos(await api(`/clientes/veiculos/lista${q}`))
    } catch (e) {
      setErro(e.message)
    }
  }, [aba, busca, setErro])

  // 300 ms de espera antes de buscar. Sem isso, digitar "GOL" dispara
  // três requisições e a resposta da primeira pode chegar por último,
  // sobrescrevendo o resultado certo com o de uma letra só.
  useEffect(() => {
    const t = setTimeout(carregar, 300)
    return () => clearTimeout(t)
  }, [carregar])

  async function salvar(dados) {
    const ehVeiculo = aba === 'veiculos'
    const base = ehVeiculo ? '/clientes/veiculos' : '/clientes'
    const r = await enviar(
      () => (dados.id
        ? api(`${base}/${dados.id}`, { metodo: 'PATCH', corpo: dados })
        : api(base, { metodo: 'POST', corpo: dados })),
      dados.id ? 'Alterado.' : 'Cadastrado.'
    )
    if (r) {
      setEditando(null)
      carregar()
    }
  }

  async function desativar(item) {
    const base = aba === 'veiculos' ? '/clientes/veiculos' : '/clientes'
    const r = await enviar(() => api(`${base}/${item.id}`, { metodo: 'DELETE' }), 'Desativado.')
    if (r) { setEditando(null); carregar() }
  }

  return (
    <div>
      <Cabecalho
        titulo="Clientes e veículos"
        acao={podeEditar ? (aba === 'clientes' ? '+ Cliente' : '+ Veículo') : null}
        aoAgir={() => setEditando(aba === 'clientes' ? { ...VAZIO_CLIENTE } : { ...VAZIO_VEICULO })}
      />

      <Abas
        atual={aba}
        aoTrocar={(a) => { setAba(a); setBusca('') }}
        itens={[{ id: 'clientes', rotulo: 'Clientes' }, { id: 'veiculos', rotulo: 'Veículos' }]}
      />

      <Aviso erro={erro} ok={ok} />

      <Busca
        valor={busca}
        aoMudar={setBusca}
        dica={aba === 'clientes' ? 'Nome, telefone, CPF/CNPJ ou placa do carro' : 'Placa, modelo, marca ou dono'}
      />

      <div className="cartao">
        {aba === 'clientes' ? (
          clientes.length === 0
            ? <Vazio>{busca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}</Vazio>
            : clientes.map((c) => (
              <div className="linha-lista clicavel" key={c.id} onClick={() => setEditando(c)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{c.nome}</div>
                  <div className="sutil">
                    {[c.telefone, c.documento].filter(Boolean).join(' · ') || 'sem contato'}
                  </div>
                </div>
                <span className="chip">{c.veiculos} {c.veiculos === 1 ? 'carro' : 'carros'}</span>
              </div>
            ))
        ) : (
          veiculos.length === 0
            ? <Vazio>{busca ? 'Nenhum veículo encontrado.' : 'Nenhum veículo cadastrado ainda.'}</Vazio>
            : veiculos.map((v) => (
              <div className="linha-lista clicavel" key={v.id} onClick={() => setEditando(v)}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }} className="num">{v.placa}</div>
                  <div className="sutil">
                    {[v.marca, v.modelo, v.ano].filter(Boolean).join(' ') || 'sem modelo'} · {v.cliente_nome}
                  </div>
                </div>
                {v.km_atual && <span className="chip num">{Number(v.km_atual).toLocaleString('pt-BR')} km</span>}
              </div>
            ))
        )}
      </div>

      {editando && (
        aba === 'clientes'
          ? <FormCliente
              dados={editando} aoFechar={() => setEditando(null)} aoSalvar={salvar}
              aoDesativar={desativar} enviando={enviando} podeEditar={podeEditar}
            />
          : <FormVeiculo
              dados={editando} aoFechar={() => setEditando(null)} aoSalvar={salvar}
              aoDesativar={desativar} enviando={enviando} podeEditar={podeEditar}
            />
      )}
    </div>
  )
}

function FormCliente({ dados, aoFechar, aoSalvar, aoDesativar, enviando, podeEditar }) {
  const [f, setF] = useState(dados)
  const m = (campo) => (v) => setF({ ...f, [campo]: v })

  return (
    <Modal titulo={f.id ? f.nome : 'Novo cliente'} aoFechar={aoFechar}>
      <div className="grade grade-2">
        <Campo rotulo="Nome *" valor={f.nome} aoMudar={m('nome')} autoFocus />
        <Selecao
          rotulo="Tipo" valor={f.tipo_pessoa} aoMudar={m('tipo_pessoa')}
          opcoes={[{ valor: 'pf', rotulo: 'Pessoa física' }, { valor: 'pj', rotulo: 'Empresa' }]}
        />
        <Campo rotulo="Telefone" tipo="tel" valor={f.telefone} aoMudar={m('telefone')} />
        <Campo rotulo={f.tipo_pessoa === 'pj' ? 'CNPJ' : 'CPF'} valor={f.documento} aoMudar={m('documento')} />
        <Campo rotulo="E-mail" tipo="email" valor={f.email} aoMudar={m('email')} />
        <Campo rotulo="Endereço" valor={f.endereco} aoMudar={m('endereco')} />
      </div>
      <Campo rotulo="Observações" tipo="textarea" valor={f.observacoes} aoMudar={m('observacoes')} />

      {/* Só o nome é obrigatório, de propósito: cada campo exigido a mais
          é uma chance de o balcão desistir e voltar pro caderno. */}
      <p className="sutil" style={{ marginTop: -4 }}>Só o nome é obrigatório. O resto dá pra completar depois.</p>

      {podeEditar && (
        <div className="modal-acoes">
          {f.id && f.ativo !== false && (
            <button className="btn-fantasma" onClick={() => aoDesativar(f)} disabled={enviando}>
              Desativar
            </button>
          )}
          <button className="btn-primario" onClick={() => aoSalvar(f)} disabled={enviando || !f.nome}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </Modal>
  )
}

function FormVeiculo({ dados, aoFechar, aoSalvar, aoDesativar, enviando, podeEditar }) {
  const [f, setF] = useState(dados)
  const [clientes, setClientes] = useState([])
  const m = (campo) => (v) => setF({ ...f, [campo]: v })

  useEffect(() => { api('/clientes').then(setClientes).catch(() => {}) }, [])

  return (
    <Modal titulo={f.id ? f.placa : 'Novo veículo'} aoFechar={aoFechar}>
      <div className="grade grade-2">
        <Campo
          rotulo="Placa *" valor={f.placa} aoMudar={m('placa')} autoFocus
          autoCapitalize="characters" dica="Pode digitar com ou sem traço."
        />
        <Selecao
          rotulo="Dono *" valor={f.cliente_id} aoMudar={m('cliente_id')}
          vazio="Escolha o cliente..."
          opcoes={clientes.map((c) => ({ valor: c.id, rotulo: c.nome }))}
        />
        <Campo rotulo="Marca" valor={f.marca} aoMudar={m('marca')} />
        <Campo rotulo="Modelo" valor={f.modelo} aoMudar={m('modelo')} />
        <Campo rotulo="Ano" tipo="number" valor={f.ano} aoMudar={m('ano')} />
        <Campo rotulo="Cor" valor={f.cor} aoMudar={m('cor')} />
        <Campo rotulo="KM atual" tipo="number" valor={f.km_atual} aoMudar={m('km_atual')} />
        <Campo rotulo="Motorização" valor={f.motorizacao} aoMudar={m('motorizacao')} dica="Ex.: 1.0 flex" />
      </div>
      <Campo rotulo="Chassi" valor={f.chassi} aoMudar={m('chassi')} />
      <Campo rotulo="Observações" tipo="textarea" valor={f.observacoes} aoMudar={m('observacoes')} />

      {podeEditar && (
        <div className="modal-acoes">
          {f.id && f.ativo !== false && (
            <button className="btn-fantasma" onClick={() => aoDesativar(f)} disabled={enviando}>
              Desativar
            </button>
          )}
          <button
            className="btn-primario"
            onClick={() => aoSalvar(f)}
            disabled={enviando || !f.placa || !f.cliente_id}
          >
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </Modal>
  )
}
