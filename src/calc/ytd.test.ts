import { describe, it, expect } from 'vitest'
import {
  completedPeriods,
  projectAnnual,
  realizedToDate,
  divProjection,
  faixaInfo,
  defYtdConfig,
  defDivGrid,
  type YtdConfig,
  type DivGrid,
} from './ytd'

describe('completedPeriods', () => {
  it('mensal: k = mês de referência', () => {
    expect(completedPeriods(12, 6)).toBe(6)
    expect(completedPeriods(12, 1)).toBe(1)
  })
  it('trimestral e semestral contam períodos fechados', () => {
    expect(completedPeriods(4, 6)).toBe(2)
    expect(completedPeriods(2, 6)).toBe(1)
    expect(completedPeriods(4, 7)).toBe(2)
  })
})

describe('projectAnnual', () => {
  const base = (over: Partial<YtdConfig>): YtdConfig => ({ ...defYtdConfig(), mode: 'ytd', ...over })

  it('run-rate mensal com 6 meses = ×2', () => {
    const cfg = base({ method: 'runrate', realized: [10000, 10000, 10000, 10000, 10000, 10000] })
    expect(projectAnnual(cfg, 6)).toBeCloseTo(120000, 6)
  })

  it('run-rate lida com valores irregulares', () => {
    const cfg = base({ method: 'runrate', realized: [20000, 0, 40000, 0, 30000, 10000] }) // soma 100k em 6m
    expect(projectAnnual(cfg, 6)).toBeCloseTo(200000, 6)
  })

  it('repetir último período', () => {
    const cfg = base({ method: 'last', realized: [5000, 5000, 5000, 5000, 5000, 8000] })
    // ytd = 33000; último = 8000; restam 6 meses → 33000 + 48000
    expect(projectAnnual(cfg, 6)).toBeCloseTo(81000, 6)
  })

  it('manual soma os períodos restantes informados', () => {
    const cfg = base({ method: 'manual', realized: [10000, 10000, 10000], manual: [5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000] })
    // ytd (3m) = 30000; restam 9 meses × 5000 = 45000
    expect(projectAnnual(cfg, 3)).toBeCloseTo(75000, 6)
  })

  it('trimestral run-rate', () => {
    const cfg = base({ gran: 4, method: 'runrate', realized: [100000, 100000] }) // 2 tri, 200k
    expect(projectAnnual(cfg, 6)).toBeCloseTo(400000, 6)
  })

  it('realizedToDate soma só os períodos fechados', () => {
    const cfg = base({ realized: [10000, 20000, 30000, 999999] })
    expect(realizedToDate(cfg, 3)).toBe(60000)
  })
})

describe('divProjection — grade [mês × CNPJ] e gatilho de 50k', () => {
  const grid = (over: Partial<DivGrid>): DivGrid => ({ ...defDivGrid(), mode: 'ytd', ...over })

  it('2 PJs a 35k/mês (< 50k) não geram IRRF; run-rate projeta o ano', () => {
    const g = grid({
      pjs: [{ nome: 'PJ 1' }, { nome: 'PJ 2' }],
      cells: [
        [35000, 35000, 35000, 35000, 35000, 35000],
        [35000, 35000, 35000, 35000, 35000, 35000],
      ],
      method: 'runrate',
    })
    const r = divProjection(g, 6)
    expect(r.realized).toBeCloseTo(420000, 6) // 2 × 210k
    expect(r.annual).toBeCloseTo(840000, 6) // ×2
    expect(r.irrf).toBe(0) // cada PJ 35k/mês < 50k
  })

  it('uma PJ a 70k/mês (> 50k) gera 10% sobre o total mensal', () => {
    const g = grid({
      pjs: [{ nome: 'PJ 1' }],
      cells: [[70000, 70000, 70000, 70000, 70000, 70000]],
      method: 'runrate',
    })
    const r = divProjection(g, 6)
    expect(r.realized).toBeCloseTo(420000, 6)
    expect(r.annual).toBeCloseTo(840000, 6)
    // IRRF: 12 meses × 70k × 10% = 84.000
    expect(r.irrf).toBeCloseTo(84000, 6)
  })

  it('pulverizar reduz IRRF: mesmo total anual, menos imposto retido', () => {
    const concentrado = divProjection(
      grid({ pjs: [{ nome: 'A' }], cells: [[70000, 70000, 70000, 70000, 70000, 70000]], method: 'runrate' }),
      6,
    )
    const pulverizado = divProjection(
      grid({
        pjs: [{ nome: 'A' }, { nome: 'B' }],
        cells: [
          [35000, 35000, 35000, 35000, 35000, 35000],
          [35000, 35000, 35000, 35000, 35000, 35000],
        ],
        method: 'runrate',
      }),
      6,
    )
    expect(concentrado.annual).toBeCloseTo(pulverizado.annual, 6)
    expect(pulverizado.irrf).toBeLessThan(concentrado.irrf)
  })
})

describe('faixaInfo — distância e meses até cruzar 600k', () => {
  it('projeta o mês em que a base cruza 600k no ritmo atual', () => {
    // 540k em 6 meses → 90k/mês; faltam 60k → ~1 mês → cruza no mês 7
    const fi = faixaInfo(540000, 6)
    expect(fi.jaCruzou600).toBe(false)
    expect(fi.mesesAteCruzar600).toBe(1)
    expect(fi.crossMonth).toBe(7)
  })

  it('sinaliza quando já cruzou 600k', () => {
    const fi = faixaInfo(700000, 6)
    expect(fi.jaCruzou600).toBe(true)
    expect(fi.mesesAteCruzar600).toBeNull()
  })
})
