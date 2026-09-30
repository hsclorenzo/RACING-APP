import express from 'express'
import { pool, emTransacao } from '../db/pool.js'
import { exigirAutenticacao } from '../middleware/autenticacao.js'
import {
  TODOS, ESCREVE, contexto, rota, montarUpdate, erroDeUso, registrarAuditoria,
} from '../lib/rotas.js'
import {
  STATUS, podeIr, carimboDe, calcularTotais, itemDeServico, itemDeProduto,
} from '../lib/os.js'
import { sincronizarBaixa, estornarBaixa } from '../lib/movimentos.js'

// ---------------------------------------------------------------------
// A partir de `em_execucao` a peça saiu da prateleira de verdade.
//
// Não em `aprovado`: orçamento aprovado que nunca vira serviço inflaria
// o consumo com peça que ninguém pegou. Não em `entregue`: aí a
// prateleira teria mentido por dias, e quem for comprar reposição
// compra errado. `em_execucao` é o momento em que o mecânico
// efetivamente abre a caixa.
// ---------------------------------------------------------------------
const COM_BAIXA = ['em_execucao', 'pronto', 'entregue', 'faturado']

export const rotasOs = express.Router()
rotasOs.use(exigirAutenticacao)

// Mecânico mexe na OS: é o trabalho dele lançar peça e serviço. O que ele
// não vê é CUSTO e MARGEM (ver `limparMargem`).
const MEXE_NA_OS = ['admin', 'balcao', 'mecanico']

const CAMPOS_OS = [
  'km_entrada', 'mecanico_id', 'descricao_problema', 'diagnostico', 'desconto', 'observacoes',
]

// ---------------------------------------------------------------------
// O mecânico vê a OS inteira menos o dinheiro que é do dono. Apagado NO
// SERVIDOR — esconder na tela deixa o número na resposta HTTP, e o
// primeiro que abrir o inspetor do navegador lê tudo.
// ---------------------------------------------------------------------
function limparMargem(linha, papel) {
  if (papel !== 'mecanico' || !linha) return linha
  const { custo_total, margem_valor, margem_percentual, itens_sem_custo, ...resto } = linha
  return resto
}

function limparCustoItens(itens, papel) {
  if (papel !== 'mecanico') return itens
  return itens.map(({ custo_unitario, ...resto }) => resto)
}

// ---------------------------------------------------------------------
// Recalcula e grava os totais. Chamada depois de TODA mexida em item ou
// desconto — nunca deixa o cabeçalho da OS discordar da soma dos itens.
//
// Recebe o `cliente` de uma transação em aberto para que somar e gravar
// aconteçam no mesmo lugar: se dois lançamentos de peça chegarem juntos e
// cada um somasse a lista que leu antes do outro, o total ficaria errado.
// ---------------------------------------------------------------------
async function recalcular(cliente, tenant, osId, usuarioId) {
  const os = await cliente.query(
    `select desconto, baixa_confirmada from ordens_servico
      where tenant_id = $1 and id = $2 for update`,
    [tenant, osId]
  )
  if (!os.rows[0]) throw erroDeUso('OS não encontrada', 404)

  // Se a OS já está em execução, mexer nos itens tem que mexer no
  // estoque na mesma hora. Trabalha por delta, então rodar aqui em toda
  // recontagem (inclusive quando só o desconto mudou) não baixa em dobro.
  if (os.rows[0].baixa_confirmada && usuarioId) {
    await sincronizarBaixa(cliente, tenant, osId, usuarioId)
  }

  const itens = await cliente.query(
    `select tipo, quantidade, preco_unitario, custo_unitario
       from os_itens where tenant_id = $1 and os_id = $2`,
    [tenant, osId]
  )
  const t = calcularTotais(itens.rows, os.rows[0].desconto)

  const r = await cliente.query(
    `update ordens_servico
        set total_servicos = $3, total_pecas = $4, total_geral = $5,
            custo_total = $6, margem_valor = $7, margem_percentual = $8,
            atualizado_em = now()
      where tenant_id = $1 and id = $2 returning *`,
    [tenant, osId, t.total_servicos, t.total_pecas, t.total_geral,
     t.custo_total, t.margem_valor, t.margem_percentual]
  )
  return { ...r.rows[0], itens_sem_custo: t.itens_sem_custo }
}

