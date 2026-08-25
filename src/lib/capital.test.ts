import { describe, it, expect } from 'vitest'
import { analiseCapital } from './capital'
import { composicaoRenda } from './renda'
import { taxaDoAno, taxaDoPeriodo, fatorAcumulado, anosSemTaxa, TABELA } from './benchmarks'
import { montarDeclaracao, upsertDeclaracao, type Historico } from './historico'
import type { DecResult, Lancamento, Posicao } from './decParser'

const lanc = (alvo: string, valor: number): Lancamento => ({
  linha: 1,
  tipo: '88',
  tipoLabel: 'x',
  fonte: '',
  cnpj: '',
  rotulo: 'Rendimento',
  valor,
  alvo,
})

const pos = (descricao: string, saldoAtual: number, saldoAnterior = 0): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo: '45',
  subcodigo: '01',
  bruta: `27CPF        450100${descricao}`,
  descricao,
  saldoAnterior,
  saldoAtual,
  tipoCarteira: 'cdb',
})

const dec = (exercicio: string, l: Lancamento[], p: Posicao[]): DecResult => ({
  ano: exercicio,
  registros: [],
  lancamentos: l,
  posicoes: p,
  pagamentos: [],
  ndep: 0,
  linhas: [],
  totalLinhas: 0,
})

const historico = (...anos: { exercicio: string; rendas: Lancamento[]; bens: Posicao[] }[]): Historico => {
  let h: Historico = {}
  for (const a of anos) h = upsertDeclaracao(h, montarDeclaracao(dec(a.exercicio, a.rendas, a.bens), `${a.exercicio}.DEC`, 'agora')!)
  return h
}

describe('de onde vem a renda', () => {
  it('separa trabalho de capital', () => {
    const c = composicaoRenda({ salario: 300_000, divBR: 100_000, cdb: 50_000, isentos: 50_000 })
    expect(c.trabalho).toBe(300_000)
    expect(c.capital).toBe(200_000)
    expect(c.total).toBe(500_000)
    expect(c.fracaoCapital).toBeCloseTo(0.4, 6)
  })

  it('dividendo da própria PJ é trabalho quando a pessoa diz que é', () => {
    const vals = { salario: 100_000, divBR: 400_000 }
    expect(composicaoRenda(vals).fracaoCapital).toBeCloseTo(0.8, 6)
    const comoTrabalho = composicaoRenda(vals, { dividendosSaoTrabalho: true })
    expect(comoTrabalho.trabalho).toBe(500_000)
    expect(comoTrabalho.fracaoCapital).toBe(0)
  })

  it('exterior e "outros" não são chutados para nenhum lado', () => {
    const c = composicaoRenda({ exterior: 50_000, outros: 10_000 })
    expect(c.indefinido).toBe(60_000)
    expect(c.trabalho).toBe(0)
    expect(c.capital).toBe(0)
  })

  it('imposto retido não é renda', () => {
    expect(composicaoRenda({ salario: 100_000, salario_ir: 27_500 }).total).toBe(100_000)
  })
})

describe('rendimento do capital', () => {
  /** 2024: patrimônio 1,0M → 1,3M; renda 400k (300k salário + 100k dividendos). */
  const base = () =>
    historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      {
        exercicio: '2025',
        rendas: [lanc('salario', 300_000), lanc('divBR', 100_000)],
        bens: [pos('CDB', 1_300_000, 1_000_000)],
      },
    )

  it('poupado é renda menos gasto, e o resto do crescimento é do capital', () => {
    const r = analiseCapital(base(), { 2024: { despesas: 200_000 } })
    const a = r.anos.find((x) => x.anoBase === 2024)!
    expect(a.crescimento).toBe(300_000)
    expect(a.renda).toBe(400_000)
    expect(a.poupado).toBe(200_000) // 400k − 200k
    expect(a.embutido).toBe(100_000) // 300k − 200k
    // o dividendo já reinvestido volta para a conta: é rendimento do capital
    expect(a.rendaDeCapital).toBe(100_000)
    expect(a.rendimento).toBe(200_000)
    // patrimônio médio: (1,0M + 1,3M) / 2 = 1,15M
    expect(a.retorno).toBeCloseTo(200_000 / 1_150_000, 6)
  })

  it('dividendo da PJ contado como trabalho sai do rendimento do capital', () => {
    const r = analiseCapital(base(), { 2024: { despesas: 200_000 } }, { dividendosSaoTrabalho: true })
    const a = r.anos.find((x) => x.anoBase === 2024)!
    expect(a.rendaDeCapital).toBe(0)
    expect(a.rendimento).toBe(100_000) // só o embutido
  })

  it('sem gasto informado o número é piso, e a linha diz isso', () => {
    const r = analiseCapital(base())
    const a = r.anos.find((x) => x.anoBase === 2024)!
    expect(a.semGasto).toBe(true)
    expect(a.poupado).toBe(400_000) // renda inteira: teto
    expect(a.embutido).toBe(-100_000) // logo o embutido é piso, e pode ser negativo
    expect(r.retornoMedio).toBe(null) // e não entra em média nenhuma
  })

  it('ano com buraco no meio não entra na média — mistura anos', () => {
    const h = historico(
      { exercicio: '2021', rendas: [lanc('salario', 100_000)], bens: [pos('CDB', 500_000)] },
      { exercicio: '2024', rendas: [lanc('salario', 100_000)], bens: [pos('CDB', 900_000, 800_000)] },
    )
    const r = analiseCapital(h, { 2020: { despesas: 50_000 }, 2023: { despesas: 50_000 } })
    expect(r.anos.find((a) => a.anoBase === 2023)!.anosCobertos).toBe(3)
    // sobra só 2020, que tem gasto informado e cobre um ano
    expect(r.retornoMedio).not.toBe(null)
  })

  it('histórico vazio devolve análise vazia', () => {
    const r = analiseCapital({})
    expect(r.anos).toEqual([])
    expect(r.retornoMedio).toBe(null)
  })
})

