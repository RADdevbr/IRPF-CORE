import { describe, it, expect } from 'vitest'
import { analiseCapital, retornoVsIndices, acumularRetorno, retornoPorClasse, retornoReal } from './capital'
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

const pos = (descricao: string, saldoAtual: number, saldoAnterior = 0, codigo = '45'): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo,
  subcodigo: '01',
  bruta: `27CPF        ${codigo}0100${descricao}`,
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

describe('retorno contra os índices', () => {
  /** 2023 e 2024 com gasto informado; patrimônio 1,0M → 1,3M → 1,6M. */
  const doisAnos = () =>
    historico(
      { exercicio: '2023', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2024', rendas: [lanc('salario', 400_000)], bens: [pos('CDB', 1_300_000, 1_000_000)] },
      { exercicio: '2025', rendas: [lanc('salario', 400_000)], bens: [pos('CDB', 1_600_000, 1_300_000)] },
    )
  const gastos = { 2023: { despesas: 200_000 }, 2024: { despesas: 200_000 } }

  it('põe o índice do MESMO ano ao lado do retorno medido', () => {
    const r = retornoVsIndices(doisAnos(), gastos)
    const p2024 = r.pontos.find((x) => x.anoBase === 2024)!
    expect(p2024.cdi).toBeCloseTo(0.1088, 6)
    expect(p2024.ipca).toBeCloseTo(0.0483, 6)
    expect(p2024.retorno).not.toBeNull()
    expect(p2024.piso).toBe(false)
  })

  it('CDI e Selic dividem o rótulo quando as duas existem', () => {
    expect(retornoVsIndices(doisAnos(), gastos).rotuloCdi).toBe('CDI / Selic')
  })

  it('a média do índice usa os MESMOS anos da média do retorno', () => {
    // só 2024 tem gasto informado: a média do CDI tem de ser a de 2024 sozinha
    const r = retornoVsIndices(doisAnos(), { 2024: { despesas: 200_000 } })
    expect(r.anosNaMedia).toBe(1)
    expect(r.cdiMedio).toBeCloseTo(0.1088, 6)
    expect(r.ipcaMedio).toBeCloseTo(0.0483, 6)
  })

  it('ano sem gasto informado sai marcado como piso e fica fora da média', () => {
    const r = retornoVsIndices(doisAnos(), { 2024: { despesas: 200_000 } })
    expect(r.pontos.find((p) => p.anoBase === 2023)!.piso).toBe(true)
    expect(r.pontos.find((p) => p.anoBase === 2024)!.piso).toBe(false)
    expect(r.anosNaMedia).toBe(1)
  })

  it('ponto que cobre vários anos compara com o índice do mesmo período', () => {
    const comBuraco = historico(
      { exercicio: '2023', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2026', rendas: [lanc('salario', 400_000)], bens: [pos('CDB', 1_600_000, 1_000_000)] },
    )
    const p = retornoVsIndices(comBuraco, { 2025: { despesas: 200_000 } }).pontos.find((x) => x.anoBase === 2025)!
    expect(p.anosCobertos).toBe(3)
    // 2023 + 2024 + 2025 compostos, não a taxa de 2025 sozinha
    expect(p.cdi).toBeCloseTo(1.1304 * 1.1088 * 1.1432 - 1, 6)
  })

  it('sem histórico não inventa nada', () => {
    const r = retornoVsIndices({})
    expect(r.pontos).toEqual([])
    expect(r.retornoMedio).toBeNull()
    expect(r.cdiMedio).toBeNull()
    expect(r.anosNaMedia).toBe(0)
  })
})

describe('retorno acumulado', () => {
  const ponto = (anoBase: number, retorno: number | null, cdi: number | null, ipca: number | null, piso = false) =>
    ({ anoBase, retorno, cdi, ipca, piso, anosCobertos: 1 })

  it('compõe em vez de somar — 10% e 10% dão 21%', () => {
    const a = acumularRetorno([ponto(2023, 0.1, 0.1, 0.05), ponto(2024, 0.1, 0.1, 0.05)])
    expect(a[0].retorno).toBeCloseTo(0.1, 6)
    expect(a[1].retorno).toBeCloseTo(0.21, 6)
    expect(a[1].cdi).toBeCloseTo(0.21, 6)
    expect(a[1].ipca).toBeCloseTo(1.05 * 1.05 - 1, 6)
  })

  it('um ano ruim no meio derruba tudo o que vem depois', () => {
    const a = acumularRetorno([ponto(2023, 0.2, 0.1, 0), ponto(2024, -0.3, 0.1, 0), ponto(2025, 0.2, 0.1, 0)])
    // 1,2 × 0,7 × 1,2 = 1,008 → +0,8% em três anos, contra 33,1% do CDI
    expect(a[2].retorno).toBeCloseTo(0.008, 6)
    expect(a[2].cdi).toBeCloseTo(1.1 ** 3 - 1, 6)
  })

  it('ano sem retorno interrompe a série em vez de fingir 0%', () => {
    const a = acumularRetorno([ponto(2023, 0.1, 0.1, 0), ponto(2024, null, 0.1, 0), ponto(2025, 0.1, 0.1, 0)])
    expect(a[0].retorno).toBeCloseTo(0.1, 6)
    expect(a[1].retorno).toBeNull()
    expect(a[2].retorno).toBeNull()
    // o índice não depende do retorno: a linha dele continua
    expect(a[2].cdi).toBeCloseTo(1.1 ** 3 - 1, 6)
  })

  it('piso contamina para frente: acumulado de piso é piso', () => {
    const a = acumularRetorno([ponto(2023, 0.1, 0.1, 0), ponto(2024, 0.1, 0.1, 0, true), ponto(2025, 0.1, 0.1, 0)])
    expect(a[0].piso).toBe(false)
    expect(a[1].piso).toBe(true)
    expect(a[2].piso).toBe(true)
  })

  it('ponto que cobre vários anos entra inteiro, sem anualizar', () => {
    // o retorno de 3 anos já É o total do período; o índice ao lado também
    const a = acumularRetorno([{ anoBase: 2025, retorno: 0.331, cdi: 0.331, ipca: 0, piso: false, anosCobertos: 3 }])
    expect(a[0].retorno).toBeCloseTo(0.331, 6)
  })

  it('sem pontos, nada', () => {
    expect(acumularRetorno([])).toEqual([])
  })
})

describe('benchmarks', () => {
  it('a tabela embutida cobre até 2025 e não inventa 2026', () => {
    expect(taxaDoAno('cdi', 2025)).toBeCloseTo(0.1432, 6)
    expect(taxaDoAno('selic', 2025)).toBeCloseTo(0.1433, 6)
    expect(taxaDoAno('ipca', 2025)).toBeCloseTo(0.0426, 6)
    expect(taxaDoAno('cdi', 2026)).toBe(null)
    expect(anosSemTaxa('cdi', [2024, 2026])).toEqual([2026])
  })

  it('o que a pessoa informa manda sobre a tabela', () => {
    expect(taxaDoAno('cdi', 2024, { 'cdi:2024': 0.11 })).toBe(0.11)
    expect(taxaDoAno('ipca', 2025, { 'ipca:2025': 0.045 })).toBe(0.045)
  })

  it('o acumulado começa em 1 e compõe ano a ano', () => {
    const f = fatorAcumulado('cdi', [2022, 2023, 2024])
    expect(f.map((x) => x.anoBase)).toEqual([2022, 2023, 2024])
    expect(f[0].fator).toBe(1)
    expect(f[1].fator).toBeCloseTo(1.1304, 6)
    expect(f[2].fator).toBeCloseTo(1.1304 * 1.1088, 6)
  })

  it('com ano faltando na lista, compõe o intervalo inteiro', () => {
    // 2022 → 2024 são dois anos de rendimento, mesmo que 2023 não esteja na
    // lista: usar só a taxa de 2024 diria que o CDI rendeu metade do que rendeu
    const f = fatorAcumulado('cdi', [2022, 2024])
    expect(f).toHaveLength(2)
    expect(f[1].fator).toBeCloseTo(1.1304 * 1.1088, 6)
  })

  it('ano sem taxa interrompe o acumulado em vez de fingir 0%', () => {
    const f = fatorAcumulado('cdi', [2024, 2025, 2026, 2027])
    expect(f.map((x) => x.anoBase)).toEqual([2024, 2025])
  })

  it('aponta os anos do intervalo que a tabela não cobre', () => {
    // 2026 e 2027 ainda não fecharam; a tela pede os dois
    expect(anosSemTaxa('cdi', [2024, 2027])).toEqual([2026, 2027])
  })

  it('período de N anos compara com N anos do índice', () => {
    // 2022 + 2023 + 2024 compostos, não a taxa de 2024 sozinha
    const esperado = 1.1239 * 1.1304 * 1.1088 - 1
    expect(taxaDoPeriodo('cdi', 2024, 3)).toBeCloseTo(esperado, 6)
    expect(taxaDoPeriodo('cdi', 2024, 1)).toBeCloseTo(0.1088, 6)
    // falta 2026 na tabela: sem chute
    expect(taxaDoPeriodo('cdi', 2026, 1)).toBe(null)
  })

  it('CDI e Selic andam juntos — a diferença é decimal, não de rumo', () => {
    for (const ano of Object.keys(TABELA.cdi).map(Number)) {
      expect(Math.abs(TABELA.cdi[ano] - TABELA.selic[ano])).toBeLessThan(0.001)
    }
  })
})

describe('retorno por classe', () => {
  it('mede a classe pelo saldo que o próprio arquivo declara, sem depender de vínculo', () => {
    // CDB 100k → 120k sem aporte: 20k de rendimento sobre média de 110k
    const h = historico({
      exercicio: '2025',
      rendas: [],
      bens: [pos('CDB BANCO X', 120_000, 100_000)],
    })
    const [cdb] = retornoPorClasse(h)
    expect(cdb.nome).toBe('CDB / RDB')
    expect(cdb.anos[0].rendimento).toBe(20_000)
    // base = o que havia no começo do ano
    expect(cdb.anos[0].retorno).toBeCloseTo(20_000 / 100_000, 6)
    expect(cdb.retornoMedio).toBeCloseTo(0.2, 6)
  })

  it('aporte informado sai do rendimento — dinheiro que você pôs não é rendimento', () => {
    const h = historico({ exercicio: '2025', rendas: [], bens: [pos('CDB BANCO X', 200_000, 100_000)] })
    const id = h['2024'].posicoes[0].id
    const [cdb] = retornoPorClasse(h, { [`${id}@2024`]: 80_000 })
    expect(cdb.anos[0].aporte).toBe(80_000)
    expect(cdb.anos[0].rendimento).toBe(20_000)
    // base = 100.000 + 80.000/2
    expect(cdb.anos[0].retorno).toBeCloseTo(20_000 / 140_000, 6)
  })

  it('bem que entrou ou saiu no ano fica de fora — e a linha diz quanto ficou', () => {
    const h = historico({
      exercicio: '2025',
      rendas: [],
      // um que ficou o ano inteiro, um comprado no ano e um vendido
      bens: [pos('CDB VELHO', 110_000, 100_000), pos('CDB NOVO', 50_000, 0), pos('CDB VENDIDO', 0, 30_000)],
    })
    const [cdb] = retornoPorClasse(h)
    // mede só o que ficou parado: 10k sobre 100k
    expect(cdb.anos[0].rendimento).toBe(10_000)
    expect(cdb.anos[0].retorno).toBeCloseTo(0.1, 6)
    expect(cdb.anos[0].parcial).toBe(true)
    expect(cdb.anos[0].foraDaConta).toBe(80_000)
    // e o ano continua medindo: antes ele era descartado inteiro
    expect(cdb.retornoMedio).toBeCloseTo(0.1, 6)
  })

  it('com aporte informado, o bem novo entra na conta e a entrada vale meio ano', () => {
    const h = historico({ exercicio: '2025', rendas: [], bens: [pos('CDB NOVO', 50_000, 0)] })
    const id = h['2024'].posicoes[0].id
    const [cdb] = retornoPorClasse(h, { [`${id}@2024`]: 48_000 })
    expect(cdb.anos[0].parcial).toBe(false)
    expect(cdb.anos[0].rendimento).toBe(2_000)
    // base = 0 + 48.000/2
    expect(cdb.anos[0].retorno).toBeCloseTo(2_000 / 24_000, 6)
  })

  it('classe inteira que entrou no ano não tem o que medir', () => {
    const h = historico({ exercicio: '2025', rendas: [], bens: [pos('CDB NOVO', 50_000, 0)] })
    const [cdb] = retornoPorClasse(h)
    expect(cdb.anos[0].retorno).toBe(null)
    expect(cdb.retornoMedio).toBe(null)
    expect(cdb.anos[0].foraDaConta).toBe(50_000)
  })

  it('classes vêm da maior para a menor, pelo saldo do fim', () => {
    const h = historico({
      exercicio: '2025',
      rendas: [],
      bens: [pos('CDB', 100_000, 90_000), pos('APARTAMENTO', 800_000, 800_000, '11')],
    })
    expect(retornoPorClasse(h).map((c) => c.classe)).toEqual(['imovel', 'cdb'])
  })
})

describe('retorno real', () => {
  it('desconta a inflação de verdade, não por subtração', () => {
    // 13% nominal com 5% de inflação não são 8% de poder de compra
    expect(retornoReal(0.13, 0.05)).toBeCloseTo(1.13 / 1.05 - 1, 9)
    expect(retornoReal(0.13, 0.05)).toBeLessThan(0.08)
  })

  it('render menos que a inflação é perder poder de compra', () => {
    expect(retornoReal(0.03, 0.06)).toBeLessThan(0)
  })
})