rotasOs.get('/status', rota(async (req, res) => {
  contexto(req, TODOS)
  res.json(STATUS)
}))

// =====================================================================
// LISTA / KANBAN
// =====================================================================

rotasOs.get('/', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, TODOS)
  const busca = String(req.query.busca || '').trim()
  const placa = busca.toUpperCase().replace(/[^A-Z0-9]/g, '')

  const r = await pool.query(
    `select o.id, o.numero, o.status, o.data_abertura, o.data_entrega,
            o.total_geral, o.custo_total, o.margem_valor, o.margem_percentual,
            o.descricao_problema,
            c.nome as cliente_nome, v.placa, v.marca, v.modelo,
            u.nome as mecanico_nome,
            (select count(*) from os_itens i where i.os_id = o.id)::int as itens,
            (select count(*) from os_fotos f where f.os_id = o.id)::int as fotos,
            -- Mesma honestidade do detalhe: a lista não pode mostrar
            -- "100% de margem" em verde quando aquilo é custo faltando.
            (select count(*) from os_itens i
              where i.os_id = o.id and i.custo_unitario = 0 and i.total > 0)::int as itens_sem_custo
       from ordens_servico o
       join clientes c on c.id = o.cliente_id
       join veiculos v on v.id = o.veiculo_id
       left join usuarios u on u.id = o.mecanico_id
      where o.tenant_id = $1
        and ($2 = '' or o.status::text = $2)
        -- O mecânico vê a fila inteira da oficina, não só a dele: ele
        -- precisa saber o que vem a seguir. O que ele não vê é a margem.
        and ($3::uuid is null or o.mecanico_id = $3)
        and ($4 = '' or c.nome ilike '%'||$4||'%'
             or upper(replace(v.placa,'-','')) like '%'||$5||'%'
             or o.numero::text = $4)
      order by o.numero desc limit 300`,
    [tenant, req.query.status || '', req.query.mecanico || null, busca, placa]
  )
  res.json(r.rows.map((x) => limparMargem(x, papel)))
}))

// Contagem por coluna do kanban. Uma query, não sete.
rotasOs.get('/resumo', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const r = await pool.query(
    `select status::text as status, count(*)::int as quantidade,
            coalesce(sum(total_geral),0) as valor
       from ordens_servico where tenant_id = $1 group by status`,
    [tenant]
  )
  res.json(r.rows)
}))

rotasOs.get('/:id', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, TODOS)
  const o = await pool.query(
    `select o.*, c.nome as cliente_nome, c.telefone as cliente_telefone,
            c.documento as cliente_documento,
            v.placa, v.marca, v.modelo, v.ano, v.cor, v.km_atual, v.motorizacao,
            u.nome as mecanico_nome
       from ordens_servico o
       join clientes c on c.id = o.cliente_id
       join veiculos v on v.id = o.veiculo_id
       left join usuarios u on u.id = o.mecanico_id
      where o.tenant_id = $1 and o.id = $2`,
    [tenant, req.params.id]
  )
  if (!o.rows[0]) throw erroDeUso('OS não encontrada', 404)

  const itens = await pool.query(
    `select i.*, u.nome as mecanico_nome
       from os_itens i left join usuarios u on u.id = i.mecanico_id
      where i.tenant_id = $1 and i.os_id = $2 order by i.criado_em`,
    [tenant, req.params.id]
  )
  // `conteudo` fica de fora: a lista de fotos traz só os metadados, e o
  // binário sai pela rota da foto. Sem isso, abrir uma OS com 6 fotos
  // baixaria 600 KB de JSON no celular do mecânico.
  const fotos = await pool.query(
    `select id, momento, legenda, bytes, criado_em
       from os_fotos where tenant_id = $1 and os_id = $2 order by criado_em`,
    [tenant, req.params.id]
  )

  const totais = calcularTotais(itens.rows, o.rows[0].desconto)
  res.json({
    ...limparMargem({ ...o.rows[0], itens_sem_custo: totais.itens_sem_custo }, papel),
    itens: limparCustoItens(itens.rows, papel),
    fotos: fotos.rows,
  })
}))

