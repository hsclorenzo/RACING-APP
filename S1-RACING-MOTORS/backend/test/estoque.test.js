import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  quantidadeEmUso, custoPorUnidadeDeUso, novoCustoMedio,
  aplicarMovimento, deltaDeBaixa, valorDoEstoque, emQuatroCasas,
} from '../src/lib/estoque.js'

// ---------------------------------------------------------------------
// FRACIONAMENTO — o caso que motivou o sistema
// ---------------------------------------------------------------------

test('3 baldes de 20 L entram como 60 L', () => {
  assert.equal(quantidadeEmUso(3, 20), 60)
})

test('sem fator, compra e uso sao a mesma unidade', () => {
  assert.equal(quantidadeEmUso(7, 1), 7)
  assert.equal(quantidadeEmUso(7, null), 7)
})

test('R$ 890 em 3 baldes de 20 L = R$ 14,8333 o litro', () => {
  assert.equal(custoPorUnidadeDeUso(890, 3, 20), 14.8333)
})

// Duas casas fariam cada litro perder meio centavo, e numa OS de 4,5 L
// o erro ja aparece no total.
test('o custo unitario guarda 4 casas, nao 2', () => {
  const custo = custoPorUnidadeDeUso(100, 1, 3) // 33,3333...
  assert.equal(custo, 33.3333)
  assert.notEqual(custo, 33.33)
})

test('compra de quantidade zero nao divide por zero', () => {
  assert.equal(custoPorUnidadeDeUso(500, 0, 20), 0)
})

// ---------------------------------------------------------------------
// CUSTO MEDIO PONDERADO
// ---------------------------------------------------------------------

test('primeira compra: o custo medio e o custo da compra', () => {
  const c = novoCustoMedio({
    estoqueAtual: 0, custoMedioAtual: 0, quantidadeEntrada: 60, custoUnitarioEntrada: 14.8333,
  })
  assert.equal(c, 14.8333)
})

test('segunda compra pondera pelo que ja tinha', () => {
  // 10 L a R$ 12,00 + 60 L a R$ 14,8333 -> (120 + 889,998) / 70 = 14,42854... -> 14,4285
  const c = novoCustoMedio({
    estoqueAtual: 10, custoMedioAtual: 12, quantidadeEntrada: 60, custoUnitarioEntrada: 14.8333,
  })
  assert.equal(c, 14.4285)
})

test('comprar mais caro sobe a media; mais barato desce', () => {
  const base = { estoqueAtual: 50, custoMedioAtual: 20, quantidadeEntrada: 50 }
  assert.ok(novoCustoMedio({ ...base, custoUnitarioEntrada: 30 }) > 20)
  assert.ok(novoCustoMedio({ ...base, custoUnitarioEntrada: 10 }) < 20)
  assert.equal(novoCustoMedio({ ...base, custoUnitarioEntrada: 20 }), 20)
})

// A ARMADILHA: estoque negativo (peca usada antes de a compra ser
// lancada) faria a formula ponderada dividir por um total menor que a
// entrada e cuspir custo inflado — ou negativo, se o saldo negativo
// fosse maior que a entrada.
test('estoque NEGATIVO nao envenena a media', () => {
  const c = novoCustoMedio({
    estoqueAtual: -30, custoMedioAtual: 12, quantidadeEntrada: 60, custoUnitarioEntrada: 15,
  })
  assert.equal(c, 15, 'com saldo negativo, o custo da entrada e a unica verdade disponivel')
  assert.ok(c > 0)
})

test('saldo negativo maior que a entrada tambem se comporta', () => {
  const c = novoCustoMedio({
    estoqueAtual: -100, custoMedioAtual: 12, quantidadeEntrada: 10, custoUnitarioEntrada: 15,
  })
  assert.equal(c, 15)
})

test('entrada zero nao mexe na media', () => {
  const c = novoCustoMedio({
    estoqueAtual: 10, custoMedioAtual: 12, quantidadeEntrada: 0, custoUnitarioEntrada: 99,
  })
  assert.equal(c, 12)
})

// ---------------------------------------------------------------------
// SALDO
// ---------------------------------------------------------------------

test('entrada soma, saida subtrai, estorno devolve', () => {
  assert.equal(aplicarMovimento(100, 'entrada', 60), 160)
  assert.equal(aplicarMovimento(100, 'saida', 4.5), 95.5)
  assert.equal(aplicarMovimento(95.5, 'estorno', 4.5), 100)
})

test('tipo desconhecido explode em vez de somar errado calado', () => {
  assert.throws(() => aplicarMovimento(10, 'sei_la', 1), /desconhecido/)
})

