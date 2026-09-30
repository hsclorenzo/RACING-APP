import { useEffect, useState, useCallback } from 'react'
import { api, dinheiro, percentual, emDias } from '../lib/api.js'
import { Campo, Selecao, Modal, Busca, Vazio, Aviso, Abas, Cabecalho, useEnvio } from '../components/ui.jsx'
import { Simulador } from '../components/Simulador.jsx'

export function CadastrosPage({ podeEditar, papel }) {
  const [aba, setAba] = useState('servicos')
  const itens = [
    { id: 'servicos', rotulo: 'Serviços' },
    { id: 'fornecedores', rotulo: 'Fornecedores' },
    { id: 'maquininhas', rotulo: 'Maquininhas e taxas' },
  ]
  return (
    <div>
      <Cabecalho titulo="Cadastros" />
      <Abas atual={aba} aoTrocar={setAba} itens={itens} />
      {aba === 'servicos' && <Servicos podeEditar={podeEditar} papel={papel} />}
      {aba === 'fornecedores' && <Fornecedores podeEditar={podeEditar} />}
      {aba === 'maquininhas' && <Maquininhas ehAdmin={papel === 'admin'} />}
    </div>
  )
}

// =====================================================================
// SERVIÇOS
// =====================================================================

const VAZIO_SERVICO = { descricao: '', tempo_padrao_horas: '', valor_hora: '', valor_fixo: '', custo_hora: '' }

function Servicos({ podeEditar, papel }) {
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState([])
  const [editando, setEditando] = useState(null)
  const { erro, ok, enviando, enviar, setErro } = useEnvio()

  const carregar = useCallback(async () => {
    try { setLista(await api(`/catalogo/servicos?busca=${encodeURIComponent(busca)}`)) }
    catch (e) { setErro(e.message) }
  }, [busca, setErro])

  useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t) }, [carregar])

  async function salvar(d) {
    const r = await enviar(
      () => (d.id ? api(`/catalogo/servicos/${d.id}`, { metodo: 'PATCH', corpo: d })
                  : api('/catalogo/servicos', { metodo: 'POST', corpo: d })),
      d.id ? 'Alterado.' : 'Cadastrado.'
    )
    if (r) { setEditando(null); carregar() }
  }
  async function desativar(d) {
    const r = await enviar(() => api(`/catalogo/servicos/${d.id}`, { metodo: 'DELETE' }), 'Desativado.')
    if (r) { setEditando(null); carregar() }
  }

  return (
    <div>
      <Aviso erro={erro} ok={ok} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Busca valor={busca} aoMudar={setBusca} dica="Buscar serviço" /></div>
        {podeEditar && (
          <button className="btn-primario" onClick={() => setEditando({ ...VAZIO_SERVICO })}>+</button>
        )}
      </div>

      <div className="cartao">
        {lista.length === 0
          ? <Vazio>Nenhum serviço cadastrado. Comece pelos 5 que a oficina mais faz.</Vazio>
          : lista.map((s) => (
            <div className="linha-lista clicavel" key={s.id} onClick={() => setEditando(s)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{s.descricao}</div>
                <div className="sutil">
                  {s.valor_fixo != null
                    ? 'valor fechado'
                    : `${Number(s.tempo_padrao_horas || 0)}h × ${dinheiro(s.valor_hora)}`}
                </div>
              </div>
              <div className="num" style={{ fontWeight: 600, flexShrink: 0 }}>
                {dinheiro(s.valor_sugerido)}
              </div>
            </div>
          ))}
      </div>

      {editando && (
        <FormServico
          dados={editando} podeEditar={podeEditar} enviando={enviando} veCusto={papel !== 'mecanico'}
          aoFechar={() => setEditando(null)} aoSalvar={salvar} aoDesativar={desativar}
        />
      )}
    </div>
  )
}

