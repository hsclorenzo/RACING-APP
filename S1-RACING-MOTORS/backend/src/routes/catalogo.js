import express from 'express'
import { pool } from '../db/pool.js'
import { exigirAutenticacao } from '../middleware/autenticacao.js'
import {
  TODOS, ESCREVE, contexto, rota, montarUpdate, erroDeUso,
  traduzirErroBanco, registrarAuditoria,
  semCusto,
} from '../lib/rotas.js'

export const rotasCatalogo = express.Router()
rotasCatalogo.use(exigirAutenticacao)

const CAMPOS_PRODUTO = [
  'sku', 'descricao', 'categoria', 'unidade_compra', 'unidade_uso', 'fator_conversao',
  'preco_venda', 'estoque_minimo', 'ativo',
]
const CAMPOS_SERVICO = [
  'descricao', 'tempo_padrao_horas', 'valor_hora', 'valor_fixo', 'custo_hora', 'ativo',
]
const CAMPOS_FORNECEDOR = ['nome', 'documento', 'telefone', 'contato', 'observacoes', 'ativo']

// =====================================================================
// PRODUTOS (peças e insumos)
// =====================================================================

rotasCatalogo.get('/produtos', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, TODOS)
  const busca = String(req.query.busca || '').trim()
  const r = await pool.query(
    `select * from produtos
      where tenant_id = $1
        and ($2 or ativo)
        and ($3 = '' or descricao ilike '%'||$3||'%'
             or coalesce(sku,'') ilike '%'||$3||'%'
             or coalesce(categoria,'') ilike '%'||$3||'%')
        and ($4 = false or estoque_atual <= estoque_minimo)
      order by descricao limit 300`,
    [tenant, req.query.inativos === '1', busca, req.query.abaixo_minimo === '1']
  )
  res.json(semCusto(r.rows, papel))
}))

rotasCatalogo.post('/produtos', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const descricao = String(req.body.descricao || '').trim()
  if (!descricao) throw erroDeUso('A descrição do produto é obrigatória')

  // `||` NÃO serve aqui: `0 || 1` é 1, então mandar fator zero passaria
  // pela validação virando 1 silenciosamente. `??` só troca null e
  // undefined, que é exatamente o que "não informou" significa.
  const fator = Number(req.body.fator_conversao ?? 1)
  if (!(fator > 0)) {
    throw erroDeUso('O fator de conversão precisa ser maior que zero (ex.: balde de 20 L = 20).')
  }

  // ESTOQUE_ATUAL E CUSTO_MEDIO NÃO ENTRAM AQUI, nunca.
  // Os dois só mudam por movimento de estoque (compra, baixa da OS,
  // ajuste). Deixar cadastrar "estoque inicial" direto no produto abriria
  // um caminho de entrada sem histórico — e aí o extrato do produto nunca
  // mais fecharia com o saldo. Estoque inicial entra como uma compra na E4.
  // Os ::numeric abaixo não são enfeite. Sem eles, o zero literal dentro
  // do coalesce faz o Postgres inferir o parâmetro como INTEGER, e um
  // preço de 48,90 é recusado com "invalid input syntax for type integer".
  // Quebra só contra banco de verdade — lendo o código, parece certo.
  //
  // (E o comentário mora AQUI, fora do SQL, de propósito: crase dentro de
  // template literal fecha a string, e o erro aponta uma linha que não é
  // a culpada.)
  try {
    const r = await pool.query(
      `insert into produtos (tenant_id, sku, descricao, categoria, unidade_compra, unidade_uso,
                             fator_conversao, preco_venda, estoque_minimo)
       values ($1,$2,$3,$4,coalesce($5,'un'),coalesce($6,'un'),$7::numeric,
               coalesce($8::numeric,0),coalesce($9::numeric,0))
       returning *`,
      [tenant, req.body.sku || null, descricao, req.body.categoria || null,
       req.body.unidade_compra || null, req.body.unidade_uso || null, fator,
       req.body.preco_venda || null, req.body.estoque_minimo || null]
    )
    await registrarAuditoria(tenant, req.usuario.id, 'produtos', r.rows[0].id, 'criou', { descricao })
    res.json(r.rows[0])
  } catch (erro) {
    throw traduzirErroBanco(erro, {
      uq_produtos_sku: `Já existe um produto com o código ${req.body.sku}.`,
    })
  }
}))

rotasCatalogo.patch('/produtos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  if (Object.prototype.hasOwnProperty.call(req.body, 'fator_conversao')
      && !(Number(req.body.fator_conversao) > 0)) {
    throw erroDeUso('O fator de conversão precisa ser maior que zero.')
  }
  const { pedacos, valores } = montarUpdate(req.body, CAMPOS_PRODUTO, [tenant, req.params.id])
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')

  try {
    const r = await pool.query(
      `update produtos set ${pedacos.join(', ')}, atualizado_em = now()
        where tenant_id = $1 and id = $2 returning *`,
      valores
    )
    if (!r.rows[0]) throw erroDeUso('Produto não encontrado', 404)
    await registrarAuditoria(tenant, req.usuario.id, 'produtos', req.params.id, 'alterou', req.body)
    res.json(r.rows[0])
  } catch (erro) {
    throw traduzirErroBanco(erro, { uq_produtos_sku: 'Já existe outro produto com esse código.' })
  }
}))

