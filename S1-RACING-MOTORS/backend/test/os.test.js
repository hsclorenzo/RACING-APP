import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularTotais, podeIr, itemDeServico, itemDeProduto, carimboDe } from '../src/lib/os.js'
import { emCentavos } from '../src/lib/taxas.js'

const peca = (q, preco, custo) => ({ tipo: 'peca', quantidade: q, preco_unitario: preco, custo_unitario: custo })
const serv = (q, preco, custo) => ({ tipo: 'servico', quantidade: q, preco_unitario: preco, custo_unitario: custo })

// ---------------------------------------------------------------------
// TOTAIS E MARGEM
// ---------------------------------------------------------------------

test('separa servico de peca e soma a margem', () => {
  const t = calcularTotais([
    serv(2.5, 130, 42),     // 325 de venda, 105 de custo
    peca(4.5, 52.90, 31.20), // 238,05 de venda, 140,40 de custo
    peca(1, 34.90, 19.50),   // 34,90 de venda, 19,50 de custo
  ])
  assert.equal(t.total_servicos, 325)
  assert.equal(t.total_pecas, 272.95)
  assert.equal(t.total_geral, 597.95)
  assert.equal(t.custo_total, 264.9)
  assert.equal(t.margem_valor, 333.05)
  assert.equal(t.margem_percentual, 55.7)
})

// A armadilha: desconto sai do LUCRO, nao do custo. Abater desconto do
// custo faria a margem parecer intacta depois de dar 20% — o contrario
// do que aconteceu de verdade.
test('desconto derruba a margem, nao o custo', () => {
  const itens = [peca(1, 1000, 600)]
  const semDesconto = calcularTotais(itens, 0)
  const comDesconto = calcularTotais(itens, 200)

  assert.equal(semDesconto.margem_valor, 400)
  assert.equal(semDesconto.margem_percentual, 40)

  assert.equal(comDesconto.custo_total, 600, 'o custo nao muda com desconto')
  assert.equal(comDesconto.total_geral, 800)
  assert.equal(comDesconto.margem_valor, 200, 'o desconto inteiro saiu do lucro')
  assert.equal(comDesconto.margem_percentual, 25)
})

test('desconto maior que a margem deixa a OS no prejuizo, e mostra isso', () => {
  const t = calcularTotais([peca(1, 1000, 600)], 500)
  assert.equal(t.total_geral, 500)
  assert.equal(t.margem_valor, -100)
  assert.ok(t.margem_percentual < 0, 'prejuizo aparece como percentual negativo')
})

// Sem este contador, uma OS de pecas recem-cadastradas (custo medio
// ainda zero porque nunca houve compra) mostra 100% de margem com cara
// de certeza. A tela precisa poder dizer que aquilo e ignorancia.
test('conta os itens que entraram sem custo', () => {
  const t = calcularTotais([peca(1, 100, 0), peca(1, 50, 20), serv(1, 90, 0)])
  assert.equal(t.itens_sem_custo, 2)
  assert.equal(t.margem_percentual, 91.67)
})

test('item de preco zero nao conta como sem custo', () => {
  // Cortesia lancada a zero nao e falta de informacao: e uma decisao.
  const t = calcularTotais([peca(1, 0, 0), peca(1, 100, 40)])
  assert.equal(t.itens_sem_custo, 0)
})

test('OS vazia nao divide por zero', () => {
  const t = calcularTotais([], 0)
  assert.equal(t.total_geral, 0)
  assert.equal(t.margem_percentual, 0)
})

test('os centavos fecham com quantidade fracionada', () => {
  for (const q of [0.33, 4.5, 1.75, 12.125]) {
    const t = calcularTotais([peca(q, 52.9, 31.2)])
    assert.equal(t.total_pecas, emCentavos(q * 52.9))
    assert.equal(emCentavos(t.margem_valor + t.custo_total), t.total_geral)
  }
})

// ---------------------------------------------------------------------
// MAQUINA DE ESTADOS
// ---------------------------------------------------------------------

