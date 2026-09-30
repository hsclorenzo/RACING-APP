// E3 (ordem de servico) de ponta a ponta. Roda depois do e2-cadastros.mjs,
// que ja deixou cliente, veiculo, produto e servico no banco.
const B = process.env.BASE || 'http://localhost:3333/api'

let passou = 0, falhou = 0

async function bater(rotulo, caminho, o = {}) {
  const r = await fetch(B + caminho, {
    method: o.metodo || 'GET',
    headers: {
      ...(o.corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}),
    },
    body: o.corpo ? JSON.stringify(o.corpo) : undefined,
  })
  const d = await r.json().catch(() => null)
  const ok = r.status === o.espera && (!o.conferir || o.conferir(d))
  ok ? passou++ : falhou++
  console.log(`${ok ? 'ok  ' : 'FALHA'} ${String(r.status).padEnd(3)} (esp ${o.espera})  ${rotulo}`)
  if (!ok) console.log('        ->', JSON.stringify(d))
  return d
}

const entrar = async (email, senha) => (await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, senha }),
})).json())

const admin = await entrar('lorenzo@teste.com', 'senha12345')
const T = admin.token
if (!T) { console.error('rode as suites anteriores primeiro'); process.exit(1) }
const mec = await entrar('joao@teste.com', 'senha12345')
const M = mec.token

// A suite anterior deixa um veiculo so. A E3 precisa de varios (OS
// paralelas, cancelada, com foto) — cria os que faltam aqui em vez de
// depender da ordem em que a outra suite rodou.
const cli = await (await fetch(B + '/clientes', { headers: { Authorization: `Bearer ${T}` } })).json()
for (const placa of ['AAA1A11', 'BBB2B22', 'CCC3C33', 'DDD4D44']) {
  await fetch(B + '/clientes/veiculos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` },
    body: JSON.stringify({ cliente_id: cli[0].id, placa, modelo: 'Teste' }),
  })
}
const veiculos = await (await fetch(B + '/clientes/veiculos/lista', {
  headers: { Authorization: `Bearer ${T}` },
})).json()
const servicos = await (await fetch(B + '/catalogo/servicos?busca=Revisao', {
  headers: { Authorization: `Bearer ${T}` },
})).json()
const produtos = await (await fetch(B + '/catalogo/produtos?busca=Oleo%205W30', {
  headers: { Authorization: `Bearer ${T}` },
})).json()

console.log('\n--- ABRIR ---')
const os = await bater('abre OS', '/os', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { veiculo_id: veiculos[0].id, km_entrada: 91000, descricao_problema: 'Barulho na frente' },
  conferir: (d) => d.numero === 1 && d.status === 'orcamento',
})
const ID = os.id

