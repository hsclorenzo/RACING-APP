import { useEffect, useState, useCallback } from 'react'
import { api, dinheiro, dataBR } from '../lib/api.js'
import { Campo, Selecao, Modal, Busca, Vazio, Aviso, Cabecalho, useEnvio } from '../components/ui.jsx'

// ---------------------------------------------------------------------
// Lançar a nota do fornecedor. É por aqui que peça entra no estoque COM
// custo — e é o que faz a margem da OS deixar de ser chute.
// ---------------------------------------------------------------------
export function ComprasPage({ aoVerProduto }) {
  const [lista, setLista] = useState([])
  const [busca, setBusca] = useState('')
  const [nova, setNova] = useState(false)
  const [vendo, setVendo] = useState(null)
  const [resumo, setResumo] = useState(null)
  const { erro, ok, enviando, enviar, setErro, setOk } = useEnvio()

  const carregar = useCallback(async () => {
    try {
      const [c, r] = await Promise.all([
        api(`/estoque/compras?busca=${encodeURIComponent(busca)}`),
        api('/estoque/resumo'),
      ])
      setLista(c)
      setResumo(r)
    } catch (e) { setErro(e.message) }
  }, [busca, setErro])

  useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t) }, [carregar])

  return (
    <div>
      <Cabecalho titulo="Compras" acao="+ Nota" aoAgir={() => setNova(true)} />
      <Aviso erro={erro} ok={ok} />

      {resumo && (
        <div className="cartao" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div className="sutil">Parado na prateleira</div>
              <div className="numerao" style={{ fontSize: 24 }}>{dinheiro(resumo.valor_parado)}</div>
              <div className="sutil">{resumo.produtos} produtos, a custo médio</div>
            </div>
            {resumo.em_alerta > 0 && (
              <div style={{ textAlign: 'right' }}>
                <div className="sutil">Precisam de atenção</div>
                <div className="numerao" style={{ fontSize: 24, color: 'var(--alerta)' }}>
                  {resumo.em_alerta}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Busca valor={busca} aoMudar={setBusca} dica="Número da nota ou fornecedor" />

      <div className="cartao">
        {lista.length === 0
          ? <Vazio>Nenhuma nota lançada. A primeira compra é o que dá custo real às peças.</Vazio>
          : lista.map((c) => (
            <div className="linha-lista clicavel" key={c.id} onClick={() => setVendo(c.id)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {c.numero_nota ? `NF ${c.numero_nota}` : 'Sem número'}
                </div>
                <div className="sutil">
                  {dataBR(c.data)} · {c.fornecedor_nome || 'sem fornecedor'} ·{' '}
                  {c.itens} {c.itens === 1 ? 'item' : 'itens'}
                </div>
              </div>
              <div className="num" style={{ fontWeight: 600, flexShrink: 0 }}>{dinheiro(c.valor_total)}</div>
            </div>
          ))}
      </div>

      {nova && (
        <FormCompra
          enviando={enviando}
          aoFechar={() => setNova(false)}
          aoSalvar={async (dados) => {
            const r = await enviar(() => api('/estoque/compras', { metodo: 'POST', corpo: dados }))
            if (r) {
              setNova(false)
              setOk(r.lancados.map((l) =>
                `${l.produto}: entraram ${l.entrou} ${l.unidade} a ${dinheiro(l.custo_unitario)}` +
                (l.custo_medio_antes !== l.custo_medio_depois
                  ? ` — custo médio foi de ${dinheiro(l.custo_medio_antes)} para ${dinheiro(l.custo_medio_depois)}`
                  : '')
              ).join(' · '))
              carregar()
            }
          }}
        />
      )}

      {vendo && (
        <DetalheCompra
          id={vendo} enviando={enviando}
          aoFechar={() => setVendo(null)}
          aoVerProduto={aoVerProduto}
          aoEstornar={async () => {
            const r = await enviar(() => api(`/estoque/compras/${vendo}`, { metodo: 'DELETE' }), 'Compra estornada.')
            if (r) { setVendo(null); carregar() }
          }}
        />
      )}
    </div>
  )
}

const LINHA_VAZIA = { produto_id: '', quantidade_compra: '', custo_total: '' }

function FormCompra({ aoFechar, aoSalvar, enviando }) {
  const [cabecalho, setCabecalho] = useState({
    fornecedor_id: '', numero_nota: '', data: new Date().toISOString().slice(0, 10), observacoes: '',
  })
  const [linhas, setLinhas] = useState([{ ...LINHA_VAZIA }])
  const [produtos, setProdutos] = useState([])
  const [fornecedores, setFornecedores] = useState([])

  useEffect(() => {
    api('/catalogo/produtos').then(setProdutos).catch(() => {})
    api('/catalogo/fornecedores').then(setFornecedores).catch(() => {})
  }, [])

  const mudar = (i, campo, valor) =>
    setLinhas(linhas.map((l, j) => (i === j ? { ...l, [campo]: valor } : l)))

  const total = linhas.reduce((s, l) => s + (Number(l.custo_total) || 0), 0)
  const validas = linhas.filter((l) => l.produto_id && Number(l.quantidade_compra) > 0)

  return (
    <Modal titulo="Lançar nota de compra" aoFechar={aoFechar}>
      <div className="grade grade-2">
        <Campo rotulo="Número da nota" valor={cabecalho.numero_nota}
               aoMudar={(v) => setCabecalho({ ...cabecalho, numero_nota: v })} autoFocus />
        <Campo rotulo="Data" tipo="date" valor={cabecalho.data}
               aoMudar={(v) => setCabecalho({ ...cabecalho, data: v })} />
      </div>
      <Selecao
        rotulo="Fornecedor" valor={cabecalho.fornecedor_id}
        aoMudar={(v) => setCabecalho({ ...cabecalho, fornecedor_id: v })}
        vazio="Sem fornecedor"
        opcoes={fornecedores.map((f) => ({ valor: f.id, rotulo: f.nome }))}
      />

      <h3 style={{ marginTop: 16 }}>Itens da nota</h3>
      <p className="sutil" style={{ marginTop: 0 }}>
        A quantidade é na <strong>unidade de compra</strong> — 3 baldes, não 60 litros. O sistema
        converte e calcula o custo do litro sozinho.
      </p>

      {linhas.map((l, i) => {
        const p = produtos.find((x) => x.id === l.produto_id)
        const fator = Number(p?.fator_conversao) || 1
        const emUso = (Number(l.quantidade_compra) || 0) * fator
        const custoUnit = emUso > 0 ? (Number(l.custo_total) || 0) / emUso : 0

        return (
          <div key={i} style={{ borderTop: i > 0 ? '1px solid var(--borda)' : 'none', paddingTop: i > 0 ? 12 : 0 }}>
            <Selecao
              rotulo={`Produto ${linhas.length > 1 ? i + 1 : ''}`} valor={l.produto_id}
              aoMudar={(v) => mudar(i, 'produto_id', v)} vazio="Escolha..."
              opcoes={produtos.map((x) => ({
                valor: x.id,
                rotulo: Number(x.fator_conversao) !== 1
                  ? `${x.descricao} (1 ${x.unidade_compra} = ${Number(x.fator_conversao)} ${x.unidade_uso})`
                  : x.descricao,
              }))}
            />
            <div className="grade grade-2">
              <Campo
                rotulo={`Quantidade${p ? ` (${p.unidade_compra})` : ''}`} tipo="number" step="0.01"
                valor={l.quantidade_compra} aoMudar={(v) => mudar(i, 'quantidade_compra', v)}
              />
              <Campo
                rotulo="Valor total da linha" tipo="number" step="0.01"
                valor={l.custo_total} aoMudar={(v) => mudar(i, 'custo_total', v)}
              />
            </div>
            {p && emUso > 0 && (
              // A conta aparece ANTES de salvar. É o momento em que o dono
              // descobre quanto custa o litro de verdade.
              <div className="cartao" style={{ background: 'var(--fundo-2)', padding: 12, marginBottom: 12 }}>
                <div className="sutil num">
                  Entram <strong>{emUso.toLocaleString('pt-BR')} {p.unidade_uso}</strong> no estoque
                  {custoUnit > 0 && <> · custo de <strong>{dinheiro(custoUnit)}</strong> por {p.unidade_uso}</>}
                </div>
              </div>
            )}
            {linhas.length > 1 && (
              <button className="btn-fantasma" style={{ padding: '5px 11px', minHeight: 0, fontSize: 12, marginBottom: 12 }}
                      onClick={() => setLinhas(linhas.filter((_, j) => j !== i))}>
                Remover linha
              </button>
            )}
          </div>
        )
      })}

      <button className="btn-fantasma btn-bloco" onClick={() => setLinhas([...linhas, { ...LINHA_VAZIA }])}>
        + Outro produto
      </button>

      <div style={{ borderTop: '1px solid var(--borda)', marginTop: 14, paddingTop: 12,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>Total da nota</strong>
        <span className="numerao" style={{ fontSize: 22 }}>{dinheiro(total)}</span>
      </div>

      <div className="modal-acoes">
        <button
          className="btn-primario"
          onClick={() => aoSalvar({ ...cabecalho, fornecedor_id: cabecalho.fornecedor_id || null, itens: validas })}
          disabled={enviando || validas.length === 0}
        >
          {enviando ? 'Lançando...' : 'Lançar e dar entrada'}
        </button>
      </div>
    </Modal>
  )
}

function DetalheCompra({ id, aoFechar, aoEstornar, aoVerProduto, enviando }) {
  const [compra, setCompra] = useState(null)
  const [confirmando, setConfirmando] = useState(false)

  useEffect(() => { api(`/estoque/compras/${id}`).then(setCompra).catch(() => {}) }, [id])
  if (!compra) return <Modal titulo="Compra" aoFechar={aoFechar}><p className="sutil">Carregando...</p></Modal>

  return (
    <Modal titulo={compra.numero_nota ? `NF ${compra.numero_nota}` : 'Compra'} aoFechar={aoFechar}>
      <p className="sutil" style={{ marginTop: 0 }}>
        {dataBR(compra.data)} · {compra.fornecedor_nome || 'sem fornecedor'}
      </p>

      {compra.itens.map((i) => (
        <div className="linha-lista" key={i.id}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }} className="clicavel"
                 onClick={() => { aoFechar(); aoVerProduto(i.produto_id) }}>
              {i.descricao}
            </div>
            {/* Quanto entrou na unidade de uso sai do próprio item: valor
                da linha ÷ custo por unidade. Assim a tela não precisa do
                fator de conversão de hoje, que pode ter mudado depois. */}
            <div className="sutil num">
              {Number(i.quantidade_compra)} {i.unidade_compra}
              {Number(i.custo_unitario_uso) > 0 && (
                <> → {(Number(i.custo_total) / Number(i.custo_unitario_uso)).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} {i.unidade_uso}</>
              )}
              {' · '}{dinheiro(i.custo_unitario_uso)} por {i.unidade_uso}
            </div>
          </div>
          <div className="num" style={{ fontWeight: 600 }}>{dinheiro(i.custo_total)}</div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <strong>Total</strong>
        <span className="num" style={{ fontWeight: 700 }}>{dinheiro(compra.valor_total)}</span>
      </div>

      {compra.observacoes && <p className="sutil">{compra.observacoes}</p>}

      <div className="modal-acoes">
        {confirmando ? (
          <>
            <button className="btn-fantasma" onClick={() => setConfirmando(false)}>Deixa pra lá</button>
            <button className="btn-primario" onClick={aoEstornar} disabled={enviando}>
              {enviando ? 'Estornando...' : 'Confirmar estorno'}
            </button>
          </>
        ) : (
          <button className="btn-fantasma" onClick={() => setConfirmando(true)}>Estornar nota</button>
        )}
      </div>
      {confirmando && (
        <p className="sutil">
          Devolve o saldo e o custo médio ao que eram antes desta nota. Só funciona se nada tiver
          acontecido com essas peças depois — custo médio não se desfaz pela metade.
        </p>
      )}
    </Modal>
  )
}
