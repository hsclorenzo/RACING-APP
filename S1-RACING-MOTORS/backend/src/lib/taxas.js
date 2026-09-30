import { pool } from '../db/pool.js'

// =====================================================================
// MOTOR DE TAXAS — o coração do sistema.
//
// A oficina vende R$ 1.000 em 6x, acha que faturou R$ 1.000 e recebe
// ~R$ 940 daqui a 30 dias. Este arquivo é o que transforma esse buraco
// em número na tela.
//
// Tudo aqui é FUNÇÃO PURA (menos a última, que só busca no banco), por
// dois motivos: dá para testar sem banco, e a mesma função vai ser
// chamada pelo simulador da tela E pelo `fechar_os` da E5. Se o
// simulador tivesse a conta dele e o fechamento tivesse outra, um dia os
// dois discordariam por um centavo e ninguém saberia qual acreditar.
// =====================================================================

export const MODALIDADES = [
  { valor: 'dinheiro', rotulo: 'Dinheiro', parcelavel: false },
  { valor: 'pix', rotulo: 'PIX', parcelavel: false },
  { valor: 'debito', rotulo: 'Débito', parcelavel: false },
  { valor: 'credito_vista', rotulo: 'Crédito à vista', parcelavel: false },
  { valor: 'credito_parcelado', rotulo: 'Crédito parcelado', parcelavel: true },
  { valor: 'transferencia', rotulo: 'Transferência / TED', parcelavel: false },
]

// Centavos, sempre. `Math.round(x * 100) / 100` erra em casos como
// 1.005 por causa de ponto flutuante; somar Number.EPSILON relativo
// resolve o caso comum sem trazer biblioteca de decimal.
export function emCentavos(valor) {
  const n = Number(valor) || 0
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * 100) / 100
}

// ---------------------------------------------------------------------
// Escolhe qual taxa vale, entre as cadastradas. Pura: recebe a lista.
//
// Duas regras, nesta ordem:
//   1. VIGÊNCIA — a taxa tem que estar valendo NA DATA DA VENDA, não
//      hoje. Conciliar uma venda de três meses atrás com a taxa de hoje
//      é o erro que faz o relatório do mês passado mudar sozinho.
//   2. FAIXA DE PARCELAS — 2..6 é uma taxa, 7..12 é outra.
//
// Empate (duas taxas válidas cobrindo o mesmo caso) vence a de vigência
// mais recente: é o cadastro mais novo, provavelmente a renegociação.
// ---------------------------------------------------------------------
// Normaliza para "AAAA-MM-DD" venha o que vier: string do Postgres,
// objeto Date (se alguém ligar de novo o parser do driver), ou uma data
// digitada. Usa os componentes LOCAIS do Date, nunca `toISOString()` —
// que num fuso a oeste devolve o dia anterior.
export function paraDia(valor) {
  if (!valor) return ''
  if (valor instanceof Date) {
    const p = (n) => String(n).padStart(2, '0')
    return `${valor.getFullYear()}-${p(valor.getMonth() + 1)}-${p(valor.getDate())}`
  }
  return String(valor).slice(0, 10)
}

export function escolherTaxa(taxas, { modalidade, parcelas = 1, dataVenda }) {
  const dia = paraDia(dataVenda)
  const n = Number(parcelas) || 1

  const candidatas = (taxas || []).filter((t) => {
    if (t.modalidade !== modalidade) return false
    if (n < Number(t.parcelas_min) || n > Number(t.parcelas_max)) return false
    if (paraDia(t.vigencia_inicio) > dia) return false
    if (t.vigencia_fim && paraDia(t.vigencia_fim) < dia) return false
    return true
  })

  candidatas.sort((a, b) => {
    const va = paraDia(a.vigencia_inicio)
    const vb = paraDia(b.vigencia_inicio)
    if (va !== vb) return vb.localeCompare(va)
    // Segundo critério: faixa mais estreita ganha. Uma taxa cadastrada
    // especificamente para 6x é mais específica que uma de 1..12, e é
    // a que o dono quis dizer.
    return (a.parcelas_max - a.parcelas_min) - (b.parcelas_max - b.parcelas_min)
  })

  return candidatas[0] || null
}

