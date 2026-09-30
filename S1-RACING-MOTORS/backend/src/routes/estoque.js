import express from 'express'
import { pool, emTransacao } from '../db/pool.js'
import { exigirAutenticacao } from '../middleware/autenticacao.js'
import { TODOS, ESCREVE, DINHEIRO, contexto, rota, erroDeUso, registrarAuditoria, semCusto } from '../lib/rotas.js'
import { quantidadeEmUso, custoPorUnidadeDeUso, valorDoEstoque, emQuatroCasas } from '../lib/estoque.js'
import { lancarMovimento } from '../lib/movimentos.js'
import { emCentavos } from '../lib/taxas.js'

export const rotasEstoque = express.Router()
rotasEstoque.use(exigirAutenticacao)

// =====================================================================
// COMPRAS — a única forma de entrar peça no estoque com custo.
// =====================================================================

rotasEstoque.get('/compras', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `select c.*, f.nome as fornecedor_nome,
            (select count(*) from compras_itens i where i.compra_id = c.id)::int as itens
       from compras c left join fornecedores f on f.id = c.fornecedor_id
      where c.tenant_id = $1
        and ($2 = '' or coalesce(c.numero_nota,'') ilike '%'||$2||'%'
             or coalesce(f.nome,'') ilike '%'||$2||'%')
      order by c.data desc, c.criado_em desc limit 200`,
    [tenant, String(req.query.busca || '').trim()]
  )
  res.json(r.rows)
}))

rotasEstoque.get('/compras/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const c = await pool.query(
    `select c.*, f.nome as fornecedor_nome from compras c
       left join fornecedores f on f.id = c.fornecedor_id
      where c.tenant_id = $1 and c.id = $2`,
    [tenant, req.params.id]
  )
  if (!c.rows[0]) throw erroDeUso('Compra não encontrada', 404)
  const itens = await pool.query(
    `select i.*, p.descricao, p.unidade_uso, p.unidade_compra
       from compras_itens i join produtos p on p.id = i.produto_id
      where i.tenant_id = $1 and i.compra_id = $2 order by i.criado_em`,
    [tenant, req.params.id]
  )
  res.json({ ...c.rows[0], itens: itens.rows })
}))

// ---------------------------------------------------------------------
// Lançar a nota. Tudo numa transação: ou entra a compra inteira com
// todos os movimentos e todos os custos médios recalculados, ou não
// entra nada. Meia nota lançada é pior que nota nenhuma — o estoque
// passa a mentir e ninguém sabe onde parou.
// ---------------------------------------------------------------------
rotasEstoque.post('/compras', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const itens = Array.isArray(req.body.itens) ? req.body.itens : []
  if (itens.length === 0) throw erroDeUso('A compra precisa de ao menos um item.')

  const resultado = await emTransacao(async (cliente) => {
    const c = await cliente.query(
      `insert into compras (tenant_id, fornecedor_id, numero_nota, data, observacoes)
       values ($1,$2,$3,coalesce($4::date, current_date),$5) returning *`,
      [tenant, req.body.fornecedor_id || null, req.body.numero_nota || null,
       req.body.data || null, req.body.observacoes || null]
    )
    const compra = c.rows[0]
    let total = 0
    const lancados = []

    for (const item of itens) {
      const p = await cliente.query(
        `select id, descricao, fator_conversao, unidade_compra, unidade_uso
           from produtos where tenant_id = $1 and id = $2`,
        [tenant, item.produto_id]
      )
      if (!p.rows[0]) throw erroDeUso(`Produto não encontrado na linha da nota.`, 404)
      const produto = p.rows[0]

      const qtdCompra = Number(item.quantidade_compra)
      const custoTotal = Number(item.custo_total)
      if (!(qtdCompra > 0)) {
        throw erroDeUso(`Quantidade inválida em "${produto.descricao}".`)
      }
      if (!(custoTotal >= 0)) {
        throw erroDeUso(`Valor inválido em "${produto.descricao}".`)
      }

      // AQUI mora a conta que a planilha não fazia: 3 baldes viram 60 L,
      // e R$ 890 viram R$ 14,8333 por litro.
      const fator = Number(produto.fator_conversao) || 1
      const emUso = quantidadeEmUso(qtdCompra, fator)
      const custoUso = custoPorUnidadeDeUso(custoTotal, qtdCompra, fator)

      await cliente.query(
        `insert into compras_itens
           (tenant_id, compra_id, produto_id, quantidade_compra, unidade, custo_total, custo_unitario_uso)
         values ($1,$2,$3,$4::numeric,$5,$6::numeric,$7::numeric)`,
        [tenant, compra.id, produto.id, qtdCompra, produto.unidade_compra, custoTotal, custoUso]
      )

      const mov = await lancarMovimento(cliente, tenant, {
        produtoId: produto.id,
        tipo: 'entrada',
        quantidade: emUso,
        custoUnitario: custoUso,
        compraId: compra.id,
        usuarioId: req.usuario.id,
        motivo: req.body.numero_nota ? `Compra NF ${req.body.numero_nota}` : 'Compra',
      })

      total = emCentavos(total + custoTotal)
      lancados.push({
        produto: produto.descricao,
        entrou: emUso,
        unidade: produto.unidade_uso,
        custo_unitario: custoUso,
        custo_medio_antes: mov.custo_medio_antes,
        custo_medio_depois: Number(mov.custo_medio_depois),
        estoque_depois: Number(mov.estoque_depois),
      })
    }

    await cliente.query(
      `update compras set valor_total = $3::numeric, atualizado_em = now()
        where tenant_id = $1 and id = $2`,
      [tenant, compra.id, total]
    )
    return { ...compra, valor_total: total, lancados }
  })

  await registrarAuditoria(tenant, req.usuario.id, 'compras', resultado.id, 'lancou',
    { nota: req.body.numero_nota, total: resultado.valor_total })
  res.json(resultado)
}))

