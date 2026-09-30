import { useEffect, useState, useCallback } from 'react'
import { api, dinheiro } from '../lib/api.js'
import { Campo, Modal, Busca, Vazio, Aviso, Cabecalho, useEnvio } from '../components/ui.jsx'
import { ExtratoProduto } from './ExtratoProduto.jsx'

const VAZIO = {
  sku: '', descricao: '', categoria: '',
  unidade_compra: 'un', unidade_uso: 'un', fator_conversao: 1,
  preco_venda: '', estoque_minimo: '',
}

// Atalhos para o caso que motivou o sistema: o balde de 20 L de óleo.
// Sem isso o balconista teria que entender "fator de conversão" para
// cadastrar o item mais comum da oficina.
const ATALHOS = [
  { rotulo: 'Balde 20 L → litro', compra: 'balde', uso: 'L', fator: 20 },
  { rotulo: 'Tambor 200 L → litro', compra: 'tambor', uso: 'L', fator: 200 },
  { rotulo: 'Galão 5 L → litro', compra: 'galão', uso: 'L', fator: 5 },
  { rotulo: 'Caixa 12 un → unidade', compra: 'caixa', uso: 'un', fator: 12 },
  { rotulo: 'Unidade (sem fracionar)', compra: 'un', uso: 'un', fator: 1 },
]

