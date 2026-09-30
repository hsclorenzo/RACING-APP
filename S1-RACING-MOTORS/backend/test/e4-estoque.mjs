// E4 (estoque) de ponta a ponta. Roda depois das suites anteriores.
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
const M = (await entrar('joao@teste.com', 'senha12345')).token
const h = { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` }
const pegar = async (c) => (await fetch(B + c, { headers: h })).json()
const criar = async (c, b) => (await fetch(B + c, { method: 'POST', headers: h, body: JSON.stringify(b) })).json()

// Um produto só desta suite, pra não herdar saldo das outras.
const oleo = await criar('/catalogo/produtos', {
  descricao: 'Oleo E4 5W30', sku: 'E4-OL', unidade_compra: 'balde', unidade_uso: 'L',
  fator_conversao: 20, preco_venda: 52.9, estoque_minimo: 15,
})
const forn = (await pegar('/catalogo/fornecedores'))[0]

console.log('\n--- COMPRA E FRACIONAMENTO ---')
const c1 = await bater('3 baldes de 20 L por R$ 890 entram como 60 L', '/estoque/compras', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    fornecedor_id: forn.id, numero_nota: '1001',
    itens: [{ produto_id: oleo.id, quantidade_compra: 3, custo_total: 890 }],
  },
  conferir: (d) => d.lancados[0].entrou === 60 && d.lancados[0].unidade === 'L'
    && d.lancados[0].custo_unitario === 14.8333,
})
console.log(`        litro a R$ ${c1.lancados[0].custo_unitario} · estoque ${c1.lancados[0].estoque_depois} L`)

await bater('o produto ficou com 60 L e o custo medio do litro', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T,
  conferir: (d) => Number(d[0].estoque_atual) === 60 && Number(d[0].custo_medio) === 14.8333,
})

// A conta que a planilha nao fazia: comprar mais caro move a media, nao
// substitui.
await bater('2a compra mais cara pondera a media', '/estoque/compras', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { numero_nota: '1002', itens: [{ produto_id: oleo.id, quantidade_compra: 1, custo_total: 340 }] },
  conferir: (d) => d.lancados[0].custo_unitario === 17
    && d.lancados[0].custo_medio_depois === 15.375
    && d.lancados[0].estoque_depois === 80,
})

await bater('compra sem item e recusada', '/estoque/compras', {
  metodo: 'POST', espera: 400, token: T, corpo: { numero_nota: 'x', itens: [] },
})
await bater('quantidade zero na nota e recusada', '/estoque/compras', {
  metodo: 'POST', espera: 400, token: T,
  corpo: { itens: [{ produto_id: oleo.id, quantidade_compra: 0, custo_total: 100 }] },
})
await bater('MECANICO nao lanca compra', '/estoque/compras', {
  metodo: 'POST', espera: 403, token: M,
  corpo: { itens: [{ produto_id: oleo.id, quantidade_compra: 1, custo_total: 10 }] },
})

console.log('\n--- BAIXA AUTOMATICA PELA OS ---')
const veiculos = await pegar('/clientes/veiculos/lista')
const os = await criar('/os', { veiculo_id: veiculos[0].id, descricao_problema: 'Troca de oleo' })
await criar(`/os/${os.id}/itens`, { produto_id: oleo.id, quantidade: 4.5 })

// A peca ainda NAO saiu: orcamento aprovado que nunca vira servico
// inflaria o consumo com peca que ninguem pegou.
await bater('orcamento NAO baixa estoque', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 80,
})
await criar(`/os/${os.id}/status`, { status: 'aprovado' })
await bater('aprovado tambem NAO baixa', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 80,
})

await bater('em execucao BAIXA 4,5 L', `/os/${os.id}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'em_execucao' },
  conferir: (d) => d.movimentos_estoque === 1 && d.baixa_confirmada === true,
})
await bater('sobraram 75,5 L', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 75.5,
})

// O custo estava ZERO no item (a peca foi lancada antes de existir
// compra). Na baixa, o custo real do consumo passa a existir.
await bater('a baixa preencheu o custo que faltava no item', `/os/${os.id}`, {
  espera: 200, token: T,
  conferir: (d) => Number(d.itens[0].custo_unitario) === 15.375
    && Number(d.custo_total) === 69.19 && d.itens_sem_custo === 0,
})

// O defeito classico: passar de novo pelo status baixa em dobro.
await bater('avancar pra pronto NAO baixa de novo', `/os/${os.id}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'pronto' },
  conferir: (d) => d.movimentos_estoque === 0,
})
await bater('estoque continua 75,5 L', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 75.5,
})

console.log('\n--- MEXER NA OS JA EM EXECUCAO ---')
await bater('voltar pra execucao', `/os/${os.id}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'em_execucao' },
})
const detalhe = await pegar(`/os/${os.id}`)
await bater('aumentar a quantidade tira so a diferenca', `/os/itens/${detalhe.itens[0].id}`, {
  metodo: 'PATCH', espera: 200, token: T, corpo: { quantidade: 7 },
})
await bater('sairam mais 2,5 L (73 no total)', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 73,
})
await bater('remover o item devolve tudo', `/os/itens/${detalhe.itens[0].id}`, {
  metodo: 'DELETE', espera: 200, token: T,
})
await bater('voltou pra 80 L', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 80,
})