rotasCatalogo.delete('/produtos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `update produtos set ativo = false, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning id`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Produto não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'produtos', req.params.id, 'desativou')
  res.json({ ok: true })
}))

// =====================================================================
// SERVIÇOS (catálogo de mão de obra)
// =====================================================================

rotasCatalogo.get('/servicos', rota(async (req, res) => {
  const { tenant, papel } = contexto(req, TODOS)
  const busca = String(req.query.busca || '').trim()
  const r = await pool.query(
    `select *,
            -- O preço que a tela mostra: valor fechado quando existe,
            -- senão horas x valor da hora. Calculado no BANCO para que
            -- a OS e a tela nunca discordem por causa de duas contas.
            coalesce(valor_fixo, coalesce(tempo_padrao_horas,0) * coalesce(valor_hora,0)) as valor_sugerido
       from servicos
      where tenant_id = $1 and ($2 or ativo)
        and ($3 = '' or descricao ilike '%'||$3||'%')
      order by descricao limit 300`,
    [tenant, req.query.inativos === '1', busca]
  )
  res.json(semCusto(r.rows, papel))
}))

rotasCatalogo.post('/servicos', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const descricao = String(req.body.descricao || '').trim()
  if (!descricao) throw erroDeUso('A descrição do serviço é obrigatória')

  const temFixo = req.body.valor_fixo !== undefined && req.body.valor_fixo !== null
    && req.body.valor_fixo !== ''
  const temHora = Number(req.body.valor_hora) > 0
  if (!temFixo && !temHora) {
    throw erroDeUso('Informe um valor fechado OU o valor da hora — senão o serviço entra na OS por R$ 0,00.')
  }

  const r = await pool.query(
    `insert into servicos (tenant_id, descricao, tempo_padrao_horas, valor_hora, valor_fixo, custo_hora)
     values ($1,$2,$3,$4,$5,coalesce($6::numeric,0)) returning *`,
    [tenant, descricao, req.body.tempo_padrao_horas || null, req.body.valor_hora || null,
     temFixo ? req.body.valor_fixo : null, req.body.custo_hora || null]
  )
  await registrarAuditoria(tenant, req.usuario.id, 'servicos', r.rows[0].id, 'criou', { descricao })
  res.json(r.rows[0])
}))

rotasCatalogo.patch('/servicos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const { pedacos, valores } = montarUpdate(req.body, CAMPOS_SERVICO, [tenant, req.params.id])
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')
  const r = await pool.query(
    `update servicos set ${pedacos.join(', ')}, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning *`,
    valores
  )
  if (!r.rows[0]) throw erroDeUso('Serviço não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'servicos', req.params.id, 'alterou', req.body)
  res.json(r.rows[0])
}))

rotasCatalogo.delete('/servicos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `update servicos set ativo = false, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning id`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Serviço não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'servicos', req.params.id, 'desativou')
  res.json({ ok: true })
}))

// =====================================================================
// FORNECEDORES
// =====================================================================

rotasCatalogo.get('/fornecedores', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const busca = String(req.query.busca || '').trim()
  const r = await pool.query(
    `select * from fornecedores
      where tenant_id = $1 and ($2 or ativo)
        and ($3 = '' or nome ilike '%'||$3||'%' or coalesce(contato,'') ilike '%'||$3||'%')
      order by nome limit 300`,
    [tenant, req.query.inativos === '1', busca]
  )
  res.json(r.rows)
}))

rotasCatalogo.post('/fornecedores', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const nome = String(req.body.nome || '').trim()
  if (!nome) throw erroDeUso('O nome do fornecedor é obrigatório')
  const r = await pool.query(
    `insert into fornecedores (tenant_id, nome, documento, telefone, contato, observacoes)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [tenant, nome, req.body.documento || null, req.body.telefone || null,
     req.body.contato || null, req.body.observacoes || null]
  )
  await registrarAuditoria(tenant, req.usuario.id, 'fornecedores', r.rows[0].id, 'criou', { nome })
  res.json(r.rows[0])
}))

rotasCatalogo.patch('/fornecedores/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const { pedacos, valores } = montarUpdate(req.body, CAMPOS_FORNECEDOR, [tenant, req.params.id])
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')
  const r = await pool.query(
    `update fornecedores set ${pedacos.join(', ')}, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning *`,
    valores
  )
  if (!r.rows[0]) throw erroDeUso('Fornecedor não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'fornecedores', req.params.id, 'alterou', req.body)
  res.json(r.rows[0])
}))

rotasCatalogo.delete('/fornecedores/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `update fornecedores set ativo = false, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning id`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Fornecedor não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'fornecedores', req.params.id, 'desativou')
  res.json({ ok: true })
}))
