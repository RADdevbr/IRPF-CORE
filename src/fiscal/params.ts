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
  /** Valores trocados à mão por quem usa — a tela precisa dizer isso. */
  manual?: boolean
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
  /**
   * Declaração de ajuste anual — o que se deduz e como se apura o imposto
   * DEVIDO, que é o valor que a Lei 15.270/2025 manda abater do IRPFM.
   */
  declaracao: Procedencia & {
    /** Teto do desconto do modelo simplificado, no ano. */
    descontoSimplificadoTeto: number
    /** Fração do rendimento que o desconto simplificado abate, até o teto. */
    descontoSimplificadoAliq: number
    /** Teto anual de instrução, por pessoa (contribuinte e cada dependente). */
    instrucaoPorPessoa: number
    /** Teto da previdência complementar, como fração do rendimento tributável. */
    previdenciaPrivadaFracao: number
  }
  /**
   * IR sobre o rendimento de aplicações financeiras de renda fixa.
   *
   * `aliquotaUnica: null` = vale a tabela regressiva por prazo, que é a regra em
   * vigor. Um número aqui substitui a tabela por uma alíquota só — é cenário,
   * não lei, e a tela precisa dizer isso.
   */
  rendaFixa: Procedencia & { aliquotaUnica: number | null }
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

/**
 * Limites da declaração de ajuste anual.
 *
 * Valores parados desde 2015, como a dedução por dependente. Ficam
 * `confirmado: false` porque a Lei 15.270/2025 mexeu na tabela e na isenção sem
 * que se possa presumir o que aconteceu com estes — e um teto errado aqui muda
 * o imposto devido, que agora é dedução do IRPFM.
 */
const DECLARACAO: ParametrosAno['declaracao'] = {
  descontoSimplificadoTeto: 16_754.34,
  descontoSimplificadoAliq: 0.2,
  instrucaoPorPessoa: 3_561.50,
  previdenciaPrivadaFracao: 0.12,
  fonte: 'Lei nº 9.250/1995, arts. 8º e 10 — valores inalterados desde 2015',
  confirmado: false,
  nota: 'Tetos de 2015. Conferir os do ano-base antes de tratar o imposto devido como definitivo — ele é dedução do IRPFM.',
}

/**
 * Renda fixa: a tabela regressiva continua sendo a regra.
 *
 * O app já chegou a trazer 17,5% fixo para aportes de 2026, atribuídos à "reforma
 * da Lei 15.270/2025". A atribuição não se sustenta: a Lei 15.270/2025 trata de
 * IRPF, dividendos e imposto mínimo, e não toca na tributação de aplicações
 * financeiras. A alíquota única estava na MP 1.303/2025, que perdeu a eficácia
 * sem ser convertida em lei.
 *
 * Ficou como CENÁRIO, desligado, em vez de sumir: se a regra voltar por norma
 * nova, quem usa liga o interruptor em vez de esperar um deploy — que é o mesmo
 * arranjo já usado para as tabelas de INSS e IRRF.
 */
const RENDA_FIXA_REGRESSIVA: ParametrosAno['rendaFixa'] = {
  aliquotaUnica: null,
  fonte: 'Tabela regressiva por prazo — Lei 11.033/2004, art. 1º',
  confirmado: true,
}

/** A alíquota única que a MP 1.303/2025 propôs, para quem quiser simular. */
export const ALIQUOTA_UNICA_PROPOSTA = 0.175

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
    declaracao: DECLARACAO,
    rendaFixa: RENDA_FIXA_REGRESSIVA,
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

/**
 * Tabelas trocadas à mão.
 *
 * Existe porque INSS e IRRF de 2026 aqui são ESTIMATIVA: quando a portaria sair,
 * quem usa não deveria depender de um deploy para ter a conta certa. Serve
 * também para simular uma tabela que ainda está em discussão.
 */
export interface OverridesParametros {
  inss?: FaixaINSS[]
  irrf?: FaixaIRRF[]
  dependenteMensal?: number
  /**
   * Alíquota única da renda fixa, para simular uma regra que não está em vigor.
   * `null`/ausente = tabela regressiva.
   */
  rendaFixaAliquotaUnica?: number | null
}

/**
 * Aplica as tabelas informadas à mão sobre os parâmetros do ano.
 *
 * O grupo trocado vira `manual` e deixa de ser pendência — mas não vira "lei
 * confirmada": a fonte passa a dizer que o número veio de quem usa, que é a
 * verdade e é o que a tela e a memória precisam mostrar.
 */
export function aplicarOverrides(
  base: ParametrosAno,
  ov: OverridesParametros | undefined,
): ParametrosAno {
  if (!ov) return base
  const marca = (fonte: string) => ({ fonte, confirmado: true, manual: true, nota: undefined })
  return {
    ...base,
    inss: ov.inss?.length
      ? { ...base.inss, faixas: ov.inss, ...marca('Faixas do INSS informadas à mão') }
      : base.inss,
    irrf: ov.irrf?.length
      ? { ...base.irrf, faixas: ov.irrf, ...marca('Tabela do IRRF informada à mão') }
      : base.irrf,
    dependente:
      ov.dependenteMensal !== undefined
        ? { ...base.dependente, mensal: ov.dependenteMensal, ...marca('Dedução por dependente informada à mão') }
        : base.dependente,
    // A alíquota única é simulação de regra que não existe: fica `manual` e a
    // nota diz o que ela é, para não passar por lei nem por padrão do app.
    rendaFixa:
      ov.rendaFixaAliquotaUnica != null
        ? {
            ...base.rendaFixa,
            aliquotaUnica: ov.rendaFixaAliquotaUnica,
            fonte: 'Alíquota única da renda fixa — cenário informado à mão, sem norma em vigor',
            confirmado: false,
            manual: true,
            nota: 'A regra em vigor é a tabela regressiva por prazo. Este número é simulação.',
          }
        : base.rendaFixa,
  }
}

/** Grupos que a pessoa trocou à mão, para a tela e a memória declararem. */
export function manuais(p: ParametrosAno): string[] {
  return (
    [
      ['INSS', p.inss],
      ['Tabela do IRRF', p.irrf],
      ['Dedução por dependente', p.dependente],
      ['Redução do IR mensal', p.reducao],
      ['Limites da declaração', p.declaracao],
      ['IR da renda fixa', p.rendaFixa],
      ['IRPFM', p.irpfm],
    ] as [string, Procedencia][]
  )
    .filter(([, g]) => g.manual)
    .map(([nome]) => nome)
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
    ['Limites da declaração', p.declaracao],
    ['IR da renda fixa', p.rendaFixa],
    ['IRPFM', p.irpfm],
  ]
  return grupos
    .filter(([, g]) => !g.confirmado)
    .map(([grupo, g]) => ({ grupo, fonte: g.fonte, nota: g.nota ?? '' }))
}
