// Projeção YTD (year-to-date): anualiza renda parcial por fonte e projeta a
// base do IRPFM no fechamento do ano. Ver PLAN.md ("Mecânica: Projeção YTD").

export type Gran = 12 | 4 | 2
export type Method = 'runrate' | 'last' | 'manual'

export interface YtdConfig {
  mode: 'anual' | 'ytd'
  gran: Gran
  method: Method
  realized: number[] // valores dos períodos já fechados
  manual: number[] // projeção manual dos períodos restantes (method='manual')
}

export interface DivPJ {
  nome: string
}

export interface DivGrid {
  mode: 'anual' | 'ytd'
  pjs: DivPJ[]
  cells: number[][] // [pjIndex][mês 0..11] — valores realizados (dividendos são mensais)
  method: Method
  manualMonthly: number[] // projeção da média mensal por PJ (method='manual')
}

// Dividendos: gatilho e alíquota do IRRF mensal (Art. 6º-A, Lei 15.270/2025).
export const DIV_TRIGGER = 50000
export const DIV_ALIQ = 0.1

export const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function periodLabels(gran: Gran): string[] {
  if (gran === 12) return MONTHS
  if (gran === 4) return ['1º tri', '2º tri', '3º tri', '4º tri']
  return ['1º sem', '2º sem']
}

// Períodos já fechados dada a granularidade e o mês de referência (1..12).
export function completedPeriods(gran: Gran, mesRef: number): number {
  const monthsPerPeriod = 12 / gran
  return Math.max(0, Math.min(gran, Math.floor(mesRef / monthsPerPeriod)))
}

// Soma realizada até a data (períodos fechados).
export function realizedToDate(cfg: YtdConfig, mesRef: number): number {
  const k = completedPeriods(cfg.gran, mesRef)
  return cfg.realized.slice(0, k).reduce((s, x) => s + (x || 0), 0)
}

// Projeção do valor anual conforme o método escolhido.
export function projectAnnual(cfg: YtdConfig, mesRef: number): number {
  const N = cfg.gran
  const k = completedPeriods(cfg.gran, mesRef)
  const realized = cfg.realized.slice(0, k)
  const ytd = realized.reduce((s, x) => s + (x || 0), 0)
  const remaining = N - k
  if (remaining <= 0) return ytd
  if (cfg.method === 'manual') {
    return ytd + cfg.manual.slice(0, remaining).reduce((s, x) => s + (x || 0), 0)
  }
  if (k === 0) return 0 // nada realizado e sem manual → não dá pra projetar
  if (cfg.method === 'runrate') return (ytd * N) / k
  // 'last': repete o último período fechado
  return ytd + (realized[k - 1] || 0) * remaining
}

export interface DivPjResult {
  nome: string
  sumRealizado: number
  irrfRealizado: number
  futMensal: number
  futTotal: number
  irrfFuturo: number
  annual: number
  irrf: number
}

export interface DivResult {
  pjs: DivPjResult[]
  annual: number
  realized: number
  irrf: number
}

// Projeção dos dividendos pela grade [mês × PJ], com IRRF de 10% por célula/
// mês-projeção quando o valor mensal de uma PJ ultrapassa R$ 50k.
export function divProjection(grid: DivGrid, mesRef: number): DivResult {
  const k = Math.max(0, Math.min(12, mesRef))
  const pjs = grid.pjs.map((pj, j) => {
    const row = grid.cells[j] || []
    const completed: number[] = []
    for (let m = 0; m < k; m++) completed.push(row[m] || 0)
    const sumRealizado = completed.reduce((s, x) => s + x, 0)
    const irrfRealizado = completed.reduce((s, x) => s + (x > DIV_TRIGGER ? DIV_ALIQ * x : 0), 0)
    const remaining = 12 - k
    let futMensal = 0
    if (remaining > 0) {
      if (k === 0) futMensal = grid.method === 'manual' ? grid.manualMonthly[j] || 0 : 0
      else if (grid.method === 'runrate') futMensal = sumRealizado / k
      else if (grid.method === 'last') futMensal = completed[k - 1] || 0
      else futMensal = grid.manualMonthly[j] || 0
    }
    const futTotal = futMensal * remaining
    const irrfFuturo = (futMensal > DIV_TRIGGER ? DIV_ALIQ * futMensal : 0) * remaining
    return {
      nome: pj.nome,
      sumRealizado,
      irrfRealizado,
      futMensal,
      futTotal,
      irrfFuturo,
      annual: sumRealizado + futTotal,
      irrf: irrfRealizado + irrfFuturo,
    }
  })
  return {
    pjs,
    annual: pjs.reduce((s, p) => s + p.annual, 0),
    realized: pjs.reduce((s, p) => s + p.sumRealizado, 0),
    irrf: pjs.reduce((s, p) => s + p.irrf, 0),
  }
}

export interface FaixaInfo {
  falta600: number
  falta12: number
  runMensal: number
  mesesAteCruzar600: number | null
  crossMonth: number | null // mês (1..12) em que cruza 600k; >12 = não cruza este ano
  jaCruzou600: boolean
  jaCruzou12: boolean
}

// Distância até os degraus 600k / 1,2M e projeção de quando a base os cruza,
// no ritmo do que já foi realizado.
export function faixaInfo(baseRealizada: number, mesRef: number): FaixaInfo {
  const falta600 = Math.max(0, 600000 - baseRealizada)
  const falta12 = Math.max(0, 1200000 - baseRealizada)
  const runMensal = mesRef > 0 ? baseRealizada / mesRef : 0
  const jaCruzou600 = baseRealizada >= 600000
  const jaCruzou12 = baseRealizada >= 1200000
  let mesesAteCruzar600: number | null = null
  let crossMonth: number | null = null
  if (!jaCruzou600 && runMensal > 0) {
    mesesAteCruzar600 = Math.ceil(falta600 / runMensal)
    crossMonth = mesRef + mesesAteCruzar600
  }
  return { falta600, falta12, runMensal, mesesAteCruzar600, crossMonth, jaCruzou600, jaCruzou12 }
}

// ---- Fábricas de estado padrão ----

export function defYtdConfig(): YtdConfig {
  return { mode: 'anual', gran: 12, method: 'runrate', realized: [], manual: [] }
}

export const YTD_KEYS = ['salario', 'exterior', 'aluguel', 'cdb', 'outros'] as const

export function defYtdMap(): Record<string, YtdConfig> {
  const o: Record<string, YtdConfig> = {}
  YTD_KEYS.forEach((k) => {
    o[k] = defYtdConfig()
  })
  return o
}

export function defDivGrid(): DivGrid {
  return { mode: 'anual', pjs: [{ nome: 'PJ 1' }], cells: [[]], method: 'runrate', manualMonthly: [] }
}