// ---------------------------------------------------------------------
// A conta. Devolve os campos EXATAMENTE como eles serão gravados em
// `recebimentos` — inclusive as taxas aplicadas, que são SNAPSHOT.
//
// `taxa` nula não é erro: dinheiro e PIX normalmente não têm taxa
// cadastrada, e aí o líquido é o bruto. `semTaxaCadastrada` diz a
// diferença entre "é de graça" e "ninguém cadastrou ainda" — a tela
// precisa avisar no segundo caso, senão o sistema mente com cara de
// certeza.
// ---------------------------------------------------------------------
// `manual` sobrescreve, campo a campo, o que veio da tabela. É o que
// permite "esta venda aqui foi diferente" sem cadastrar uma taxa nova
// para uma exceção que não vai se repetir. Passar `null`/`undefined` num
// campo de `manual` significa "não mexi nele"; passar 0 significa zero.
export function calcularRecebimento({
  valorBruto, taxa, modalidade, parcelas = 1, dataVenda, manual = null,
}) {
  const bruto = emCentavos(valorBruto)

  // `??` e não `||`: uma taxa manual de 0% é uma informação legítima
  // ("nesta a maquininha não cobrou"), e o `||` a trocaria pela da tabela.
  const daTabela = (campo) => (taxa ? Number(taxa[campo]) || 0 : 0)
  const escolher = (campo) => {
    const m = manual ? manual[campo] : null
    return m === null || m === undefined || m === '' ? daTabela(campo) : Number(m) || 0
  }

  const pct = escolher('taxa_percentual')
  const fixa = escolher('taxa_fixa')
  const imposto = escolher('imposto_percentual')
  const dias = escolher('dias_liquidacao')

  const valorTaxa = emCentavos(emCentavos((bruto * pct) / 100) + fixa)
  const valorImposto = emCentavos((bruto * imposto) / 100)
  const liquido = emCentavos(bruto - valorTaxa - valorImposto)
  const prevista = somarDias(paraDia(dataVenda), dias)

  const tocouNaMao = Boolean(manual && ['taxa_percentual', 'taxa_fixa', 'imposto_percentual', 'dias_liquidacao']
    .some((c) => manual[c] !== null && manual[c] !== undefined && manual[c] !== ''))

  return {
    modalidade,
    parcelas: Number(parcelas) || 1,
    valor_bruto: bruto,
    taxa_percentual_aplicada: pct,
    taxa_fixa_aplicada: fixa,
    imposto_percentual_aplicado: imposto,
    valor_taxa: valorTaxa,
    valor_imposto: valorImposto,
    // O que sai do bolso da oficina somando as duas pernas. É o número
    // que interessa; taxa e imposto separados servem pra explicar.
    valor_descontado: emCentavos(valorTaxa + valorImposto),
    valor_liquido: liquido,
    dias_liquidacao: dias,
    data_venda: paraDia(dataVenda),
    data_prevista_liquidacao: prevista,
    // Quanto por cento do bruto ficou pelo caminho. Não é o percentual da
    // tabela: com taxa fixa e imposto juntos, os dois não são iguais.
    percentual_efetivo: bruto > 0 ? emCentavos(((valorTaxa + valorImposto) / bruto) * 100) : 0,
    taxa_manual: tocouNaMao,
    // Só avisa "ninguém cadastrou" quando de fato não há tabela E o
    // usuário também não digitou nada. Se ele digitou, o número é dele e
    // está certo — avisar ali seria o sistema duvidando de quem sabe.
    sem_taxa_cadastrada: !taxa && !tocouNaMao,
    adquirente_id: taxa ? taxa.adquirente_id : null,
  }
}

// Soma dias em cima de uma data ISO, sem passar por fuso. `new Date()`
// com string "2026-09-08" é interpretada como UTC e, num servidor em
// São Paulo, volta como dia 7. Fazendo a conta em UTC puro e formatando
// em UTC, o dia nunca escorrega.
export function somarDias(dataIso, dias) {
  const [a, m, d] = paraDia(dataIso).split('-').map(Number)
  const base = Date.UTC(a, m - 1, d)
  return new Date(base + (Number(dias) || 0) * 86400000).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------
// A parte que fala com o banco. Traz TODAS as taxas do adquirente e
// deixa `escolherTaxa` decidir — em vez de resolver a vigência dentro do
// SQL. Assim a regra vive num lugar só, testável, e o mesmo código serve
// para o simulador da tela e para o fechamento da OS.
// ---------------------------------------------------------------------
export async function taxasDoTenant(tenant, adquirenteId = null) {
  const r = await pool.query(
    `select * from taxas_adquirente
      where tenant_id = $1 and ($2::uuid is null or adquirente_id = $2)`,
    [tenant, adquirenteId]
  )
  return r.rows
}

export async function simular(tenant, { adquirenteId, modalidade, parcelas, valorBruto, dataVenda, manual }) {
  const taxas = await taxasDoTenant(tenant, adquirenteId)
  const taxa = escolherTaxa(taxas, { modalidade, parcelas, dataVenda })
  return {
    ...calcularRecebimento({ valorBruto, taxa, modalidade, parcelas, dataVenda, manual }),
    // O que a tabela DIRIA, mesmo quando o usuário sobrescreveu. A tela
    // usa isso para o botão "voltar ao cadastrado" e para mostrar o
    // quanto esta venda fugiu do padrão.
    sugerido: taxa
      ? {
          taxa_percentual: Number(taxa.taxa_percentual) || 0,
          taxa_fixa: Number(taxa.taxa_fixa) || 0,
          imposto_percentual: Number(taxa.imposto_percentual) || 0,
          dias_liquidacao: Number(taxa.dias_liquidacao) || 0,
        }
      : null,
  }
}
