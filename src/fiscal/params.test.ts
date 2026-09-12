import { describe, it, expect } from 'vitest'
import { ANO_BASE, PARAMS, aplicarOverrides, manuais, parametros, pendencias, type ParametrosAno } from './params'
import { aliqMinima, calcINSS, calcIRRF, aplicaReducao, calcSalarioAnual } from './irpfm'

describe('parâmetros por ano', () => {
  it('tem o ano-base do app cadastrado', () => {
    expect(PARAMS[ANO_BASE]).toBeDefined()
    expect(parametros().ano).toBe(ANO_BASE)
  })

  it('recusa ano sem parâmetros em vez de calcular com os do ano errado', () => {
    expect(() => parametros(1999)).toThrow(/1999/)
  })

  it('todo grupo declara fonte, e o que não é definitivo diz o que falta', () => {
    const p = parametros()
    const grupos = [p.inss, p.irrf, p.dependente, p.reducao, p.irpfm]
    grupos.forEach((g) => {
      expect(g.fonte.length).toBeGreaterThan(0)
      if (!g.confirmado) expect(g.nota).toBeTruthy()
    })
  })

  it('lista como pendente exatamente o que ainda é estimativa', () => {
    const p = parametros()
    const nomes = pendencias(p).map((x) => x.grupo)
    expect(nomes.includes('INSS')).toBe(p.inss.confirmado === false)
    expect(nomes.includes('IRPFM')).toBe(false) // o núcleo da lei é confirmado
  })

  it('mantém os limites da Lei 15.270 no grupo do IRPFM', () => {
    const { irpfm } = parametros()
    expect(irpfm.baseIsenta).toBe(600_000)
    expect(irpfm.baseAliqCheia).toBe(1_200_000)
    expect(irpfm.aliqMax).toBe(0.1)
    expect(irpfm.gatilhoDividendoMes).toBe(50_000)
    expect(irpfm.aliqIrrfDividendo).toBe(0.1)
  })
})

// Um conjunto inventado, deliberadamente diferente do real: se o cálculo
// ignorasse o argumento e usasse a constante velha, estes testes passariam a
// devolver os números do ano-base e falhariam.
const OUTRO: ParametrosAno = {
  ano: 2030,
  inss: { faixas: [{ ate: 1000, aliq: 0.1 }], fonte: 'teste', confirmado: true },
  irrf: { faixas: [{ ate: Infinity, aliq: 0.5, ded: 0 }], fonte: 'teste', confirmado: true },
  dependente: { mensal: 100, fonte: 'teste', confirmado: true },
  reducao: { isencaoAte: 0, reducaoAte: 0, constante: 0, coeficiente: 0, fonte: 'teste', confirmado: true },
  declaracao: {
    descontoSimplificadoTeto: 1000,
    descontoSimplificadoAliq: 0.2,
    instrucaoPorPessoa: 500,
    previdenciaPrivadaFracao: 0.12,
    fonte: 'teste',
    confirmado: true,
  },
  rendaFixa: { aliquotaUnica: null, fonte: 'teste', confirmado: true },
  irpfm: {
    baseIsenta: 100_000,
    baseAliqCheia: 200_000,
    aliqMax: 0.2,
    gatilhoDividendoMes: 10_000,
    aliqIrrfDividendo: 0.05,
    fonte: 'teste',
    confirmado: true,
  },
}

describe('o cálculo obedece aos parâmetros recebidos', () => {
  it('alíquota mínima usa os limites do conjunto, não os fixos', () => {
    expect(aliqMinima(150_000, OUTRO)).toBeCloseTo(0.1, 10) // meio da rampa
    expect(aliqMinima(200_001, OUTRO)).toBe(0.2)
    expect(aliqMinima(100_000, OUTRO)).toBe(0)
  })

  it('INSS e IRRF usam as faixas do conjunto', () => {
    expect(calcINSS(1000, OUTRO)).toBeCloseTo(100, 10)
    expect(calcIRRF(1000, OUTRO).aliq).toBe(0.5)
  })

  it('a redução do IR mensal usa os limites do conjunto', () => {
    // Sem faixa de redução no conjunto de teste: nada é reduzido.
    expect(aplicaReducao(3000, 500, OUTRO)).toBe(500)
  })

  it('o salário anual propaga os parâmetros até o 13º e as férias', () => {
    const r = calcSalarioAnual(120_000, 1, OUTRO)
    const mensal = 120_000 / (12 + 1 + 1 / 3)
    const inss = Math.min(mensal, 1000) * 0.1
    const base = Math.max(0, mensal - inss - 100)
    expect(r.inssMensal).toBeCloseTo(inss, 8)
    expect(r.baseMensal).toBeCloseTo(base, 8)
    expect(r.irMensal).toBeCloseTo(base * 0.5, 8)
  })
})

describe('tabelas trocadas à mão', () => {
  it('sem overrides, nada muda', () => {
    const base = parametros()
    expect(aplicarOverrides(base, undefined)).toBe(base)
    expect(aplicarOverrides(base, {})).toEqual(base)
  })

  it('a faixa informada substitui a estimativa e vira "alterado à mão"', () => {
    const p = aplicarOverrides(parametros(), { inss: [{ ate: 2000, aliq: 0.08 }] })
    expect(p.inss.faixas).toEqual([{ ate: 2000, aliq: 0.08 }])
    expect(p.inss.manual).toBe(true)
    expect(manuais(p)).toEqual(['INSS'])
  })

  it('trocar um grupo não mexe nos outros', () => {
    const base = parametros()
    const p = aplicarOverrides(base, { dependenteMensal: 250 })
    expect(p.dependente.mensal).toBe(250)
    expect(p.irrf).toBe(base.irrf)
    expect(manuais(p)).toEqual(['Dedução por dependente'])
  })

  it('grupo trocado sai da lista de pendências — deixou de ser estimativa do app', () => {
    const antes = pendencias(parametros()).map((x) => x.grupo)
    expect(antes).toContain('INSS')
    const depois = pendencias(aplicarOverrides(parametros(), { inss: [{ ate: 1, aliq: 0.1 }] }))
    expect(depois.map((x) => x.grupo)).not.toContain('INSS')
  })

  it('lista vazia é ignorada — não apaga a tabela sem querer', () => {
    const base = parametros()
    expect(aplicarOverrides(base, { inss: [] }).inss).toBe(base.inss)
  })
})
