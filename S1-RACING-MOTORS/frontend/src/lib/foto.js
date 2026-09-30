// ---------------------------------------------------------------------
// Comprime a foto NO APARELHO antes de subir.
//
// Uma foto de celular moderno tem 4 a 8 MB. Numa oficina, com 4G ruim e
// 6 fotos por OS, subir isso cru significa o mecânico esperando meio
// minuto e desistindo — e é o desistir que mata o sistema, não o tamanho
// do arquivo. Reduzida para 1280 px e JPEG 0,55, a mesma foto fica em
// torno de 100 KB e continua mostrando o risco no para-choque, que é
// para o que ela serve.
//
// Sem biblioteca: canvas do próprio navegador.
// ---------------------------------------------------------------------
const LADO_MAXIMO = 1280
const QUALIDADE = 0.55

export function comprimirFoto(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo || !arquivo.type.startsWith('image/')) {
      reject(new Error('Isso não é uma imagem.'))
      return
    }

    const leitor = new FileReader()
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    leitor.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Não consegui abrir a imagem.'))
      img.onload = () => {
        // Encolhe pelo lado MAIOR, preservando a proporção. Encolher
        // pela largura deixaria foto em pé gigante.
        const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height))
        const largura = Math.round(img.width * escala)
        const altura = Math.round(img.height * escala)

        const tela = document.createElement('canvas')
        tela.width = largura
        tela.height = altura
        const ctx = tela.getContext('2d')
        // Fundo branco: PNG com transparência vira preto ao virar JPEG.
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, largura, altura)
        ctx.drawImage(img, 0, 0, largura, altura)

        resolve({
          dados: tela.toDataURL('image/jpeg', QUALIDADE),
          largura,
          altura,
          original: arquivo.size,
        })
      }
      img.src = leitor.result
    }
    leitor.readAsDataURL(arquivo)
  })
}
