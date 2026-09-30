import { useEffect, useState } from 'react'
import { api, dinheiro, percentual, dataBR } from '../lib/api.js'
import { Campo, Selecao } from './ui.jsx'

// ---------------------------------------------------------------------
// "Vendi R$ 1.000 em 6x. Quanto entra, e quando?"
//
// É a pergunta que o sistema existe para responder, então ela fica na
// primeira tela — não escondida num relatório. E chama a MESMA rota que
// a E5 vai usar para gravar o recebimento: o número aqui é, ao centavo,
// o que vai ser lançado.
//
// DECISÃO CENTRAL: a taxa cadastrada é SUGESTÃO, nunca imposição. Os
// quatro campos (taxa %, taxa fixa, imposto %, dias) ficam abertos e
// editáveis em toda venda, porque cada operação tem a sua — adquirente
// renegocia caso a caso, antecipa uma e não outra, e o imposto muda com
// o regime e com o tipo do serviço. Deixar em branco usa o cadastro;
// digitar vale para esta venda e fica marcado como manual, para que
// depois a média não misture exceção com regra.
// ---------------------------------------------------------------------

const VAZIO = { taxa_percentual: '', taxa_fixa: '', imposto_percentual: '', dias_liquidacao: '' }

export function Simulador({ compacto = false }) {
  const [adquirentes, setAdquirentes] = useState([])
  const [modalidades, setModalidades] = useState([])
  const [f, setF] = useState({ valor_bruto: '1000', modalidade: 'credito_parcelado', parcelas: '6', adquirente_id: '' })
  const [manual, setManual] = useState(VAZIO)
  const [abrirDetalhe, setAbrirDetalhe] = useState(false)
  const [r, setR] = useState(null)
  const [erro, setErro] = useState('')

  useEffect(() => {
    Promise.all([api('/adquirentes'), api('/adquirentes/modalidades')])
      .then(([a, m]) => {
        setAdquirentes(a)
        setModalidades(m)
        if (a.length > 0) setF((x) => ({ ...x, adquirente_id: a[0].id }))
      })
      .catch((e) => setErro(e.message))
  }, [])

  const parcelavel = modalidades.find((m) => m.valor === f.modalidade)?.parcelavel
  const chaveManual = JSON.stringify(manual)

  useEffect(() => {
    const valor = Number(f.valor_bruto)
    if (!(valor > 0)) { setR(null); return }
    const t = setTimeout(() => {
      api('/adquirentes/simular', {
        metodo: 'POST',
        corpo: {
          valor_bruto: valor,
          modalidade: f.modalidade,
          parcelas: parcelavel ? Number(f.parcelas) : 1,
          adquirente_id: f.adquirente_id || null,
          ...JSON.parse(chaveManual),
        },
      }).then((x) => { setR(x); setErro('') }).catch((e) => { setR(null); setErro(e.message) })
    }, 250)
    return () => clearTimeout(t)
  }, [f.valor_bruto, f.modalidade, f.parcelas, f.adquirente_id, parcelavel, chaveManual])

  const m = (campo) => (v) => setF({ ...f, [campo]: v })
  const mm = (campo) => (v) => setManual({ ...manual, [campo]: v })
  const temManual = Object.values(manual).some((v) => v !== '')

  return (
    <div className="cartao">
      <h2 style={{ marginBottom: 4 }}>Quanto eu recebo de verdade?</h2>
      <p className="sutil" style={{ marginTop: 0 }}>
        A venda é uma. O que cai na conta é outra. Aqui dá pra ver antes de fechar o preço.
      </p>

      <div className="grade grade-2">
        <Campo rotulo="Valor da venda" tipo="number" step="0.01" valor={f.valor_bruto} aoMudar={m('valor_bruto')} />
        <Selecao
          rotulo="Forma de pagamento" valor={f.modalidade} aoMudar={m('modalidade')}
          opcoes={modalidades.map((x) => ({ valor: x.valor, rotulo: x.rotulo }))}
        />
        {parcelavel && (
          <Selecao
            rotulo="Parcelas" valor={f.parcelas} aoMudar={m('parcelas')}
            opcoes={Array.from({ length: 11 }, (_, i) => ({ valor: String(i + 2), rotulo: `${i + 2}x` }))}
          />
        )}
        {adquirentes.length > 0 && (
          <Selecao
            rotulo="Maquininha" valor={f.adquirente_id} aoMudar={m('adquirente_id')}
            vazio="Sem maquininha"
            opcoes={adquirentes.map((a) => ({ valor: a.id, rotulo: a.nome }))}
          />
        )}
      </div>

      {erro && <div className="aviso aviso-erro">{erro}</div>}

      {/* ----------------------------------------------------------------
          Taxas desta venda. Abre fechado para não assustar quem só quer o
          número, e abre sozinho quando não há taxa cadastrada — que é
          justamente quando a pessoa PRECISA digitar.
          ---------------------------------------------------------------- */}
      <button
        className="btn-fantasma btn-bloco"
        style={{ marginBottom: abrirDetalhe || temManual ? 14 : 0, textAlign: 'left' }}
        onClick={() => setAbrirDetalhe(!abrirDetalhe)}
      >
        {abrirDetalhe ? '▾' : '▸'} Taxas desta venda
        {temManual && <span className="etiqueta" style={{ marginLeft: 9, color: 'var(--alerta)', borderColor: 'var(--alerta)' }}>ajustada</span>}
      </button>

      {(abrirDetalhe || (r && r.sem_taxa_cadastrada)) && (
        <div style={{ background: 'var(--fundo-2)', borderRadius: 'var(--raio)', padding: 14, marginBottom: 14 }}>
          <p className="sutil" style={{ marginTop: 0 }}>
            Em branco usa a taxa cadastrada. Preenchido vale só para esta venda — útil quando o
            adquirente cobrou diferente, quando houve antecipação, ou quando o imposto muda.
          </p>
          <div className="grade grade-2">
            <Campo
              rotulo="Taxa da maquininha %" tipo="number" step="0.01"
              valor={manual.taxa_percentual} aoMudar={mm('taxa_percentual')}
              placeholder={r && r.sugerido ? String(r.sugerido.taxa_percentual) : 'não cadastrada'}
            />
            <Campo
              rotulo="Taxa fixa R$" tipo="number" step="0.01"
              valor={manual.taxa_fixa} aoMudar={mm('taxa_fixa')}
              placeholder={r && r.sugerido ? String(r.sugerido.taxa_fixa) : 'não cadastrada'}
            />
            <Campo
              rotulo="Imposto %" tipo="number" step="0.01"
              valor={manual.imposto_percentual} aoMudar={mm('imposto_percentual')}
              placeholder={r && r.sugerido ? String(r.sugerido.imposto_percentual) : 'não cadastrado'}
            />
            <Campo
              rotulo="Dias pra cair" tipo="number"
              valor={manual.dias_liquidacao} aoMudar={mm('dias_liquidacao')}
              placeholder={r && r.sugerido ? String(r.sugerido.dias_liquidacao) : 'não cadastrado'}
            />
          </div>
          {temManual && (
            <button className="btn-fantasma btn-bloco" onClick={() => setManual(VAZIO)}>
              Voltar para a taxa cadastrada
            </button>
          )}
        </div>
      )}

      {r && (
        <div style={{ borderTop: '1px solid var(--borda)', paddingTop: 16, marginTop: 4 }}>
          {r.sem_taxa_cadastrada && (
            // A diferença entre "é de graça" e "ninguém cadastrou ainda"
            // precisa aparecer. Mostrar 0% com cara de certeza é o
            // sistema mentindo.
            <div className="aviso aviso-erro" style={{ marginBottom: 14 }}>
              Nada cadastrado para essa combinação, e nada digitado acima. O valor abaixo está sem
              desconto nenhum — e provavelmente não é o que vai cair na conta.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap' }}>
            <div>
              <div className="sutil">Cai na conta</div>
              <div className="numerao" style={{ color: 'var(--ok)' }}>{dinheiro(r.valor_liquido)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="sutil">Fica pelo caminho</div>
              <div className="numerao" style={{ fontSize: 22, color: 'var(--perigo)' }}>
                −{dinheiro(r.valor_descontado)}
              </div>
              <div className="sutil num">{percentual(r.percentual_efetivo)} do total</div>
            </div>
          </div>

          {!compacto && (
            <div className="sutil" style={{ marginTop: 14, lineHeight: 1.8 }}>
              <div>
                Maquininha: {percentual(r.taxa_percentual_aplicada)}
                {Number(r.taxa_fixa_aplicada) > 0 && <> + {dinheiro(r.taxa_fixa_aplicada)} por transação</>}
                {' → '}<strong>{dinheiro(r.valor_taxa)}</strong>
              </div>
              {Number(r.imposto_percentual_aplicado) > 0 && (
                <div>
                  Imposto: {percentual(r.imposto_percentual_aplicado)}
                  {' → '}<strong>{dinheiro(r.valor_imposto)}</strong>
                </div>
              )}
              <div>
                Previsão de liquidação: <strong>{dataBR(r.data_prevista_liquidacao)}</strong>
                {' '}(venda em {dataBR(r.data_venda)})
              </div>
              {r.taxa_manual && (
                <div style={{ color: 'var(--alerta)' }}>
                  Taxa digitada à mão nesta venda — fica marcada assim para não entrar na média
                  como se fosse a regra.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
