import { useState } from 'react'
import { Abas } from '../components/ui.jsx'
import { ProdutosPage } from './ProdutosPage.jsx'
import { ComprasPage } from './ComprasPage.jsx'

// ---------------------------------------------------------------------
// "Peças" e "Compras" respondem a MESMA pergunta — o que eu tenho, e
// quanto me custou. Separá-las em dois itens de menu enchia a barra do
// celular (7 itens em 375 px ficam colados) e obrigava a escolher entre
// duas telas que a pessoa usa na mesma tarefa: conferiu a prateleira,
// lançou a nota.
//
// A aba de Compras só existe para quem lança nota; o mecânico vê só as
// peças, que é o que ele usa.
// ---------------------------------------------------------------------
export function EstoquePage({ podeEditar, papel, aoAbrirOs }) {
  const [aba, setAba] = useState('produtos')
  const veCompras = papel !== 'mecanico'

  if (!veCompras) {
    return <ProdutosPage podeEditar={podeEditar} papel={papel} aoAbrirOs={aoAbrirOs} />
  }

  return (
    <div>
      <Abas
        atual={aba} aoTrocar={setAba}
        itens={[{ id: 'produtos', rotulo: 'Peças' }, { id: 'compras', rotulo: 'Compras' }]}
      />
      {aba === 'produtos'
        ? <ProdutosPage podeEditar={podeEditar} papel={papel} aoAbrirOs={aoAbrirOs} />
        : <ComprasPage aoVerProduto={() => setAba('produtos')} />}
    </div>
  )
}