test('o caminho normal da OS anda', () => {
  const caminho = ['orcamento', 'aprovado', 'em_execucao', 'pronto', 'entregue', 'faturado']
  for (let i = 0; i < caminho.length - 1; i++) {
    assert.ok(podeIr(caminho[i], caminho[i + 1]), `${caminho[i]} -> ${caminho[i + 1]}`)
  }
})

test('nao da pra pular etapa', () => {
  assert.equal(podeIr('orcamento', 'em_execucao'), false)
  assert.equal(podeIr('orcamento', 'faturado'), false)
  assert.equal(podeIr('aprovado', 'entregue'), false)
})

test('da pra voltar um passo, mas nao ressuscitar o faturado', () => {
  assert.ok(podeIr('em_execucao', 'aprovado'), 'voltar um passo e normal na oficina')
  assert.ok(podeIr('pronto', 'em_execucao'))
  assert.equal(podeIr('faturado', 'entregue'), false)
  assert.equal(podeIr('faturado', 'cancelado'), false, 'faturado se estorna, nao se cancela')
})

test('cancelar sai de quase todo lugar', () => {
  for (const de of ['orcamento', 'aprovado', 'em_execucao', 'pronto']) {
    assert.ok(podeIr(de, 'cancelado'), `${de} -> cancelado`)
  }
  assert.equal(podeIr('entregue', 'cancelado'), false, 'carro ja saiu da oficina')
})

test('cada transicao carimba a sua data, e so a sua', () => {
  assert.equal(carimboDe('aprovado'), 'data_aprovacao')
  assert.equal(carimboDe('pronto'), 'data_conclusao')
  assert.equal(carimboDe('entregue'), 'data_entrega')
  assert.equal(carimboDe('em_execucao'), null)
  assert.equal(carimboDe('cancelado'), null)
})

// ---------------------------------------------------------------------
// CATALOGO -> ITEM DA OS
// ---------------------------------------------------------------------

test('servico por hora: quantidade e hora, preco e o valor da hora', () => {
  const i = itemDeServico(
    { id: 's1', descricao: 'Revisao', tempo_padrao_horas: 2.5, valor_hora: 130, valor_fixo: null, custo_hora: 42 }
  )
  assert.equal(i.quantidade, 2.5)
  assert.equal(i.preco_unitario, 130)
  assert.equal(i.custo_unitario, 42)
  assert.equal(calcularTotais([i]).total_geral, 325)
})

test('servico de valor fechado: quantidade 1, custo pelo tempo padrao', () => {
  const i = itemDeServico(
    { id: 's2', descricao: 'Troca de oleo', tempo_padrao_horas: 0.5, valor_hora: null, valor_fixo: 90, custo_hora: 42 }
  )
  assert.equal(i.quantidade, 1)
  assert.equal(i.preco_unitario, 90)
  assert.equal(i.custo_unitario, 21, '0,5 h x R$ 42')
})

test('quantidade informada vence o tempo padrao do catalogo', () => {
  const i = itemDeServico(
    { id: 's1', descricao: 'Revisao', tempo_padrao_horas: 2.5, valor_hora: 130, valor_fixo: null, custo_hora: 42 },
    { quantidade: 4 }
  )
  assert.equal(i.quantidade, 4)
  assert.equal(calcularTotais([i]).total_geral, 520)
})

// O que impede o orcamento aprovado de mudar sozinho quando o preco da
// peca sobe amanha: preco e custo sao COPIADOS, nao referenciados.
test('a peca entra com o preco e o custo do momento', () => {
  const produto = { id: 'p1', descricao: 'Oleo 5W30', preco_venda: 52.9, custo_medio: 31.2 }
  const i = itemDeProduto(produto, { quantidade: 4.5 })
  produto.preco_venda = 99
  produto.custo_medio = 80
  assert.equal(i.preco_unitario, 52.9)
  assert.equal(i.custo_unitario, 31.2)
})

test('peca sem custo medio entra com zero e e contada como sem custo', () => {
  const i = itemDeProduto({ id: 'p2', descricao: 'Filtro', preco_venda: 34.9, custo_medio: 0 })
  assert.equal(i.custo_unitario, 0)
  assert.equal(calcularTotais([i]).itens_sem_custo, 1)
})
