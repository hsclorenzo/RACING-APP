import { useEffect, useState, useCallback } from 'react'
import { api, dinheiro, dataBR } from '../lib/api.js'
import { Campo, Modal, Vazio, Aviso, useEnvio } from '../components/ui.jsx'

const TIPO = {
  entrada: { rotulo: 'Entrada', cor: 'ok', sinal: '+' },
  saida: { rotulo: 'Saída', cor: 'perigo', sinal: '−' },
  estorno: { rotulo: 'Devolução', cor: 'info', sinal: '+' },
  ajuste: { rotulo: 'Ajuste', cor: 'alerta', sinal: '+' },
}

// ---------------------------------------------------------------------
// O extrato responde "por que o saldo é esse?" — que é a pergunta que a
// planilha nunca respondeu. Cada linha diz de onde veio, quem lançou e
// quanto o saldo ficou depois.
// ---------------------------------------------------------------------
export function ExtratoProduto({ id, papel, aoFechar, aoAbrirOs }) {
  const [dados, setDados] = useState(null)
  const [ajustando, setAjustando] = useState(false)
  const { erro, ok, enviando, enviar, setErro, setOk } = useEnvio()
  const veCusto = papel !== 'mecanico'
  const podeAjustar = papel !== 'mecanico'

  const carregar = useCallback(async () => {
    try { setDados(await api(`/estoque/produto/${id}`)) } catch (e) { setErro(e.message) }
  }, [id, setErro])
  useEffect(() => { carregar() }, [carregar])

  if (!dados) {
    return <Modal titulo="Extrato" aoFechar={aoFechar}><p className="sutil">Carregando...</p></Modal>
  }

  const p = dados.produto
  const saldo = Number(p.estoque_atual)
  const minimo = Number(p.estoque_minimo)
  const abaixo = minimo > 0 && saldo <= minimo

  return (
    <Modal titulo={p.descricao} aoFechar={aoFechar}>
      <Aviso erro={erro} ok={ok} />

      <div className="cartao" style={{ background: 'var(--fundo-2)', marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div>
            <div className="sutil">Em estoque</div>
            <div className="numerao" style={{ color: saldo < 0 ? 'var(--perigo)' : abaixo ? 'var(--alerta)' : 'var(--texto)' }}>
              {saldo.toLocaleString('pt-BR')} <span style={{ fontSize: 16 }}>{p.unidade_uso}</span>
            </div>
            {minimo > 0 && <div className="sutil num">mínimo: {minimo.toLocaleString('pt-BR')}</div>}
          </div>
          {veCusto && (
            <div style={{ textAlign: 'right' }}>
              <div className="sutil">Custo médio</div>
              <div className="num" style={{ fontSize: 18, fontWeight: 600 }}>{dinheiro(p.custo_medio)}</div>
              <div className="sutil">venda: {dinheiro(p.preco_venda)}</div>
            </div>
          )}
        </div>

        {/* Saldo negativo não é "acabou": é compra que ninguém lançou. */}
        {saldo < 0 && (
          <div className="aviso aviso-erro" style={{ marginTop: 12, marginBottom: 0 }}>
            Saldo negativo. Isso quase sempre quer dizer que uma compra não foi lançada — a peça
            saiu do sistema sem nunca ter entrado.
          </div>
        )}
        {saldo >= 0 && abaixo && (
          <div className="aviso" style={{ marginTop: 12, marginBottom: 0, borderColor: 'rgba(245,166,35,0.4)', background: 'rgba(245,166,35,0.1)', color: 'var(--alerta)' }}>
            No mínimo ou abaixo. Hora de comprar.
          </div>
        )}
      </div>

      {podeAjustar && (
        <button className="btn-fantasma btn-bloco" style={{ marginBottom: 14 }} onClick={() => setAjustando(true)}>
          Conferi a prateleira e não bate
        </button>
      )}

      <h3>Extrato</h3>
      <div className="cartao">
        {dados.movimentos.length === 0
          ? <Vazio>Nada movimentou ainda.</Vazio>
          : dados.movimentos.map((m) => {
            const t = TIPO[m.tipo] || { rotulo: m.tipo, cor: 'texto-3', sinal: '' }
            return (
              <div className="linha-lista" key={m.id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="etiqueta" style={{ color: `var(--${t.cor})`, borderColor: `var(--${t.cor})` }}>
                      {t.rotulo}
                    </span>
                    {m.os_numero && (
                      <span className="num clicavel" style={{ color: 'var(--info)' }}
                            onClick={() => { aoFechar(); aoAbrirOs(m.os_id) }}>
                        OS #{m.os_numero}
                      </span>
                    )}
                    {m.numero_nota && <span className="num sutil">NF {m.numero_nota}</span>}
                  </div>
                  <div className="sutil" style={{ marginTop: 3 }}>
                    {m.motivo || '—'}
                    {m.usuario_nome && ` · ${m.usuario_nome}`}
                  </div>
                  <div className="sutil num">
                    {dataBR(String(m.criado_em).slice(0, 10))}
                    {veCusto && Number(m.custo_unitario) > 0 && ` · ${dinheiro(m.custo_unitario)} / ${p.unidade_uso}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div className="num" style={{ fontWeight: 600, color: `var(--${t.cor})` }}>
                    {t.sinal}{Number(m.quantidade).toLocaleString('pt-BR')}
                  </div>
                  <div className="sutil num">ficou {Number(m.estoque_depois).toLocaleString('pt-BR')}</div>
                </div>
              </div>
            )
          })}
      </div>

      {ajustando && (
        <FormAjuste
          produto={p} enviando={enviando}
          aoFechar={() => setAjustando(false)}
          aoSalvar={async (corpo) => {
            const r = await enviar(() => api('/estoque/ajuste', { metodo: 'POST', corpo: { ...corpo, produto_id: id } }))
            if (r) {
              setAjustando(false)
              setOk(r.sem_diferenca
                ? 'A contagem bate com o sistema. Nada mudou.'
                : `Diferença de ${r.diferenca > 0 ? '+' : ''}${r.diferenca} ${p.unidade_uso} registrada.`)
              carregar()
            }
          }}
        />
      )}
    </Modal>
  )
}

function FormAjuste({ produto, aoFechar, aoSalvar, enviando }) {
  const [contado, setContado] = useState('')
  const [motivo, setMotivo] = useState('')
  const atual = Number(produto.estoque_atual)
  const diferenca = contado === '' ? null : Number(contado) - atual

  return (
    <Modal titulo="Ajuste de estoque" aoFechar={aoFechar}>
      <p className="sutil" style={{ marginTop: 0 }}>
        O sistema diz <strong className="num">{atual.toLocaleString('pt-BR')} {produto.unidade_uso}</strong>.
        Quanto tem de verdade na prateleira?
      </p>

      <Campo
        rotulo={`Quantidade contada (${produto.unidade_uso})`} tipo="number" step="0.01"
        valor={contado} aoMudar={setContado} autoFocus
      />

      {diferenca !== null && diferenca !== 0 && (
        <div className="cartao" style={{ background: 'var(--fundo-2)', padding: 12, marginBottom: 14 }}>
          <div className="num" style={{ color: diferenca > 0 ? 'var(--ok)' : 'var(--perigo)', fontWeight: 600 }}>
            {diferenca > 0 ? 'Sobrando' : 'Faltando'} {Math.abs(diferenca).toLocaleString('pt-BR')} {produto.unidade_uso}
          </div>
        </div>
      )}

      {/* O motivo é obrigatório de propósito. Sem ele, meses depois
          ninguém distingue quebra de furto de erro de digitação — e o
          extrato vira uma lista de números sem história. */}
      <Campo
        rotulo="Por quê? *" valor={motivo} aoMudar={setMotivo}
        dica="Ex.: balde vazou, contagem antiga errada, peça quebrou na bancada"
      />

      <div className="modal-acoes">
        <button
          className="btn-primario" onClick={() => aoSalvar({ estoque_contado: Number(contado), motivo })}
          disabled={enviando || contado === '' || !motivo.trim()}
        >
          {enviando ? 'Registrando...' : 'Registrar ajuste'}
        </button>
      </div>
    </Modal>
  )
}