// =====================================================================
// ABRIR / EDITAR
// =====================================================================

rotasOs.post('/', rota(async (req, res) => {
  const { tenant } = contexto(req, MEXE_NA_OS)
  if (!req.body.veiculo_id) throw erroDeUso('Escolha o veículo')

  const resultado = await emTransacao(async (cliente) => {
    // O dono do carro vem do cadastro do veículo, não do formulário: se a
    // tela mandasse os dois, um dia chegaria uma OS com o carro de um e a
    // conta de outro.
    const v = await cliente.query(
      `select cliente_id from veiculos where tenant_id = $1 and id = $2`,
      [tenant, req.body.veiculo_id]
    )
    if (!v.rows[0]) throw erroDeUso('Veículo não encontrado', 404)

    const n = await cliente.query(`select proximo_numero_os($1) as numero`, [tenant])
    const os = await cliente.query(
      `insert into ordens_servico
         (tenant_id, numero, cliente_id, veiculo_id, km_entrada, mecanico_id, descricao_problema)
       values ($1,$2,$3,$4,$5::numeric,$6,$7) returning *`,
      [tenant, n.rows[0].numero, v.rows[0].cliente_id, req.body.veiculo_id,
       req.body.km_entrada || null, req.body.mecanico_id || null,
       req.body.descricao_problema || null]
    )

    // KM de entrada também atualiza o cadastro do carro. É a "integração
    // e praticidade": o dado já foi digitado uma vez, ninguém deve
    // digitar de novo na tela do veículo.
    if (req.body.km_entrada) {
      await cliente.query(
        `update veiculos set km_atual = greatest(coalesce(km_atual,0), $3::numeric),
                             atualizado_em = now()
          where tenant_id = $1 and id = $2`,
        [tenant, req.body.veiculo_id, req.body.km_entrada]
      )
    }
    return os.rows[0]
  })

  await registrarAuditoria(tenant, req.usuario.id, 'ordens_servico', resultado.id, 'abriu',
    { numero: resultado.numero })
  res.json(resultado)
}))

rotasOs.patch('/:id', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, MEXE_NA_OS)
  // Desconto é dinheiro: mecânico não dá desconto.
  if (papel === 'mecanico' && 'desconto' in req.body) {
    throw erroDeUso('Só o balcão ou o administrador altera o desconto.', 403)
  }

  const atual = await pool.query(
    `select status, total_servicos, total_pecas from ordens_servico where tenant_id = $1 and id = $2`,
    [tenant, req.params.id]
  )
  if (!atual.rows[0]) throw erroDeUso('OS não encontrada', 404)
  if (['faturado', 'cancelado'].includes(atual.rows[0].status)) {
    throw erroDeUso(`OS ${atual.rows[0].status === 'faturado' ? 'faturada' : 'cancelada'} não se edita.`)
  }

  if ('desconto' in req.body) {
    const d = Number(req.body.desconto || 0)
    const bruto = Number(atual.rows[0].total_servicos) + Number(atual.rows[0].total_pecas)
    if (d < 0) throw erroDeUso('O desconto não pode ser negativo.')
    // Desconto maior que a OS deixaria o total negativo — e um total
    // negativo vira "a oficina deve ao cliente", que não é o caso.
    if (d > bruto) throw erroDeUso(`O desconto não pode passar do total da OS (R$ ${bruto}).`)
  }

  const { pedacos, valores } = montarUpdate(req.body, CAMPOS_OS, [tenant, req.params.id])
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')

  const resultado = await emTransacao(async (cliente) => {
    await cliente.query(
      `update ordens_servico set ${pedacos.join(', ')}, atualizado_em = now()
        where tenant_id = $1 and id = $2`,
      valores
    )
    return recalcular(cliente, tenant, req.params.id, req.usuario.id)
  })
  await registrarAuditoria(tenant, req.usuario.id, 'ordens_servico', req.params.id, 'alterou', req.body)
  res.json(limparMargem(resultado, papel))
}))