// O numero e por oficina e nao pode repetir nem com duas aberturas juntas.
const paralelas = await Promise.all([1, 2, 3].map(() => fetch(B + '/os', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` },
  body: JSON.stringify({ veiculo_id: veiculos[1].id }),
}).then((r) => r.json())))
const numeros = paralelas.map((x) => x.numero).sort((a, b) => a - b)
const semRepetir = new Set(numeros).size === 3
console.log(`${semRepetir ? 'ok  ' : 'FALHA'} 200 (esp 200)  3 aberturas juntas geram numeros distintos (${numeros.join(',')})`)
semRepetir ? passou++ : falhou++

await bater('OS sem veiculo e recusada', '/os', {
  metodo: 'POST', espera: 400, token: T, corpo: { descricao_problema: 'nada' },
})
// O km da OS sobe pro cadastro do carro sozinho — dado digitado uma vez
// nao se digita de novo em outra tela.
await bater('o km da OS atualizou o cadastro do veiculo', `/clientes/veiculos/lista?busca=${veiculos[0].placa}`, {
  espera: 200, token: T, conferir: (d) => Number(d[0].km_atual) === 91000,
})

console.log('\n--- ITENS E MARGEM AO VIVO ---')
await bater('lanca servico do catalogo (2,5h x 120 = 300)', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 200, token: T, corpo: { servico_id: servicos[0].id },
  conferir: (d) => Number(d.total_servicos) === 300 && Number(d.total_geral) === 300,
})
await bater('lanca 4,5 L de oleo (4,5 x 48,90)', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 200, token: T,
  corpo: { produto_id: produtos[0].id, quantidade: 4.5 },
  conferir: (d) => Number(d.total_pecas) === 220.05,
})
await bater('lanca item livre (peca da esquina)', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 200, token: T,
  corpo: { tipo: 'peca', descricao_livre: 'Bieleta usada', quantidade: 2, preco_unitario: 45, custo_unitario: 22 },
  conferir: (d) => Number(d.total_pecas) === 310.05,
})
await bater('item sem descricao nem catalogo e recusado', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 400, token: T, corpo: { quantidade: 1, preco_unitario: 10 },
})
await bater('quantidade zero e recusada', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 400, token: T,
  corpo: { produto_id: produtos[0].id, quantidade: 0 },
})

const detalhe = await bater('a OS soma tudo', `/os/${ID}`, {
  espera: 200, token: T,
  conferir: (d) => Number(d.total_geral) === 610.05 && d.itens.length === 3,
})
console.log(`        total ${detalhe.total_geral} · custo ${detalhe.custo_total} · margem ${detalhe.margem_percentual}%`)

// O oleo entrou com custo medio ZERO (nunca houve compra). Sem este
// aviso, a tela mostraria margem altissima com cara de certeza.
await bater('avisa quantos itens entraram sem custo', `/os/${ID}`, {
  espera: 200, token: T, conferir: (d) => d.itens_sem_custo === 1,
})

console.log('\n--- DESCONTO ---')
await bater('desconto de 35 derruba o total', `/os/${ID}`, {
  metodo: 'PATCH', espera: 200, token: T, corpo: { desconto: 35 },
  conferir: (d) => Number(d.total_geral) === 575.05,
})
await bater('desconto maior que a OS e recusado', `/os/${ID}`, {
  metodo: 'PATCH', espera: 400, token: T, corpo: { desconto: 99999 },
})
await bater('desconto negativo e recusado', `/os/${ID}`, {
  metodo: 'PATCH', espera: 400, token: T, corpo: { desconto: -10 },
})
await bater('MECANICO nao da desconto', `/os/${ID}`, {
  metodo: 'PATCH', espera: 403, token: M, corpo: { desconto: 100 },
})

console.log('\n--- RBAC: o mecanico nao ve dinheiro do dono ---')
await bater('mecanico ve a OS mas SEM custo e SEM margem', `/os/${ID}`, {
  espera: 200, token: M,
  conferir: (d) => d.total_geral !== undefined
    && d.custo_total === undefined && d.margem_valor === undefined
    && d.margem_percentual === undefined
    && d.itens.every((i) => i.custo_unitario === undefined),
})
await bater('mecanico ve a lista SEM margem', '/os', {
  espera: 200, token: M, conferir: (d) => d.every((x) => x.margem_percentual === undefined),
})
await bater('mecanico PODE lancar item', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 200, token: M,
  corpo: { tipo: 'servico', descricao_livre: 'Limpeza de bico', quantidade: 1, preco_unitario: 80 },
  conferir: (d) => d.margem_percentual === undefined,
})

console.log('\n--- MAQUINA DE ESTADOS ---')
await bater('nao pula de orcamento pra execucao', `/os/${ID}/status`, {
  metodo: 'POST', espera: 400, token: T, corpo: { status: 'em_execucao' },
  conferir: (d) => /não pode ir para/i.test(d.erro),
})
await bater('aprova', `/os/${ID}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'aprovado' },
  conferir: (d) => d.status === 'aprovado' && d.data_aprovacao,
})
await bater('poe em execucao', `/os/${ID}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'em_execucao' },
})
await bater('marca pronto e carimba a conclusao', `/os/${ID}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'pronto' },
  conferir: (d) => d.data_conclusao,
})
await bater('entrega', `/os/${ID}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'entregue' },
  conferir: (d) => d.data_entrega,
})
await bater('OS entregue nao aceita item novo', `/os/${ID}/itens`, {
  metodo: 'POST', espera: 400, token: T,
  corpo: { tipo: 'peca', descricao_livre: 'tardia', quantidade: 1, preco_unitario: 10 },
})
await bater('mecanico NAO fatura', `/os/${ID}/status`, {
  metodo: 'POST', espera: 403, token: M, corpo: { status: 'faturado' },
})
await bater('fatura', `/os/${ID}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'faturado' },
})
await bater('OS faturada nao volta atras', `/os/${ID}/status`, {
  metodo: 'POST', espera: 400, token: T, corpo: { status: 'entregue' },
})
await bater('OS faturada nao se edita', `/os/${ID}`, {
  metodo: 'PATCH', espera: 400, token: T, corpo: { diagnostico: 'tarde demais' },
})

