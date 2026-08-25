// Parâmetros fiscais com ano, fonte e grau de confirmação declarados.
//
// Por que isto existe: as tabelas de INSS e IRRF mudam todo ano, mas o número
// que sai delas vira DEDUÇÃO do IRPFM — erra a tabela, erra a conta final sem
// que nada quebre. Antes elas eram constantes soltas, sem dizer de que ano
// eram; havia inclusive tabela de anos diferentes convivendo. Aqui cada grupo
// carrega a fonte e um `confirmado` que a tela mostra, para a pessoa saber o
// que é lei e o que ainda é estimativa.

export interface FaixaINSS {
  ate: number
  aliq: number
}
export interface FaixaIRRF {
  ate: number
  aliq: number
  ded: number
}

/** Comum a todo grupo de parâmetro: de onde veio e se já é definitivo. */
export interface Procedencia {
  /** Norma ou documento que sustenta os valores. */
  fonte: string
  /** `false` = ainda é estimativa/projeção para este ano-base. */
  confirmado: boolean
  /** O que falta para confirmar, quando não está. */
  nota?: string
}

export interface ParametrosAno {
  ano: number
  inss: Procedencia & { faixas: FaixaINSS[] }
  irrf: Procedencia & { faixas: FaixaIRRF[] }
  dependente: Procedencia & { mensal: number }
  /** Art. 3º-A da Lei 9.250/1995 (redação da Lei 15.270/2025). */
  reducao: Procedencia & {
    isencaoAte: number
    reducaoAte: number
    constante: number
    coeficiente: number
  }
  /** Art. 16-A (IRPFM anual) e Art. 6º-A (IRRF mensal de dividendos). */
  irpfm: Procedencia & {
    baseIsenta: number
    baseAliqCheia: number
    aliqMax: number
    gatilhoDividendoMes: number
    aliqIrrfDividendo: number
  }
}

// Núcleo da Lei 15.270/2025 — igual em qualquer ano de vigência, conferido
// contra o texto primário (ver PLAN.md).
const LEI_15270: ParametrosAno['irpfm'] = {
  baseIsenta: 600_000,
  baseAliqCheia: 1_200_000,
  aliqMax: 0.1,
  gatilhoDividendoMes: 50_000,
  aliqIrrfDividendo: 0.1,
  fonte: 'Lei nº 15.270/2025, Art. 16-A e Art. 6º-A',
  confirmado: true,
}

const REDUCAO_15270: ParametrosAno['reducao'] = {
  isencaoAte: 5_000,
  reducaoAte: 7_350,
  constante: 978.62,
  coeficiente: 0.133145,
  fonte: 'Lei nº 15.270/2025, Art. 3º-A da Lei 9.250/1995',
  confirmado: true,
}

const DEPENDENTE: ParametrosAno['dependente'] = {
  mensal: 189.59,
  fonte: 'Lei nº 9.250/1995, art. 4º — valor inalterado desde 2015',
  confirmado: true,
}

// Tabela progressiva mensal do IRRF em vigor desde mai/2025 (com a parcela a
// deduzir de cada faixa).
const IRRF_MAI_2025: FaixaIRRF[] = [
  { ate: 2428.8, aliq: 0.0, ded: 0 },
  { ate: 2826.65, aliq: 0.075, ded: 182.16 },
  { ate: 3751.05, aliq: 0.15, ded: 394.16 },
  { ate: 4664.68, aliq: 0.225, ded: 675.49 },
  { ate: Infinity, aliq: 0.275, ded: 908.73 },
]

export const PARAMS: Record<number, ParametrosAno> = {
  2026: {
    ano: 2026,
    inss: {
      // Faixas do segurado reajustadas na virada do ano junto com o mínimo.
      faixas: [
        { ate: 1621.0, aliq: 0.075 },
        { ate: 2902.84, aliq: 0.09 },
        { ate: 4354.27, aliq: 0.12 },
        { ate: 8475.55, aliq: 0.14 },
      ],
      fonte: 'Reajuste anual das faixas do segurado (portaria interministerial)',
      confirmado: false,
      nota: 'Faixas e teto estimados para 2026 — conferir a portaria publicada antes de tratar o IRRF do pró-labore como definitivo.',
    },
    irrf: {
      faixas: IRRF_MAI_2025,
      fonte: 'Tabela progressiva mensal em vigor desde mai/2025',
      confirmado: false,
      nota: 'Mantida a tabela de mai/2025; se houver reajuste para 2026, o IRRF do pró-labore sai maior do que o real.',
    },
    dependente: DEPENDENTE,
    reducao: REDUCAO_15270,
    irpfm: LEI_15270,
  },
}

/** Ano-base do app: o IRPFM incide sobre 2026 e é declarado em 2027. */
export const ANO_BASE = 2026

export function parametros(ano: number = ANO_BASE): ParametrosAno {
  const p = PARAMS[ano]
  if (!p) throw new Error(`Sem parâmetros fiscais cadastrados para ${ano}.`)
  return p
}

export interface Pendencia {
  grupo: string
  fonte: string
  nota: string
}

/**
 * Os grupos que ainda não são definitivos, para a tela dizer isso em vez de
 * apresentar estimativa com cara de lei.
 */
export function pendencias(p: ParametrosAno = parametros()): Pendencia[] {
  const grupos: [string, Procedencia][] = [
    ['INSS', p.inss],
    ['Tabela do IRRF', p.irrf],
    ['Dedução por dependente', p.dependente],
    ['Redução do IR mensal', p.reducao],
    ['IRPFM', p.irpfm],
  ]
  return grupos
    .filter(([, g]) => !g.confirmado)
    .map(([grupo, g]) => ({ grupo, fonte: g.fonte, nota: g.nota ?? '' }))
}