// ---------------------------------------------------------------------
// MUDANÇA DE STATUS — passa pela máquina de estados, sempre.
// ---------------------------------------------------------------------
rotasOs.post('/:id/status', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, MEXE_NA_OS)
  const novo = String(req.body.status || '')
  if (!STATUS.some((s) => s.valor === novo)) throw erroDeUso('Status inválido')

  const resultado = await emTransacao(async (cliente) => {
    const o = await cliente.query(
      `select * from ordens_servico where tenant_id = $1 and id = $2 for update`,
      [tenant, req.params.id]
    )
    if (!o.rows[0]) throw erroDeUso('OS não encontrada', 404)
    const de = o.rows[0].status
    if (de === novo) return o.rows[0]

    if (!podeIr(de, novo)) {
      const nome = (v) => STATUS.find((s) => s.valor === v)?.rotulo || v
      throw erroDeUso(`Uma OS ${nome(de).toLowerCase()} não pode ir para ${nome(novo).toLowerCase()}.`)
    }
    // Aprovar uma OS vazia gera título de R$ 0 lá na frente.
    if (novo === 'aprovado') {
      const n = await cliente.query(
        `select count(*)::int as n from os_itens where tenant_id = $1 and os_id = $2`,
        [tenant, req.params.id]
      )
      if (n.rows[0].n === 0) throw erroDeUso('Lance ao menos um item antes de aprovar o orçamento.')
    }
    // Faturar é o gatilho do dinheiro (E5): a `fechar_os` vai morar aqui.
    if (novo === 'faturado' && papel === 'mecanico') {
      throw erroDeUso('Só o balcão ou o administrador fatura uma OS.', 403)
    }

    const carimbo = carimboDe(novo)
    const r = await cliente.query(
      `update ordens_servico
          set status = $3::status_os,
              ${carimbo ? `${carimbo} = coalesce(${carimbo}, now()),` : ''}
              atualizado_em = now()
        where tenant_id = $1 and id = $2 returning *`,
      [tenant, req.params.id, novo]
    )

    // ESTOQUE. Dentro da MESMA transação da mudança de status: se a
    // baixa falhar (produto sumiu, por exemplo), a OS também não muda de
    // status. Estoque e status andando separados é como a prateleira
    // começa a mentir.
    let movimentos = 0
    if (COM_BAIXA.includes(novo)) {
      movimentos = (await sincronizarBaixa(cliente, tenant, req.params.id, req.usuario.id)).length
      await cliente.query(
        `update ordens_servico set baixa_confirmada = true where tenant_id = $1 and id = $2`,
        [tenant, req.params.id]
      )
    } else if (COM_BAIXA.includes(de)) {
      // Voltou para antes da execução, ou foi cancelada: a peça não foi
      // usada e volta pra prateleira HOJE, não no inventário do ano que vem.
      movimentos = await estornarBaixa(cliente, tenant, req.params.id, req.usuario.id)
      await cliente.query(
        `update ordens_servico set baixa_confirmada = false where tenant_id = $1 and id = $2`,
        [tenant, req.params.id]
      )
    }

    return { ...r.rows[0], baixa_confirmada: COM_BAIXA.includes(novo), movimentos_estoque: movimentos }
  })

  await registrarAuditoria(tenant, req.usuario.id, 'ordens_servico', req.params.id,
    `mudou para ${novo}`, { status: novo })
  res.json(limparMargem(resultado, papel))
}))

// =====================================================================
// ITENS
// =====================================================================

function conferirEditavel(status) {
  if (['faturado', 'cancelado', 'entregue'].includes(status)) {
    throw erroDeUso('Esta OS já foi encerrada — não dá para mexer nos itens.')
  }
}