function FormServico({ dados, podeEditar, enviando, veCusto, aoFechar, aoSalvar, aoDesativar }) {
  const [f, setF] = useState(dados)
  // Um serviço é cobrado por hora OU por valor fechado. Deixar os dois
  // campos vivos ao mesmo tempo faz o balconista preencher os dois e
  // depois brigar com o sistema sobre qual valeu.
  const [modo, setModo] = useState(dados.valor_fixo != null ? 'fixo' : 'hora')
  const m = (campo) => (v) => setF({ ...f, [campo]: v })

  const previsto = modo === 'fixo'
    ? Number(f.valor_fixo || 0)
    : Number(f.tempo_padrao_horas || 0) * Number(f.valor_hora || 0)

  function salvar() {
    // Zera o lado que não está em uso, para que o banco nunca guarde os
    // dois preenchidos e a regra de qual vence fique ambígua.
    aoSalvar(modo === 'fixo'
      ? { ...f, valor_fixo: Number(f.valor_fixo || 0), tempo_padrao_horas: f.tempo_padrao_horas || null }
      : { ...f, valor_fixo: null })
  }

  return (
    <Modal titulo={f.id ? f.descricao : 'Novo serviço'} aoFechar={aoFechar}>
      <Campo rotulo="Descrição *" valor={f.descricao} aoMudar={m('descricao')} autoFocus
             dica="Ex.: Troca de óleo e filtro" />

      <label>Como cobra</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={modo === 'hora' ? 'btn-primario' : 'btn-fantasma'} style={{ flex: 1 }} onClick={() => setModo('hora')}>
          Por hora
        </button>
        <button className={modo === 'fixo' ? 'btn-primario' : 'btn-fantasma'} style={{ flex: 1 }} onClick={() => setModo('fixo')}>
          Valor fechado
        </button>
      </div>

      {modo === 'hora' ? (
        <div className="grade grade-2">
          <Campo rotulo="Horas do serviço" tipo="number" step="0.25" valor={f.tempo_padrao_horas} aoMudar={m('tempo_padrao_horas')} />
          <Campo rotulo="Valor da hora" tipo="number" step="0.01" valor={f.valor_hora} aoMudar={m('valor_hora')} />
        </div>
      ) : (
        <Campo rotulo="Valor do serviço" tipo="number" step="0.01" valor={f.valor_fixo} aoMudar={m('valor_fixo')} />
      )}

      {veCusto && (
        <Campo
          rotulo="Custo da hora de mecânico" tipo="number" step="0.01"
          valor={f.custo_hora} aoMudar={m('custo_hora')}
          dica="O que a hora custa pra oficina. Sem isso a margem da OS conta só a peça."
        />
      )}

      <div className="cartao" style={{ background: 'var(--fundo-2)', padding: 14 }}>
        <div className="sutil">Vai entrar na OS por</div>
        <div className="numerao" style={{ fontSize: 24 }}>{dinheiro(previsto)}</div>
      </div>

      {podeEditar && (
        <div className="modal-acoes">
          {f.id && f.ativo !== false && (
            <button className="btn-fantasma" onClick={() => aoDesativar(f)} disabled={enviando}>Desativar</button>
          )}
          <button className="btn-primario" onClick={salvar} disabled={enviando || !f.descricao}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </Modal>
  )
}

// =====================================================================
// FORNECEDORES
// =====================================================================

const VAZIO_FORN = { nome: '', documento: '', telefone: '', contato: '', observacoes: '' }

function Fornecedores({ podeEditar }) {
  const [busca, setBusca] = useState('')
  const [lista, setLista] = useState([])
  const [editando, setEditando] = useState(null)
  const { erro, ok, enviando, enviar, setErro } = useEnvio()

  const carregar = useCallback(async () => {
    try { setLista(await api(`/catalogo/fornecedores?busca=${encodeURIComponent(busca)}`)) }
    catch (e) { setErro(e.message) }
  }, [busca, setErro])
  useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t) }, [carregar])

  async function salvar(d) {
    const r = await enviar(
      () => (d.id ? api(`/catalogo/fornecedores/${d.id}`, { metodo: 'PATCH', corpo: d })
                  : api('/catalogo/fornecedores', { metodo: 'POST', corpo: d })),
      d.id ? 'Alterado.' : 'Cadastrado.'
    )
    if (r) { setEditando(null); carregar() }
  }
  async function desativar(d) {
    const r = await enviar(() => api(`/catalogo/fornecedores/${d.id}`, { metodo: 'DELETE' }), 'Desativado.')
    if (r) { setEditando(null); carregar() }
  }

  return (
    <div>
      <Aviso erro={erro} ok={ok} />
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}><Busca valor={busca} aoMudar={setBusca} dica="Buscar fornecedor" /></div>
        {podeEditar && <button className="btn-primario" onClick={() => setEditando({ ...VAZIO_FORN })}>+</button>}
      </div>

      <div className="cartao">
        {lista.length === 0
          ? <Vazio>Nenhum fornecedor cadastrado.</Vazio>
          : lista.map((x) => (
            <div className="linha-lista clicavel" key={x.id} onClick={() => setEditando(x)}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{x.nome}</div>
                <div className="sutil">{[x.contato, x.telefone].filter(Boolean).join(' · ') || 'sem contato'}</div>
              </div>
            </div>
          ))}
      </div>

      {editando && (
        <Modal titulo={editando.id ? editando.nome : 'Novo fornecedor'} aoFechar={() => setEditando(null)}>
          <FormSimples
            dados={editando} setDados={setEditando} enviando={enviando} podeEditar={podeEditar}
            aoSalvar={salvar} aoDesativar={desativar}
            campos={[
              { campo: 'nome', rotulo: 'Nome *', autoFocus: true },
              { campo: 'contato', rotulo: 'Pessoa de contato' },
              { campo: 'telefone', rotulo: 'Telefone', tipo: 'tel' },
              { campo: 'documento', rotulo: 'CNPJ' },
              { campo: 'observacoes', rotulo: 'Observações', tipo: 'textarea' },
            ]}
            obrigatorio="nome"
          />
        </Modal>
      )}
    </div>
  )
}

