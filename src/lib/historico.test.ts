import { describe, it, expect } from 'vitest'
import {
  classificaPatrimonio,
  REGIME,
  somaPorAlvo,
  idPosicao,
  montarDeclaracao,
  seriePatrimonio,
  serieBacktest,
  cagr,
  porClasse,
  upsertDeclaracao,
  removerAno,
  type Historico,
} from './historico'
import type { DecResult, Lancamento, Posicao } from './decParser'

const lanc = (alvo: string, valor: number): Lancamento => ({
  linha: 1,
  tipo: '84',
  tipoLabel: 'x',
  fonte: 'Fonte',
  cnpj: '',
  rotulo: 'Rendimento',
  valor,
  alvo,
})

const pos = (descricao: string, saldoAtual: number, saldoAnterior = 0): Posicao => ({
  linha: 1,
  cdBem: '00',
  descricao,
  saldoAnterior,
  saldoAtual,
  tipoCarteira: 'cdb',
})

const dec = (ano: string | null, lancamentos: Lancamento[], posicoes: Posicao[], ndep = 0): DecResult => ({
  ano,
  registros: [],
  lancamentos,
  posicoes,
  ndep,
  linhas: [],
  totalLinhas: 0,
})

describe('classificação do patrimônio', () => {
  it('reconhece as classes que decidem o regime', () => {
    expect(classificaPatrimonio('CDB BANCO X VENC 2027')).toBe('cdb')
    expect(classificaPatrimonio('TESOURO IPCA+ 2029')).toBe('tesouro')
    expect(classificaPatrimonio('LCA BANCO Y')).toBe('lci')
    expect(classificaPatrimonio('CRI SETOR IMOBILIARIO')).toBe('cri')
    expect(classificaPatrimonio('DEBENTURE INCENTIVADA XPTO')).toBe('debentureInc')
    expect(classificaPatrimonio('POUPANCA BANCO Z')).toBe('poupanca')
    expect(classificaPatrimonio('APARTAMENTO RUA TAL 120M2')).toBe('imovel')
    expect(classificaPatrimonio('ACOES PETR4 B3')).toBe('acoes')
    expect(classificaPatrimonio('PGBL SEGURADORA')).toBe('previdencia')
  })

  it('não chuta: bem irreconhecível NÃO entra como base do IRPFM', () => {
    const c = classificaPatrimonio('BEM ESQUISITO SEM NOME CLARO')
    expect(c).toBe('desconhecido')
    expect(REGIME[c]).toBe('depende')
  })

  it('separa o que a lei já resolveu do que ainda não', () => {
    expect(REGIME.cdb).toBe('inBase')
    expect(REGIME.tesouro).toBe('inBase')
    expect(REGIME.lci).toBe('foraBase')
    expect(REGIME.poupanca).toBe('foraBase')
    expect(REGIME.acoes).toBe('depende')
    expect(REGIME.imovel).toBe('depende')
  })
})

describe('soma por destino', () => {
  it('agrupa lançamentos e ignora os sem destino', () => {
    const vals = somaPorAlvo([lanc('cdb', 1000), lanc('cdb', 500), lanc('divBR', 200), lanc('', 999)])
    expect(vals).toEqual({ cdb: 1500, divBR: 200 })
  })
})

describe('identidade da posição entre anos', () => {
  it('sobrevive a pontuação e espaço extra — é o que liga a mesma aplicação ano a ano', () => {
    expect(idPosicao('CDB  Banco X - venc. 03/2027', 'cdb')).toBe(idPosicao('cdb banco x venc 03 2027', 'cdb'))
  })

  it('separa bens de classes diferentes com a mesma descrição', () => {
    expect(idPosicao('BANCO X', 'cdb')).not.toBe(idPosicao('BANCO X', 'poupanca'))
  })
})

