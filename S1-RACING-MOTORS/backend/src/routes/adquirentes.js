import express from 'express'
import { pool } from '../db/pool.js'
import { exigirAutenticacao } from '../middleware/autenticacao.js'
import {
  TODOS, DINHEIRO, contexto, rota, montarUpdate, erroDeUso, registrarAuditoria,
} from '../lib/rotas.js'
import { MODALIDADES, simular } from '../lib/taxas.js'

export const rotasAdquirentes = express.Router()
rotasAdquirentes.use(exigirAutenticacao)

const MODALIDADES_VALIDAS = MODALIDADES.map((m) => m.valor)
const PARCELAVEIS = MODALIDADES.filter((m) => m.parcelavel).map((m) => m.valor)

rotasAdquirentes.get('/modalidades', rota(async (req, res) => {
  contexto(req, TODOS)
  res.json(MODALIDADES)
}))

// =====================================================================
// ADQUIRENTES (Stone, Cielo, InfinitePay, Mercado Pago...)
// =====================================================================

rotasAdquirentes.get('/', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const r = await pool.query(
    `select a.*,
            (select count(*) from taxas_adquirente t
              where t.adquirente_id = a.id
                and (t.vigencia_fim is null or t.vigencia_fim >= current_date))::int as taxas_vigentes
       from adquirentes a
      where a.tenant_id = $1 and ($2 or a.ativo)
      order by a.nome`,
    [tenant, req.query.inativos === '1']
  )
  res.json(r.rows)
}))

rotasAdquirentes.post('/', rota(async (req, res) => {
  const { tenant } = contexto(req, DINHEIRO)
  const nome = String(req.body.nome || '').trim()
  if (!nome) throw erroDeUso('O nome da maquininha é obrigatório')
  const r = await pool.query(
    `insert into adquirentes (tenant_id, nome) values ($1,$2) returning *`,
    [tenant, nome]
  )
  await registrarAuditoria(tenant, req.usuario.id, 'adquirentes', r.rows[0].id, 'criou', { nome })
  res.json(r.rows[0])
}))

rotasAdquirentes.patch('/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, DINHEIRO)
  const { pedacos, valores } = montarUpdate(req.body, ['nome', 'ativo'], [tenant, req.params.id])
  if (pedacos.length === 0) throw erroDeUso('Nada para alterar')
  const r = await pool.query(
    `update adquirentes set ${pedacos.join(', ')}, atualizado_em = now()
      where tenant_id = $1 and id = $2 returning *`,
    valores
  )
  if (!r.rows[0]) throw erroDeUso('Maquininha não encontrada', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'adquirentes', req.params.id, 'alterou', req.body)
  res.json(r.rows[0])
}))

// =====================================================================
// TAXAS
// =====================================================================

rotasAdquirentes.get('/taxas', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const r = await pool.query(
    `select t.*, a.nome as adquirente_nome,
            (t.vigencia_inicio <= current_date
             and (t.vigencia_fim is null or t.vigencia_fim >= current_date)) as vigente
       from taxas_adquirente t left join adquirentes a on a.id = t.adquirente_id
      where t.tenant_id = $1 and ($2::uuid is null or t.adquirente_id = $2)
      order by a.nome, t.modalidade, t.parcelas_min, t.vigencia_inicio desc`,
    [tenant, req.query.adquirente || null]
  )
  res.json(r.rows)
}))

rotasAdquirentes.post('/taxas', rota(async (req, res) => {
  const { tenant } = contexto(req, DINHEIRO)
  const modalidade = String(req.body.modalidade || '')
  if (!MODALIDADES_VALIDAS.includes(modalidade)) throw erroDeUso('Forma de pagamento inválida')

  // Só crédito parcelado tem faixa. Deixar cadastrar "PIX de 3 a 6
  // parcelas" criaria uma taxa que nunca casa com venda nenhuma — e o
  // dono passaria meses achando que cadastrou.
  const parcelavel = PARCELAVEIS.includes(modalidade)
  const min = parcelavel ? Number(req.body.parcelas_min || 2) : 1
  const max = parcelavel ? Number(req.body.parcelas_max || min) : 1
  if (parcelavel && (min < 2 || max < min)) {
    throw erroDeUso('A faixa de parcelas está invertida ou começa antes de 2x.')
  }

  // Todos os três podem vir vazios: taxa é sugestão, e uma maquininha
  // cadastrada sem taxa nenhuma é um estado legítimo (a pessoa ainda não
  // recebeu o extrato). O que não pode é número impossível.
  const pct = Number(req.body.taxa_percentual || 0)
  const fixa = Number(req.body.taxa_fixa || 0)
  const imposto = Number(req.body.imposto_percentual || 0)
  if (pct < 0 || pct > 100) throw erroDeUso('A taxa percentual precisa ficar entre 0 e 100.')
  if (imposto < 0 || imposto > 100) throw erroDeUso('O imposto precisa ficar entre 0 e 100.')
  if (fixa < 0) throw erroDeUso('A taxa fixa não pode ser negativa.')

  const inicio = String(req.body.vigencia_inicio || '').slice(0, 10) || null
  const fim = String(req.body.vigencia_fim || '').slice(0, 10) || null
  if (inicio && fim && fim < inicio) throw erroDeUso('O fim da vigência é antes do início.')

  const r = await pool.query(
    `insert into taxas_adquirente
       (tenant_id, adquirente_id, modalidade, parcelas_min, parcelas_max,
        taxa_percentual, taxa_fixa, imposto_percentual, dias_liquidacao,
        vigencia_inicio, vigencia_fim, observacao)
     values ($1,$2,$3::modalidade_pgto,$4,$5,$6::numeric,$7::numeric,$8::numeric,
             coalesce($9::int,0),coalesce($10::date,current_date),$11::date,$12)
     returning *`,
    [tenant, req.body.adquirente_id || null, modalidade, min, max, pct, fixa, imposto,
     req.body.dias_liquidacao || null, inicio, fim, req.body.observacao || null]
  )
  await registrarAuditoria(tenant, req.usuario.id, 'taxas_adquirente', r.rows[0].id, 'criou', req.body)
  res.json(r.rows[0])
}))

