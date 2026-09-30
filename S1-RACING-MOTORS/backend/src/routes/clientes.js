import express from 'express'
import { pool } from '../db/pool.js'
import { exigirAutenticacao } from '../middleware/autenticacao.js'
import {
  TODOS, ESCREVE, contexto, rota, montarUpdate, erroDeUso,
  traduzirErroBanco, registrarAuditoria,
} from '../lib/rotas.js'

export const rotasClientes = express.Router()
rotasClientes.use(exigirAutenticacao)

// Placa normalizada: ABC-1234, abc1234 e "ABC 1234" são a MESMA placa. Sem
// isto o mesmo carro entra duas vezes e o histórico do veículo se parte em
// dois — que é justamente o que o dono quer consultar quando o carro volta.
const normalizarPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const formatarPlaca = (p) => {
  const n = normalizarPlaca(p)
  return n.length === 7 ? `${n.slice(0, 3)}-${n.slice(3)}` : n
}

const CAMPOS_CLIENTE = [
  'nome', 'tipo_pessoa', 'documento', 'telefone', 'email', 'endereco', 'observacoes', 'ativo',
]
const CAMPOS_VEICULO = [
  'cliente_id', 'marca', 'modelo', 'ano', 'cor', 'chassi', 'km_atual',
  'motorizacao', 'observacoes', 'ativo',
]

// =====================================================================
// CLIENTES
// =====================================================================

rotasClientes.get('/', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const busca = String(req.query.busca || '').trim()
  const incluirInativos = req.query.inativos === '1'

  // A busca cobre nome, telefone, documento E PLACA de propósito: quem
  // atende no balcão tem na mão a placa do carro, não o nome do dono.
  const r = await pool.query(
    `select c.*,
            (select count(*) from veiculos v where v.cliente_id = c.id and v.ativo)::int as veiculos
       from clientes c
      where c.tenant_id = $1
        and ($2 or c.ativo)
        and ($3 = '' or c.nome ilike '%'||$3||'%'
             or coalesce(c.telefone,'') ilike '%'||$3||'%'
             or coalesce(c.documento,'') ilike '%'||$3||'%'
             or exists (select 1 from veiculos v
                         where v.cliente_id = c.id
                           and upper(replace(v.placa,'-','')) like '%'||$4||'%'))
      order by c.nome
      limit 200`,
    [tenant, incluirInativos, busca, normalizarPlaca(busca)]
  )
  res.json(r.rows)
}))

rotasClientes.get('/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const c = await pool.query(`select * from clientes where tenant_id = $1 and id = $2`, [
    tenant, req.params.id,
  ])
  if (!c.rows[0]) throw erroDeUso('Cliente não encontrado', 404)
  const v = await pool.query(
    `select * from veiculos where tenant_id = $1 and cliente_id = $2 order by ativo desc, placa`,
    [tenant, req.params.id]
  )
  res.json({ ...c.rows[0], veiculos: v.rows })
}))

rotasClientes.post('/', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const nome = String(req.body.nome || '').trim()
  // Nome é o ÚNICO campo obrigatório, por decisão de produto: cada campo
  // exigido a mais é uma chance de o balcão desistir e voltar pro papel.
  if (!nome) throw erroDeUso('O nome do cliente é obrigatório')

  const r = await pool.query(
    `insert into clientes (tenant_id, nome, tipo_pessoa, documento, telefone, email, endereco, observacoes)
     values ($1,$2,coalesce($3::tipo_pessoa,'pf'),$4,$5,$6,$7,$8) returning *`,
    [tenant, nome, req.body.tipo_pessoa || null, req.body.documento || null,
     req.body.telefone || null, req.body.email || null, req.body.endereco || null,
     req.body.observacoes || null]
  )
  await registrarAuditoria(tenant, req.usuario.id, 'clientes', r.rows[0].id, 'criou', { nome })
  res.json(r.rows[0])
}))