rotasOs.post('/:id/itens', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, MEXE_NA_OS)

  const resultado = await emTransacao(async (cliente) => {
    const o = await cliente.query(
      `select status from ordens_servico where tenant_id = $1 and id = $2`,
      [tenant, req.params.id]
    )
    if (!o.rows[0]) throw erroDeUso('OS não encontrada', 404)
    conferirEditavel(o.rows[0].status)

    let item
    if (req.body.servico_id) {
      const s = await cliente.query(
        `select * from servicos where tenant_id = $1 and id = $2`, [tenant, req.body.servico_id]
      )
      if (!s.rows[0]) throw erroDeUso('Serviço não encontrado', 404)
      item = itemDeServico(s.rows[0], { quantidade: req.body.quantidade })
    } else if (req.body.produto_id) {
      const p = await cliente.query(
        `select * from produtos where tenant_id = $1 and id = $2`, [tenant, req.body.produto_id]
      )
      if (!p.rows[0]) throw erroDeUso('Produto não encontrado', 404)
      item = itemDeProduto(p.rows[0], { quantidade: req.body.quantidade })
    } else {
      // Item livre: a peça que veio da esquina e não está no cadastro.
      // Existe porque a alternativa é o balcão desistir e anotar no papel.
      const descricao = String(req.body.descricao_livre || '').trim()
      if (!descricao) throw erroDeUso('Descreva o item, escolha um serviço ou escolha uma peça.')
      item = {
        tipo: req.body.tipo === 'peca' ? 'peca' : 'servico',
        descricao_livre: descricao,
        quantidade: req.body.quantidade === undefined || req.body.quantidade === ''
          ? 1 : Number(req.body.quantidade),
        preco_unitario: Number(req.body.preco_unitario || 0),
        custo_unitario: Number(req.body.custo_unitario || 0),
      }
    }

    // Preço e custo podem ser sobrescritos no lançamento. Mesma filosofia
    // da taxa: o catálogo sugere, a operação decide.
    if (req.body.preco_unitario !== undefined && req.body.preco_unitario !== '') {
      item.preco_unitario = Number(req.body.preco_unitario)
    }
    if (papel !== 'mecanico' && req.body.custo_unitario !== undefined && req.body.custo_unitario !== '') {
      item.custo_unitario = Number(req.body.custo_unitario)
    }
    if (!(Number(item.quantidade) > 0)) throw erroDeUso('A quantidade precisa ser maior que zero.')
    if (Number(item.preco_unitario) < 0) throw erroDeUso('O preço não pode ser negativo.')

    await cliente.query(
      `insert into os_itens
         (tenant_id, os_id, tipo, servico_id, produto_id, descricao_livre,
          quantidade, custo_unitario, preco_unitario, total, mecanico_id)
       values ($1,$2,$3::tipo_item_os,$4,$5,$6,$7::numeric,$8::numeric,$9::numeric,
               $7::numeric * $9::numeric,$10)`,
      [tenant, req.params.id, item.tipo, item.servico_id || null, item.produto_id || null,
       item.descricao_livre, item.quantidade, item.custo_unitario, item.preco_unitario,
       req.body.mecanico_id || (papel === 'mecanico' ? req.usuario.id : null)]
    )
    return recalcular(cliente, tenant, req.params.id, req.usuario.id)
  })

  res.json(limparMargem(resultado, papel))
}))

