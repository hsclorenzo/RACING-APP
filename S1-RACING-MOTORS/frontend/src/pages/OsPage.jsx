import { useEffect, useState, useCallback } from 'react'
import { api, dinheiro, dataBR } from '../lib/api.js'
import { Selecao, Modal, Busca, Vazio, Aviso, Cabecalho, useEnvio } from '../components/ui.jsx'

// ---------------------------------------------------------------------
// KANBAN da oficina. No celular vira uma coluna por vez (as colunas de
// verdade, lado a lado, não cabem em 375 px — e forçar rolagem
// horizontal num pátio movimentado é pedir para o cara errar de card).
// ---------------------------------------------------------------------
export function OsPage({ papel, aoAbrir }) {
  const [status, setStatus] = useState([])
  const [resumo, setResumo] = useState([])
  const [coluna, setColuna] = useState('')
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState([])
  const [nova, setNova] = useState(false)
  const { erro, ok, enviando, enviar, setErro } = useEnvio()
  const veMargem = papel !== 'mecanico'

  const carregar = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (coluna) p.set('status', coluna)
      if (busca) p.set('busca', busca)
      const [l, r] = await Promise.all([api(`/os?${p}`), api('/os/resumo')])
      setLista(l)
      setResumo(r)
    } catch (e) { setErro(e.message) }
  }, [coluna, busca, setErro])

  useEffect(() => { api('/os/status').then(setStatus).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t) }, [carregar])

  const contar = (s) => resumo.find((x) => x.status === s)?.quantidade || 0
  const somar = (s) => Number(resumo.find((x) => x.status === s)?.valor || 0)

  // Cancelado e faturado ficam fora das abas principais: são finais e
  // enchem a barra. Chega neles pelo filtro "Todas" ou pela busca.
  const colunas = status.filter((s) => !['cancelado', 'faturado'].includes(s.valor))

  return (
    <div>
      <Cabecalho
        titulo="Ordens de serviço"
        acao="+ Nova OS"
        aoAgir={() => setNova(true)}
      />

      <Aviso erro={erro} ok={ok} />

      <div className="abas">
        <button className={coluna === '' ? 'ativo' : ''} onClick={() => setColuna('')}>
          Todas
        </button>
        {colunas.map((s) => (
          <button key={s.valor} className={coluna === s.valor ? 'ativo' : ''} onClick={() => setColuna(s.valor)}>
            {s.rotulo}
            {contar(s.valor) > 0 && (
              <span className="num" style={{ marginLeft: 6, color: `var(--${s.cor})` }}>
                {contar(s.valor)}
              </span>
            )}
          </button>
        ))}
      </div>

      <Busca valor={busca} aoMudar={setBusca} dica="Placa, cliente ou número da OS" />

      {coluna && veMargem && contar(coluna) > 0 && (
        <p className="sutil" style={{ marginTop: -6 }}>
          {contar(coluna)} {contar(coluna) === 1 ? 'OS' : 'OSs'} · {dinheiro(somar(coluna))} em jogo
        </p>
      )}

      <div className="cartao">
        {lista.length === 0 ? (
          <Vazio>
            {busca ? 'Nenhuma OS encontrada.' : coluna ? 'Nada nesta etapa.' : 'Nenhuma OS ainda. Abra a primeira.'}
          </Vazio>
        ) : lista.map((o) => {
          const cor = status.find((s) => s.valor === o.status)?.cor || 'texto-3'
          const rotulo = status.find((s) => s.valor === o.status)?.rotulo || o.status
          const margem = Number(o.margem_percentual)
          return (
            <div className="linha-lista clicavel" key={o.id} onClick={() => aoAbrir(o.id)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
                  <strong className="num">#{o.numero}</strong>
                  <span className="num" style={{ fontWeight: 600 }}>{o.placa}</span>
                  <span className="etiqueta" style={{ color: `var(--${cor})`, borderColor: `var(--${cor})` }}>
                    {rotulo}
                  </span>
                </div>
                <div className="sutil" style={{ marginTop: 3 }}>
                  {o.cliente_nome} · {[o.marca, o.modelo].filter(Boolean).join(' ') || 'sem modelo'}
                </div>
                <div className="sutil">
                  {dataBR(String(o.data_abertura).slice(0, 10))} · {o.itens} {o.itens === 1 ? 'item' : 'itens'}
                  {o.fotos > 0 && ` · ${o.fotos} ${o.fotos === 1 ? 'foto' : 'fotos'}`}
                  {o.mecanico_nome && ` · ${o.mecanico_nome}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div className="num" style={{ fontWeight: 600 }}>{dinheiro(o.total_geral)}</div>
                {veMargem && Number(o.total_geral) > 0 && (
                  // Com item sem custo, a margem é palpite otimista, não
                  // resultado — então não sai em verde. O "?" convida a
                  // abrir a OS, onde a explicação inteira está.
                  <div
                    className="sutil num"
                    style={{ color: o.itens_sem_custo > 0 ? 'var(--texto-3)' : corDaMargem(margem) }}
                    title={o.itens_sem_custo > 0 ? 'Há item sem custo lançado — a margem está otimista' : ''}
                  >
                    {margem.toFixed(0)}% margem{o.itens_sem_custo > 0 ? ' ?' : ''}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {nova && (
        <FormNovaOs
          enviando={enviando}
          aoFechar={() => setNova(false)}
          aoCriar={async (dados) => {
            const r = await enviar(() => api('/os', { metodo: 'POST', corpo: dados }))
            if (r) { setNova(false); aoAbrir(r.id) }
          }}
        />
      )}
    </div>
  )
}

// Verde não é "bonito", é acima de 35%; amarelo aperta; vermelho é
// prejuízo. Os cortes são grosseiros de propósito — margem de oficina
// varia muito por serviço, e um número exato daria falsa precisão.
export function corDaMargem(m) {
  if (!(m > 0)) return 'var(--perigo)'
  if (m < 20) return 'var(--alerta)'
  if (m < 35) return 'var(--racing-amarelo)'
  return 'var(--ok)'
}

function FormNovaOs({ aoFechar, aoCriar, enviando }) {
  const [veiculos, setVeiculos] = useState([])
  const [mecanicos, setMecanicos] = useState([])
  const [busca, setBusca] = useState('')
  const [f, setF] = useState({ veiculo_id: '', km_entrada: '', descricao_problema: '', mecanico_id: '' })

  useEffect(() => {
    api(`/clientes/veiculos/lista?busca=${encodeURIComponent(busca)}`).then(setVeiculos).catch(() => {})
  }, [busca])
  // A lista de mecânicos só existe para admin; para o balcão a chamada
  // volta 403 e o campo simplesmente não aparece. Melhor que esconder um
  // campo quebrado.
  useEffect(() => { api('/auth/equipe').then(setMecanicos).catch(() => setMecanicos([])) }, [])

  const escolhido = veiculos.find((v) => v.id === f.veiculo_id)

  return (
    <Modal titulo="Nova ordem de serviço" aoFechar={aoFechar}>
      <div className="campo">
        <label>Buscar o carro</label>
        <input
          type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Placa, modelo ou dono" autoFocus
        />
      </div>

      <Selecao
        rotulo="Veículo *" valor={f.veiculo_id} aoMudar={(v) => setF({ ...f, veiculo_id: v })}
        vazio="Escolha..."
        opcoes={veiculos.map((v) => ({
          valor: v.id,
          rotulo: `${v.placa} · ${[v.marca, v.modelo].filter(Boolean).join(' ')} · ${v.cliente_nome}`,
        }))}
      />

      {escolhido && (
        <p className="sutil" style={{ marginTop: -8 }}>
          Dono: {escolhido.cliente_nome}
          {escolhido.cliente_telefone && ` · ${escolhido.cliente_telefone}`}
          {escolhido.km_atual && ` · último km: ${Number(escolhido.km_atual).toLocaleString('pt-BR')}`}
        </p>
      )}

      <div className="campo">
        <label>KM de entrada</label>
        <input
          type="number" value={f.km_entrada}
          onChange={(e) => setF({ ...f, km_entrada: e.target.value })}
          placeholder={escolhido && escolhido.km_atual ? String(escolhido.km_atual) : ''}
        />
        <div className="sutil" style={{ marginTop: 5 }}>Atualiza o cadastro do carro sozinho.</div>
      </div>

      <div className="campo">
        <label>O que o cliente reclamou</label>
        <textarea
          rows={3} value={f.descricao_problema}
          onChange={(e) => setF({ ...f, descricao_problema: e.target.value })}
          placeholder="Ex.: barulho na frente ao passar em lombada"
        />
      </div>

      {mecanicos.length > 0 && (
        <Selecao
          rotulo="Mecânico responsável" valor={f.mecanico_id}
          aoMudar={(v) => setF({ ...f, mecanico_id: v })}
          vazio="Definir depois"
          opcoes={mecanicos.filter((u) => u.papel === 'mecanico' || u.papel === 'admin')
            .map((u) => ({ valor: u.id, rotulo: u.nome }))}
        />
      )}

      <div className="modal-acoes">
        <button
          className="btn-primario"
          onClick={() => aoCriar({ ...f, mecanico_id: f.mecanico_id || null })}
          disabled={enviando || !f.veiculo_id}
        >
          {enviando ? 'Abrindo...' : 'Abrir OS'}
        </button>
      </div>
    </Modal>
  )
}
