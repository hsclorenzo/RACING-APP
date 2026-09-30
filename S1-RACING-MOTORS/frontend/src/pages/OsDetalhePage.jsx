import { useEffect, useState, useCallback, useRef } from 'react'
import { api, sessao, dinheiro, dataBR, percentual } from '../lib/api.js'
import { Campo, Selecao, Modal, Vazio, Aviso, useEnvio } from '../components/ui.jsx'
import { comprimirFoto } from '../lib/foto.js'
import { corDaMargem } from './OsPage.jsx'

const MOMENTOS = [
  { valor: 'entrada', rotulo: 'Entrada' },
  { valor: 'execucao', rotulo: 'Execução' },
  { valor: 'saida', rotulo: 'Saída' },
]

export function OsDetalhePage({ id, papel, aoVoltar }) {
  const [os, setOs] = useState(null)
  const [status, setStatus] = useState([])
  const [addItem, setAddItem] = useState(false)
  const [editando, setEditando] = useState(false)
  const { erro, ok, enviando, enviar, setErro, setOk } = useEnvio()
  const veMargem = papel !== 'mecanico'
  const podeDarDesconto = papel !== 'mecanico'

  const carregar = useCallback(async () => {
    try { setOs(await api(`/os/${id}`)) } catch (e) { setErro(e.message) }
  }, [id, setErro])

  useEffect(() => { carregar() }, [carregar])
  useEffect(() => { api('/os/status').then(setStatus).catch(() => {}) }, [])

  if (!os) {
    return (
      <div>
        <button className="btn-fantasma" onClick={aoVoltar}>← Voltar</button>
        {erro ? <div className="aviso aviso-erro" style={{ marginTop: 14 }}>{erro}</div>
              : <p className="sutil">Carregando...</p>}
      </div>
    )
  }

  const atual = status.find((s) => s.valor === os.status) || { rotulo: os.status, cor: 'texto-3' }
  const encerrada = ['faturado', 'cancelado', 'entregue'].includes(os.status)
  const margem = Number(os.margem_percentual)

  async function mudarStatus(novo) {
    const r = await enviar(() => api(`/os/${id}/status`, { metodo: 'POST', corpo: { status: novo } }))
    if (r) { setOk(''); carregar() }
  }
  async function apagarItem(item) {
    const r = await enviar(() => api(`/os/itens/${item.id}`, { metodo: 'DELETE' }))
    if (r) carregar()
  }

  return (
    <div>
      {/* A barra de ações some na impressão: o orçamento em papel não tem
          botão. Ver o bloco @media print no fim deste arquivo. */}
      <div className="sem-impressao">
        <button className="btn-fantasma" onClick={aoVoltar} style={{ marginBottom: 14 }}>← Ordens de serviço</button>
        <Aviso erro={erro} ok={ok} />
      </div>

      {/* Cabeçalho que SÓ existe no papel. Na tela seria repetição da
          barra de cima; no orçamento entregue ao cliente, é o que diz de
          qual oficina veio o papel. */}
      <div className="so-impressao" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>RACING MOTORS</div>
            <div style={{ fontSize: 12, letterSpacing: '0.1em' }}>ORÇAMENTO DE SERVIÇO</div>
          </div>
          <div style={{ fontSize: 12, textAlign: 'right' }}>
            <div>OS nº {os.numero}</div>
            <div>{dataBR(String(os.data_abertura).slice(0, 10))}</div>
          </div>
        </div>
        <hr />
      </div>

      <div className="cartao" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: 0 }} className="num">OS #{os.numero}</h1>
            <p className="sutil" style={{ margin: '4px 0 0' }}>
              Aberta em {dataBR(String(os.data_abertura).slice(0, 10))}
              {os.mecanico_nome && ` · ${os.mecanico_nome}`}
            </p>
          </div>
          <span className="etiqueta" style={{ color: `var(--${atual.cor})`, borderColor: `var(--${atual.cor})`, fontSize: 13 }}>
            {atual.rotulo}
          </span>
        </div>

        <div style={{ borderTop: '1px solid var(--borda)', marginTop: 14, paddingTop: 14 }}>
          <div className="num" style={{ fontSize: 19, fontWeight: 700 }}>{os.placa}</div>
          <div className="sutil">
            {[os.marca, os.modelo, os.ano].filter(Boolean).join(' ')}
            {os.cor && ` · ${os.cor}`}
            {os.km_entrada && ` · ${Number(os.km_entrada).toLocaleString('pt-BR')} km`}
          </div>
          <div className="sutil" style={{ marginTop: 6 }}>
            {os.cliente_nome}{os.cliente_telefone && ` · ${os.cliente_telefone}`}
          </div>
        </div>

        {os.descricao_problema && (
          <div style={{ marginTop: 14 }}>
            <label>Reclamação do cliente</label>
            <div>{os.descricao_problema}</div>
          </div>
        )}
        {os.diagnostico && (
          <div style={{ marginTop: 12 }}>
            <label>Diagnóstico</label>
            <div>{os.diagnostico}</div>
          </div>
        )}
      </div>

      <AcoesStatus
        os={os} status={status} enviando={enviando}
        aoMudar={mudarStatus} aoEditar={() => setEditando(true)}
      />

      {/* ------------------------------------------------------------ */}
      {/* ITENS                                                        */}
      {/* ------------------------------------------------------------ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
        <h2 style={{ margin: 0 }}>Itens</h2>
        {!encerrada && (
          <button className="btn-primario sem-impressao" onClick={() => setAddItem(true)}>+ Item</button>
        )}
      </div>

      <div className="cartao">
        {os.itens.length === 0
          ? <Vazio>Nada lançado ainda. Comece pelo serviço.</Vazio>
          : os.itens.map((i) => (
            <div className="linha-lista" key={i.id}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{i.descricao_livre}</div>
                <div className="sutil num">
                  {Number(i.quantidade)} × {dinheiro(i.preco_unitario)}
                  {/* O custo é dado interno. Sem este `sem-impressao`, ele
                      sai no orçamento que vai para a mão do cliente — que
                      passa a saber exatamente quanto a oficina ganha em
                      cada peça. */}
                  <span className="sem-impressao">
                    {veMargem && Number(i.custo_unitario) > 0 &&
                      ` · custo ${dinheiro(i.custo_unitario)}`}
                    {veMargem && Number(i.custo_unitario) === 0 && Number(i.total) > 0 &&
                      ' · sem custo lançado'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <div className="num" style={{ fontWeight: 600 }}>{dinheiro(i.total)}</div>
                {!encerrada && (
                  <button
                    className="btn-fantasma sem-impressao"
                    style={{ padding: '5px 10px', minHeight: 0, fontSize: 12 }}
                    onClick={() => apagarItem(i)} disabled={enviando}
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>

      {/* ------------------------------------------------------------ */}
      {/* TOTAIS E MARGEM AO VIVO                                      */}
      {/* ------------------------------------------------------------ */}
      <div className="cartao" style={{ marginTop: 14 }}>
        <Linha rotulo="Serviços" valor={os.total_servicos} />
        <Linha rotulo="Peças" valor={os.total_pecas} />
        {Number(os.desconto) > 0 && <Linha rotulo="Desconto" valor={-Number(os.desconto)} />}
        <div style={{ borderTop: '1px solid var(--borda)', marginTop: 8, paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong>Total</strong>
            <span className="numerao" style={{ fontSize: 26 }}>{dinheiro(os.total_geral)}</span>
          </div>
        </div>

        {veMargem && Number(os.total_geral) > 0 && (
          <div style={{ borderTop: '1px solid var(--borda)', marginTop: 12, paddingTop: 12 }} className="sem-impressao">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
              <div>
                <div className="sutil">Custo</div>
                <div className="num" style={{ fontWeight: 600 }}>{dinheiro(os.custo_total)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="sutil">Esta OS deixa</div>
                <div className="numerao" style={{ fontSize: 24, color: corDaMargem(margem) }}>
                  {dinheiro(os.margem_valor)}
                </div>
                <div className="sutil num" style={{ color: corDaMargem(margem) }}>
                  {percentual(margem, 1)} de margem
                </div>
              </div>
            </div>

            {/* Sem este aviso, uma OS de peças sem histórico de compra
                mostra margem altíssima com cara de certeza — e o dono
                toma decisão de preço em cima de um número que é
                ignorância, não lucro. */}
            {os.itens_sem_custo > 0 && (
              <div className="aviso aviso-erro" style={{ marginTop: 12, marginBottom: 0 }}>
                {os.itens_sem_custo === 1 ? 'Um item entrou' : `${os.itens_sem_custo} itens entraram`} sem
                custo. Esta margem está otimista — o custo médio só aparece depois que a peça
                for lançada numa compra.
              </div>
            )}
          </div>
        )}

        {podeDarDesconto && !encerrada && (
          <div className="sem-impressao" style={{ marginTop: 14 }}>
            <Desconto
              valor={os.desconto} enviando={enviando}
              aoSalvar={async (d) => {
                const r = await enviar(() => api(`/os/${id}`, { metodo: 'PATCH', corpo: { desconto: d } }))
                if (r) carregar()
              }}
            />
          </div>
        )}
      </div>

      <Fotos os={os} id={id} papel={papel} aoMudar={carregar} setErro={setErro} />

      <div className="sem-impressao" style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
        <button className="btn-secundario" onClick={() => window.print()}>Imprimir orçamento</button>
      </div>

      {addItem && (
        <FormItem
          osId={id} papel={papel} aoFechar={() => setAddItem(false)}
          aoSalvo={() => { setAddItem(false); carregar() }}
        />
      )}
      {editando && (
        <FormCabecalho
          os={os} aoFechar={() => setEditando(false)}
          aoSalvo={() => { setEditando(false); carregar() }}
        />
      )}

      <ImpressaoCss />
    </div>
  )
}

function Linha({ rotulo, valor }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span className="sutil">{rotulo}</span>
      <span className="num">{dinheiro(valor)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------
// Só os próximos passos LEGÍTIMOS aparecem. Botão que existe para dar
// erro é pior que botão que não existe: o balcão aperta, leva "não pode"
// e perde a confiança na tela.
// ---------------------------------------------------------------------
function AcoesStatus({ os, status, enviando, aoMudar, aoEditar }) {
  const TRANSICOES = {
    orcamento: ['aprovado', 'cancelado'],
    aprovado: ['em_execucao', 'orcamento', 'cancelado'],
    em_execucao: ['pronto', 'aprovado', 'cancelado'],
    pronto: ['entregue', 'em_execucao', 'cancelado'],
    entregue: ['faturado', 'pronto'],
    faturado: [],
    cancelado: ['orcamento'],
  }
  const proximos = TRANSICOES[os.status] || []
  const rotulo = (v) => status.find((s) => s.valor === v)?.rotulo || v
  // O primeiro é o caminho normal e ganha destaque; os outros são
  // "voltar" e "cancelar", que devem existir sem convidar.
  const [principal, ...outros] = proximos

  return (
    <div className="sem-impressao" style={{ display: 'flex', gap: 9, flexWrap: 'wrap' }}>
      {principal && (
        <button className="btn-primario" onClick={() => aoMudar(principal)} disabled={enviando}>
          {principal === 'cancelado' ? 'Cancelar OS' : `Marcar como ${rotulo(principal).toLowerCase()}`}
        </button>
      )}
      {outros.map((p) => (
        <button key={p} className="btn-fantasma" onClick={() => aoMudar(p)} disabled={enviando}>
          {p === 'cancelado' ? 'Cancelar' : `Voltar para ${rotulo(p).toLowerCase()}`}
        </button>
      ))}
      {!['faturado', 'cancelado'].includes(os.status) && (
        <button className="btn-fantasma" onClick={aoEditar}>Editar dados</button>
      )}
    </div>
  )
}

function Desconto({ valor, aoSalvar, enviando }) {
  const [v, setV] = useState(String(Number(valor) || ''))
  useEffect(() => { setV(String(Number(valor) || '')) }, [valor])
  const mudou = Number(v || 0) !== Number(valor || 0)

  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-end' }}>
      <div className="campo" style={{ flex: 1, marginBottom: 0 }}>
        <label>Desconto R$</label>
        <input type="number" step="0.01" value={v} onChange={(e) => setV(e.target.value)} placeholder="0,00" />
      </div>
      <button
        className="btn-secundario" onClick={() => aoSalvar(Number(v || 0))}
        disabled={enviando || !mudou}
      >
        Aplicar
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------
// Lançar item. Três caminhos: serviço do catálogo, peça do catálogo, ou
// digitado na mão — porque a peça que veio da esquina não está cadastrada
// e a alternativa a deixar digitar é o balcão anotar no papel.
// ---------------------------------------------------------------------
function FormItem({ osId, papel, aoFechar, aoSalvo }) {
  const [modo, setModo] = useState('servico')
  const [catalogo, setCatalogo] = useState([])
  const [busca, setBusca] = useState('')
  const [f, setF] = useState({ id: '', quantidade: '', preco_unitario: '', descricao_livre: '', custo_unitario: '' })
  const { erro, enviando, enviar, setErro } = useEnvio()
  const veCusto = papel !== 'mecanico'

  useEffect(() => {
    if (modo === 'livre') return
    const rota = modo === 'servico' ? '/catalogo/servicos' : '/catalogo/produtos'
    api(`${rota}?busca=${encodeURIComponent(busca)}`).then(setCatalogo).catch(() => setCatalogo([]))
  }, [modo, busca])

  const escolhido = catalogo.find((x) => x.id === f.id)

  async function salvar() {
    const corpo = modo === 'livre'
      ? {
          tipo: f.tipoLivre === 'peca' ? 'peca' : 'servico',
          descricao_livre: f.descricao_livre,
          quantidade: f.quantidade || 1,
          preco_unitario: f.preco_unitario || 0,
          custo_unitario: veCusto ? (f.custo_unitario || 0) : 0,
        }
      : {
          [modo === 'servico' ? 'servico_id' : 'produto_id']: f.id,
          quantidade: f.quantidade === '' ? undefined : f.quantidade,
          preco_unitario: f.preco_unitario === '' ? undefined : f.preco_unitario,
        }
    const r = await enviar(() => api(`/os/${osId}/itens`, { metodo: 'POST', corpo }))
    if (r) aoSalvo()
  }

  const pronto = modo === 'livre'
    ? Boolean(f.descricao_livre && Number(f.preco_unitario) >= 0)
    : Boolean(f.id)

  return (
    <Modal titulo="Lançar item" aoFechar={aoFechar}>
      {erro && <div className="aviso aviso-erro">{erro}</div>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['servico', 'Serviço'], ['peca', 'Peça'], ['livre', 'Digitar']].map(([v, r]) => (
          <button
            key={v} style={{ flex: 1 }}
            className={modo === v ? 'btn-primario' : 'btn-fantasma'}
            onClick={() => { setModo(v); setF({ id: '', quantidade: '', preco_unitario: '', descricao_livre: '', custo_unitario: '' }) }}
          >
            {r}
          </button>
        ))}
      </div>

      {modo === 'livre' ? (
        <>
          <Selecao
            rotulo="É serviço ou peça?" valor={f.tipoLivre || 'peca'}
            aoMudar={(v) => setF({ ...f, tipoLivre: v })}
            opcoes={[{ valor: 'peca', rotulo: 'Peça' }, { valor: 'servico', rotulo: 'Serviço' }]}
          />
          <Campo rotulo="Descrição *" valor={f.descricao_livre} aoMudar={(v) => setF({ ...f, descricao_livre: v })} autoFocus />
          <div className="grade grade-2">
            <Campo rotulo="Quantidade" tipo="number" step="0.01" valor={f.quantidade} aoMudar={(v) => setF({ ...f, quantidade: v })} placeholder="1" />
            <Campo rotulo="Preço unitário *" tipo="number" step="0.01" valor={f.preco_unitario} aoMudar={(v) => setF({ ...f, preco_unitario: v })} />
          </div>
          {veCusto && (
            <Campo
              rotulo="Custo unitário" tipo="number" step="0.01"
              valor={f.custo_unitario} aoMudar={(v) => setF({ ...f, custo_unitario: v })}
              dica="Quanto essa peça custou pra oficina. Sem isso a margem da OS fica otimista."
            />
          )}
        </>
      ) : (
        <>
          <div className="campo">
            <label>Buscar</label>
            <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus
                   placeholder={modo === 'servico' ? 'Nome do serviço' : 'Descrição ou código'} />
          </div>
          <Selecao
            rotulo={modo === 'servico' ? 'Serviço' : 'Peça'} valor={f.id}
            aoMudar={(v) => setF({ ...f, id: v, quantidade: '', preco_unitario: '' })}
            vazio="Escolha..."
            opcoes={catalogo.map((x) => ({
              valor: x.id,
              rotulo: `${x.descricao} — ${dinheiro(modo === 'servico' ? x.valor_sugerido : x.preco_venda)}`,
            }))}
          />
          {escolhido && (
            <div className="grade grade-2">
              <Campo
                rotulo={modo === 'servico' && escolhido.valor_fixo == null ? 'Horas' : 'Quantidade'}
                tipo="number" step="0.01" valor={f.quantidade}
                aoMudar={(v) => setF({ ...f, quantidade: v })}
                placeholder={modo === 'servico'
                  ? String(escolhido.valor_fixo != null ? 1 : Number(escolhido.tempo_padrao_horas || 1))
                  : '1'}
              />
              <Campo
                rotulo="Preço unitário" tipo="number" step="0.01" valor={f.preco_unitario}
                aoMudar={(v) => setF({ ...f, preco_unitario: v })}
                placeholder={String(modo === 'servico'
                  ? (escolhido.valor_fixo ?? escolhido.valor_hora ?? 0)
                  : escolhido.preco_venda)}
                dica="Em branco usa o do catálogo."
              />
            </div>
          )}
        </>
      )}

      <div className="modal-acoes">
        <button className="btn-primario" onClick={salvar} disabled={enviando || !pronto}>
          {enviando ? 'Lançando...' : 'Lançar'}
        </button>
      </div>
    </Modal>
  )
}

function FormCabecalho({ os, aoFechar, aoSalvo }) {
  const [f, setF] = useState({
    diagnostico: os.diagnostico || '',
    descricao_problema: os.descricao_problema || '',
    km_entrada: os.km_entrada || '',
    observacoes: os.observacoes || '',
  })
  const { erro, enviando, enviar } = useEnvio()

  return (
    <Modal titulo={`OS #${os.numero}`} aoFechar={aoFechar}>
      {erro && <div className="aviso aviso-erro">{erro}</div>}
      <Campo rotulo="Reclamação do cliente" tipo="textarea" valor={f.descricao_problema}
             aoMudar={(v) => setF({ ...f, descricao_problema: v })} />
      <Campo rotulo="Diagnóstico" tipo="textarea" valor={f.diagnostico}
             aoMudar={(v) => setF({ ...f, diagnostico: v })}
             dica="O que a oficina achou de verdade. Sai no orçamento impresso." />
      <Campo rotulo="KM de entrada" tipo="number" valor={f.km_entrada}
             aoMudar={(v) => setF({ ...f, km_entrada: v })} />
      <Campo rotulo="Observações internas" tipo="textarea" valor={f.observacoes}
             aoMudar={(v) => setF({ ...f, observacoes: v })} />
      <div className="modal-acoes">
        <button
          className="btn-primario"
          onClick={async () => {
            const r = await enviar(() => api(`/os/${os.id}`, { metodo: 'PATCH', corpo: f }))
            if (r) aoSalvo()
          }}
          disabled={enviando}
        >
          {enviando ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------
// FOTOS — o que elimina discussão de avaria pré-existente com o cliente,
// e a razão pela qual o mecânico quer usar o sistema.
// ---------------------------------------------------------------------
function Fotos({ os, id, papel, aoMudar, setErro }) {
  const [momento, setMomento] = useState('entrada')
  const [subindo, setSubindo] = useState(false)
  const entrada = useRef(null)
  const podeApagar = papel !== 'mecanico'

  async function escolher(e) {
    const arquivos = [...e.target.files]
    e.target.value = ''
    if (arquivos.length === 0) return
    setSubindo(true)
    try {
      for (const arquivo of arquivos) {
        const { dados } = await comprimirFoto(arquivo)
        await api(`/os/${id}/fotos`, { metodo: 'POST', corpo: { arquivo: dados, momento } })
      }
      aoMudar()
    } catch (err) {
      setErro(err.message)
    } finally {
      setSubindo(false)
    }
  }

  // A rota da foto exige o token, então a tag <img> não pode apontar
  // direto pra ela. O token vai na query string desta URL interna? Não:
  // isso o deixaria no histórico do navegador. Em vez disso, a foto é
  // baixada com o cabeçalho certo e virada em blob local.
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Fotos</h2>
        <div className="sem-impressao" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={momento} onChange={(e) => setMomento(e.target.value)} style={{ width: 'auto' }}>
            {MOMENTOS.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
          </select>
          <button className="btn-primario" onClick={() => entrada.current.click()} disabled={subindo}>
            {subindo ? 'Enviando...' : '+ Foto'}
          </button>
        </div>
      </div>

      <input
        ref={entrada} type="file" accept="image/*" capture="environment" multiple
        onChange={escolher} style={{ display: 'none' }}
      />

      <div className="cartao">
        {os.fotos.length === 0 ? (
          <Vazio>
            Sem foto ainda. A foto de entrada é o que evita discussão de risco que já existia.
          </Vazio>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }}>
            {os.fotos.map((f) => (
              <FotoCartao key={f.id} foto={f} podeApagar={podeApagar} aoApagar={async () => {
                await api(`/os/fotos/${f.id}`, { metodo: 'DELETE' })
                aoMudar()
              }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FotoCartao({ foto, podeApagar, aoApagar }) {
  const [url, setUrl] = useState(null)

  useEffect(() => {
    let vivo = true
    let criada = null
    fetch(`/api/os/fotos/${foto.id}`, { headers: { Authorization: `Bearer ${sessao.token()}` } })
      .then((r) => r.blob())
      .then((b) => {
        if (!vivo) return
        criada = URL.createObjectURL(b)
        setUrl(criada)
      })
      .catch(() => {})
    // Sem o revoke, cada abertura da OS deixa um blob preso na memória
    // do navegador — 6 fotos por OS, o dia inteiro, e o celular trava.
    return () => { vivo = false; if (criada) URL.revokeObjectURL(criada) }
  }, [foto.id])

  const rotulo = MOMENTOS.find((m) => m.valor === foto.momento)?.rotulo || foto.momento

  return (
    <div style={{ position: 'relative' }}>
      {url
        ? <img src={url} alt={foto.legenda || rotulo}
               style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: 'var(--raio)', display: 'block' }} />
        : <div style={{ width: '100%', aspectRatio: '4/3', background: 'var(--fundo-2)', borderRadius: 'var(--raio)' }} />}
      <span className="etiqueta" style={{ position: 'absolute', left: 6, top: 6, background: 'rgba(0,0,0,0.7)' }}>
        {rotulo}
      </span>
      {podeApagar && (
        <button
          className="btn-fantasma sem-impressao"
          style={{ position: 'absolute', right: 6, top: 6, padding: '3px 8px', minHeight: 0, fontSize: 11, background: 'rgba(0,0,0,0.7)' }}
          onClick={aoApagar}
        >
          ✕
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------
// O "orçamento em PDF" é o Imprimir do próprio navegador, com CSS de
// impressão. Sem biblioteca de PDF: o navegador já sabe gerar PDF, e no
// celular o botão Compartilhar manda direto pro WhatsApp do cliente —
// que é como a oficina realmente envia orçamento.
// ---------------------------------------------------------------------
function ImpressaoCss() {
  return (
    <style>{`
      .so-impressao { display: none; }
      @media print {
        .sem-impressao, .barra, .topo { display: none !important; }
        .so-impressao { display: block !important; }
        /* A foto de entrada é o que resolve discussão de avaria, então
           ela SAI no papel — mas em tamanho de comprovante, não de
           pôster, senão o orçamento vira 4 páginas. */
        .so-impressao hr { border: none; border-top: 2px solid #000; margin-top: 8px; }
        img { max-width: 150px !important; }
        /* Papel é branco. Imprimir o tema escuro gasta o cartucho inteiro
           e sai ilegível. */
        :root { color-scheme: light; }
        body, .cartao { background: #fff !important; color: #000 !important; }
        .cartao { border: 1px solid #ccc !important; break-inside: avoid; }
        .sutil, label { color: #444 !important; }
        .conteudo { padding: 0 !important; max-width: none !important; }
        .numerao { color: #000 !important; }
        a { color: #000 !important; }
      }
    `}</style>
  )
}
