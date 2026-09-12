import { describe, it, expect } from 'vitest'
import { deflatorPara, chaveBenchmark, type BenchmarksInformados } from './benchmarks.js'


// PAT-04 — o painel era nominal de ponta a ponta, e a janela que ele desenha
// tem mais de 30% de inflação dentro.
describe('deflatorPara — ler o passado em reais de hoje', () => {
  const ipca = (pares: [number, number][]): BenchmarksInformados =>
    Object.fromEntries(pares.map(([ano, taxa]) => [chaveBenchmark('ipca', ano), taxa]))

  it('o ano-referência vale 1 por definição', () => {
    expect(deflatorPara(2025, [2025], ipca([])).map((d) => d.deflator)).toEqual([1])
  })

  it('compõe a inflação do caminho, não soma', () => {
    const d = deflatorPara(2025, [2023, 2024, 2025], ipca([[2024, 0.1], [2025, 0.1]]))
    expect(d[0].deflator).toBeCloseTo(1.21, 10) // 1,1 × 1,1 — não 1,20
    expect(d[1].deflator).toBeCloseTo(1.1, 10)
    expect(d[2].deflator).toBe(1)
  })

  it('sem taxa no caminho, devolve null em vez de fingir 0%', () => {
    // A tabela embutida vai até 2025; 2027 e 2028 ninguém tem, e é aí que o
    // caminho fica furado — dentro da tabela o fallback preencheria sozinho.
    const d = deflatorPara(2028, [2026, 2028], ipca([[2026, 0.05]]))
    expect(d[0].deflator).toBeNull()
  })

  it('usa a tabela embutida quando o ano não foi informado à mão', () => {
    const d = deflatorPara(2025, [2024, 2025], {})
    expect(d[0].deflator).toBeCloseTo(1.0426, 6) // IPCA de 2025
  })

  it('não tenta trazer o futuro para o presente', () => {
    expect(deflatorPara(2023, [2025], ipca([[2024, 0.1], [2025, 0.1]]))[0].deflator).toBeNull()
  })

  it('um patrimônio que cresceu 35% nominal com 30% de inflação quase não andou', () => {
    // O deflator MULTIPLICA o valor antigo para trazê-lo a reais de hoje.
    const d = deflatorPara(2025, [2020, 2025], {}) // IPCA real de 2021..2025, da tabela
    const inicio = 1_000_000 * (d[0].deflator as number)
    const fim = 1_350_000 * (d[1].deflator as number)
    expect(d[0].deflator).toBeGreaterThan(1.3) // mais de 30% de inflação na janela
    expect(fim / inicio - 1).toBeLessThan(0.03) // 35% nominal vira quase nada
    expect(fim / inicio - 1).toBeGreaterThan(0) // mas não vira perda
  })
})
