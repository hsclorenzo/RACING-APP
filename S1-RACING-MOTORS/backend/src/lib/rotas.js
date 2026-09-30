import { exigirPapel, oficinaPadrao } from '../middleware/autenticacao.js'
import { pool } from '../db/pool.js'

// ---------------------------------------------------------------------
// Peças repetidas por todas as rotas de cadastro. Existem para que a
// regra de acesso e a montagem de UPDATE apareçam UMA vez — quando o
// mesmo `if` de permissão é reescrito em 20 handlers, um dia um deles sai
// diferente e ninguém percebe.
// ---------------------------------------------------------------------

// Quem pode LER cadastro: todo mundo da oficina.
export const TODOS = ['admin', 'balcao', 'mecanico']
// Quem pode MEXER em cadastro: quem atende e quem manda.
export const ESCREVE = ['admin', 'balcao']
// Dinheiro (taxa de maquininha, custo): só quem manda.
export const DINHEIRO = ['admin']

// Devolve a oficina do request depois de conferir o papel. Toda rota
// começa por aqui, ANTES de qualquer query.
export function contexto(req, papeis) {
  const tenant = oficinaPadrao(req)
  const papel = exigirPapel(req, tenant, papeis)
  return { tenant, papel }
}

// Embrulha o handler async. Sem isto, um `await` que estoura vira
// unhandledRejection e o request fica pendurado até o timeout do
// navegador, sem resposta e sem log útil.
export function rota(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
}

// Monta `set a = $2, b = $3` a partir só dos campos que vieram no corpo.
// Campo ausente não é campo vazio: mandar `{telefone: null}` limpa o
// telefone, mas não mandar `telefone` deixa como está. A diferença
// importa porque a tela do celular manda formulário parcial.
export function montarUpdate(corpo, permitidos, valoresIniciais) {
  const pedacos = []
  const valores = [...valoresIniciais]
  for (const campo of permitidos) {
    if (!Object.prototype.hasOwnProperty.call(corpo, campo)) continue
    valores.push(corpo[campo] === '' ? null : corpo[campo])
    pedacos.push(`${campo} = $${valores.length}`)
  }
  return { pedacos, valores }
}

// ---------------------------------------------------------------------
// O que o mecânico NÃO vê, num lugar só.
//
// A regra do Lorenzo: "mecânico é mecânico, não gestor". Ele lança peça e
// serviço, vê preço de venda (precisa, pra conversar com o cliente), mas
// não vê custo nem margem.
//
// Esta lista mora aqui porque o mesmo dado aparece com nomes diferentes
// em cada resposta — `custo_medio` no produto, `custo_unitario` no item,
// `custo_medio_depois` no movimento. Já vazou uma vez por eu esconder um
// nome e esquecer o outro. Com a lista central, esquecer fica difícil.
//
// E é o SERVIDOR que apaga, nunca a tela: esconder na tela deixa o número
// na resposta HTTP, e quem abrir o inspetor lê tudo.
const CAMPOS_DE_CUSTO = [
  'custo_medio', 'custo_unitario', 'custo_hora', 'custo_medio_depois',
  'custo_total', 'margem_valor', 'margem_percentual', 'itens_sem_custo',
]

export function semCusto(dado, papel) {
  if (papel !== 'mecanico' || !dado) return dado
  if (Array.isArray(dado)) return dado.map((x) => semCusto(x, papel))
  const copia = { ...dado }
  for (const campo of CAMPOS_DE_CUSTO) delete copia[campo]
  return copia
}

export function erroDeUso(mensagem, status = 400) {
  const e = new Error(mensagem)
  e.status = status
  return e
}

// Traduz o erro cru do Postgres para uma frase que o balconista entende.
// O texto do driver ("duplicate key value violates unique constraint
// uq_veiculos_placa") está certo e é inútil na tela.
export function traduzirErroBanco(erro, traducoes = {}) {
  if (erro.code === '23505') {
    for (const [restricao, frase] of Object.entries(traducoes)) {
      if (String(erro.constraint || '').includes(restricao)) return erroDeUso(frase, 409)
    }
    return erroDeUso('Esse registro já existe.', 409)
  }
  if (erro.code === '23503') {
    return erroDeUso('Não dá para apagar: existe outro registro usando este.', 409)
  }
  return erro
}

export async function registrarAuditoria(tenant, usuarioId, entidade, entidadeId, acao, detalhe) {
  try {
    await pool.query(
      `insert into auditoria (tenant_id, usuario_id, entidade, entidade_id, acao, detalhe)
       values ($1,$2,$3,$4,$5,$6)`,
      [tenant, usuarioId, entidade, entidadeId, acao, detalhe ? JSON.stringify(detalhe) : null]
    )
  } catch (erro) {
    // Auditoria que falha NUNCA derruba a operação do usuário. Ele
    // acabou de cadastrar um cliente; perder a linha de log é ruim,
    // perder o cliente é pior.
    console.error('[auditoria] não gravou:', erro.message)
  }
}