describe('benchmarks', () => {
  it('a tabela embutida cobre até 2024 e não inventa 2025', () => {
    expect(taxaDoAno('cdi', 2024)).toBeCloseTo(0.1088, 6)
    expect(taxaDoAno('cdi', 2025)).toBe(null)
    expect(anosSemTaxa('cdi', [2023, 2025])).toEqual([2025])
  })

  it('o que a pessoa informa manda sobre a tabela', () => {
    expect(taxaDoAno('cdi', 2024, { 'cdi:2024': 0.11 })).toBe(0.11)
    expect(taxaDoAno('ipca', 2025, { 'ipca:2025': 0.045 })).toBe(0.045)
  })

  it('com ano faltando na lista, compõe o intervalo inteiro', () => {
    // 2022 → 2024 são dois anos de rendimento, mesmo que 2023 não esteja na
    // lista: usar só a taxa de 2024 diria que o CDI rendeu metade do que rendeu
    const f = fatorAcumulado('cdi', [2022, 2024])
    expect(f).toHaveLength(2)
    expect(f[1].fator).toBeCloseTo(1.1304 * 1.1088, 6)
  })

  it('falta a taxa de um ano do meio: a linha para antes', () => {
    // 2025 não está na tabela; o salto 2024 → 2026 depende dela
    expect(fatorAcumulado('cdi', [2024, 2026]).map((x) => x.anoBase)).toEqual([2024])
    expect(anosSemTaxa('cdi', [2023, 2026])).toEqual([2025, 2026])
  })

  it('o acumulado começa em 1 e compõe ano a ano', () => {
    const f = fatorAcumulado('cdi', [2022, 2023, 2024])
    expect(f.map((x) => x.anoBase)).toEqual([2022, 2023, 2024])
    expect(f[0].fator).toBe(1)
    expect(f[1].fator).toBeCloseTo(1.1304, 6)
    expect(f[2].fator).toBeCloseTo(1.1304 * 1.1088, 6)
  })

  it('ano sem taxa interrompe a série em vez de fingir 0%', () => {
    const f = fatorAcumulado('cdi', [2023, 2024, 2025, 2026])
    expect(f.map((x) => x.anoBase)).toEqual([2023, 2024])
  })

  it('período de N anos compara com N anos do índice', () => {
    // 2022 + 2023 + 2024 compostos, não a taxa de 2024 sozinha
    const esperado = 1.1239 * 1.1304 * 1.1088 - 1
    expect(taxaDoPeriodo('cdi', 2024, 3)).toBeCloseTo(esperado, 6)
    expect(taxaDoPeriodo('cdi', 2024, 1)).toBeCloseTo(0.1088, 6)
    // falta 2025 na tabela: sem chute
    expect(taxaDoPeriodo('cdi', 2025, 1)).toBe(null)
  })

  it('CDI e Selic andam juntos — a diferença é decimal, não de rumo', () => {
    for (const ano of Object.keys(TABELA.cdi).map(Number)) {
      expect(Math.abs(TABELA.cdi[ano] - TABELA.selic[ano])).toBeLessThan(0.001)
    }
  })
})