const vazia = await bater('abre OS nova pra testar aprovacao vazia', '/os', {
  metodo: 'POST', espera: 200, token: T, corpo: { veiculo_id: veiculos[2].id },
})
await bater('nao aprova orcamento sem nenhum item', `/os/${vazia.id}/status`, {
  metodo: 'POST', espera: 400, token: T, corpo: { status: 'aprovado' },
})
await bater('cancela a vazia', `/os/${vazia.id}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'cancelado' },
})

console.log('\n--- BUSCA E KANBAN ---')
await bater('acha OS pela placa', `/os?busca=${veiculos[0].placa.replace('-', '').toLowerCase()}`, {
  espera: 200, token: T, conferir: (d) => d.length >= 1 && d[0].placa === veiculos[0].placa,
})
await bater('acha OS pelo numero', '/os?busca=1', {
  espera: 200, token: T, conferir: (d) => d.some((x) => x.numero === 1),
})
await bater('filtra por status', '/os?status=cancelado', {
  espera: 200, token: T, conferir: (d) => d.length === 1 && d[0].status === 'cancelado',
})
await bater('resumo por coluna do kanban', '/os/resumo', {
  espera: 200, token: T,
  conferir: (d) => d.some((x) => x.status === 'faturado') && d.some((x) => x.status === 'cancelado'),
})

console.log('\n--- FOTOS ---')
// 1x1 PNG transparente. O suficiente pra provar o caminho inteiro:
// entra base64, e gravado binario, sai com o Content-Type certo.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const nova = await bater('abre OS pra fotos', '/os', {
  metodo: 'POST', espera: 200, token: T, corpo: { veiculo_id: veiculos[3].id },
})
const foto = await bater('mecanico manda foto de entrada', `/os/${nova.id}/fotos`, {
  metodo: 'POST', espera: 200, token: M,
  corpo: { arquivo: PNG, momento: 'entrada', legenda: 'Risco no para-choque' },
  conferir: (d) => d.id && d.bytes > 0 && d.momento === 'entrada',
})
await bater('arquivo que nao e imagem e recusado', `/os/${nova.id}/fotos`, {
  metodo: 'POST', espera: 400, token: T, corpo: { arquivo: 'nao sou uma imagem' },
})
await bater('a OS lista a foto SEM o binario junto', `/os/${nova.id}`, {
  espera: 200, token: T,
  conferir: (d) => d.fotos.length === 1 && d.fotos[0].conteudo === undefined,
})

const imagem = await fetch(`${B}/os/fotos/${foto.id}`, { headers: { Authorization: `Bearer ${T}` } })
const tipoOk = imagem.status === 200 && imagem.headers.get('content-type') === 'image/png'
console.log(`${tipoOk ? 'ok  ' : 'FALHA'} ${imagem.status} (esp 200)  a foto sai com o Content-Type certo`)
tipoOk ? passou++ : falhou++

await bater('mecanico NAO apaga foto', `/os/fotos/${foto.id}`, {
  metodo: 'DELETE', espera: 403, token: M,
})
await bater('balcao apaga foto', `/os/fotos/${foto.id}`, {
  metodo: 'DELETE', espera: 200, token: T,
})

console.log(`\n${passou} passaram, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)
