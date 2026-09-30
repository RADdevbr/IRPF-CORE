import { describe, it, expect } from 'vitest'
import { continuidadeEntreAnos } from './continuidade.js'
import { montarDeclaracao, upsertDeclaracao, idPosicao, type Historico } from './historico.js'
import type { DecResult, Posicao } from '../dec/decParser.js'

const pos = (descricao: string, saldoAnterior: number, saldoAtual: number): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo: '45',
  subcodigo: '',
  bruta: `27CPF        45 ${descricao}`,
  descricao,
  saldoAnterior,
  saldoAtual,
  tipoCarteira: 'cdb',
})
const dec = (ano: string, posicoes: Posicao[]): DecResult => ({ ano, registros: [], lancamentos: [], posicoes, pagamentos: [], ndep: 0, linhas: [], totalLinhas: 0 })
const historico = (...anos: [string, Posicao[]][]): Historico => {
  let h: Historico = {}
  for (const [ex, bens] of anos) h = upsertDeclaracao(h, montarDeclaracao(dec(ex, bens), `${ex}.DEC`, 'agora')!)
  return h
}
const tipos = (h: Historico, v = {}) => continuidadeEntreAnos(h, v).achados.map((a) => a.tipo)

describe('o que não fecha de uma declaração para a seguinte', () => {
  it('declaração que repete os saldos direitinho não tem o que conferir', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100)]], ['2025', [pos('CDB BANCO X', 100, 110)]])
    const c = continuidadeEntreAnos(h)
    expect(c.achados).toEqual([])
    expect(c.porAno).toEqual([{ anoBase: 2024, patrimonioAnterior: 100, somaDosSaldosAnteriores: 100, diferenca: 0 }])
  })

  it('o bem renomeado sem ligação: sumiu com saldo, e o novo entra com esse saldo como anterior — um achado só, com o par', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100)]], ['2025', [pos('CDB DO BANCO X S A', 100, 110)]])
    const [a, ...resto] = continuidadeEntreAnos(h).achados
    expect(resto.filter((x) => x.tipo !== 'descricaoMudou')).toEqual([])
    expect(a).toMatchObject({ tipo: 'sumiuComSaldo', anoBase: 2024, valor: 100, par: { descricao: 'CDB DO BANCO X S A', valor: 100 } })
    expect(a.oQueFazer).toMatch(/mesmo bem com outro nome/)
  })

  it('já ligado, não falta nada — sobra só a descrição a unificar', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100)]], ['2025', [pos('CDB DO BANCO X S A', 100, 110)]])
    const v = { [idPosicao('CDB BANCO X', 'cdb')]: idPosicao('CDB DO BANCO X S A', 'cdb') }
    const c = continuidadeEntreAnos(h, v)
    expect(c.achados.map((a) => a.tipo)).toEqual(['descricaoMudou'])
    expect(c.achados[0]).toMatchObject({ descricao: 'CDB DO BANCO X S A', par: { descricao: 'CDB BANCO X', anoBase: 2023 } })
  })

  it('o bem que sumiu com saldo, sem par: vendido deveria ficar com saldo zero', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100), pos('LCA BANCO Y', 0, 50)]], ['2025', [pos('CDB BANCO X', 100, 110)]])
    const [a] = continuidadeEntreAnos(h).achados
    expect(a).toMatchObject({ tipo: 'sumiuComSaldo', valor: 50 })
    expect(a.par).toBeUndefined()
    expect(a.oQueFazer).toMatch(/saldo atual zero/)
    expect(continuidadeEntreAnos(h).porAno[0].diferenca).toBe(-50)
  })

  it('o bem que entra dizendo que já valia algo, sem par', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100)]], ['2025', [pos('CDB BANCO X', 100, 110), pos('LCA BANCO Y', 70, 75)]])
    expect(tipos(h)).toEqual(['entrouComSaldoAnterior'])
  })

  it('o saldo anterior diferente do que a declaração passada disse', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100)]], ['2025', [pos('CDB BANCO X', 120, 130)]])
    const [a] = continuidadeEntreAnos(h).achados
    expect(a).toMatchObject({ tipo: 'saldoAnteriorDiferente', valor: 20, par: { valor: 100, anoBase: 2023 } })
  })

  it('centavo de diferença é arredondamento, e não achado', () => {
    const h = historico(['2024', [pos('CDB BANCO X', 0, 100.4)]], ['2025', [pos('CDB BANCO X', 100, 130)]])
    expect(tipos(h)).toEqual([])
  })

  it('zerado e reaberto no mesmo ano: a ação com o mesmo custo, com outro nome', () => {
    const h = historico(
      ['2024', [pos('ACOES ITUB4 XP', 0, 5_000)]],
      ['2025', [pos('ACOES ITUB4 XP', 5_000, 0), pos('ITAU UNIBANCO PN 100 ACOES BTG', 0, 5_000)]],
    )
    const [a] = continuidadeEntreAnos(h).achados
    expect(a).toMatchObject({ tipo: 'zeradoEReaberto', anoBase: 2024, valor: 5_000, par: { descricao: 'ITAU UNIBANCO PN 100 ACOES BTG' } })
  })

  it('na renda fixa, o título novo com o valor do velho é coincidência — sem descrição parecida, não é achado', () => {
    const h = historico(
      ['2024', [pos('CDB BANCO X 2024', 0, 5_000)]],
      ['2025', [pos('CDB BANCO X 2024', 5_000, 0), pos('LCA BANCO Y 2027', 0, 5_000)]],
    )
    expect(tipos(h)).toEqual([])
  })

  it('com um ano faltando no meio, não há o que comparar', () => {
    const h = historico(['2023', [pos('CDB BANCO X', 0, 100)]], ['2025', [pos('LCA BANCO Y', 70, 75)]])
    expect(continuidadeEntreAnos(h).porAno).toEqual([])
    expect(tipos(h)).toEqual([])
  })
})
