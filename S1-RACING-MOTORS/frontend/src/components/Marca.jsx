// Marca do sistema, desenhada em SVG a partir do logo da oficina: as
// tres faixas diagonais (preta, vermelha, amarela) e a tipografia
// condensada de RACING com MOTORS espacado embaixo.
//
// SVG e nao PNG de proposito: fica nitido em qualquer tela, muda de cor
// e de tamanho sem reexportar nada, e pesa ~1 KB no bundle em vez de
// virar mais uma requisicao de imagem no celular do mecanico.

export function Faixas({ altura = 30 }) {
  return (
    <svg
      height={altura}
      viewBox="0 0 62 40"
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', width: 'auto' }}
    >
      {/* No logo original a primeira faixa e preta sobre um fundo cinza
          claro. Aqui o fundo do sistema e quase preto, entao a faixa
          preta simplesmente sumiria — ela vira branca para manter o
          MESMO contraste que ela tem no logo impresso. */}
      <path d="M14 0h13L13 40H0z" fill="var(--texto)" />
      <path d="M33 0h13L32 40H19z" fill="var(--racing-vermelho)" />
      <path d="M52 0h10L48 40H38z" fill="var(--racing-amarelo)" />
    </svg>
  )
}

export function Marca({ altura = 30 }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: altura * 0.32,
        userSelect: 'none',
      }}
    >
      <Faixas altura={altura} />
      <div style={{ lineHeight: 1 }}>
        <div
          style={{
            fontSize: altura * 0.72,
            fontWeight: 800,
            letterSpacing: '-0.02em',
            color: 'var(--texto)',
          }}
        >
          RACING
        </div>
        <div
          style={{
            fontSize: altura * 0.33,
            fontWeight: 500,
            letterSpacing: altura * 0.11,
            color: 'var(--texto-2)',
            marginTop: altura * 0.11,
            marginLeft: 2,
          }}
        >
          MOTORS
        </div>
      </div>
    </div>
  )
}

// Versao curta para a barra de navegacao apertada do celular.
export function MarcaCurta({ altura = 22 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Faixas altura={altura} />
      <strong style={{ fontSize: altura * 0.62, letterSpacing: '-0.01em' }}>RACING</strong>
      <span
        style={{
          fontSize: altura * 0.44,
          color: 'var(--texto-3)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        Gestão
      </span>
    </div>
  )
}