rotasOs.patch('/itens/:id', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, MEXE_NA_OS)

  const resultado = await emTransacao(async (cliente) => {
    const i = await cliente.query(
      `select i.os_id, o.status from os_itens i
         join ordens_servico o on o.id = i.os_id
        where i.tenant_id = $1 and i.id = $2`,
      [tenant, req.params.id]
    )
    if (!i.rows[0]) throw erroDeUso('Item não encontrado', 404)
    conferirEditavel(i.rows[0].status)

    const permitidos = ['quantidade', 'preco_unitario', 'descricao_livre', 'mecanico_id']
    if (papel !== 'mecanico') permitidos.push('custo_unitario')
    const { pedacos, valores } = montarUpdate(req.body, permitidos, [tenant, req.params.id])
    if (pedacos.length === 0) throw erroDeUso('Nada para alterar')

    await cliente.query(
      `update os_itens set ${pedacos.join(', ')}, atualizado_em = now()
        where tenant_id = $1 and id = $2`,
      valores
    )
    // `total` é derivado; recalculado aqui para nunca discordar dos dois
    // campos que o formam.
    await cliente.query(
      `update os_itens set total = quantidade * preco_unitario
        where tenant_id = $1 and id = $2`,
      [tenant, req.params.id]
    )
    return recalcular(cliente, tenant, i.rows[0].os_id, req.usuario.id)
  })

  res.json(limparMargem(resultado, papel))
}))

rotasOs.delete('/itens/:id', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, MEXE_NA_OS)

  const resultado = await emTransacao(async (cliente) => {
    const i = await cliente.query(
      `select i.os_id, o.status from os_itens i
         join ordens_servico o on o.id = i.os_id
        where i.tenant_id = $1 and i.id = $2`,
      [tenant, req.params.id]
    )
    if (!i.rows[0]) throw erroDeUso('Item não encontrado', 404)
    conferirEditavel(i.rows[0].status)

    await cliente.query(`delete from os_itens where tenant_id = $1 and id = $2`, [tenant, req.params.id])
    return recalcular(cliente, tenant, i.rows[0].os_id, req.usuario.id)
  })

  res.json(limparMargem(resultado, papel))
}))

// =====================================================================
// FOTOS
// =====================================================================
// Chegam em base64 no corpo do POST (o celular comprime antes, no
// canvas) e são gravadas como BINÁRIO. Guardar o base64 cru infla 33% e
// paga decodificação em toda leitura.

const LIMITE_FOTO = 3 * 1024 * 1024

rotasOs.post('/:id/fotos', rota(async (req, res) => {
  const { tenant } = contexto(req, MEXE_NA_OS)
  const dados = String(req.body.arquivo || '')
  const casa = dados.match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
  if (!casa) throw erroDeUso('Formato de imagem não reconhecido.')

  const binario = Buffer.from(casa[2], 'base64')
  if (binario.length > LIMITE_FOTO) {
    throw erroDeUso('Foto muito grande. Tire de novo — o app reduz sozinho antes de enviar.')
  }

  const o = await pool.query(
    `select 1 from ordens_servico where tenant_id = $1 and id = $2`, [tenant, req.params.id]
  )
  if (!o.rows[0]) throw erroDeUso('OS não encontrada', 404)

  const r = await pool.query(
    `insert into os_fotos (tenant_id, os_id, momento, legenda, usuario_id, conteudo, tipo_mime, bytes)
     values ($1,$2,coalesce($3,'entrada')::momento_foto,$4,$5,$6,$7,$8)
     returning id, momento, legenda, bytes, criado_em`,
    [tenant, req.params.id, req.body.momento || null, req.body.legenda || null,
     req.usuario.id, binario, casa[1], binario.length]
  )
  res.json(r.rows[0])
}))

rotasOs.get('/fotos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const r = await pool.query(
    `select conteudo, tipo_mime from os_fotos where tenant_id = $1 and id = $2`,
    [tenant, req.params.id]
  )
  if (!r.rows[0] || !r.rows[0].conteudo) throw erroDeUso('Foto não encontrada', 404)
  res.setHeader('Content-Type', r.rows[0].tipo_mime || 'image/jpeg')
  // A foto nunca muda depois de gravada, e a URL carrega o id — então
  // pode ficar em cache no aparelho para sempre.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.send(r.rows[0].conteudo)
}))

rotasOs.delete('/fotos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `delete from os_fotos where tenant_id = $1 and id = $2 returning os_id`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Foto não encontrada', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'os_fotos', req.params.id, 'apagou')
  res.json({ ok: true })
}))
