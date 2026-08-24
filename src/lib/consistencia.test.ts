import { describe, it, expect } from 'vitest'
import { analisarConsistencia, PISO_RELEVANCIA, type Entradas } from './consistencia'
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
  ndep: 0,
  linhas: [],
  totalLinhas: 0,
})

const historico = (...anos: { exercicio: string; rendas: Lancamento[]; bens: Posicao[] }[]): Historico => {
  let h: Historico = {}
  for (const a of anos) {
    h = upsertDeclaracao(h, montarDeclaracao(dec(a.exercicio, a.rendas, a.bens), `${a.exercicio}.DEC`, 'agora')!)
  }
  return h
}

describe('um ano de cada vez', () => {
  it('patrimônio que cresce dentro da renda é compatível', () => {
    // ano-base 2024: 1,0M → 1,2M (+200k) com 300k de renda declarada
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 300_000)], bens: [pos('CDB', 1_200_000, 1_000_000)] },
    )
    const r = analisarConsistencia(h)
    const a = r.anos.find((x) => x.anoBase === 2024)!
    expect(a.evolucao).toBe(200_000)
    expect(a.fontes).toBe(300_000)
    expect(a.saldo).toBe(100_000)
    expect(a.descoberto).toBe(0)
    expect(a.classificacao).toBe('compatível')
  })

  it('patrimônio que cresce mais do que a renda explica vira diferença a descoberto', () => {
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 100_000)], bens: [pos('CDB', 1_600_000, 1_000_000)] },
    )
    const a = analisarConsistencia(h).anos.find((x) => x.anoBase === 2024)!
    expect(a.evolucao).toBe(600_000)
    expect(a.descoberto).toBe(500_000)
    expect(a.proporcao).toBe(5) // 500k sobre 100k de fontes
    expect(a.classificacao).toBe('inconsistência relevante')
  })

  it('a venda de um bem informada fecha a conta — era só informação faltando', () => {
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 100_000)], bens: [pos('CDB', 1_600_000, 1_000_000)] },
    )
    const entradas: Entradas = { 2024: { receitasNaoRecorrentes: 500_000, nota: 'venda do apartamento' } }
    const a = analisarConsistencia(h, entradas).anos.find((x) => x.anoBase === 2024)!
    expect(a.descoberto).toBe(0)
    expect(a.classificacao).toBe('compatível')
  })

  it('o custo de vida informado aperta a conta, não afrouxa', () => {
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 300_000)], bens: [pos('CDB', 1_200_000, 1_000_000)] },
    )
    const a = analisarConsistencia(h, { 2024: { despesas: 250_000 } }).anos.find((x) => x.anoBase === 2024)!
    expect(a.necessidade).toBe(450_000) // 200k de evolução + 250k gastos
    expect(a.descoberto).toBe(150_000)
    expect(a.semDespesas).toBe(false)
  })

  it('dívida informada derruba o patrimônio líquido — bem financiado não é riqueza nova', () => {
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 100_000)], bens: [pos('IMOVEL', 1_600_000, 1_000_000)] },
    )
    const semDivida = analisarConsistencia(h).anos.find((x) => x.anoBase === 2024)!
    const comDivida = analisarConsistencia(h, { 2024: { dividas: 500_000 } }).anos.find((x) => x.anoBase === 2024)!
    expect(semDivida.descoberto).toBe(500_000)
    expect(comDivida.liquidoFinal).toBe(1_100_000)
    expect(comDivida.descoberto).toBe(0)
  })

  it('diferença pequena não vira "relevante" nem com percentual alto', () => {
    // 20k de diferença sobre 10k de renda: proporção enorme, valor irrelevante
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 100_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 10_000)], bens: [pos('CDB', 130_000, 100_000)] },
    )
    const a = analisarConsistencia(h).anos.find((x) => x.anoBase === 2024)!
    expect(a.descoberto).toBe(20_000)
    expect(a.descoberto).toBeLessThan(PISO_RELEVANCIA)
    expect(a.classificacao).toBe('atenção')
  })

  it('o primeiro ano usa o saldo anterior que o próprio arquivo declara', () => {
    const h = historico({ exercicio: '2025', rendas: [lanc('cdb', 90_000)], bens: [pos('CDB', 500_000, 420_000)] })
    const a = analisarConsistencia(h).anos[0]
    expect(a.semAnoAnterior).toBe(true)
    expect(a.patrimonioInicial).toBe(420_000)
    expect(a.evolucao).toBe(80_000)
  })
})