function FormSimples({ dados, setDados, campos, obrigatorio, enviando, podeEditar, aoSalvar, aoDesativar }) {
  return (
    <>
      {campos.map((c) => (
        <Campo
          key={c.campo} rotulo={c.rotulo} tipo={c.tipo} autoFocus={c.autoFocus}
          valor={dados[c.campo]} aoMudar={(v) => setDados({ ...dados, [c.campo]: v })}
        />
      ))}
      {podeEditar && (
        <div className="modal-acoes">
          {dados.id && dados.ativo !== false && (
            <button className="btn-fantasma" onClick={() => aoDesativar(dados)} disabled={enviando}>Desativar</button>
          )}
          <button className="btn-primario" onClick={() => aoSalvar(dados)} disabled={enviando || !dados[obrigatorio]}>
            {enviando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      )}
    </>
  )
}

// =====================================================================
// MAQUININHAS E TAXAS — a razão de existir do sistema
// =====================================================================

function Maquininhas({ ehAdmin }) {
  const [adquirentes, setAdquirentes] = useState([])
  const [taxas, setTaxas] = useState([])
  const [modalidades, setModalidades] = useState([])
  const [novaTaxa, setNovaTaxa] = useState(null)
  const [novoAdq, setNovoAdq] = useState(false)
  const [nome, setNome] = useState('')
  const { erro, ok, enviando, enviar, setErro } = useEnvio()

  const carregar = useCallback(async () => {
    try {
      const [a, t, m] = await Promise.all([
        api('/adquirentes'), api('/adquirentes/taxas'), api('/adquirentes/modalidades'),
      ])
      setAdquirentes(a); setTaxas(t); setModalidades(m)
    } catch (e) { setErro(e.message) }
  }, [setErro])
  useEffect(() => { carregar() }, [carregar])

  async function criarAdquirente() {
    const r = await enviar(() => api('/adquirentes', { metodo: 'POST', corpo: { nome } }), 'Maquininha cadastrada.')
    if (r) { setNome(''); setNovoAdq(false); carregar() }
  }
  async function salvarTaxa(d) {
    const r = await enviar(() => api('/adquirentes/taxas', { metodo: 'POST', corpo: d }), 'Taxa cadastrada.')
    if (r) { setNovaTaxa(null); carregar() }
  }
  async function encerrarTaxa(t) {
    const r = await enviar(() => api(`/adquirentes/taxas/${t.id}`, { metodo: 'DELETE' }), 'Taxa encerrada hoje.')
    if (r) carregar()
  }

  const rotuloModalidade = (v) => modalidades.find((m) => m.valor === v)?.rotulo || v

  return (
    <div>
      <Aviso erro={erro} ok={ok} />

      <div style={{ marginBottom: 16 }}><Simulador /></div>

      {adquirentes.length === 0 && (
        <div className="aviso aviso-erro">
          Nenhuma maquininha cadastrada ainda. Enquanto isso, o sistema não tem como saber quanto
          a taxa come de cada venda — e essa é a conta que ele existe pra fazer.
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Maquininhas</h2>
        {ehAdmin && <button className="btn-secundario" onClick={() => setNovoAdq(true)}>+ Maquininha</button>}
      </div>

      <div className="cartao" style={{ marginBottom: 18 }}>
        {adquirentes.length === 0
          ? <Vazio>Stone, Cielo, InfinitePay, Mercado Pago...</Vazio>
          : adquirentes.map((a) => (
            <div className="linha-lista" key={a.id}>
              <div style={{ fontWeight: 600 }}>{a.nome}</div>
              <span className="chip" style={{ color: a.taxas_vigentes === 0 ? 'var(--alerta)' : undefined }}>
                {a.taxas_vigentes} {a.taxas_vigentes === 1 ? 'taxa' : 'taxas'}
              </span>
            </div>
          ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Taxas</h2>
        {ehAdmin && adquirentes.length > 0 && (
          // Tudo em branco de propósito. Não existe taxa "padrão de
          // mercado" para pré-preencher: cada contrato é um, e número
          // sugerido pelo sistema vira número aceito sem conferir.
          <button className="btn-secundario" onClick={() => setNovaTaxa({
            adquirente_id: adquirentes[0].id, modalidade: 'credito_parcelado',
            parcelas_min: 2, parcelas_max: 6,
            taxa_percentual: '', taxa_fixa: '', imposto_percentual: '',
            dias_liquidacao: '', observacao: '',
            vigencia_inicio: new Date().toISOString().slice(0, 10),
          })}>+ Taxa</button>
        )}
      </div>

      <div className="cartao">
        {taxas.length === 0
          ? <Vazio>Nenhuma taxa cadastrada.</Vazio>
          : taxas.map((t) => (
            <div className="linha-lista" key={t.id} style={{ opacity: t.vigente ? 1 : 0.5 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>
                  {t.adquirente_nome} · {rotuloModalidade(t.modalidade)}
                  {t.parcelas_max > 1 && ` ${t.parcelas_min}x–${t.parcelas_max}x`}
                </div>
                <div className="sutil num">
                  {percentual(t.taxa_percentual)}
                  {Number(t.taxa_fixa) > 0 && ` + ${dinheiro(t.taxa_fixa)}`}
                  {Number(t.imposto_percentual) > 0 && ` · imposto ${percentual(t.imposto_percentual)}`}
                  {' · '}{emDias(t.dias_liquidacao)}
                  {!t.vigente && ' · encerrada'}
                </div>
                {t.observacao && <div className="sutil">{t.observacao}</div>}
              </div>
              {ehAdmin && t.vigente && (
                <button className="btn-fantasma" style={{ padding: '6px 11px', minHeight: 0, fontSize: 12.5 }}
                        onClick={() => encerrarTaxa(t)} disabled={enviando}>
                  Encerrar
                </button>
              )}
            </div>
          ))}
      </div>

      <p className="sutil" style={{ marginTop: 12 }}>
        Taxa nunca é apagada — é encerrada. As vendas antigas guardam a taxa que valia no dia,
        então o relatório do mês passado não muda quando você renegocia.
      </p>

      {novoAdq && (
        <Modal titulo="Nova maquininha" aoFechar={() => setNovoAdq(false)}>
          <Campo rotulo="Nome *" valor={nome} aoMudar={setNome} autoFocus dica="Ex.: Stone, Cielo, InfinitePay" />
          <div className="modal-acoes">
            <button className="btn-primario" onClick={criarAdquirente} disabled={enviando || !nome}>
              {enviando ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </Modal>
      )}

      {novaTaxa && (
        <FormTaxa
          dados={novaTaxa} setDados={setNovaTaxa} adquirentes={adquirentes} modalidades={modalidades}
          enviando={enviando} aoFechar={() => setNovaTaxa(null)} aoSalvar={salvarTaxa}
        />
      )}
    </div>
  )
}

function FormTaxa({ dados, setDados, adquirentes, modalidades, enviando, aoFechar, aoSalvar }) {
  const m = (campo) => (v) => setDados({ ...dados, [campo]: v })
  const parcelavel = modalidades.find((x) => x.valor === dados.modalidade)?.parcelavel

  return (
    <Modal titulo="Nova taxa" aoFechar={aoFechar}>
      <Selecao
        rotulo="Maquininha" valor={dados.adquirente_id} aoMudar={m('adquirente_id')}
        opcoes={adquirentes.map((a) => ({ valor: a.id, rotulo: a.nome }))}
      />
      <Selecao
        rotulo="Forma de pagamento" valor={dados.modalidade} aoMudar={m('modalidade')}
        opcoes={modalidades.map((x) => ({ valor: x.valor, rotulo: x.rotulo }))}
      />

      {parcelavel && (
        <div className="grade grade-2">
          <Campo rotulo="De (parcelas)" tipo="number" valor={dados.parcelas_min} aoMudar={m('parcelas_min')} />
          <Campo rotulo="Até (parcelas)" tipo="number" valor={dados.parcelas_max} aoMudar={m('parcelas_max')} />
        </div>
      )}

      <div className="grade grade-2">
        <Campo rotulo="Taxa da maquininha %" tipo="number" step="0.01" valor={dados.taxa_percentual} aoMudar={m('taxa_percentual')}
               placeholder="0,00" dica="Só o número: 3,49 vira 3.49" />
        <Campo rotulo="Taxa fixa R$" tipo="number" step="0.01" valor={dados.taxa_fixa} aoMudar={m('taxa_fixa')}
               placeholder="0,00" dica="Por transação, se houver" />
        <Campo rotulo="Imposto %" tipo="number" step="0.01" valor={dados.imposto_percentual} aoMudar={m('imposto_percentual')}
               placeholder="0,00" dica="O que sai por fora da taxa (Simples, ISS, retenção)" />
        <Campo rotulo="Dias pra cair" tipo="number" valor={dados.dias_liquidacao} aoMudar={m('dias_liquidacao')}
               placeholder="0" dica="0 = cai no mesmo dia" />
        <Campo rotulo="Vale a partir de" tipo="date" valor={dados.vigencia_inicio} aoMudar={m('vigencia_inicio')}
               dica="Renegociou? Cadastre uma nova com a data de hoje." />
      </div>
      <Campo rotulo="Observação" valor={dados.observacao} aoMudar={m('observacao')}
             dica="Ex.: contrato assinado em julho, com antecipação" />

      <p className="sutil">
        Tudo aqui é <strong>sugestão</strong>: em cada venda dá para digitar outra taxa e outro
        imposto, sem mexer neste cadastro.
      </p>

      <div className="modal-acoes">
        <button className="btn-primario" onClick={() => aoSalvar(dados)} disabled={enviando}>
          {enviando ? 'Salvando...' : 'Salvar taxa'}
        </button>
      </div>
    </Modal>
  )
}
