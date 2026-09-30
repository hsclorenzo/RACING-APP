import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escolherTaxa, calcularRecebimento, somarDias, emCentavos } from '../src/lib/taxas.js'

const t = (o) => ({
  adquirente_id: 'stone', modalidade: 'credito_parcelado',
  parcelas_min: 1, parcelas_max: 12, taxa_percentual: 0, taxa_fixa: 0,
  dias_liquidacao: 30, vigencia_inicio: '2020-01-01', vigencia_fim: null, ...o,
})

test('escolhe a taxa pela faixa de parcelas', () => {
  const taxas = [
    t({ parcelas_min: 2, parcelas_max: 6, taxa_percentual: 3.49 }),
    t({ parcelas_min: 7, parcelas_max: 12, taxa_percentual: 4.99 }),
  ]
  const seis = escolherTaxa(taxas, { modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08' })
  const dez = escolherTaxa(taxas, { modalidade: 'credito_parcelado', parcelas: 10, dataVenda: '2026-09-08' })
  assert.equal(Number(seis.taxa_percentual), 3.49)
  assert.equal(Number(dez.taxa_percentual), 4.99)
})

test('parcela fora de qualquer faixa nao acha taxa', () => {
  const taxas = [t({ parcelas_min: 2, parcelas_max: 6 })]
  assert.equal(
    escolherTaxa(taxas, { modalidade: 'credito_parcelado', parcelas: 18, dataVenda: '2026-09-08' }),
    null
  )
})

// O ponto do sistema inteiro: a venda de julho tem que ser lida com a
// taxa de JULHO, mesmo depois de a Stone renegociar em agosto.
test('usa a taxa vigente NA DATA DA VENDA, nao a de hoje', () => {
  const taxas = [
    t({ taxa_percentual: 3.49, vigencia_inicio: '2026-01-01', vigencia_fim: '2026-07-31' }),
    t({ taxa_percentual: 2.89, vigencia_inicio: '2026-08-01' }),
  ]
  const julho = escolherTaxa(taxas, { modalidade: 'credito_parcelado', parcelas: 3, dataVenda: '2026-07-15' })
  const agora = escolherTaxa(taxas, { modalidade: 'credito_parcelado', parcelas: 3, dataVenda: '2026-09-08' })
  assert.equal(Number(julho.taxa_percentual), 3.49)
  assert.equal(Number(agora.taxa_percentual), 2.89)
})

test('a vigencia inclui o primeiro e o ultimo dia', () => {
  const taxas = [t({ taxa_percentual: 1.5, vigencia_inicio: '2026-08-01', vigencia_fim: '2026-08-31' })]
  const arg = (d) => ({ modalidade: 'credito_parcelado', parcelas: 2, dataVenda: d })
  assert.ok(escolherTaxa(taxas, arg('2026-08-01')), 'primeiro dia vale')
  assert.ok(escolherTaxa(taxas, arg('2026-08-31')), 'ultimo dia vale')
  assert.equal(escolherTaxa(taxas, arg('2026-07-31')), null)
  assert.equal(escolherTaxa(taxas, arg('2026-09-01')), null)
})

test('empate de vigencia: a faixa mais especifica ganha', () => {
  const taxas = [
    t({ parcelas_min: 1, parcelas_max: 12, taxa_percentual: 4.99, vigencia_inicio: '2026-01-01' }),
    t({ parcelas_min: 6, parcelas_max: 6, taxa_percentual: 3.20, vigencia_inicio: '2026-01-01' }),
  ]
  const r = escolherTaxa(taxas, { modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08' })
  assert.equal(Number(r.taxa_percentual), 3.20)
})

// O caso do briefing, com número redondo para conferir de cabeça.
test('R$ 1.000 em 6x a 3,49% + R$ 0,39: liquido e 964,71', () => {
  const taxa = t({ taxa_percentual: 3.49, taxa_fixa: 0.39, dias_liquidacao: 30 })
  const r = calcularRecebimento({
    valorBruto: 1000, taxa, modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08',
  })
  assert.equal(r.valor_taxa, 35.29)      // 34,90 + 0,39
  assert.equal(r.valor_liquido, 964.71)
  assert.equal(r.data_prevista_liquidacao, '2026-10-08')
  assert.equal(r.sem_taxa_cadastrada, false)
})

// Com taxa fixa junto, o percentual da tabela NAO e o que a oficina
// perdeu. Numa venda pequena a diferenca e enorme.
test('percentual efetivo inclui a taxa fixa', () => {
  const taxa = t({ taxa_percentual: 2, taxa_fixa: 1 })
  const r = calcularRecebimento({ valorBruto: 20, taxa, modalidade: 'debito', dataVenda: '2026-09-08' })
  assert.equal(r.valor_taxa, 1.4)          // 0,40 + 1,00
  assert.equal(r.percentual_efetivo, 7)    // 7%, nao 2%
})

// Dinheiro nao tem taxa; produto errado seria mostrar 0% com cara de
// certeza quando na verdade ninguem cadastrou.
test('sem taxa cadastrada: liquido = bruto, mas avisa', () => {
  const r = calcularRecebimento({ valorBruto: 500, taxa: null, modalidade: 'dinheiro', dataVenda: '2026-09-08' })
  assert.equal(r.valor_liquido, 500)
  assert.equal(r.valor_taxa, 0)
  assert.equal(r.sem_taxa_cadastrada, true)
})

test('a soma dos centavos fecha, sem sobra de ponto flutuante', () => {
  const taxa = t({ taxa_percentual: 3.33, taxa_fixa: 0 })
  for (const bruto of [0.01, 0.05, 33.33, 99.99, 1234.56, 7777.77]) {
    const r = calcularRecebimento({ valorBruto: bruto, taxa, modalidade: 'debito', dataVenda: '2026-09-08' })
    assert.equal(emCentavos(r.valor_liquido + r.valor_taxa), emCentavos(bruto),
      `bruto ${bruto}: liquido + taxa tem que dar o bruto`)
  }
})

// Armadilha real: `new Date('2026-09-08')` e meia-noite UTC, que num
// servidor em Sao Paulo e dia 7 as 21h. Somar dia tem que ser em UTC puro.
test('somar dias nao escorrega de fuso, nem virando mes ou ano', () => {
  assert.equal(somarDias('2026-09-08', 30), '2026-10-08')
  assert.equal(somarDias('2026-01-31', 1), '2026-02-01')
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01')
  assert.equal(somarDias('2026-09-08', 0), '2026-09-08')
  assert.equal(somarDias('2028-02-28', 1), '2028-02-29') // bissexto
})

// =====================================================================
// TAXA POR OPERACAO — "cada operacao tem uma variavel" (Lorenzo, 08/09)
// =====================================================================

test('imposto entra na conta separado da taxa da maquininha', () => {
  const taxa = t({ taxa_percentual: 3.49, taxa_fixa: 0.39, imposto_percentual: 6 })
  const r = calcularRecebimento({
    valorBruto: 1000, taxa, modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08',
  })
  assert.equal(r.valor_taxa, 35.29)
  assert.equal(r.valor_imposto, 60)
  assert.equal(r.valor_descontado, 95.29)
  assert.equal(r.valor_liquido, 904.71)
  assert.equal(r.percentual_efetivo, 9.53)
})

test('taxa digitada na venda vence a cadastrada', () => {
  const taxa = t({ taxa_percentual: 3.49, taxa_fixa: 0.39, dias_liquidacao: 30 })
  const r = calcularRecebimento({
    valorBruto: 1000, taxa, modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08',
    manual: { taxa_percentual: 2.1, dias_liquidacao: 14 },
  })
  assert.equal(r.taxa_percentual_aplicada, 2.1)
  assert.equal(r.taxa_fixa_aplicada, 0.39, 'o que nao foi digitado continua vindo do cadastro')
  assert.equal(r.valor_taxa, 21.39)
  assert.equal(r.data_prevista_liquidacao, '2026-09-22')
  assert.equal(r.taxa_manual, true)
})

// A armadilha do `||`: uma taxa manual de 0% e informacao legitima
// ("nesta venda a maquininha nao cobrou"), e o `||` a trocaria pela do
// cadastro silenciosamente.
test('taxa manual ZERO e respeitada, nao trocada pela cadastrada', () => {
  const taxa = t({ taxa_percentual: 3.49, taxa_fixa: 0.39 })
  const r = calcularRecebimento({
    valorBruto: 1000, taxa, modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08',
    manual: { taxa_percentual: 0, taxa_fixa: 0 },
  })
  assert.equal(r.valor_taxa, 0)
  assert.equal(r.valor_liquido, 1000)
  assert.equal(r.taxa_manual, true)
})

test('campo vazio no manual nao apaga o cadastro', () => {
  const taxa = t({ taxa_percentual: 3.49, taxa_fixa: 0.39 })
  const r = calcularRecebimento({
    valorBruto: 1000, taxa, modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08',
    manual: { taxa_percentual: '', taxa_fixa: null, imposto_percentual: undefined },
  })
  assert.equal(r.taxa_percentual_aplicada, 3.49)
  assert.equal(r.valor_liquido, 964.71)
  assert.equal(r.taxa_manual, false, 'nao mexer em nada nao e mexer na mao')
})

// Sem tabela nenhuma, digitando tudo: o sistema tem que aceitar e NAO
// avisar "sem taxa cadastrada" — o numero e da pessoa e esta certo.
test('sem nenhuma taxa cadastrada, so o que foi digitado vale', () => {
  const r = calcularRecebimento({
    valorBruto: 1000, taxa: null, modalidade: 'credito_parcelado', parcelas: 6, dataVenda: '2026-09-08',
    manual: { taxa_percentual: 4.5, taxa_fixa: 1, imposto_percentual: 6, dias_liquidacao: 30 },
  })
  assert.equal(r.valor_taxa, 46)
  assert.equal(r.valor_imposto, 60)
  assert.equal(r.valor_liquido, 894)
  assert.equal(r.data_prevista_liquidacao, '2026-10-08')
  assert.equal(r.sem_taxa_cadastrada, false, 'digitou, entao nao esta faltando nada')
})

test('sem tabela e sem digitar nada: avisa que esta faltando', () => {
  const r = calcularRecebimento({
    valorBruto: 1000, taxa: null, modalidade: 'pix', dataVenda: '2026-09-08',
  })
  assert.equal(r.valor_liquido, 1000)
  assert.equal(r.sem_taxa_cadastrada, true)
  assert.equal(r.taxa_manual, false)
})

test('taxa + imposto continuam fechando o bruto ao centavo', () => {
  const taxa = t({ taxa_percentual: 3.33, taxa_fixa: 0.47, imposto_percentual: 8.65 })
  for (const bruto of [0.03, 17.77, 99.99, 1234.56, 9876.54]) {
    const r = calcularRecebimento({ valorBruto: bruto, taxa, modalidade: 'debito', dataVenda: '2026-09-08' })
    assert.equal(
      emCentavos(r.valor_liquido + r.valor_taxa + r.valor_imposto), emCentavos(bruto),
      `bruto ${bruto}: liquido + taxa + imposto tem que dar o bruto`
    )
  }
})
