import { emCentavos } from './taxas.js'

// =====================================================================
// ESTOQUE — a dor número dois do sistema.
//
// A oficina compra óleo em balde de 20 L, usa 4,5 L numa troca e cobra
// um valor de chute. Sem saber o custo real do litro, a margem da OS é
// ficção. Este arquivo é o que transforma "comprei 3 baldes por R$ 890"
// em "o litro me custa R$ 14,83".
//
// Tudo função pura, testável sem banco.
// =====================================================================

// Arredondamento do CUSTO usa 4 casas, não 2.
//
// O custo do litro sai de uma divisão (R$ 890 ÷ 60 L = 14,8333...). Com
// 2 casas, cada litro perderia meio centavo, e numa OS de 4,5 L o erro
// já aparece. As colunas de custo no banco são numeric(14,4) por isso.
export function emQuatroCasas(valor) {
  const n = Number(valor) || 0
  return Math.round(n * 10000) / 10000
}

// ---------------------------------------------------------------------
// Compra em balde, controla em litro.
//
// 3 baldes × fator 20 = 60 L entram no estoque. É a conta que a planilha
// da oficina não fazia, e a razão de o controle de óleo nunca fechar.
// ---------------------------------------------------------------------
export function quantidadeEmUso(quantidadeCompra, fator) {
  return emQuatroCasas(Number(quantidadeCompra) * (Number(fator) || 1))
}

// R$ 890 por 3 baldes de 20 L = R$ 14,8333 por litro.
export function custoPorUnidadeDeUso(custoTotal, quantidadeCompra, fator) {
  const emUso = quantidadeEmUso(quantidadeCompra, fator)
  if (!(emUso > 0)) return 0
  return emQuatroCasas(Number(custoTotal) / emUso)
}

// ---------------------------------------------------------------------
// CUSTO MÉDIO PONDERADO. Não FIFO, não último custo.
//
// Motivo (do briefing): é o que o dono da oficina entende, e o que fecha
// com a realidade de comprar fracionado em épocas diferentes. Tinha 10 L
// a R$ 12 e entram 60 L a R$ 14,83 → o litro passa a valer R$ 14,42, e
// toda OS daqui pra frente usa esse número.
//
// A ARMADILHA: quando o estoque está NEGATIVO (peça usada antes de a
// compra ser lançada — acontece o tempo todo numa oficina), a fórmula
// ponderada dividiria por um total menor que a entrada e cuspiria um
// custo inflado ou negativo. Por isso o saldo entra na média pisado em
// zero: com estoque negativo, o custo da entrada é o novo custo médio,
// que é a única informação verdadeira que existe naquele momento.
// ---------------------------------------------------------------------
export function novoCustoMedio({ estoqueAtual, custoMedioAtual, quantidadeEntrada, custoUnitarioEntrada }) {
  const saldo = Math.max(Number(estoqueAtual) || 0, 0)
  const custoAtual = Number(custoMedioAtual) || 0
  const entrada = Number(quantidadeEntrada) || 0
  const custoEntrada = Number(custoUnitarioEntrada) || 0

  if (!(entrada > 0)) return emQuatroCasas(custoAtual)
  const total = saldo + entrada
  if (!(total > 0)) return emQuatroCasas(custoEntrada)

  return emQuatroCasas((saldo * custoAtual + entrada * custoEntrada) / total)
}

// O sinal de cada tipo de movimento. Guardar a quantidade sempre positiva
// e derivar o sinal daqui evita o clássico "somei tudo e deu errado
// porque metade estava negativa".
export const SINAL = { entrada: 1, saida: -1, estorno: 1, ajuste: 1 }

export function aplicarMovimento(estoqueAtual, tipo, quantidade) {
  const sinal = SINAL[tipo]
  if (sinal === undefined) throw new Error(`Tipo de movimento desconhecido: ${tipo}`)
  return emQuatroCasas((Number(estoqueAtual) || 0) + sinal * (Number(quantidade) || 0))
}

// ---------------------------------------------------------------------
// O que precisa ser baixado de uma OS, comparado com o que já foi.
//
// Devolve o DELTA, não o total. Assim a mesma função serve para a baixa
// inicial, para o item lançado depois de a OS já estar em execução, e
// para o item removido — sem nunca baixar duas vezes a mesma peça, que é
// o defeito clássico de "dar baixa" com um INSERT solto.
// ---------------------------------------------------------------------
export function deltaDeBaixa(itensDaOs, jaBaixado) {
  const precisa = new Map()
  for (const i of itensDaOs || []) {
    if (i.tipo !== 'peca' || !i.produto_id) continue
    precisa.set(i.produto_id, emQuatroCasas((precisa.get(i.produto_id) || 0) + Number(i.quantidade)))
  }

  const baixado = new Map()
  for (const m of jaBaixado || []) {
    const sinal = m.tipo === 'saida' ? 1 : -1 // estorno devolve
    baixado.set(m.produto_id, emQuatroCasas((baixado.get(m.produto_id) || 0) + sinal * Number(m.quantidade)))
  }

  const deltas = []
  for (const produtoId of new Set([...precisa.keys(), ...baixado.keys()])) {
    const d = emQuatroCasas((precisa.get(produtoId) || 0) - (baixado.get(produtoId) || 0))
    if (d === 0) continue
    deltas.push({
      produto_id: produtoId,
      tipo: d > 0 ? 'saida' : 'estorno',
      quantidade: Math.abs(d),
    })
  }
  return deltas
}

// Valor total do que está parado na prateleira. Uma oficina costuma
// descobrir aqui que tem mais dinheiro em peça do que em caixa.
export function valorDoEstoque(produtos) {
  return emCentavos((produtos || []).reduce(
    (soma, p) => soma + Math.max(Number(p.estoque_atual) || 0, 0) * (Number(p.custo_medio) || 0),
    0
  ))
}
