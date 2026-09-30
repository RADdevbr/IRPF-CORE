import { describe, it, expect } from 'vitest'
import { aMercado } from './mercado.js'
import { analiseCapital } from './capital.js'
import { montarDeclaracao, upsertDeclaracao, type Historico } from '../historico/historico.js'
import type { DecResult, Lancamento, Posicao } from '../dec/decParser.js'
import type { ItemDaPosicao } from '../b3/posicao.js'

const pos = (descricao: string, saldoAnterior: number, saldoAtual: number): Posicao => ({
  linha: 1, cdBem: '00', codigo: '31', subcodigo: '', bruta: `27 ${descricao}`, descricao, saldoAnterior, saldoAtual, tipoCarteira: 'x',
})
const lanc = (alvo: string, valor: number): Lancamento => ({ linha: 1, tipo: '21', tipoLabel: 'x', fonte: '', cnpj: '', rotulo: 'Rendimento', valor, alvo })
const dec = (ano: string, l: Lancamento[], p: Posicao[]): DecResult => ({ ano, registros: [], lancamentos: l, posicoes: p, pagamentos: [], ndep: 0, linhas: [], totalLinhas: 0 })
const item = (ativo: string, valor: number): ItemDaPosicao => ({ produto: ativo, ativo, instituicao: 'XP', quantidade: null, preco: null, valor, aba: 'Acoes' })

function historico(): Historico {
  let h: Historico = {}
  h = upsertDeclaracao(h, montarDeclaracao(dec('2024', [lanc('salario', 100_000)], [pos('100 ACOES PETR4 XP', 0, 10_000)]), '2024.DEC', 'agora')!)
  h = upsertDeclaracao(h, montarDeclaracao(dec('2025', [lanc('salario', 100_000)], [pos('100 ACOES PETR4 XP', 10_000, 10_000)]), '2025.DEC', 'agora')!)
  return h
}

describe('a bolsa a mercado', () => {
  it('o ganho não realizado de cada 31/12, e a valorização só com os dois anos', () => {
    const m = aMercado(historico(), { 2023: [item('PETR4', 12_000)], 2024: [item('PETR4', 15_000), item('VALE3', 900)] })
    expect(m[2023]).toMatchObject({ ganho: 2_000, valorizacao: null })
    expect(m[2024]).toMatchObject({ ganho: 5_000, valorizacao: 3_000 })
    // o papel sem bem na declaração fica de fora, e contado
    expect(m[2024].semBem.map((i) => i.ativo)).toEqual(['VALE3'])
  })

  it('a valorização entra no retorno, e não no rendimento que a declaração mostra', () => {
    const h = historico()
    const m = aMercado(h, { 2023: [item('PETR4', 12_000)], 2024: [item('PETR4', 15_000)] })
    const sem = analiseCapital(h, { 2024: { despesas: 100_000 } }).anos.find((a) => a.anoBase === 2024)!
    const com = analiseCapital(h, { 2024: { despesas: 100_000 } }, {}, m).anos.find((a) => a.anoBase === 2024)!
    expect(com.rendimento).toBe(sem.rendimento)
    expect(com.valorizacao).toBe(3_000)
    expect(sem.valorizacao).toBe(null)
    // patrimônio a mercado: (10.000 + 2.000 + 10.000 + 5.000) / 2 = 13.500
    expect(com.retorno).toBeCloseTo((sem.rendimento + 3_000) / 13_500, 6)
  })
})
