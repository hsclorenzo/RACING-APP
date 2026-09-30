// Roteiro de ponta a ponta da E1, batendo no backend por HTTP como o
// navegador bate. Sobe o pg-local.mjs e o server.js antes de rodar.
const B = process.env.BASE || 'http://localhost:3333/api'

let passou = 0
let falhou = 0

async function bater(rotulo, caminho, opcoes = {}) {
  const r = await fetch(B + caminho, {
    method: opcoes.metodo || 'GET',
    headers: {
      ...(opcoes.corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(opcoes.token ? { Authorization: `Bearer ${opcoes.token}` } : {}),
      ...(opcoes.chave ? { 'x-admin-key': opcoes.chave } : {}),
    },
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  })
  const dados = await r.json().catch(() => null)
  const ok = r.status === opcoes.espera
  if (ok) passou++
  else falhou++
  console.log(
    `${ok ? 'ok  ' : 'FALHA'} ${String(r.status).padEnd(3)} (esperado ${opcoes.espera})  ${rotulo}`
  )
  if (!ok) console.log('        ->', JSON.stringify(dados))
  return dados
}

const CHAVE = process.env.ADMIN_KEY || 'chave-de-teste-local'

await bater('saude', '/saude', { espera: 200 })
await bater('migrations sem chave e bloqueada', '/migrations', { metodo: 'POST', espera: 403 })
await bater('migrations com chave aplica', '/migrations', { metodo: 'POST', chave: CHAVE, espera: 200 })
await bater('migrations rodando de novo (idempotente)', '/migrations', { metodo: 'POST', chave: CHAVE, espera: 200 })

await bater('instalar cria oficina e admin', '/auth/instalar', {
  metodo: 'POST', chave: CHAVE, espera: 200,
  corpo: { oficina: 'Racing Motors', nome: 'Lorenzo', email: 'Lorenzo@Teste.COM ', senha: 'senha12345' },
})
await bater('instalar duas vezes e recusado', '/auth/instalar', {
  metodo: 'POST', chave: CHAVE, espera: 409,
  corpo: { nome: 'Invasor', email: 'x@y.com', senha: 'senha12345' },
})
await bater('instalar sem chave e bloqueado', '/auth/instalar', {
  metodo: 'POST', espera: 403, corpo: { nome: 'x', email: 'x@y.com', senha: 'senha12345' },
})

await bater('login com senha errada', '/auth/login', {
  metodo: 'POST', espera: 401, corpo: { email: 'lorenzo@teste.com', senha: 'errada9999' },
})
await bater('login de email que nao existe', '/auth/login', {
  metodo: 'POST', espera: 401, corpo: { email: 'ninguem@teste.com', senha: 'senha12345' },
})

// Email com maiuscula e espaco tem que entrar: e como a pessoa digita no
// celular, com o teclado capitalizando a primeira letra sozinho.
const admin = await bater('login (email com maiuscula e espaco)', '/auth/login', {
  metodo: 'POST', espera: 200, corpo: { email: ' LORENZO@teste.com ', senha: 'senha12345' },
})

await bater('rota protegida sem token', '/auth/equipe', { espera: 401 })
await bater('token invalido', '/auth/eu', { espera: 401, token: 'nao-e-um-jwt' })
await bater('/eu com token bom', '/auth/eu', { espera: 200, token: admin.token })

await bater('admin cria mecanico', '/auth/equipe', {
  metodo: 'POST', espera: 200, token: admin.token,
  corpo: { nome: 'Ze Mecanico', email: 'ze@teste.com', senha: 'senha12345', papel: 'mecanico' },
})
const equipe = await bater('admin lista equipe', '/auth/equipe', { espera: 200, token: admin.token })
console.log('        equipe:', equipe.map((u) => `${u.nome}/${u.papel}`).join(', '))

const ze = await bater('mecanico consegue entrar', '/auth/login', {
  metodo: 'POST', espera: 200, corpo: { email: 'ze@teste.com', senha: 'senha12345' },
})
await bater('RBAC: mecanico NAO lista equipe', '/auth/equipe', { espera: 403, token: ze.token })
await bater('RBAC: mecanico NAO cria usuario', '/auth/equipe', {
  metodo: 'POST', espera: 403, token: ze.token,
  corpo: { nome: 'Fantasma', email: 'f@t.com', senha: 'senha12345', papel: 'admin' },
})

await bater('troca de senha com a atual errada', '/auth/senha', {
  metodo: 'POST', espera: 400, token: ze.token, corpo: { atual: 'errada9999', nova: 'novasenha123' },
})
await bater('troca de senha', '/auth/senha', {
  metodo: 'POST', espera: 200, token: ze.token, corpo: { atual: 'senha12345', nova: 'novasenha123' },
})
await bater('senha velha nao entra mais', '/auth/login', {
  metodo: 'POST', espera: 401, corpo: { email: 'ze@teste.com', senha: 'senha12345' },
})
await bater('senha nova entra', '/auth/login', {
  metodo: 'POST', espera: 200, corpo: { email: 'ze@teste.com', senha: 'novasenha123' },
})

const zeId = equipe.find((u) => u.email === 'ze@teste.com').id
await bater('admin desativa o mecanico', `/auth/equipe/${zeId}`, {
  metodo: 'PATCH', espera: 200, token: admin.token, corpo: { ativo: false },
})
// O ponto: o token do Ze continua valido criptograficamente. Se o papel
// viajasse dentro do token, ele continuaria entrando. Como os papeis sao
// lidos do banco a cada request, o acesso morre na hora.
await bater('token do desativado para de funcionar NA HORA', '/auth/eu', {
  espera: 403, token: ze.token,
})
await bater('admin nao pode desativar a si mesmo', `/auth/equipe/${admin.usuario.id}`, {
  metodo: 'PATCH', espera: 400, token: admin.token, corpo: { ativo: false },
})

await bater('rota que nao existe', '/nao-existe', { espera: 404 })

console.log(`\n${passou} passaram, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)