console.log('\n--- CANCELAR DEVOLVE A PECA ---')
const os2 = await criar('/os', { veiculo_id: veiculos[1].id })
await criar(`/os/${os2.id}/itens`, { produto_id: oleo.id, quantidade: 10 })
await criar(`/os/${os2.id}/status`, { status: 'aprovado' })
await criar(`/os/${os2.id}/status`, { status: 'em_execucao' })
await bater('a OS em execucao levou 10 L', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 70,
})
await bater('cancelar estorna', `/os/${os2.id}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'cancelado' },
  conferir: (d) => d.movimentos_estoque === 1 && d.baixa_confirmada === false,
})
await bater('a peca voltou pra prateleira na hora', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 80,
})

console.log('\n--- ESTOQUE NEGATIVO: informacao, nao defeito ---')
const seco = await criar('/catalogo/produtos', {
  descricao: 'Peca E4 sem compra', sku: 'E4-SEM', preco_venda: 100, estoque_minimo: 2,
})
const os3 = await criar('/os', { veiculo_id: veiculos[2].id })
await criar(`/os/${os3.id}/itens`, { produto_id: seco.id, quantidade: 3 })
await criar(`/os/${os3.id}/status`, { status: 'aprovado' })
await bater('a oficina usa a peca mesmo sem a compra lancada', `/os/${os3.id}/status`, {
  metodo: 'POST', espera: 200, token: T, corpo: { status: 'em_execucao' },
})
await bater('o saldo fica -3 e denuncia a compra que falta', '/catalogo/produtos?busca=E4-SEM', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === -3,
})
await bater('o alerta separa NEGATIVO de "acabando"', '/estoque/alertas', {
  espera: 200, token: T,
  conferir: (d) => d.find((x) => x.sku === 'E4-SEM')?.negativo === true,
})

// Com saldo negativo, a formula ponderada cuspiria custo inflado.
await bater('compra depois do negativo nao envenena o custo medio', '/estoque/compras', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { itens: [{ produto_id: seco.id, quantidade_compra: 10, custo_total: 600 }] },
  conferir: (d) => d.lancados[0].custo_medio_depois === 60 && d.lancados[0].estoque_depois === 7,
})

console.log('\n--- AJUSTE DE INVENTARIO ---')
await bater('ajuste sem motivo e recusado', '/estoque/ajuste', {
  metodo: 'POST', espera: 400, token: T,
  corpo: { produto_id: oleo.id, estoque_contado: 78 },
})
await bater('contou 78 onde havia 80', '/estoque/ajuste', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { produto_id: oleo.id, estoque_contado: 78, motivo: 'Balde vazado' },
  conferir: (d) => d.diferenca === -2,
})
await bater('o saldo virou 78', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].estoque_atual) === 78,
})
await bater('ajuste nao mexe no custo medio', '/catalogo/produtos?busca=E4-OL', {
  espera: 200, token: T, conferir: (d) => Number(d[0].custo_medio) === 15.375,
})
await bater('contar o mesmo numero nao gera movimento', '/estoque/ajuste', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { produto_id: oleo.id, estoque_contado: 78, motivo: 'Conferencia' },
  conferir: (d) => d.sem_diferenca === true,
})

console.log('\n--- EXTRATO ---')
await bater('o extrato conta a historia toda', `/estoque/produto/${oleo.id}`, {
  espera: 200, token: T,
  conferir: (d) => d.movimentos.length >= 6
    && d.movimentos.some((m) => m.tipo === 'entrada' && m.numero_nota === '1001')
    && d.movimentos.some((m) => m.tipo === 'saida' && m.os_numero),
})
await bater('MECANICO ve o extrato SEM custo', `/estoque/produto/${oleo.id}`, {
  espera: 200, token: M,
  conferir: (d) => d.movimentos.every((m) => m.custo_unitario === undefined)
    && d.produto.custo_medio === undefined,
})

// O saldo do produto tem que bater com a soma dos movimentos. Se um dia
// alguem der UPDATE direto no saldo, e aqui que aparece.
const extrato = await pegar(`/estoque/produto/${oleo.id}`)
const soma = extrato.movimentos.reduce(
  (s, m) => s + (m.tipo === 'saida' ? -1 : 1) * Number(m.quantidade), 0
)
const bate = Math.abs(soma - Number(extrato.produto.estoque_atual)) < 0.0001
console.log(`${bate ? 'ok  ' : 'FALHA'} 200 (esp 200)  o saldo bate com a soma dos movimentos (${soma})`)
bate ? passou++ : falhou++

console.log('\n--- ESTORNO DE COMPRA ---')
const novo = await criar('/catalogo/produtos', { descricao: 'Peca E4 estorno', sku: 'E4-EST', preco_venda: 50 })
const compraBoa = await criar('/estoque/compras', {
  numero_nota: '2001', itens: [{ produto_id: novo.id, quantidade_compra: 5, custo_total: 150 }],
})
await bater('estornar a ultima compra devolve saldo e custo', `/estoque/compras/${compraBoa.id}`, {
  metodo: 'DELETE', espera: 200, token: T,
})
await bater('o produto voltou a zero', '/catalogo/produtos?busca=E4-EST', {
  espera: 200, token: T,
  conferir: (d) => Number(d[0].estoque_atual) === 0 && Number(d[0].custo_medio) === 0,
})

// Custo medio ponderado e irreversivel: com movimento depois, "desfazer"
// seria inventar numero. O sistema recusa e diz o caminho certo.
await bater('nao estorna compra com movimento depois', `/estoque/compras/${c1.id}`, {
  metodo: 'DELETE', espera: 400, token: T,
  conferir: (d) => /ajuste de estoque/i.test(d.erro),
})

console.log('\n--- RESUMO ---')
await bater('resumo traz o valor parado na prateleira', '/estoque/resumo', {
  espera: 200, token: T,
  conferir: (d) => d.valor_parado > 0 && d.produtos > 0 && typeof d.em_alerta === 'number',
})

console.log(`\n${passou} passaram, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)
