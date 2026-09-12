// De onde vem a renda: trabalho, capital, ou o que ainda não dá para afirmar.
//
// A pergunta que isto responde não é fiscal, é de vida: quanto do que entra
// depende de você acordar cedo e quanto o patrimônio produz sozinho. É também o
// que dá sentido ao rendimento do capital — sem separar as duas, "renda"
// misturada não se compara com o CDI de nada.
//
// Uma decisão que muda tudo para quem tem PJ: lucros e dividendos da SUA
// empresa são trabalho, não capital. O médico que distribui lucro da própria
// clínica não está vivendo de renda — está sendo pago pelo que fez. Por isso a
// classificação de dividendos é uma escolha da pessoa, não do app.

export type Origem = 'trabalho' | 'capital' | 'indefinido'

export interface FonteRenda {
  chave: string
  rotulo: string
  valor: number
  origem: Origem
}

/**
 * Chaves de `vals` que são renda recebida (as `*_ir` são imposto retido, não
 * renda) e o que cada uma significa na hora de separar trabalho de capital.
 */
const FONTES: { chave: string; rotulo: string; origem: Origem }[] = [
  { chave: 'salario', rotulo: 'Salário / pró-labore', origem: 'trabalho' },
  { chave: 'divBR', rotulo: 'Lucros e dividendos', origem: 'capital' },
  { chave: 'divFII', rotulo: 'Dividendos de FII', origem: 'capital' },
  { chave: 'cdb', rotulo: 'Aplicações — tributação exclusiva', origem: 'capital' },
  { chave: 'aluguel', rotulo: 'Aluguéis', origem: 'capital' },
  { chave: 'isentos', rotulo: 'Isentos e não tributáveis', origem: 'capital' },
  // 22 junta exterior e carnê-leão; "outros" cai em vários lugares. Chutar a
  // origem aqui contaminaria a proporção que a tela afirma.
  { chave: 'exterior', rotulo: 'Exterior', origem: 'indefinido' },
  { chave: 'outros', rotulo: 'Outros rendimentos', origem: 'indefinido' },
]

/**
 * Ordem canônica das fontes — é o que dá cor estável a cada uma.
 *
 * A cor tem de seguir a fonte, não a posição no ranking: se o dividendo é azul
 * num ano, tem de ser azul em todos, senão a barra muda de significado quando a
 * ordem muda. As duas fontes sem origem definida ficam de fora — elas usam o
 * cinza de "a classificar" e não gastam cor de série.
 */
export const FONTES_COM_COR = FONTES.filter((f) => f.origem !== 'indefinido').map((f) => f.chave)

/** Todas as fontes, na ordem em que a tela deve empilhá-las dentro do grupo. */
export const ORDEM_FONTES = FONTES.map((f) => f.chave)

export interface ComposicaoRenda {
  fontes: FonteRenda[]
  total: number
  trabalho: number
  capital: number
  indefinido: number
  /** Fração da renda que veio do capital (0 a 1). Sem renda, 0. */
  fracaoCapital: number
}

export function composicaoRenda(
  vals: Record<string, number>,
  opts: { dividendosSaoTrabalho?: boolean } = {},
): ComposicaoRenda {
  const fontes = FONTES.map((f) => ({
    ...f,
    valor: vals[f.chave] || 0,
    // dividendos da própria PJ: quem decide é a pessoa, e a diferença entre as
    // duas leituras é a diferença entre "vivo de renda" e "vivo do meu trabalho"
    origem: f.chave === 'divBR' && opts.dividendosSaoTrabalho ? ('trabalho' as Origem) : f.origem,
  })).filter((f) => f.valor > 0)

  const soma = (o: Origem) => fontes.filter((f) => f.origem === o).reduce((s, f) => s + f.valor, 0)
  const trabalho = soma('trabalho')
  const capital = soma('capital')
  const indefinido = soma('indefinido')
  const total = trabalho + capital + indefinido

  return {
    fontes: fontes.sort((a, b) => b.valor - a.valor),
    total,
    trabalho,
    capital,
    indefinido,
    fracaoCapital: total > 0 ? capital / total : 0,
  }
}