test('o saldo pode ficar negativo — e isso e informacao, nao defeito', () => {
  // Numa oficina a peca fisica existe mesmo que a compra nao tenha sido
  // lancada. Travar a baixa por saldo pararia o trabalho; deixar negativo
  // denuncia a compra que falta.
  assert.equal(aplicarMovimento(2, 'saida', 5), -3)
})

// ---------------------------------------------------------------------
// BAIXA PELA OS — sempre por DELTA, nunca pelo total
// ---------------------------------------------------------------------

test('primeira baixa: sai tudo que a OS pede', () => {
  const d = deltaDeBaixa([
    { tipo: 'peca', produto_id: 'oleo', quantidade: 4.5 },
    { tipo: 'peca', produto_id: 'filtro', quantidade: 1 },
    { tipo: 'servico', produto_id: null, quantidade: 2 },
  ], [])
  assert.equal(d.length, 2, 'servico nao baixa estoque')
  assert.deepEqual(d.find((x) => x.produto_id === 'oleo'), { produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 })
})

// O defeito classico de "dar baixa" com INSERT solto: passar duas vezes
// pelo mesmo status baixa a peca duas vezes.
test('baixar de novo o que ja foi baixado nao faz nada', () => {
  const itens = [{ tipo: 'peca', produto_id: 'oleo', quantidade: 4.5 }]
  const jaFeito = [{ produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 }]
  assert.deepEqual(deltaDeBaixa(itens, jaFeito), [])
})

test('item lancado depois da baixa gera so a diferenca', () => {
  const itens = [{ tipo: 'peca', produto_id: 'oleo', quantidade: 7 }]
  const jaFeito = [{ produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 }]
  assert.deepEqual(deltaDeBaixa(itens, jaFeito), [
    { produto_id: 'oleo', tipo: 'saida', quantidade: 2.5 },
  ])
})

test('item removido da OS devolve a peca pra prateleira', () => {
  const jaFeito = [{ produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 }]
  assert.deepEqual(deltaDeBaixa([], jaFeito), [
    { produto_id: 'oleo', tipo: 'estorno', quantidade: 4.5 },
  ])
})

test('quantidade reduzida devolve so a diferenca', () => {
  const itens = [{ tipo: 'peca', produto_id: 'oleo', quantidade: 3 }]
  const jaFeito = [{ produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 }]
  assert.deepEqual(deltaDeBaixa(itens, jaFeito), [
    { produto_id: 'oleo', tipo: 'estorno', quantidade: 1.5 },
  ])
})

test('estorno anterior entra na conta e nao vira baixa em dobro', () => {
  const itens = [{ tipo: 'peca', produto_id: 'oleo', quantidade: 4.5 }]
  const jaFeito = [
    { produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 },
    { produto_id: 'oleo', tipo: 'estorno', quantidade: 4.5 },
  ]
  assert.deepEqual(deltaDeBaixa(itens, jaFeito), [
    { produto_id: 'oleo', tipo: 'saida', quantidade: 4.5 },
  ])
})

test('o mesmo produto em dois itens da OS soma antes de baixar', () => {
  const d = deltaDeBaixa([
    { tipo: 'peca', produto_id: 'oleo', quantidade: 4 },
    { tipo: 'peca', produto_id: 'oleo', quantidade: 0.5 },
  ], [])
  assert.equal(d.length, 1)
  assert.equal(d[0].quantidade, 4.5)
})

test('peca digitada na mao (sem cadastro) nao mexe no estoque', () => {
  const d = deltaDeBaixa([{ tipo: 'peca', produto_id: null, quantidade: 2 }], [])
  assert.deepEqual(d, [])
})

// ---------------------------------------------------------------------
// VALOR PARADO NA PRATELEIRA
// ---------------------------------------------------------------------

test('soma o valor do estoque a custo medio', () => {
  const v = valorDoEstoque([
    { estoque_atual: 60, custo_medio: 14.8333 },
    { estoque_atual: 4, custo_medio: 19.5 },
  ])
  assert.equal(v, 968)
})

test('saldo negativo nao vira credito no valor do estoque', () => {
  const v = valorDoEstoque([
    { estoque_atual: 10, custo_medio: 20 },
    { estoque_atual: -5, custo_medio: 100 },
  ])
  assert.equal(v, 200, 'a peca que falta nao vale menos que zero na prateleira')
})

test('4 casas nao acumulam lixo de ponto flutuante', () => {
  assert.equal(emQuatroCasas(0.1 + 0.2), 0.3)
  assert.equal(emQuatroCasas(14.83333333), 14.8333)
})
