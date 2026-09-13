import { describe, it, expect } from 'vitest'
import {
  serieProventos,
  yieldSobreCusto,
  janelaDeMeses,
  TIPOS_PROVENTO,
  type ProventoRecebido,
  type TipoProvento,
} from './proventos.js'
import type { Posicao } from './bolsa.js'

const rec = (
  ano: number, mes: number, ticker: string, valor: number,
  tipo: TipoProvento = 'dividendo', ir = 0,
): ProventoRecebido => ({ ano, mes, ticker, pagador: ticker.slice(0, 4), tipo, valor, ir })

const perto = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
const eixo = (s: { meses: { ano: number; mes: number }[] }) =>
  s.meses.map((m) => `${m.ano}-${String(m.mes).padStart(2, '0')}`)

describe('série de proventos — o eixo', () => {
  it('vai do primeiro ao último mês com crédito, sem buraco', () => {
    const s = serieProventos([rec(2025, 11, 'A', 100), rec(2026, 2, 'A', 100)])
    expect(eixo(s)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    perto(s.meses[1].total, 0)
    perto(s.meses[2].total, 0)
  })

  it('não inventa mês fora da cobertura', () => {
    const s = serieProventos([rec(2026, 6, 'A', 50)])
    expect(eixo(s)).toEqual(['2026-06'])
    expect(s.de).toEqual({ ano: 2026, mes: 6 })
    expect(s.ate).toEqual({ ano: 2026, mes: 6 })
  })

  it('lista vazia devolve série vazia, sem null solto no meio', () => {
    const s = serieProventos([])
    expect(s).toMatchObject({ meses: [], porAno: [], porTicker: [], total: 0, ir: 0, de: null, ate: null })
  })

  it('crédito sem mês de 1 a 12 sai contado, não em silêncio', () => {
    const s = serieProventos([
      rec(2026, 1, 'A', 100),
      { ...rec(2026, 1, 'B', 100), mes: 0 },
      { ...rec(2026, 1, 'C', 100), mes: 13 },
      { ...rec(2026, 1, 'D', Number.NaN) },
    ])
    expect(s.ignorados).toBe(3)
    perto(s.total, 100)
    expect(s.porTicker.map((t) => t.ticker)).toEqual(['A'])
  })
})

describe('série de proventos — os três recortes', () => {
  const s = serieProventos([
    rec(2025, 3, 'PETR4', 300, 'dividendo'),
    rec(2025, 3, 'PETR4', 200, 'jcp', 30),
    rec(2025, 9, 'HGLG11', 90, 'rendimento'),
    rec(2026, 3, 'PETR4', 400, 'dividendo', 40),
    rec(2026, 4, 'HGLG11', 95, 'rendimento'),
  ])

  it('JCP e dividendo do mesmo mês somam no total e ficam separados por tipo', () => {
    const mar25 = s.meses.find((m) => m.ano === 2025 && m.mes === 3)!
    perto(mar25.total, 500)
    perto(mar25.porTipo.dividendo, 300)
    perto(mar25.porTipo.jcp, 200)
    perto(mar25.ir, 30)
  })

  it('o ano é a soma dos seus meses', () => {
    s.porAno.forEach((a) => {
      const doAno = s.meses.filter((m) => m.ano === a.ano)
      perto(a.total, doAno.reduce((t, m) => t + m.total, 0))
      perto(a.ir, doAno.reduce((t, m) => t + m.ir, 0))
      TIPOS_PROVENTO.forEach((tp) => {
        perto(a.porTipo[tp], doAno.reduce((t, m) => t + m.porTipo[tp], 0))
      })
    })
  })

  it('o total é a soma dos papéis, e dos meses, e dos anos', () => {
    perto(s.total, 1085)
    perto(s.total, s.porTicker.reduce((t, p) => t + p.total, 0))
    perto(s.total, s.meses.reduce((t, m) => t + m.total, 0))
    perto(s.total, s.porAno.reduce((t, a) => t + a.total, 0))
    perto(s.ir, 70)
  })

  it('o papel guarda o seu mês a mês na MESMA grade da série', () => {
    s.porTicker.forEach((p) => expect(eixo(p)).toEqual(eixo(s)))
    const petr = s.porTicker.find((p) => p.ticker === 'PETR4')!
    perto(petr.meses.find((m) => m.ano === 2025 && m.mes === 3)!.total, 500)
    perto(petr.meses.find((m) => m.ano === 2025 && m.mes === 9)!.total, 0)
  })

  it('o papel guarda o ano a ano, pela chave de texto', () => {
    const petr = s.porTicker.find((p) => p.ticker === 'PETR4')!
    expect(petr.porAno).toEqual({ '2025': 500, '2026': 400 })
  })

  it('papéis diferentes não se misturam', () => {
    expect(s.porTicker.map((p) => p.ticker)).toEqual(['HGLG11', 'PETR4'])
    perto(s.porTicker.find((p) => p.ticker === 'HGLG11')!.porTipo.rendimento, 185)
    perto(s.porTicker.find((p) => p.ticker === 'HGLG11')!.porTipo.dividendo, 0)
  })
})

describe('janela de meses', () => {
  it('doze meses terminando em março começam em abril do ano anterior', () => {
    expect(janelaDeMeses({ ano: 2026, mes: 3 }, 12)).toEqual({
      de: { ano: 2025, mes: 4 },
      ate: { ano: 2026, mes: 3 },
    })
  })

  it('janela de um mês é o próprio mês', () => {
    expect(janelaDeMeses({ ano: 2026, mes: 1 }, 1)).toEqual({
      de: { ano: 2026, mes: 1 },
      ate: { ano: 2026, mes: 1 },
    })
  })
})

describe('rendimento sobre custo', () => {
  const posicao: Posicao[] = [
    { ticker: 'PETR4', quantidade: 100, custoMedio: 30 }, // custo 3.000
    { ticker: 'HGLG11', quantidade: 10, custoMedio: 150 }, // custo 1.500
  ]

  it('é o provento do período dividido pelo custo da posição', () => {
    const s = serieProventos([rec(2026, 1, 'PETR4', 150), rec(2026, 6, 'PETR4', 150)])
    const r = yieldSobreCusto(s, posicao).find((x) => x.ticker === 'PETR4')!
    perto(r.provento, 300)
    perto(r.custo!, 3000)
    perto(r.rendimento!, 0.1)
  })

  it('papel vendido por inteiro não tem sobre o que render', () => {
    const s = serieProventos([rec(2026, 1, 'VALE3', 500)])
    const r = yieldSobreCusto(s, posicao).find((x) => x.ticker === 'VALE3')!
    expect(r.custo).toBeNull()
    expect(r.rendimento).toBeNull()
    perto(r.provento, 500)
  })

  it('posição que custou zero não vira divisão por zero', () => {
    const s = serieProventos([rec(2026, 1, 'BONUS3', 40)])
    const r = yieldSobreCusto(s, [{ ticker: 'BONUS3', quantidade: 100, custoMedio: 0 }])[0]
    expect(r.rendimento).toBeNull()
    perto(r.provento, 40)
  })

  it('papel com posição e sem provento aparece zerado, e não some da lista', () => {
    const s = serieProventos([rec(2026, 1, 'PETR4', 150)])
    const r = yieldSobreCusto(s, posicao).find((x) => x.ticker === 'HGLG11')!
    perto(r.provento, 0)
    perto(r.rendimento!, 0)
  })

  it('a janela de doze meses atravessa a virada do ano', () => {
    const s = serieProventos([
      rec(2024, 12, 'PETR4', 999), // fora da janela
      rec(2025, 4, 'PETR4', 100), // primeira dentro
      rec(2025, 12, 'PETR4', 100),
      rec(2026, 3, 'PETR4', 100), // última dentro
    ])
    const doze = yieldSobreCusto(s, posicao, janelaDeMeses({ ano: 2026, mes: 3 }, 12))
    perto(doze.find((x) => x.ticker === 'PETR4')!.provento, 300)
    perto(yieldSobreCusto(s, posicao).find((x) => x.ticker === 'PETR4')!.provento, 1299)
  })

  it('a janela corta nas duas pontas, inclusive', () => {
    const s = serieProventos([
      rec(2026, 1, 'PETR4', 10),
      rec(2026, 2, 'PETR4', 20),
      rec(2026, 3, 'PETR4', 40),
    ])
    const r = yieldSobreCusto(s, posicao, { de: { ano: 2026, mes: 1 }, ate: { ano: 2026, mes: 2 } })
    perto(r.find((x) => x.ticker === 'PETR4')!.provento, 30)
  })
})

describe('o que a revisão do lote achou', () => {
  it('tipo fora do catálogo sai CONTADO, e não vira chave nova', () => {
    const sujo = { ...rec(2026, 1, 'A', 100), tipo: 'JCP · FULANO' } as unknown as ProventoRecebido
    const s = serieProventos([sujo, rec(2026, 1, 'A', 50)])
    expect(s.ignorados).toBe(1)
    perto(s.total, 50)
    expect(Object.keys(s.porAno[0].porTipo).sort()).toEqual([...TIPOS_PROVENTO].sort())
    expect(JSON.stringify(s)).not.toContain('FULANO')
  })

  it('ano implausível sai contado, em vez de estourar a grade de meses', () => {
    // Um 1900 solto abria 1.513 meses, e cada papel ganhava a sua cópia da
    // grade. Com dois papéis e um ano digitado errado, a aba travava.
    const s = serieProventos([rec(1900, 1, 'A', 10), rec(20260, 1, 'A', 10), rec(2026, 1, 'A', 10)])
    expect(s.ignorados).toBe(2)
    expect(s.meses).toHaveLength(1)
  })
})