// ---------------------------------------------------------------------
// Encerrar uma taxa NÃO é apagar: é pôr data de fim.
//
// Toda venda antiga tem o snapshot dela gravada no recebimento, então
// apagar não mudaria número nenhum do passado — mas apagaria a prova de
// por que aquele número foi aquele. Quando a Stone renegocia, o certo é
// encerrar a antiga ontem e cadastrar a nova hoje.
// ---------------------------------------------------------------------
rotasAdquirentes.delete('/taxas/:id', rota(async (req, res) => {
  const { tenant } = contexto(req, DINHEIRO)
  const r = await pool.query(
    `update taxas_adquirente
        set vigencia_fim = least(coalesce(vigencia_fim, current_date), current_date),
            atualizado_em = now()
      where tenant_id = $1 and id = $2 returning *`,
    [tenant, req.params.id]
  )
  if (!r.rows[0]) throw erroDeUso('Taxa não encontrada', 404)
  await registrarAuditoria(tenant, req.usuario.id, 'taxas_adquirente', req.params.id, 'encerrou')
  res.json({ ok: true, taxa: r.rows[0] })
}))

// ---------------------------------------------------------------------
// SIMULADOR — "vendi R$ 1.000 em 6x; quanto entra e quando?"
//
// Chama exatamente a mesma função que a E5 vai usar para gravar o
// recebimento de verdade. É de propósito: o número que o dono vê na
// simulação tem que ser, ao centavo, o número que vai ser gravado.
// ---------------------------------------------------------------------
rotasAdquirentes.post('/simular', rota(async (req, res) => {
  const { tenant } = contexto(req, TODOS)
  const valorBruto = Number(req.body.valor_bruto || 0)
  if (!(valorBruto > 0)) throw erroDeUso('Informe o valor da venda')
  const modalidade = String(req.body.modalidade || '')
  if (!MODALIDADES_VALIDAS.includes(modalidade)) throw erroDeUso('Forma de pagamento inválida')

  // Os quatro campos que a operação pode sobrescrever. Vindo vazios, vale
  // a tabela; vindo preenchidos, vale o que a pessoa digitou. É o que
  // permite lançar a venda que fugiu do padrão sem cadastrar uma taxa
  // nova para uma exceção que não vai se repetir.
  const manual = {
    taxa_percentual: req.body.taxa_percentual,
    taxa_fixa: req.body.taxa_fixa,
    imposto_percentual: req.body.imposto_percentual,
    dias_liquidacao: req.body.dias_liquidacao,
  }
  for (const [campo, valor] of Object.entries(manual)) {
    if (valor === null || valor === undefined || valor === '') continue
    const n = Number(valor)
    if (Number.isNaN(n) || n < 0) throw erroDeUso(`Valor inválido em ${campo}.`)
    if (campo.endsWith('_percentual') && n > 100) throw erroDeUso('Percentual acima de 100%.')
  }

  const resultado = await simular(tenant, {
    adquirenteId: req.body.adquirente_id || null,
    modalidade,
    parcelas: PARCELAVEIS.includes(modalidade) ? Number(req.body.parcelas || 2) : 1,
    valorBruto,
    manual,
    // O dia é do BANCO, não do relógio do Node: o container roda em UTC
    // e, depois das 21h em São Paulo, `new Date()` já virou amanhã.
    dataVenda: req.body.data_venda
      || (await pool.query(`select current_date::text as hoje`)).rows[0].hoje,
  })
  res.json(resultado)
}))
