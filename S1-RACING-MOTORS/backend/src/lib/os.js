import { emCentavos } from './taxas.js'

// =====================================================================
// ORDEM DE SERVIÇO — regras que não são de banco nem de tela.
//
// Tudo aqui é função pura, testável sem banco, e é a MESMA conta que a
// tela mostra ao vivo e que o `fechar_os` vai congelar na E5. Se a tela
// somasse por um lado e o fechamento por outro, um dia divergiriam por
// um centavo e ninguém saberia em qual acreditar.
// =====================================================================

// ---------------------------------------------------------------------
// A máquina de estados. Um `status` livre com UPDATE solto deixa a OS ir
// de "entregue" de volta para "orçamento" e o histórico deixa de fazer
// sentido — inclusive o financeiro, que já gerou título.
//
// `cancelado` sai de quase todo lugar, porque cliente desiste mesmo. Mas
// não sai de `faturado`: aí já existe título e recebimento, e desfazer é
// estorno, não cancelamento.
// ---------------------------------------------------------------------
export const TRANSICOES = {
  orcamento: ['aprovado', 'cancelado'],
  aprovado: ['em_execucao', 'orcamento', 'cancelado'],
  em_execucao: ['pronto', 'aprovado', 'cancelado'],
  pronto: ['entregue', 'em_execucao', 'cancelado'],
  entregue: ['faturado', 'pronto'],
  faturado: [],
  cancelado: ['orcamento'],
}

export const STATUS = [
  { valor: 'orcamento', rotulo: 'Orçamento', cor: 'texto-3' },
  { valor: 'aprovado', rotulo: 'Aprovado', cor: 'info' },
  { valor: 'em_execucao', rotulo: 'Em execução', cor: 'alerta' },
  { valor: 'pronto', rotulo: 'Pronto', cor: 'ok' },
  { valor: 'entregue', rotulo: 'Entregue', cor: 'ok' },
  { valor: 'faturado', rotulo: 'Faturado', cor: 'racing-vermelho' },
  { valor: 'cancelado', rotulo: 'Cancelado', cor: 'perigo' },
]

export function podeIr(de, para) {
  return Boolean(TRANSICOES[de] && TRANSICOES[de].includes(para))
}

// Os carimbos de data que cada transição fecha. Preenchidos pelo sistema,
// nunca digitados — data de conclusão digitada é data inventada.
export function carimboDe(status) {
  return {
    aprovado: 'data_aprovacao',
    pronto: 'data_conclusao',
    entregue: 'data_entrega',
  }[status] || null
}

// ---------------------------------------------------------------------
// Totais e margem. É o coração da tela de OS.
//
// O desconto é abatido do total, NÃO do custo — desconto sai do lucro da
// oficina, não do que a peça custou. Errar isso faz a margem parecer
// intacta depois de um desconto de 20%, que é exatamente o contrário do
// que aconteceu.
// ---------------------------------------------------------------------
export function calcularTotais(itens, desconto = 0) {
  let servicos = 0
  let pecas = 0
  let custo = 0
  let itensSemCusto = 0

  for (const i of itens || []) {
    const qtd = Number(i.quantidade) || 0
    const preco = Number(i.preco_unitario) || 0
    const custoUn = Number(i.custo_unitario) || 0
    const total = emCentavos(qtd * preco)

    if (i.tipo === 'servico') servicos = emCentavos(servicos + total)
    else pecas = emCentavos(pecas + total)

    custo = emCentavos(custo + emCentavos(qtd * custoUn))
    if (custoUn === 0 && total > 0) itensSemCusto++
  }

  const desc = emCentavos(desconto)
  const geral = emCentavos(servicos + pecas - desc)
  const margemValor = emCentavos(geral - custo)

  return {
    total_servicos: servicos,
    total_pecas: pecas,
    desconto: desc,
    total_geral: geral,
    custo_total: custo,
    margem_valor: margemValor,
    // Margem sobre a VENDA (quanto de cada real fica), não sobre o custo.
    // É o número que o dono de oficina usa e o que fecha com o DRE.
    margem_percentual: geral > 0 ? emCentavos((margemValor / geral) * 100) : 0,
    // Quantos itens entraram com custo zero. Sem isto, uma OS de peças
    // recém-cadastradas (custo médio ainda zerado, porque nunca houve
    // compra) mostra 100% de margem com cara de certeza. A tela precisa
    // dizer que aquele 100% é ignorância, não lucro.
    itens_sem_custo: itensSemCusto,
  }
}

// ---------------------------------------------------------------------
// Como um item do catálogo vira item de OS.
//
// Preço e custo são COPIADOS para o item, nunca lidos por referência.
// Mudar o preço da peça amanhã não pode mexer no valor de uma OS que já
// foi orçada e aprovada pelo cliente.
// ---------------------------------------------------------------------
// ARMADILHA do `||`, a mesma que já mordeu no fator de conversão:
// `Number(0) || 1` é 1. Uma quantidade zero mandada pela tela viraria 1
// silenciosamente, e o item entraria na OS cobrando do cliente. Aqui o
// zero atravessa e é a validação que o recusa, com mensagem.
const quantidadeInformada = (valor, padrao) =>
  valor === null || valor === undefined || valor === '' ? Number(padrao) : Number(valor)

export function itemDeServico(servico, { quantidade } = {}) {
  const porHora = servico.valor_fixo === null || servico.valor_fixo === undefined
  const custoHora = Number(servico.custo_hora) || 0

  if (porHora) {
    const horas = quantidadeInformada(quantidade, servico.tempo_padrao_horas ?? 1)
    return {
      tipo: 'servico',
      servico_id: servico.id,
      descricao_livre: servico.descricao,
      quantidade: horas,
      preco_unitario: emCentavos(servico.valor_hora),
      custo_unitario: emCentavos(custoHora),
    }
  }

  // Valor fechado: a quantidade é 1 "serviço", e o custo é a hora do
  // mecânico vezes o tempo padrão — sem tempo padrão, custo é zero e a
  // tela avisa.
  return {
    tipo: 'servico',
    servico_id: servico.id,
    descricao_livre: servico.descricao,
    quantidade: quantidadeInformada(quantidade, 1),
    preco_unitario: emCentavos(servico.valor_fixo),
    custo_unitario: emCentavos(custoHora * (Number(servico.tempo_padrao_horas) || 0)),
  }
}

export function itemDeProduto(produto, { quantidade = 1 } = {}) {
  return {
    tipo: 'peca',
    produto_id: produto.id,
    descricao_livre: produto.descricao,
    quantidade: quantidadeInformada(quantidade, 1),
    preco_unitario: emCentavos(produto.preco_venda),
    // Custo médio NA HORA do lançamento. A compra de amanhã muda o custo
    // médio do produto e não pode mexer na margem de uma OS já fechada.
    custo_unitario: Number(produto.custo_medio) || 0,
  }
}
