// Paleta escura do app (portada do standalone original).
export const C = {
  bg0: '#1a1a1a',
  bg1: '#222',
  bg2: '#2a2a2a',
  bg3: '#333',
  border: '#3a3a3a',
  borderStrong: '#4a4a4a',
  text: '#f0f0f0',
  textSec: '#aaa',
  // #666 dava 3,0:1 contra o fundo — abaixo do mínimo legível para texto
  // pequeno, que é justamente onde esta cor é usada (legendas, notas de
  // rodapé, explicação de campo). #949494 passa de 4,5:1 nos três fundos.
  textMut: '#949494',
  orange: '#e8834a',
  orangeLight: '#f0a070',
  orangeDim: '#3a2010',
  orangeBorder: '#7a4020',
  green: '#5aaa70',
  greenDim: '#0f2a18',
  red: '#cc5555',
  blue: '#5588cc',
  blueDim: '#0f1a2a',
  blueBorder: '#224488',
} as const

/**
 * Paleta dos gráficos. Não é escolha de gosto: estas séries passaram no
 * validador de daltonismo/contraste contra o fundo escuro do app (banda de
 * luminosidade, piso de croma, separação CVD e contraste ≥ 3:1).
 *
 * A ordem é FIXA — a cor segue a categoria, não a posição no ranking, senão um
 * filtro que muda a ordem repinta tudo e o leitor perde a referência.
 */
export const VIZ = {
  /** Categorias (classes de patrimônio). Da 7ª em diante, agrupar em "Outros". */
  serie: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'] as const,
  /** Regime de resgate — ordem: cai na base, fora, a confirmar. */
  regime: { inBase: '#d95926', foraBase: '#199e70', depende: '#3987e5' } as const,
  /** Projeção: mesma cor da série histórica, tracejada. */
  grid: '#3a3a3a',
} as const