rotasClientes.patch('/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const { pedacos, valores } = montarUpdate(req.body, CAMPOS_CLIENTE, [tenant, req.params.id])
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')

  const r = await pool.query(
    `update clientes set ${pedacos.join(', ')}, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning *`,
    valores
  )
  if (!r.rows[0]) throw erroDeUso('Cliente não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'clientes', req.params.id, 'alterou', req.body)
  res.json(r.rows[0])
}))

// Não existe DELETE de cliente, e é de propósito: apagar quem já tem OS
// levaria o histórico junto. `ativo = false` some da lista e preserva o
// passado. O mesmo vale para veículo, produto, serviço e fornecedor.
rotasClientes.delete('/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `update clientes set ativo = false, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning id`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Cliente não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'clientes', req.params.id, 'desativou')
  res.json({ ok: true })
}))

// =====================================================================
// VEÍCULOS
// =====================================================================

rotasClientes.get('/veiculos/lista', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const busca = String(req.query.busca || '').trim()
  const r = await pool.query(
    `select v.*, c.nome as cliente_nome, c.telefone as cliente_telefone
       from veiculos v join clientes c on c.id = v.cliente_id
      where v.tenant_id = $1
        and ($2 or v.ativo)
        and ($3 = '' or upper(replace(v.placa,'-','')) like '%'||$4||'%'
             or coalesce(v.modelo,'') ilike '%'||$3||'%'
             or coalesce(v.marca,'') ilike '%'||$3||'%'
             or c.nome ilike '%'||$3||'%')
      order by v.placa limit 200`,
    [tenant, req.query.inativos === '1', busca, normalizarPlaca(busca)]
  )
  res.json(r.rows)
}))

rotasClientes.post('/veiculos', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const placa = normalizarPlaca(req.body.placa)
  if (!placa) throw erroDeUso('A placa é obrigatória')
  if (!req.body.cliente_id) throw erroDeUso('Escolha o dono do veículo')

  try {
    const r = await pool.query(
      `insert into veiculos (tenant_id, cliente_id, placa, marca, modelo, ano, cor, chassi, km_atual, motorizacao, observacoes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [tenant, req.body.cliente_id, formatarPlaca(placa), req.body.marca || null,
       req.body.modelo || null, req.body.ano || null, req.body.cor || null,
       req.body.chassi || null, req.body.km_atual || null, req.body.motorizacao || null,
       req.body.observacoes || null]
    )
    await registrarAuditoria(tenant, req.usuario.id, 'veiculos', r.rows[0].id, 'criou', { placa })
    res.json(r.rows[0])
  } catch (erro) {
    throw traduzirErroBanco(erro, {
      uq_veiculos_placa: `A placa ${formatarPlaca(placa)} já está cadastrada nesta oficina.`,
    })
  }
}))

rotasClientes.patch('/veiculos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const corpo = { ...req.body }
  // A placa passa pela mesma normalização na edição. Se ela só fosse
  // normalizada no cadastro, editar "abc1234" driblaria o índice único.
  if (Object.prototype.hasOwnProperty.call(corpo, 'placa')) {
    corpo.placa = formatarPlaca(corpo.placa)
    if (!corpo.placa) throw erroDeUso('A placa é obrigatória')
  }
  const { pedacos, valores } = montarUpdate(
    corpo, ['placa', ...CAMPOS_VEICULO], [tenant, req.params.id]
  )
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')

  try {
    const r = await pool.query(
      `update veiculos set ${pedacos.join(', ')}, atualizado_em = now()
        where tenant_id = $1 and id = $2 returning *`,
      valores
    )
    if (!r.rows[0]) throw erroDeUso('Veículo não encontrado', 404)
    await registrarAuditoria(tenant, req.usuario.id, 'veiculos', req.params.id, 'alterou', corpo)
    res.json(r.rows[0])
  } catch (erro) {
    throw traduzirErroBanco(erro, {
      uq_veiculos_placa: 'Já existe outro veículo com essa placa nesta oficina.',
    })
  }
}))

rotasClientes.delete('/veiculos/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, ESCREVE)
  const r = await pool.query(
    `update veiculos set ativo = false, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning id`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Veículo não encontrado', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'veiculos', req.params.id, 'desativou')
  res.json({ ok: true })
}))
