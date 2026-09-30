import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { Marca } from '../components/Marca.jsx'
import { Simulador } from '../components/Simulador.jsx'

// O painel de verdade (faturamento, taxas pagas no mês, margem por OS)
// só tem o que mostrar depois da E5 — antes disso não existe uma venda no
// banco. Em vez de caixinhas zeradas que parecem defeito, esta tela leva o
// SIMULADOR pra cima: é a pergunta nº 1 da oficina e ela já dá resposta
// certa hoje, com as taxas cadastradas.

const ETAPAS = [
  { id: 'E1', titulo: 'Fundação', detalhe: 'Banco, RLS, login, papéis, deploy', estado: 'feito' },
  { id: 'E2', titulo: 'Cadastros', detalhe: 'Clientes, veículos, produtos, serviços, taxas', estado: 'feito' },
  { id: 'E3', titulo: 'Ordem de serviço', detalhe: 'Kanban, itens, margem ao vivo, fotos', estado: 'feito' },
  { id: 'E4', titulo: 'Estoque', detalhe: 'Compra, custo médio, fracionamento, baixa', estado: 'feito' },
  { id: 'E5', titulo: 'Financeiro', detalhe: 'fechar_os, taxas de cartão, conciliação', estado: 'agora' },
  { id: 'E6', titulo: 'Painel e relatórios', detalhe: 'Os números na primeira tela', estado: 'fila' },
  { id: 'E7', titulo: 'Planilha e piloto', detalhe: 'Importação e uso assistido na oficina', estado: 'fila' },
]

const COR = { feito: 'var(--ok)', agora: 'var(--racing-vermelho-2)', fila: 'var(--texto-3)' }
const ROTULO = { feito: 'pronto', agora: 'em obra', fila: 'na fila' }

export function InicioPage({ usuario, oficina, papel, aoNavegar }) {
  const [resumo, setResumo] = useState(null)

  // Uma volta só pelos cadastros, para dizer o que ainda falta preencher.
  // Sistema vazio sem explicação é sistema abandonado na segunda semana.
  useEffect(() => {
    Promise.all([
      api('/clientes').catch(() => []),
      api('/clientes/veiculos/lista').catch(() => []),
      api('/catalogo/produtos').catch(() => []),
      api('/catalogo/servicos').catch(() => []),
      api('/adquirentes/taxas').catch(() => []),
      api('/estoque/alertas').catch(() => []),
    ]).then(([c, v, p, s, t, a]) => setResumo({
      clientes: c.length, veiculos: v.length, produtos: p.length,
      servicos: s.length, taxas: t.filter((x) => x.vigente).length, alertas: a,
    }))
  }, [])

  // Frase pronta por item, não "Nenhum {rotulo}": taxa é feminino,
  // produto é masculino, e concordância montada por concatenação sempre
  // acaba escrevendo "Nenhum taxa".
  const faltando = resumo
    ? [
        { rotulo: 'Nenhuma taxa de maquininha', n: resumo.taxas, destino: '/cadastros' },
        { rotulo: 'Nenhum serviço', n: resumo.servicos, destino: '/cadastros' },
        { rotulo: 'Nenhum produto', n: resumo.produtos, destino: '/estoque' },
        { rotulo: 'Nenhum cliente', n: resumo.clientes, destino: '/clientes' },
      ].filter((x) => x.n === 0)
    : []

  return (
    <div>
      <div className="cartao" style={{ marginBottom: 16 }}>
        <Marca altura={30} />
        <p className="sutil" style={{ marginTop: 14, marginBottom: 0 }}>
          {oficina} · {usuario.nome} · <span className="etiqueta">{papel}</span>
        </p>
      </div>

      {faltando.length > 0 && (
        <div className="cartao" style={{ marginBottom: 16, borderColor: 'rgba(245,166,35,0.4)' }}>
          <h3 style={{ marginTop: 0 }}>Falta cadastrar</h3>
          <p className="sutil" style={{ marginTop: 0 }}>
            Sem isto o sistema funciona, mas responde com número incompleto.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {faltando.map((x) => (
              <button key={x.rotulo} className="btn-fantasma"
                      style={{ padding: '7px 13px', minHeight: 0, fontSize: 13 }}
                      onClick={() => aoNavegar(x.destino)}>
                {x.rotulo} →
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}><Simulador /></div>

      {resumo && (
        <div className="cartao" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>O que já está cadastrado</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <span className="chip"><strong className="num">{resumo.clientes}</strong> clientes</span>
            <span className="chip"><strong className="num">{resumo.veiculos}</strong> veículos</span>
            <span className="chip"><strong className="num">{resumo.produtos}</strong> produtos</span>
            <span className="chip"><strong className="num">{resumo.servicos}</strong> serviços</span>
            <span className="chip"><strong className="num">{resumo.taxas}</strong> taxas vigentes</span>
          </div>
        </div>
      )}

      <h2 style={{ marginBottom: 12 }}>Onde o sistema está</h2>
      <div className="cartao">
        {ETAPAS.map((e) => (
          <div className="linha-lista" key={e.id}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'baseline', minWidth: 0 }}>
              <strong className="num" style={{ color: COR[e.estado] }}>{e.id}</strong>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{e.titulo}</div>
                <div className="sutil">{e.detalhe}</div>
              </div>
            </div>
            <span className="etiqueta" style={{ color: COR[e.estado], borderColor: COR[e.estado], flexShrink: 0 }}>
              {ROTULO[e.estado]}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