describe('leitura dos anos juntos', () => {
  const seis = () =>
    historico(
      { exercicio: '2021', rendas: [lanc('cdb', 200_000)], bens: [pos('CDB', 1_000_000, 900_000)] },
      { exercicio: '2022', rendas: [lanc('cdb', 200_000)], bens: [pos('CDB', 1_150_000, 1_000_000)] },
      { exercicio: '2023', rendas: [lanc('cdb', 200_000)], bens: [pos('CDB', 1_300_000, 1_150_000)] },
      { exercicio: '2024', rendas: [lanc('cdb', 200_000)], bens: [pos('CDB', 1_900_000, 1_300_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 200_000)], bens: [pos('CDB', 2_050_000, 1_900_000)] },
    )

  it('acha o ano que destoa e o coloca em primeiro na lista de revisão', () => {
    const r = analisarConsistencia(seis())
    expect(r.prioritarios).toHaveLength(1)
    expect(r.prioritarios[0].anoBase).toBe(2023) // exercício 2024, +600k com 200k de renda
    expect(r.prioritarios[0].descoberto).toBe(400_000)
  })

  it('um ano ruim isolado não é o mesmo que vários seguidos', () => {
    expect(analisarConsistencia(seis()).sequenciaRecorrente).toBe(false)
  })

  it('dois anos seguidos com diferença mudam a leitura', () => {
    const h = historico(
      { exercicio: '2024', rendas: [lanc('cdb', 50_000)], bens: [pos('CDB', 1_000_000, 900_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 50_000)], bens: [pos('CDB', 1_400_000, 1_000_000)] },
      { exercicio: '2026', rendas: [lanc('cdb', 50_000)], bens: [pos('CDB', 1_800_000, 1_400_000)] },
    )
    expect(analisarConsistencia(h).sequenciaRecorrente).toBe(true)
  })

  it('sobra de um ano cobre o buraco do seguinte — dinheiro guardado não evapora', () => {
    const h = historico(
      { exercicio: '2024', rendas: [lanc('cdb', 900_000)], bens: [pos('CDB', 1_000_000, 900_000)] },
      { exercicio: '2025', rendas: [lanc('cdb', 100_000)], bens: [pos('CDB', 1_500_000, 1_000_000)] },
    )
    const r = analisarConsistencia(h)
    expect(r.totalDescoberto).toBeGreaterThan(0)
    expect(r.folgaAcumuladaCobre).toBe(true)
  })

  it('vê o buraco na série: o saldo anterior declarado não bate com o ano importado', () => {
    const h = historico(
      { exercicio: '2024', rendas: [], bens: [pos('CDB', 1_000_000)] },
      // diz que começou com 1,4M, mas o ano anterior fechou com 1,0M
      { exercicio: '2025', rendas: [], bens: [pos('CDB', 1_500_000, 1_400_000)] },
    )
    const r = analisarConsistencia(h)
    expect(r.descontinuidades).toHaveLength(1)
    expect(r.descontinuidades[0]).toMatchObject({ de: 2023, para: 2024, diferenca: 400_000 })
    expect(r.faltando.join(' ')).toMatch(/anos que faltam/)
  })

  it('anos não consecutivos não viram descontinuidade — falta ano, não bate mesmo', () => {
    const h = historico(
      { exercicio: '2021', rendas: [], bens: [pos('CDB', 500_000)] },
      { exercicio: '2026', rendas: [], bens: [pos('CDB', 2_000_000, 1_800_000)] },
    )
    expect(analisarConsistencia(h).descontinuidades).toEqual([])
  })

  it('diz o que falta informar, e o custo de vida vem sempre na lista', () => {
    const r = analisarConsistencia(seis())
    expect(r.faltando.join(' ')).toMatch(/custo de vida/)
    expect(r.faltando.join(' ')).toMatch(/dívidas e ônus/)
  })

  it('sem histórico não há o que analisar', () => {
    const r = analisarConsistencia({})
    expect(r.anos).toEqual([])
    expect(r.totalDescoberto).toBe(0)
    expect(r.prioritarios).toEqual([])
  })
})