export function ProdutosPage({ podeEditar, papel, aoAbrirOs }) {
  const [busca, setBusca] = useState('')
  const [soMinimo, setSoMinimo] = useState(false)
  const [lista, setLista] = useState([])
  const [editando, setEditando] = useState(null)
  const [extrato, setExtrato] = useState(null)
  const { erro, ok, enviando, enviar, setErro } = useEnvio()
  const veCusto = papel !== 'mecanico'

  const carregar = useCallback(async () => {
    try {
      const p = new URLSearchParams()
      if (busca) p.set('busca', busca)
      if (soMinimo) p.set('abaixo_minimo', '1')
      setLista(await api(`/catalogo/produtos?${p}`))
    } catch (e) { setErro(e.message) }
  }, [busca, soMinimo, setErro])

  useEffect(() => {
    const t = setTimeout(carregar, 300)
    return () => clearTimeout(t)
  }, [carregar])

  async function salvar(d) {
    const r = await enviar(
      () => (d.id ? api(`/catalogo/produtos/${d.id}`, { metodo: 'PATCH', corpo: d })
                  : api('/catalogo/produtos', { metodo: 'POST', corpo: d })),
      d.id ? 'Alterado.' : 'Cadastrado.'
    )
    if (r) { setEditando(null); carregar() }
  }

  async function desativar(d) {
    const r = await enviar(() => api(`/catalogo/produtos/${d.id}`, { metodo: 'DELETE' }), 'Desativado.')
    if (r) { setEditando(null); carregar() }
  }

  return (
    <div>
      <Cabecalho
        titulo="Peças e insumos"
        acao={podeEditar ? '+ Produto' : null}
        aoAgir={() => setEditando({ ...VAZIO })}
      />

      <Aviso erro={erro} ok={ok} />
      <Busca valor={busca} aoMudar={setBusca} dica="Descrição, código ou categoria" />

      <label className="clicavel" style={{ display: 'flex', alignItems: 'center', gap: 9, textTransform: 'none', fontSize: 14, marginBottom: 14 }}>
        <input type="checkbox" checked={soMinimo} onChange={(e) => setSoMinimo(e.target.checked)} />
        Só o que está abaixo do mínimo
      </label>

      <div className="cartao">
        {lista.length === 0 ? (
          <Vazio>
            {soMinimo ? 'Nada abaixo do mínimo. ' : busca ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.'}
          </Vazio>
        ) : lista.map((p) => {
          // Saldo negativo e "no mínimo" são problemas diferentes: o
          // primeiro é compra não lançada, o segundo é hora de comprar.
          const negativo = Number(p.estoque_atual) < 0
          const abaixo = !negativo && Number(p.estoque_minimo) > 0
            && Number(p.estoque_atual) <= Number(p.estoque_minimo)
          return (
            <div className="linha-lista clicavel" key={p.id} onClick={() => setEditando(p)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.descricao}</div>
                <div className="sutil">
                  {[p.sku, p.categoria].filter(Boolean).join(' · ')}
                  {Number(p.fator_conversao) !== 1 && (
                    <> · 1 {p.unidade_compra} = {Number(p.fator_conversao)} {p.unidade_uso}</>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <div style={{ textAlign: 'right' }}>
                  <div className="num" style={{ fontWeight: 600 }}>{dinheiro(p.preco_venda)}</div>
                  <div
                    className="sutil num"
                    style={{ color: negativo ? 'var(--perigo)' : abaixo ? 'var(--alerta)' : undefined }}
                  >
                    {Number(p.estoque_atual)} {p.unidade_uso}{negativo ? ' ⚠' : abaixo ? ' ⚠' : ''}
                  </div>
                </div>
                {/* O extrato responde "por que o saldo é esse?". Botão
                    separado do corpo da linha: tocar na linha edita o
                    cadastro, tocar aqui conta a história. */}
                <button
                  className="btn-fantasma"
                  style={{ padding: '6px 10px', minHeight: 0, fontSize: 12 }}
                  onClick={(e) => { e.stopPropagation(); setExtrato(p.id) }}
                >
                  extrato
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {editando && (
        <FormProduto
          dados={editando} veCusto={veCusto} podeEditar={podeEditar} enviando={enviando}
          aoFechar={() => setEditando(null)} aoSalvar={salvar} aoDesativar={desativar}
        />
      )}
      {extrato && (
        <ExtratoProduto
          id={extrato} papel={papel}
          aoFechar={() => { setExtrato(null); carregar() }}
          aoAbrirOs={aoAbrirOs}
        />
      )}
    </div>
  )
}

function FormProduto({ dados, veCusto, podeEditar, enviando, aoFechar, aoSalvar, aoDesativar }) {
  const [f, setF] = useState(dados)
  const m = (campo) => (v) => setF({ ...f, [campo]: v })
  const fator = Number(f.fator_conversao) || 1
  const fraciona = fator !== 1

  // Margem na hora, enquanto digita. É o número que responde "vale a
  // pena?" — e ele tem que estar aqui, não num relatório mensal.
  const custo = Number(f.custo_medio) || 0
  const preco = Number(f.preco_venda) || 0
  const margem = preco > 0 ? ((preco - custo) / preco) * 100 : 0

  return (
    <Modal titulo={f.id ? f.descricao : 'Novo produto'} aoFechar={aoFechar}>
      <Campo rotulo="Descrição *" valor={f.descricao} aoMudar={m('descricao')} autoFocus />

      <div className="grade grade-2">
        <Campo rotulo="Código / SKU" valor={f.sku} aoMudar={m('sku')} />
        <Campo rotulo="Categoria" valor={f.categoria} aoMudar={m('categoria')} dica="Ex.: óleo, filtro, freio" />
      </div>

      <h3 style={{ marginTop: 14 }}>Como compra e como usa</h3>
      <p className="sutil" style={{ marginTop: 0 }}>
        Compra o balde, usa o litro. O sistema controla o estoque sempre na unidade de uso.
      </p>

      {!f.id && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
          {ATALHOS.map((a) => (
            <button
              key={a.rotulo} className="btn-fantasma"
              style={{ padding: '6px 11px', minHeight: 0, fontSize: 12.5 }}
              onClick={() => setF({ ...f, unidade_compra: a.compra, unidade_uso: a.uso, fator_conversao: a.fator })}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}

      <div className="grade grade-2">
        <Campo rotulo="Unidade de compra" valor={f.unidade_compra} aoMudar={m('unidade_compra')} />
        <Campo rotulo="Unidade de uso" valor={f.unidade_uso} aoMudar={m('unidade_uso')} />
      </div>
      <Campo
        rotulo="Quantos por embalagem" tipo="number" valor={f.fator_conversao}
        aoMudar={m('fator_conversao')}
        dica={fraciona
          ? `Comprando 3 ${f.unidade_compra}, entram ${(3 * fator).toLocaleString('pt-BR')} ${f.unidade_uso} no estoque.`
          : 'Deixe 1 quando compra e usa na mesma unidade.'}
      />

      <h3 style={{ marginTop: 14 }}>Preço</h3>
      <div className="grade grade-2">
        <Campo
          rotulo={`Preço de venda por ${f.unidade_uso || 'un'}`} tipo="number" step="0.01"
          valor={f.preco_venda} aoMudar={m('preco_venda')}
        />
        <Campo
          rotulo={`Estoque mínimo (${f.unidade_uso || 'un'})`} tipo="number" step="0.01"
          valor={f.estoque_minimo} aoMudar={m('estoque_minimo')} dica="Avisa quando cair até aqui."
        />
      </div>

      {veCusto && f.id && (
        <div className="cartao" style={{ background: 'var(--fundo-2)', padding: 14 }}>
          <div className="sutil">Custo médio atual · {dinheiro(custo)} por {f.unidade_uso}</div>
          <div className="numerao" style={{ fontSize: 22, color: margem >= 30 ? 'var(--ok)' : margem > 0 ? 'var(--alerta)' : 'var(--perigo)' }}>
            {margem.toFixed(1)}% de margem
          </div>
          <div className="sutil" style={{ marginTop: 6 }}>
            O custo médio não se digita aqui — ele se move sozinho a cada compra lançada.
          </div>
        </div>
      )}

      {!f.id && (
        <p className="sutil">
          O estoque começa em zero. A primeira quantidade entra pela tela de Compras, para o
          custo médio nascer com histórico.
        </p>
      )}

      {podeEditar && (
        <div className="modal-acoes">
          {f.id && f.ativo !== false && (
            <button className="btn-fantasma" onClick={() => aoDesativar(f)} disabled={enviando}>Desativar</button>
          )}
          <button className="btn-primario" onClick={() => aoSalvar(f)} disabled={enviando || !f.descricao}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </Modal>
  )
}
