import { novoCustoMedio, aplicarMovimento, deltaDeBaixa } from './estoque.js'
import { erroDeUso } from './rotas.js'

// =====================================================================
// A única porta de entrada e saída do estoque.
//
// Toda mexida no saldo passa por `lancarMovimento`: compra, baixa da OS,
// estorno, ajuste de inventário. Isso existe para que `produtos.estoque_atual`
// NUNCA discorde da soma de `movimentos_estoque` — o defeito clássico é
// alguém dar um UPDATE direto no saldo "só desta vez", e a partir daí o
// extrato do produto deixa de fechar e ninguém descobre quando começou.
//
// Sempre dentro de uma transação, sempre com `for update` na linha do
// produto: duas baixas simultâneas do mesmo óleo, sem a trava, leriam o
// mesmo saldo e uma sobrescreveria a outra.
// =====================================================================

export async function lancarMovimento(cliente, tenant, {
  produtoId, tipo, quantidade, custoUnitario = null,
  osId = null, compraId = null, motivo = null, usuarioId = null,
}) {
  const qtd = Number(quantidade)
  if (!(qtd > 0)) throw erroDeUso('A quantidade do movimento precisa ser maior que zero.')

  const p = await cliente.query(
    `select id, descricao, estoque_atual, custo_medio, unidade_uso
       from produtos where tenant_id = $1 and id = $2 for update`,
    [tenant, produtoId]
  )
  if (!p.rows[0]) throw erroDeUso('Produto não encontrado', 404)
  const produto = p.rows[0]

  const saldoAntes = Number(produto.estoque_atual)
  const custoAntes = Number(produto.custo_medio)
  const saldoDepois = aplicarMovimento(saldoAntes, tipo, qtd)

  // O custo médio só se move na ENTRADA. Saída consome ao custo vigente;
  // estorno devolve peça, não recalcula preço; ajuste de inventário
  // corrige contagem, não valor.
  const custoDepois = tipo === 'entrada'
    ? novoCustoMedio({
        estoqueAtual: saldoAntes,
        custoMedioAtual: custoAntes,
        quantidadeEntrada: qtd,
        custoUnitarioEntrada: custoUnitario,
      })
    : custoAntes

  await cliente.query(
    `update produtos set estoque_atual = $3::numeric, custo_medio = $4::numeric,
                         atualizado_em = now()
      where tenant_id = $1 and id = $2`,
    [tenant, produtoId, saldoDepois, custoDepois]
  )

  // `estoque_depois` e `custo_medio_depois` gravados em cada linha: é o
  // que permite auditar quando o custo mudou e por quê, sem refazer a
  // conta do zero — e é o que torna o estorno de compra possível.
  const m = await cliente.query(
    `insert into movimentos_estoque
       (tenant_id, produto_id, tipo, quantidade, custo_unitario, estoque_depois,
        custo_medio_depois, os_id, compra_id, motivo, usuario_id)
     values ($1,$2,$3::tipo_movimento,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8,$9,$10,$11)
     returning *`,
    [tenant, produtoId, tipo, qtd, custoUnitario ?? custoAntes, saldoDepois, custoDepois,
     osId, compraId, motivo, usuarioId]
  )

  return {
    ...m.rows[0],
    produto_descricao: produto.descricao,
    unidade_uso: produto.unidade_uso,
    estoque_antes: saldoAntes,
    custo_medio_antes: custoAntes,
  }
}

// ---------------------------------------------------------------------
// Põe o estoque em dia com o que a OS consome, seja qual for o caminho
// que a OS tenha feito.
//
// Chamada na transição para `em_execucao` e depois de qualquer mexida em
// item de OS que já teve baixa. Como trabalha por DELTA (ver
// `deltaDeBaixa`), rodar duas vezes seguidas não baixa em dobro — o que
// importa porque o balcão aperta o botão duas vezes com a mão suja.
// ---------------------------------------------------------------------
export async function sincronizarBaixa(cliente, tenant, osId, usuarioId) {
  const itens = await cliente.query(
    `select tipo, produto_id, quantidade from os_itens where tenant_id = $1 and os_id = $2`,
    [tenant, osId]
  )
  const feitos = await cliente.query(
    `select produto_id, tipo, quantidade from movimentos_estoque
      where tenant_id = $1 and os_id = $2 and tipo in ('saida','estorno')`,
    [tenant, osId]
  )

  const deltas = deltaDeBaixa(itens.rows, feitos.rows)
  const lancados = []
  for (const d of deltas) {
    const mov = await lancarMovimento(cliente, tenant, {
      produtoId: d.produto_id,
      tipo: d.tipo,
      quantidade: d.quantidade,
      osId,
      usuarioId,
      motivo: d.tipo === 'saida' ? 'Baixa pela OS' : 'Devolução por mudança na OS',
    })
    lancados.push(mov)

    // ----------------------------------------------------------------
    // Preenche o custo que faltava, e SÓ o que faltava.
    //
    // A peça lançada na OS antes de existir qualquer compra entra com
    // custo zero — o sistema não sabia. Quando a compra chega e a peça
    // sai da prateleira, o custo passa a existir, e é este o custo real
    // do consumo. Preencher aqui é fechar uma lacuna.
    //
    // O `and custo_unitario = 0` é o ponto: item que JÁ tinha custo não
    // é tocado. Reescrever o custo de uma OS orçada mudaria a margem do
    // passado, que é exatamente o que o snapshot existe para impedir.
    // ----------------------------------------------------------------
    if (d.tipo === 'saida' && Number(mov.custo_medio_depois) > 0) {
      await cliente.query(
        `update os_itens set custo_unitario = $4::numeric, atualizado_em = now()
          where tenant_id = $1 and os_id = $2 and produto_id = $3 and custo_unitario = 0`,
        [tenant, osId, d.produto_id, mov.custo_medio_depois]
      )
    }
  }
  return lancados
}

// Devolve TUDO que a OS tirou. Usada quando a OS volta para antes da
// execução ou é cancelada: a peça não foi usada, então ela está na
// prateleira de novo — e a prateleira precisa saber disso hoje, não no
// inventário do fim do ano.
export async function estornarBaixa(cliente, tenant, osId, usuarioId) {
  const feitos = await cliente.query(
    `select produto_id, tipo, quantidade from movimentos_estoque
      where tenant_id = $1 and os_id = $2 and tipo in ('saida','estorno')`,
    [tenant, osId]
  )
  const deltas = deltaDeBaixa([], feitos.rows)
  for (const d of deltas) {
    await lancarMovimento(cliente, tenant, {
      produtoId: d.produto_id,
      tipo: d.tipo,
      quantidade: d.quantidade,
      osId,
      usuarioId,
      motivo: 'Devolução: a OS voltou atrás',
    })
  }
  return deltas.length
}