// ---------------------------------------------------------------------
// Estornar a compra. Existe porque digitar nota errada acontece.
//
// A REGRA HONESTA: só estorna se a compra ainda for a última coisa que
// aconteceu com cada produto dela. Custo médio ponderado é irreversível
// por natureza — se depois da compra houve saída ou outra entrada, o
// custo atual já é uma mistura, e "desfazer" seria inventar um número.
// Nesse caso o caminho certo é um ajuste de inventário, que é explícito
// e fica no extrato.
// ---------------------------------------------------------------------
rotasEstoque.delete('/compras/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, DINHEIRO)

  const resultado = await emTransacao(async (cliente) => {
    const movs = await cliente.query(
      `select * from movimentos_estoque
        where tenant_id = $1 and compra_id = $2 order by criado_em`,
      [tenant, req.params.id]
    )
    if (movs.rows.length === 0) throw erroDeUso('Compra não encontrada', 404)

    for (const m of movs.rows) {
      const depois = await cliente.query(
        `select count(*)::int as n from movimentos_estoque
          where tenant_id = $1 and produto_id = $2 and criado_em > $3`,
        [tenant, m.produto_id, m.criado_em]
      )
      if (depois.rows[0].n > 0) {
        const p = await cliente.query(`select descricao from produtos where id = $1`, [m.produto_id])
        throw erroDeUso(
          `Não dá para estornar: "${p.rows[0].descricao}" já teve movimento depois desta compra, ` +
          'e o custo médio virou uma mistura. Corrija por um ajuste de estoque.'
        )
      }
    }

    for (const m of movs.rows) {
      // Devolve o saldo E o custo médio que existiam antes. O custo é
      // restaurado direto porque `lancarMovimento` não mexe em custo em
      // estorno — e aqui a gente sabe exatamente qual era.
      await lancarMovimento(cliente, tenant, {
        produtoId: m.produto_id,
        tipo: 'saida',
        quantidade: m.quantidade,
        compraId: m.compra_id,
        usuarioId: req.usuario.id,
        motivo: 'Estorno da compra',
      })
      const anterior = await cliente.query(
        `select custo_medio_depois from movimentos_estoque
          where tenant_id = $1 and produto_id = $2 and criado_em < $3
          order by criado_em desc limit 1`,
        [tenant, m.produto_id, m.criado_em]
      )
      await cliente.query(
        `update produtos set custo_medio = $3::numeric, atualizado_em = now()
          where tenant_id = $1 and id = $2`,
        [tenant, m.produto_id, anterior.rows[0]?.custo_medio_depois ?? 0]
      )
    }

    await cliente.query(`delete from compras where tenant_id = $1 and id = $2`, [tenant, req.params.id])
    return { ok: true, produtos: movs.rows.length }
  })

  await registrarAuditoria(tenant, req.usuario.id, 'compras', req.params.id, 'estornou')
  res.json(resultado)
}))

