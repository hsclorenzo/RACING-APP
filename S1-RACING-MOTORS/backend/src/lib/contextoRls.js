import { AsyncLocalStorage } from 'node:async_hooks'

// ---------------------------------------------------------------------
// Quem e o usuario desta requisicao, sem passar `req` por 40 camadas.
//
// O RLS do Postgres nao sabe nada de JWT. Ele le
// current_setting('app.usuario_id'). Alguem precisa GRAVAR isso na
// conexao antes de cada query — e esse alguem e o pool.js, que consulta
// este armazenamento.
//
// AsyncLocalStorage e o unico jeito correto de fazer isso em Node: uma
// variavel de modulo global vazaria o usuario de uma requisicao pra
// outra no exato momento em que duas chegam juntas — que e sempre.
// ---------------------------------------------------------------------
const armazenamento = new AsyncLocalStorage()

export function comContexto(contexto, fn) {
  return armazenamento.run(contexto, fn)
}

// Rotina de sistema (migrations, seed, login). Liga o bypass do RLS.
// NUNCA chamar isto de dentro de um handler ja autenticado: seria abrir
// o banco inteiro pra uma requisicao de usuario.
export function executarComoSistema(fn) {
  return armazenamento.run({ usuarioId: null, sistema: true }, fn)
}

export function contextoAtual() {
  return armazenamento.getStore() || { usuarioId: null, sistema: false }
}
