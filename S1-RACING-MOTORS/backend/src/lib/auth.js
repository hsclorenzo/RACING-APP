import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const SEGREDO_DEV = 'dev-inseguro-troque-em-producao'
// Dez anos, de proposito. Hoje uma pessoa so usa o sistema e ela nao
// quer ver tela de login nunca: instala uma vez e pronto. A trava existe
// para o mundo la fora (a URL do Netlify e publica), nao para o dono.
//
// Isto so e seguro porque os PAPEIS sao lidos do banco a cada requisicao
// (ver middleware/autenticacao.js): desativar alguem vale na hora, sem
// depender do token vencer. Se um dia o token precisar ser revogado de
// verdade, o caminho e trocar o JWT_SECRET — desloga todo mundo.
const VALIDADE = '3650d'

export function segredo() {
  return process.env.JWT_SECRET || SEGREDO_DEV
}

export async function gerarHash(senha) {
  return bcrypt.hash(senha, 10)
}

export async function conferirSenha(senha, hash) {
  return bcrypt.compare(senha, hash)
}

export function assinarToken(payload) {
  return jwt.sign(payload, segredo(), { expiresIn: VALIDADE })
}

export function lerToken(token) {
  try {
    return jwt.verify(token, segredo())
  } catch {
    return null
  }
}