// =====================================================================
// AJUSTE DE INVENTÁRIO
// =====================================================================
// Contou a prateleira e não bate. O ajuste registra a diferença COM
// MOTIVO em vez de deixar alguém "acertar" o saldo por fora — o motivo
// é o que permite, meses depois, distinguir quebra de furto de erro de
// lançamento.

rotasEstoque.post('/ajuste', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const motivo = String(req.body.motivo || '').trim()
  if (!motivo) throw erroDeUso('Diga o motivo do ajuste. Sem motivo, o extrato não explica nada depois.')
  const contado = Number(req.body.estoque_contado)
  if (Number.isNaN(contado)) throw erroDeUso('Informe a quantidade contada.')

  const resultado = await emTransacao(async (cliente) => {
    const p = await cliente.query(
      `select estoque_atual, descricao, unidade_uso from produtos
        where tenant_id = $1 and id = $2 for update`,
      [tenant, req.body.produto_id]
    )
    if (!p.rows[0]) throw erroDeUso('Produto não encontrado', 404)

    const atual = Number(p.rows[0].estoque_atual)
    const diferenca = emQuatroCasas(contado - atual)
    if (diferenca === 0) return { ok: true, sem_diferenca: true, estoque: atual }

    return {
      ok: true,
      diferenca,
      movimento: await lancarMovimento(cliente, tenant, {
        produtoId: req.body.produto_id,
        // `ajuste` soma; para tirar do estoque a diferença negativa vira
        // uma saída, e é assim que o extrato lê melhor.
        tipo: diferenca > 0 ? 'ajuste' : 'saida',
        quantidade: Math.abs(diferenca),
        usuarioId: req.usuario.id,
        motivo: `Inventário: ${motivo}`,
      }),
    }
  })

  await registrarAuditoria(tenant, req.usuario.id, 'produtos', req.body.produto_id, 'ajustou estoque',
    { contado, motivo })
  res.json(resultado)
}))

// =====================================================================
// EXTRATO E ALERTAS
// =====================================================================

rotasEstoque.get('/produto/:id', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, TODOS)
  const p = await pool.query(
    `select * from produtos where tenant_id = $1 and id = $2`, [tenant, req.params.id]
  )
  if (!p.rows[0]) throw erroDeUso('Produto não encontrado', 404)

  const m = await pool.query(
    `select m.*, u.nome as usuario_nome, o.numero as os_numero, c.numero_nota
       from movimentos_estoque m
       left join usuarios u on u.id = m.usuario_id
       left join ordens_servico o on o.id = m.os_id
       left join compras c on c.id = m.compra_id
      where m.tenant_id = $1 and m.produto_id = $2
      order by m.criado_em desc limit 200`,
    [tenant, req.params.id]
  )

  // O custo aparece aqui com TRÊS nomes — `custo_medio` no produto,
  // `custo_unitario` e `custo_medio_depois` no movimento. Foi exatamente
  // por esconder um e esquecer o outro que vazou uma vez; por isso a
  // lista mora em `semCusto`, num arquivo só, e não em cada rota.
  res.json({
    produto: semCusto(p.rows[0], papel),
    movimentos: semCusto(m.rows, papel),
  })
}))

rotasEstoque.get('/alertas', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, TODOS)
  const r = await pool.query(
    `select id, descricao, sku, unidade_uso, estoque_atual, estoque_minimo, custo_medio, preco_venda
       from produtos
      where tenant_id = $1 and ativo
        and (estoque_atual < 0 or (estoque_minimo > 0 and estoque_atual <= estoque_minimo))
      order by (estoque_atual < 0) desc, estoque_atual - estoque_minimo`,
    [tenant]
  )
  const linhas = semCusto(r.rows, papel).map((p, i) => ({
    ...p,
    // Saldo negativo não é "acabou": é compra que ninguém lançou. São
    // dois problemas diferentes e a tela precisa separar.
    negativo: Number(r.rows[i].estoque_atual) < 0,
  }))
  res.json(linhas)
}))

rotasEstoque.get('/resumo', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `select estoque_atual, custo_medio from produtos where tenant_id = $1 and ativo`, [tenant]
  )
  const alertas = await pool.query(
    `select count(*)::int as n from produtos
      where tenant_id = $1 and ativo
        and (estoque_atual < 0 or (estoque_minimo > 0 and estoque_atual <= estoque_minimo))`,
    [tenant]
  )
  res.json({
    produtos: r.rows.length,
    valor_parado: valorDoEstoque(r.rows),
    em_alerta: alertas.rows[0].n,
  })
}))
