import { lerToken } from '../lib/auth.js'
import { comContexto } from '../lib/contextoRls.js'
import { pool } from '../db/pool.js'

// ---------------------------------------------------------------------
// Le o Bearer token, embrulha o resto da requisicao no contexto de RLS
// (tudo que rodar depois daqui sai do banco ja filtrado por oficina) e
// so entao carrega os papeis.
//
// Os papeis sao lidos DO BANCO a cada requisicao, nao do token. O token
// vale 30 dias; se o papel viajasse dentro dele, tirar o admin de alguem
// so teria efeito daqui a um mes. A consulta e uma linha por indice —
// mais barata do que a explicacao.
// ---------------------------------------------------------------------
export function exigirAutenticacao(req, res, next) {
  const cabecalho = req.headers.authorization || ''
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7) : null
  if (!token) return res.status(401).json({ erro: 'Nao autenticado' })

  const dados = lerToken(token)
  if (!dados || !dados.id) {
    return res.status(401).json({ erro: 'Sessao expirada — entre de novo' })
  }

  comContexto({ usuarioId: dados.id, sistema: false }, async () => {
    try {
      const r = await pool.query(
        `select m.tenant_id, m.papel, t.nome as oficina
           from memberships m join tenants t on t.id = m.tenant_id
          where m.usuario_id = $1 and m.ativo = true and t.ativo = true`,
        [dados.id]
      )
      if (r.rows.length === 0) {
        return res.status(403).json({ erro: 'Seu acesso foi desativado.' })
      }
      req.usuario = { id: dados.id, nome: dados.nome, email: dados.email }
      req.tenants = r.rows
      next()
    } catch (erro) {
      next(erro)
    }
  })
}

// Papel do usuario numa oficina especifica.
export function papelNaOficina(req, tenantId) {
  const m = (req.tenants || []).find((x) => x.tenant_id === tenantId)
  return m ? m.papel : null
}

// Levanta 403 se o papel nao estiver na lista. Chamada NO INICIO do
// handler, antes de qualquer query — nunca depois.
export function exigirPapel(req, tenantId, papeis) {
  if (!tenantId) {
    const erro = new Error('Oficina nao informada')
    erro.status = 400
    throw erro
  }
  const papel = papelNaOficina(req, tenantId)
  if (!papel || !papeis.includes(papel)) {
    const erro = new Error('Voce nao tem permissao para isto')
    erro.status = 403
    throw erro
  }
  return papel
}

// A oficina do usuario quando ele so tem uma — que e o caso hoje. Evita
// mandar ?tenant= em toda chamada do frontend.
export function oficinaPadrao(req) {
  return req.query.tenant || (req.tenants[0] && req.tenants[0].tenant_id) || null
}
