import { describe, it, expect } from 'vitest'
import { analiseCapital, yieldDistribuido } from './capital.js'
import {
  CHAVES_DA_BASE,
  INFLACAO_LONGO_PRAZO,
  fatiasDaBase,
  projetarBase,
  regraDaFatia,
} from './baseFutura.js'
import { idPagador, montarDeclaracao, upsertDeclaracao, type Historico } from '../historico/historico.js'
import type { DecResult, Lancamento, Posicao } from '../dec/decParser.js'

const lanc = (alvo: string, valor: number, fonte = '', cnpj = ''): Lancamento => ({
  linha: 1,
  tipo: '88',
  tipoLabel: 'x',
  fonte,
  cnpj,
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
  for (const a of anos)
    h = upsertDeclaracao(h, montarDeclaracao(dec(a.exercicio, a.rendas, a.bens), `${a.exercicio}.DEC`, 'agora')!)
  return h
}

describe('a regra de cada ficha', () => {
  it('pró-labore é trabalho, e nenhum pagador muda isso', () => {
    expect(regraDaFatia('salario', 'trabalho')).toBe('trabalho')
    expect(regraDaFatia('salario', 'capital')).toBe('trabalho')
  })

  it('aluguel segue a inflação, e não a carteira', () => {
    // o imóvel entra na declaração pelo CUSTO e nunca é remarcado: projetá-lo
    // pelo patrimônio faria o aluguel subir porque você comprou ação
    expect(regraDaFatia('aluguel', 'capital')).toBe('inflacao')
  })

  it('ganho em bolsa não é série', () => {
    expect(regraDaFatia('bolsa', 'capital')).toBe('evento')
  })

  it('a mesma ficha muda de regra conforme a resposta sobre o pagador', () => {
    expect(regraDaFatia('divBR', 'trabalho')).toBe('trabalho')
    expect(regraDaFatia('divBR', 'capital')).toBe('carteira')
  })

  it('a base é a lista da lei — sem FII e sem isentos, com bolsa', () => {
    expect(CHAVES_DA_BASE).toContain('bolsa')
    expect(CHAVES_DA_BASE).not.toContain('divFII')
    expect(CHAVES_DA_BASE).not.toContain('isentos')
  })
})

describe('de que fatias a base é feita', () => {
  const h = historico(
    {
      exercicio: '2025',
      rendas: [lanc('salario', 300_000), lanc('divBR', 100_000)],
      bens: [pos('CARTEIRA', 1_000_000, 900_000)],
    },
    {
      exercicio: '2026',
      rendas: [lanc('salario', 400_000), lanc('divBR', 120_000), lanc('divFII', 40_000)],
      bens: [pos('CARTEIRA', 1_200_000, 1_000_000)],
    },
  )

  it('parte do último ano declarado', () => {
    const f = fatiasDaBase(h)
    expect(f.anoBase).toBe(2025)
    expect(f.base).toBe(520_000)
  })

  it('FII fica de fora da base mesmo sendo renda de capital', () => {
    // a base é a lista da lei, não a soma das origens
    expect(fatiasDaBase(h).fatias.map((x) => x.chave)).not.toContain('divFII')
  })

  it('a taxa da fatia de carteira usa o mesmo denominador do yield inteiro', () => {
    const f = fatiasDaBase(h)
    const div = f.fatias.find((x) => x.chave === 'divBR')!
    // 2024: 100k / ((900k+1M)/2)  ·  2025: 120k / ((1M+1,2M)/2)
    const esperado = (100_000 / 950_000 + 120_000 / 1_100_000) / 2
    expect(div.taxa).toBeCloseTo(esperado, 9)
  })

  it('a soma das fatias de carteira cabe dentro do yield medido', () => {
    // o yield inteiro inclui o FII, que não é da base — a decomposição não pode
    // estourá-lo, senão a renda de capital do painel e a da base discordariam
    const f = fatiasDaBase(h)
    const soma = f.fatias.reduce((s, x) => s + (x.taxa ?? 0), 0)
    const y = yieldDistribuido(analiseCapital(h))
    expect(soma).toBeLessThanOrEqual((y.taxa as number) + 1e-9)
  })
})

describe('a resposta sobre o pagador muda a regra, não só o rótulo', () => {
  const minhaPJ = idPagador('CLINICA X LTDA', '11222333000181')
  const corretora = idPagador('ITAUSA S.A.', '61532644000115')

  const h = historico({
    exercicio: '2026',
    rendas: [
      lanc('salario', 200_000, 'CLINICA X LTDA', '11222333000181'),
      lanc('divBR', 300_000, 'CLINICA X LTDA', '11222333000181'),
      lanc('divBR', 100_000, 'ITAUSA S.A.', '61532644000115'),
    ],
    bens: [pos('CARTEIRA', 2_000_000, 1_800_000)],
  })

  it('o lucro da própria PJ cresce como carreira; o provento do papel, como carteira', () => {
    const f = fatiasDaBase(h, {}, { origens: { [minhaPJ]: 'trabalho', [corretora]: 'capital' } })
    const comoTrabalho = f.fatias.filter((x) => x.regra === 'trabalho')
    // pró-labore + o lucro da clínica
    expect(comoTrabalho.reduce((s, x) => s + x.valor, 0)).toBe(500_000)
    expect(f.fatias.find((x) => x.regra === 'carteira')!.valor).toBe(100_000)
  })

  it('sem resposta, a ficha inteira vira faixa', () => {
    const f = fatiasDaBase(h)
    expect(f.temFaixa).toBe(true)
    expect(f.fatias.filter((x) => x.indefinida).reduce((s, x) => s + x.valor, 0)).toBe(400_000)
  })
})

describe('a projeção ano a ano', () => {
  const h = historico({
    exercicio: '2026',
    rendas: [lanc('salario', 400_000), lanc('divBR', 80_000), lanc('aluguel', 60_000)],
    bens: [pos('CARTEIRA', 2_000_000, 2_000_000)],
  })
  const f = fatiasDaBase(h, {}, { dividendosSaoTrabalho: false })

  it('cada fatia anda pela sua regra, e não pela média delas', () => {
    const p = projetarBase(f, {
      patrimonio: [2_000_000, 2_200_000],
      taxaTrabalho: 0.1,
      inflacao: 0.05,
    })
    const ano1 = p[0]
    const pega = (c: string) => ano1.fatias.find((x) => x.chave === c)!.valor

    expect(pega('salario')).toBeCloseTo(440_000, 6) // carreira
    expect(pega('aluguel')).toBeCloseTo(63_000, 6) // inflação
    expect(pega('divBR')).toBeCloseTo(2_000_000 * (80_000 / 2_000_000), 6) // carteira

    // e o segundo ano compõe cada uma sobre a sua própria base
    const ano2 = p[1]
    expect(ano2.fatias.find((x) => x.chave === 'salario')!.valor).toBeCloseTo(484_000, 6)
    expect(ano2.fatias.find((x) => x.chave === 'aluguel')!.valor).toBeCloseTo(66_150, 6)
    expect(ano2.fatias.find((x) => x.chave === 'divBR')!.valor).toBeCloseTo(2_200_000 * 0.04, 6)
  })

  it('o dividendo acompanha a carteira: patrimônio parado, dividendo parado', () => {
    // é a diferença que a fase 6 existe para fazer — na taxa da mistura, o
    // dividendo subiria junto com o pró-labore
    const p = projetarBase(f, { patrimonio: [2_000_000, 2_000_000], taxaTrabalho: 0.2 })
    const div = p.map((x) => x.fatias.find((y) => y.chave === 'divBR')!.valor)
    expect(div[0]).toBeCloseTo(div[1], 6)
  })

  it('o aluguel não sobe porque a carteira subiu', () => {
    const parada = projetarBase(f, { patrimonio: [2_000_000], taxaTrabalho: 0 })
    const dobrando = projetarBase(f, { patrimonio: [4_000_000], taxaTrabalho: 0 })
    const aluguel = (p: ReturnType<typeof projetarBase>) =>
      p[0].fatias.find((x) => x.chave === 'aluguel')!.valor
    expect(aluguel(parada)).toBeCloseTo(aluguel(dobrando), 6)
  })

  it('sem taxa de trabalho medida, o trabalho fica parado em vez de inventar carreira', () => {
    const p = projetarBase(f, { patrimonio: [2_000_000, 2_000_000], taxaTrabalho: null })
    expect(p[1].fatias.find((x) => x.chave === 'salario')!.valor).toBeCloseTo(400_000, 6)
  })

  it('a inflação tem padrão, e é a mesma do custo de vida', () => {
    const p = projetarBase(f, { patrimonio: [2_000_000], taxaTrabalho: 0 })
    expect(p[0].fatias.find((x) => x.chave === 'aluguel')!.valor).toBeCloseTo(
      60_000 * (1 + INFLACAO_LONGO_PRAZO),
      6,
    )
  })

  it('o ano projetado sai marcado e numerado a partir do último declarado', () => {
    const p = projetarBase(f, { patrimonio: [2_000_000, 2_000_000], taxaTrabalho: 0 })
    expect(p.map((x) => x.anoBase)).toEqual([2026, 2027])
    expect(p.every((x) => x.projetado)).toBe(true)
  })
})

describe('ganho em bolsa: evento, não série', () => {
  const h = historico({
    exercicio: '2026',
    rendas: [lanc('salario', 200_000), lanc('bolsa', 500_000)],
    bens: [pos('CARTEIRA', 1_000_000, 1_000_000)],
  })

  it('entra na base do último ano e repete sem crescer', () => {
    const f = fatiasDaBase(h)
    expect(f.temEvento).toBe(true)
    expect(f.base).toBe(700_000)

    const p = projetarBase(f, { patrimonio: [1_000_000, 1_100_000], taxaTrabalho: 0.1 })
    const bolsa = p.map((x) => x.fatias.find((y) => y.chave === 'bolsa')!.valor)
    expect(bolsa).toEqual([500_000, 500_000])
  })
})

describe('a faixa do que ninguém classificou', () => {
  // com fonte pagadora: é o pagador sem resposta que vira faixa. Ficha SEM
  // pagador nenhum (Registro 22) segue o padrão dela e não abre faixa — a
  // pessoa não tem como responder sobre alguém que o arquivo não nomeia.
  const pagador = idPagador('EMPRESA Y LTDA', '99888777000166')
  const h = historico({
    exercicio: '2026',
    rendas: [lanc('salario', 100_000), lanc('divBR', 200_000, 'EMPRESA Y LTDA', '99888777000166')],
    bens: [pos('CARTEIRA', 2_000_000, 2_000_000)],
  })
  const f = fatiasDaBase(h)

  it('a mesma fatia projeta diferente nas duas suposições', () => {
    const comoTrabalho = projetarBase(f, {
      patrimonio: [2_000_000],
      taxaTrabalho: 0.3,
      indefinidoComo: 'trabalho',
    })
    const comoCarteira = projetarBase(f, {
      patrimonio: [2_000_000],
      taxaTrabalho: 0.3,
      indefinidoComo: 'carteira',
    })
    expect(comoTrabalho[0].base).toBeCloseTo(130_000 + 260_000, 6)
    expect(comoCarteira[0].base).toBeCloseTo(130_000 + 200_000, 6)
  })

  it('respondida, a fatia sai da faixa', () => {
    const respondida = fatiasDaBase(h, {}, { origens: { [pagador]: 'capital' } })
    expect(respondida.temFaixa).toBe(false)
  })

  it('ficha sem fonte pagadora no arquivo não abre faixa', () => {
    // Registro 22 (exterior, carnê-leão) não traz pagador: não há sobre quem
    // perguntar, e inventar a pergunta daria à pessoa uma linha que ela não
    // tem como reconhecer
    const semFonte = historico({
      exercicio: '2026',
      rendas: [lanc('divBR', 200_000)],
      bens: [pos('CARTEIRA', 2_000_000, 2_000_000)],
    })
    expect(fatiasDaBase(semFonte).temFaixa).toBe(false)
  })
})

describe('histórico curto ou vazio não inventa base', () => {
  it('sem declaração nenhuma, não há fatia nem ano', () => {
    const f = fatiasDaBase({})
    expect(f.fatias).toEqual([])
    expect(projetarBase(f, { patrimonio: [1_000_000], taxaTrabalho: 0.1 })[0].base).toBe(0)
  })

  it('sem patrimônio medido, a fatia de carteira não vira zero por acidente', () => {
    // ela fica sem taxa, e quem projeta precisa saber a diferença
    const semBens = historico({ exercicio: '2026', rendas: [lanc('divBR', 50_000)], bens: [] })
    expect(fatiasDaBase(semBens).fatias[0].taxa).toBeNull()
  })
})
