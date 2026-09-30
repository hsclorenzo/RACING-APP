// E2 de ponta a ponta, por HTTP. Reaproveita a oficina e o admin já
// criados pelo ponta-a-ponta.mjs (rode ele antes, na mesma sessão do banco).
const B = process.env.BASE || 'http://localhost:3333/api'

let passou = 0, falhou = 0
const guardado = {}

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

const admin = await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lorenzo@teste.com', senha: 'senha12345' }),
})).json()
const T = admin.token
if (!T) { console.error('rode o ponta-a-ponta.mjs primeiro'); process.exit(1) }

// Um mecânico para provar o RBAC de custo.
await fetch(B + '/auth/equipe', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${T}` },
  body: JSON.stringify({ nome: 'Joao Mec', email: 'joao@teste.com', senha: 'senha12345', papel: 'mecanico' }),
})
const mec = await (await fetch(B + '/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'joao@teste.com', senha: 'senha12345' }),
})).json()
const M = mec.token

console.log('\n--- CLIENTES E VEICULOS ---')
const cli = await bater('cria cliente', '/clientes', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { nome: 'Maria Souza', telefone: '11 98888-7777', documento: '123.456.789-00' },
})
guardado.cliente = cli.id
await bater('cliente sem nome e recusado', '/clientes', {
  metodo: 'POST', espera: 400, token: T, corpo: { telefone: '119' },
})

const vei = await bater('cria veiculo (placa com traco)', '/clientes/veiculos', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { cliente_id: guardado.cliente, placa: 'abc-1d23', marca: 'VW', modelo: 'Gol', ano: 2018, km_atual: 84000 },
  conferir: (d) => d.placa === 'ABC-1D23',
})
guardado.veiculo = vei.id

// A armadilha da placa: mesma placa escrita diferente é o MESMO carro.
// Sem a normalização o histórico do veículo se parte em dois.
await bater('mesma placa sem traco e minuscula e recusada', '/clientes/veiculos', {
  metodo: 'POST', espera: 409, token: T,
  corpo: { cliente_id: guardado.cliente, placa: 'abc1d23' },
  conferir: (d) => /já está cadastrada/i.test(d.erro),
})
await bater('veiculo sem dono e recusado', '/clientes/veiculos', {
  metodo: 'POST', espera: 400, token: T, corpo: { placa: 'XYZ9K88' },
})

// Busca por placa achando o CLIENTE: é como o balcão procura de verdade.
await bater('busca cliente PELA PLACA do carro', '/clientes?busca=abc1d23', {
  espera: 200, token: T, conferir: (d) => d.length === 1 && d[0].nome === 'Maria Souza',
})
await bater('busca cliente por telefone', '/clientes?busca=98888', {
  espera: 200, token: T, conferir: (d) => d.length === 1,
})
await bater('cliente traz os veiculos dele', `/clientes/${guardado.cliente}`, {
  espera: 200, token: T, conferir: (d) => d.veiculos.length === 1,
})
await bater('editar placa tambem normaliza', `/clientes/veiculos/${guardado.veiculo}`, {
  metodo: 'PATCH', espera: 200, token: T, corpo: { placa: 'zzz 9k88' },
  conferir: (d) => d.placa === 'ZZZ-9K88',
})
await bater('mecanico NAO cria cliente', '/clientes', {
  metodo: 'POST', espera: 403, token: M, corpo: { nome: 'Fantasma' },
})
await bater('mecanico LE clientes', '/clientes', { espera: 200, token: M })

console.log('\n--- PRODUTOS ---')
const oleo = await bater('cria produto fracionado (balde 20 L)', '/catalogo/produtos', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    descricao: 'Oleo 5W30 sintetico', sku: 'OL5W30', categoria: 'oleo',
    unidade_compra: 'balde', unidade_uso: 'L', fator_conversao: 20,
    preco_venda: 48.90, estoque_minimo: 10,
  },
  conferir: (d) => Number(d.fator_conversao) === 20 && Number(d.estoque_atual) === 0,
})
guardado.produto = oleo.id
await bater('fator zero e recusado', '/catalogo/produtos', {
  metodo: 'POST', espera: 400, token: T, corpo: { descricao: 'X', fator_conversao: 0 },
})
await bater('SKU repetido e recusado', '/catalogo/produtos', {
  metodo: 'POST', espera: 409, token: T, corpo: { descricao: 'Outro', sku: 'ol5w30' },
})

// O ponto: estoque e custo NÃO entram por cadastro, só por movimento.
await bater('cadastro ignora estoque e custo mandados na marra', '/catalogo/produtos', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { descricao: 'Filtro de oleo', estoque_atual: 999, custo_medio: 50, preco_venda: 35 },
  conferir: (d) => Number(d.estoque_atual) === 0 && Number(d.custo_medio) === 0,
})

const listaAdmin = await bater('admin ve custo do produto', '/catalogo/produtos', {
  espera: 200, token: T, conferir: (d) => 'custo_medio' in d[0],
})
await bater('MECANICO NAO recebe custo do produto', '/catalogo/produtos', {
  espera: 200, token: M, conferir: (d) => d.length === listaAdmin.length && !('custo_medio' in d[0]),
})

console.log('\n--- SERVICOS ---')
await bater('servico por hora calcula o sugerido', '/catalogo/servicos', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { descricao: 'Revisao completa', tempo_padrao_horas: 2.5, valor_hora: 120, custo_hora: 45 },
})
await bater('servico de valor fechado', '/catalogo/servicos', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { descricao: 'Troca de oleo', valor_fixo: 90 },
})
await bater('servico sem preco nenhum e recusado', '/catalogo/servicos', {
  metodo: 'POST', espera: 400, token: T, corpo: { descricao: 'Servico fantasma' },
})
await bater('valor sugerido: 2,5h x 120 = 300', '/catalogo/servicos?busca=Revisao', {
  espera: 200, token: T, conferir: (d) => Number(d[0].valor_sugerido) === 300,
})
await bater('valor fixo vence as horas', '/catalogo/servicos?busca=Troca', {
  espera: 200, token: T, conferir: (d) => Number(d[0].valor_sugerido) === 90,
})
await bater('MECANICO NAO recebe custo_hora', '/catalogo/servicos', {
  espera: 200, token: M, conferir: (d) => !('custo_hora' in d[0]),
})

console.log('\n--- FORNECEDORES ---')
await bater('cria fornecedor', '/catalogo/fornecedores', {
  metodo: 'POST', espera: 200, token: T, corpo: { nome: 'Auto Pecas Silva', telefone: '11 3333-2222' },
})

// ---------------------------------------------------------------------
// Datas do teste, declaradas.
//
// ARMADILHA que mordeu de verdade: as taxas nasciam vigentes a partir de
// HOJE (o padrão da rota é `current_date`) e as simulações usavam uma
// data de venda fixa no passado. A suíte passou no dia em que foi
// escrita e quebrou sozinha uma semana depois — o motor estava certo,
// recusando aplicar uma taxa que ainda não existia na data da venda.
//
// A correção não é afrouxar a regra: é a vigência começar ANTES da venda
// que o teste simula. Ambas fixas, para o resultado não depender de
// quando alguém aperta o play.
// ---------------------------------------------------------------------
const VENDA = '2026-09-08'   // a venda que os testes simulam
const DESDE = '2026-01-01'   // vigência das taxas: sempre antes da venda

console.log('\n--- MAQUININHAS E TAXAS ---')
const stone = await bater('cria maquininha', '/adquirentes', {
  metodo: 'POST', espera: 200, token: T, corpo: { nome: 'Stone' },
})
guardado.adq = stone.id
await bater('BALCAO nao cria maquininha (e dinheiro)', '/adquirentes', {
  metodo: 'POST', espera: 403, token: M, corpo: { nome: 'Pirata' },
})

await bater('taxa debito', '/adquirentes/taxas', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { adquirente_id: guardado.adq, modalidade: 'debito', taxa_percentual: 1.99, dias_liquidacao: 1, vigencia_inicio: DESDE },
})
await bater('taxa credito 2x-6x', '/adquirentes/taxas', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    adquirente_id: guardado.adq, modalidade: 'credito_parcelado',
    parcelas_min: 2, parcelas_max: 6, taxa_percentual: 3.49, taxa_fixa: 0.39, dias_liquidacao: 30, vigencia_inicio: DESDE,
  },
})
await bater('taxa credito 7x-12x', '/adquirentes/taxas', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    adquirente_id: guardado.adq, modalidade: 'credito_parcelado',
    parcelas_min: 7, parcelas_max: 12, taxa_percentual: 4.99, taxa_fixa: 0.39, dias_liquidacao: 30, vigencia_inicio: DESDE,
  },
})
await bater('faixa invertida e recusada', '/adquirentes/taxas', {
  metodo: 'POST', espera: 400, token: T,
  corpo: { adquirente_id: guardado.adq, modalidade: 'credito_parcelado', parcelas_min: 9, parcelas_max: 3 },
})
await bater('taxa acima de 100% e recusada', '/adquirentes/taxas', {
  metodo: 'POST', espera: 400, token: T,
  corpo: { adquirente_id: guardado.adq, modalidade: 'debito', taxa_percentual: 150 },
})

console.log('\n--- SIMULADOR (a dor numero um) ---')
await bater('R$ 1.000 em 6x -> 964,71 liquido', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'credito_parcelado', parcelas: 6, adquirente_id: guardado.adq, data_venda: VENDA },
  conferir: (d) => d.valor_liquido === 964.71 && d.valor_taxa === 35.29
    && d.data_prevista_liquidacao === '2026-10-08',
})
await bater('a MESMA venda em 10x cai pra 949,71', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'credito_parcelado', parcelas: 10, adquirente_id: guardado.adq, data_venda: VENDA },
  conferir: (d) => d.valor_liquido === 949.71,
})
await bater('debito de R$ 1.000 -> 980,10 em 1 dia', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'debito', adquirente_id: guardado.adq, data_venda: VENDA },
  conferir: (d) => d.valor_liquido === 980.1 && d.data_prevista_liquidacao === '2026-09-09',
})
await bater('dinheiro AVISA que nao ha taxa cadastrada', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'dinheiro', adquirente_id: guardado.adq, data_venda: VENDA },
  conferir: (d) => d.valor_liquido === 1000 && d.sem_taxa_cadastrada === true,
})
await bater('mecanico PODE simular (precisa saber pra negociar)', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: M,
  corpo: { valor_bruto: 500, modalidade: 'debito', adquirente_id: guardado.adq },
})
await bater('venda sem valor e recusada', '/adquirentes/simular', {
  metodo: 'POST', espera: 400, token: T, corpo: { valor_bruto: 0, modalidade: 'debito' },
})

console.log('\n--- RENEGOCIACAO: o passado nao pode mudar ---')
const taxas = await bater('lista taxas', '/adquirentes/taxas', { espera: 200, token: T })
const seisX = taxas.find((t) => t.modalidade === 'credito_parcelado' && t.parcelas_max === 6)
await bater('encerra a taxa de 3,49%', `/adquirentes/taxas/${seisX.id}`, {
  metodo: 'DELETE', espera: 200, token: T,
})
await bater('cadastra a renegociada, 2,89%, valendo de amanha', '/adquirentes/taxas', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    adquirente_id: guardado.adq, modalidade: 'credito_parcelado',
    parcelas_min: 2, parcelas_max: 6, taxa_percentual: 2.89, taxa_fixa: 0.39,
    dias_liquidacao: 30, vigencia_inicio: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
  },
})
// ESTE É O TESTE QUE IMPORTA: a venda antiga tem que continuar valendo
// o que valia. Se ela mudar, o relatório do mês passado muda sozinho e o
// sistema perde a credibilidade na primeira renegociação de contrato.
await bater('a venda de 08/09 CONTINUA valendo 964,71', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'credito_parcelado', parcelas: 6, adquirente_id: guardado.adq, data_venda: VENDA },
  conferir: (d) => d.valor_liquido === 964.71,
})
const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
await bater('a venda de amanha ja usa 2,89% -> 970,71', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'credito_parcelado', parcelas: 6, adquirente_id: guardado.adq, data_venda: amanha },
  conferir: (d) => d.valor_liquido === 970.71,
})

console.log('\n--- TAXA POR OPERACAO: "cada operacao tem uma variavel" ---')
await bater('taxa de PIX com imposto junto', '/adquirentes/taxas', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    adquirente_id: guardado.adq, modalidade: 'pix',
    taxa_percentual: 0.99, imposto_percentual: 6, dias_liquidacao: 0, vigencia_inicio: DESDE,
  },
})
await bater('PIX de R$ 1.000: 0,99% de taxa + 6% de imposto = 930,10', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'pix', adquirente_id: guardado.adq, data_venda: VENDA },
  conferir: (d) => d.valor_taxa === 9.9 && d.valor_imposto === 60 && d.valor_liquido === 930.1,
})

// O pedido do Lorenzo (08/09): a tabela e sugestao, cada venda pode ter
// a sua. Sem isto, taxa cadastrada virava camisa de forca.
await bater('taxa digitada na venda vence a cadastrada', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    valor_bruto: 1000, modalidade: 'pix', adquirente_id: guardado.adq,
    data_venda: VENDA, taxa_percentual: 0, imposto_percentual: 15,
  },
  conferir: (d) => d.valor_taxa === 0 && d.valor_imposto === 150
    && d.valor_liquido === 850 && d.taxa_manual === true,
})
await bater('a simulacao devolve o que a TABELA diria, pra poder voltar', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    valor_bruto: 1000, modalidade: 'pix', adquirente_id: guardado.adq,
    data_venda: VENDA, taxa_percentual: 0,
  },
  conferir: (d) => d.sugerido && Number(d.sugerido.taxa_percentual) === 0.99,
})
await bater('sem nada cadastrado, so o digitado vale e NAO acusa falta', '/adquirentes/simular', {
  metodo: 'POST', espera: 200, token: T,
  corpo: {
    valor_bruto: 1000, modalidade: 'transferencia', data_venda: VENDA,
    taxa_percentual: 2, imposto_percentual: 5, dias_liquidacao: 3,
  },
  conferir: (d) => d.valor_liquido === 930 && d.sem_taxa_cadastrada === false
    && d.data_prevista_liquidacao === '2026-09-11',
})
await bater('percentual manual acima de 100 e recusado', '/adquirentes/simular', {
  metodo: 'POST', espera: 400, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'debito', taxa_percentual: 140 },
})
await bater('taxa manual negativa e recusada', '/adquirentes/simular', {
  metodo: 'POST', espera: 400, token: T,
  corpo: { valor_bruto: 1000, modalidade: 'debito', imposto_percentual: -5 },
})
await bater('maquininha pode nascer SEM taxa nenhuma', '/adquirentes', {
  metodo: 'POST', espera: 200, token: T, corpo: { nome: 'Cielo' },
  conferir: (d) => d.id && d.nome === 'Cielo',
})

console.log(`\n${passou} passaram, ${falhou} falharam`)
process.exit(falhou > 0 ? 1 : 0)
