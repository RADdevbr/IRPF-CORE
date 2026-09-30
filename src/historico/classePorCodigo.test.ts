import { describe, it, expect } from 'vitest'
import { regraDoCodigo, sugerirClassesPorCodigo, rotuloDaSugestao } from './classePorCodigo.js'
import { aplicarOverrides, montarDeclaracao, upsertDeclaracao, type Historico } from './historico.js'
import type { DecResult, Posicao } from '../dec/decParser.js'

const pos = (descricao: string, saldoAtual: number, codigo: string, subcodigo: string): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo,
  subcodigo,
  bruta: `27 ${descricao}`,
  descricao,
  saldoAnterior: 0,
  saldoAtual,
  tipoCarteira: 'x',
})
const dec = (ano: string, posicoes: Posicao[]): DecResult => ({ ano, registros: [], lancamentos: [], posicoes, pagamentos: [], ndep: 0, linhas: [], totalLinhas: 0 })
const historico = (...anos: [string, Posicao[]][]): Historico => {
  let h: Historico = {}
  for (const [ex, bens] of anos) h = upsertDeclaracao(h, montarDeclaracao(dec(ex, bens), `${ex}.DEC`, 'agora')!)
  return h
}

describe('a classe que o código da Receita sugere', () => {
  it('conhece os pares inequívocos do leiaute com grupo, e o imóvel pelo grupo', () => {
    expect(regraDoCodigo({ codigo: '03', subcodigo: '01' })?.classe).toBe('acoes')
    expect(regraDoCodigo({ codigo: '03', subcodigo: '02' })?.classe).toBe('participacao')
    expect(regraDoCodigo({ codigo: '04', subcodigo: '03' })?.classe).toBe('lci')
    expect(regraDoCodigo({ codigo: '07', subcodigo: '03' })?.classe).toBe('fii')
    expect(regraDoCodigo({ codigo: '01', subcodigo: '12' })?.classe).toBe('imovel')
    expect(regraDoCodigo({ codigo: '32', subcodigo: '' })?.classe).toBe('participacao')
    // o que a tabela não afirma fica sem sugestão
    expect(regraDoCodigo({ codigo: '07', subcodigo: '09' })).toBeNull()
    expect(regraDoCodigo({ codigo: '99', subcodigo: '07' })).toBeNull()
  })

  it('sugere para o não classificado, agrupado por código, com o saldo do ano mais recente', () => {
    const h = historico(
      ['2024', [pos('XPTO ALFA', 100, '03', '01'), pos('ZETA BETA', 50, '03', '01')]],
      ['2025', [pos('XPTO ALFA', 120, '03', '01'), pos('ZETA BETA', 60, '03', '01'), pos('OUTRO', 10, '99', '07')]],
    )
    const [s, ...resto] = sugerirClassesPorCodigo(h)
    expect(resto).toEqual([])
    expect(s).toMatchObject({ chave: '03·01', classe: 'acoes', de: 'desconhecido', saldo: 180 })
    expect(s.ids).toHaveLength(2)
    expect(rotuloDaSugestao(s)).toBe('Não classificado → Ações')
  })

  it('a quota de empresa que virou fundo pela palavra COTAS volta a participação', () => {
    const h = historico(['2025', [pos('COTAS DE CAPITAL DA CLINICA X LTDA', 10_000, '03', '02'), pos('FUNDO DI COTAS', 5_000, '07', '01')]])
    const s = sugerirClassesPorCodigo(h)
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ classe: 'participacao', de: 'fundo', saldo: 10_000 })
  })

  it('o que a pessoa já corrigiu não volta como sugestão', () => {
    const h = historico(['2025', [pos('XPTO ALFA', 120, '03', '01')]])
    const [s] = sugerirClassesPorCodigo(h)
    const corrigido = aplicarOverrides(h, Object.fromEntries(s.ids.map((id) => [id, 'acoes' as const])))
    expect(sugerirClassesPorCodigo(corrigido)).toEqual([])
  })
})