describe('montagem da declaração', () => {
  it('calcula base e IRPFM do ano, e deriva o ano-base do exercício', () => {
    const d = montarDeclaracao(
      dec('2026', [lanc('divBR', 800_000), lanc('cdb', 100_000)], [pos('CDB BANCO X', 500_000)]),
      'IRPF2026.DEC',
      '2026-08-23T00:00:00.000Z',
    )!
    expect(d.exercicio).toBe(2026)
    expect(d.anoBase).toBe(2025)
    expect(d.base).toBe(900_000)
    expect(d.irpfm).toBeGreaterThan(0)
    expect(d.patrimonio).toBe(500_000)
    expect(d.posicoes[0].regime).toBe('inBase')
  })

  it('não cai no IRPFM abaixo de 600k', () => {
    const d = montarDeclaracao(dec('2024', [lanc('cdb', 400_000)], []), 'x.DEC', 'agora')!
    expect(d.base).toBe(400_000)
    expect(d.irpfm).toBe(0)
  })

  it('devolve null quando o ano não pôde ser lido', () => {
    expect(montarDeclaracao(dec(null, [], []), 'x.DEC', 'agora')).toBeNull()
  })

  it('aceita o ano corrigido à mão quando o arquivo engana', () => {
    const d = montarDeclaracao(dec('1999', [], []), 'x.DEC', 'agora', 2023)!
    expect(d.anoBase).toBe(2022)
  })
})

describe('séries do histórico', () => {
  const montar = (): Historico => {
    let h: Historico = {}
    h = upsertDeclaracao(
      h,
      montarDeclaracao(
        dec('2024', [lanc('cdb', 500_000)], [pos('CDB BANCO X', 400_000), pos('LCA BANCO Y', 300_000), pos('APARTAMENTO', 300_000)]),
        'a.DEC',
        'agora',
      )!,
    )
    h = upsertDeclaracao(
      h,
      montarDeclaracao(
        dec('2026', [lanc('cdb', 700_000)], [pos('CDB BANCO X', 800_000), pos('LCA BANCO Y', 400_000), pos('APARTAMENTO', 400_000)]),
        'b.DEC',
        'agora',
      )!,
    )
    return h
  }

  it('empilha o patrimônio por regime, em ordem cronológica', () => {
    const s = seriePatrimonio(montar())
    expect(s.map((p) => p.anoBase)).toEqual([2023, 2025])
    expect(s[0]).toMatchObject({ inBase: 400_000, foraBase: 300_000, depende: 300_000, total: 1_000_000 })
    expect(s[1]).toMatchObject({ inBase: 800_000, foraBase: 400_000, depende: 400_000, total: 1_600_000 })
  })

  it('mostra em que anos a lei nova teria pegado', () => {
    const b = serieBacktest(montar())
    expect(b.map((p) => p.cruzou)).toEqual([false, true])
    expect(b[0].irpfm).toBe(0)
    expect(b[1].irpfm).toBeGreaterThan(0)
  })

  it('calcula o CAGR entre o primeiro e o último ano', () => {
    const c = cagr(seriePatrimonio(montar()))!
    // 1,0M → 1,6M em 2 anos = 26,49% a.a.
    expect(c).toBeCloseTo(Math.pow(1.6, 1 / 2) - 1, 6)
  })

  it('não inventa CAGR com um ano só', () => {
    expect(cagr(seriePatrimonio(removerAno(montar(), 2023)))).toBeNull()
  })

  it('agrupa o ano mais recente por classe, com o regime junto', () => {
    const c = porClasse(montar())
    expect(c[0]).toEqual({ classe: 'cdb', regime: 'inBase', total: 800_000 })
    expect(c.find((x) => x.classe === 'lci')).toEqual({ classe: 'lci', regime: 'foraBase', total: 400_000 })
    expect(c.find((x) => x.classe === 'imovel')?.regime).toBe('depende')
  })

  it('reimportar o mesmo ano substitui em vez de duplicar', () => {
    let h = montar()
    h = upsertDeclaracao(h, montarDeclaracao(dec('2026', [lanc('cdb', 10)], []), 'c.DEC', 'agora')!)
    expect(Object.keys(h)).toHaveLength(2)
    expect(h['2025'].base).toBe(10)
  })
})
