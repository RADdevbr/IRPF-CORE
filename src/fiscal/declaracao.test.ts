import { describe, it, expect } from 'vitest'
import {
  apurarDeclaracao,
  tabelaAnual,
  defDeducoes,
  LINHAS_DEDUCAO,
  type DeducoesLegais,
} from './declaracao'
import { parametros } from './params'
import { calcINSS, calcIRRF } from './tabela'
import { computeIrpfm, calcSalarioAnual, FIELDS, type CalcParams } from './irpfm'

const par = parametros()

function makeVals(over: Record<string, number> = {}): Record<string, number> {
  const v: Record<string, number> = {}
  FIELDS.forEach((f) => {
    v[f.key] = 0
    if (f.ir) v[f.ir] = 0
  })
  return { ...v, ...over }
}
const p = (over: Partial<CalcParams> = {}): CalcParams => ({
  vals: makeVals(over.vals),
  ndep: 0,
  cdbA: null,
  red: false,
  aliqEmp: 0,
  limR: 0.34,
  ...over,
})

describe('tabela anual', () => {
  it('é a mensal vezes doze, faixa e parcela a deduzir', () => {
    const mensal = par.irrf.faixas
    const anual = tabelaAnual(par)
    expect(anual).toHaveLength(mensal.length)
    anual.forEach((f, i) => {
      expect(f.aliq).toBe(mensal[i].aliq)
      expect(f.ded).toBeCloseTo(mensal[i].ded * 12, 8)
      if (mensal[i].ate === Infinity) expect(f.ate).toBe(Infinity)
      else expect(f.ate).toBeCloseTo(mensal[i].ate * 12, 8)
    })
  })

  it('trocar a tabela mensal à mão vale para o ajuste também', () => {
    const outro = { ...par, irrf: { ...par.irrf, faixas: [{ ate: Infinity, aliq: 0.5, ded: 100 }] } }
    expect(tabelaAnual(outro)).toEqual([{ ate: Infinity, aliq: 0.5, ded: 1200 }])
  })
})

describe('imposto devido na declaração', () => {
  it('sem renda, sem imposto', () => {
    expect(apurarDeclaracao({ rendimentos: 0 }).devido).toBe(0)
  })

  // A conferência que ancora o módulo: com salário e nada além de INSS, o
  // imposto devido no ajuste tem de bater com a soma das retenções mensais.
  // É essa coincidência que fazia a simplificação antiga passar despercebida.
  it('bate com o IRRF mensal quando só há INSS a deduzir', () => {
    const mensal = 20000
    const inss = calcINSS(mensal, par)
    const irrfDoMes = calcIRRF(mensal - inss, par).bruto

    const completo = apurarDeclaracao({
      rendimentos: mensal * 12,
      deducoes: { previdenciaOficial: inss * 12 },
    }).completo
    expect(completo.devido).toBeCloseTo(irrfDoMes * 12, 4)
  })

  it('escolhe o modelo mais barato, e em renda alta é o simplificado', () => {
    const r = apurarDeclaracao({
      rendimentos: 240000,
      deducoes: { previdenciaOficial: calcINSS(20000, par) * 12 },
    })
    expect(r.simplificado.devido).toBeLessThan(r.completo.devido)
    expect(r.escolhido.nome).toBe('simplificado')
    expect(r.devido).toBe(r.simplificado.devido)
  })

  it('dedução informada derruba o imposto devido — e é o ponto do módulo', () => {
    const base = { rendimentos: 600000, deducoes: { previdenciaOficial: 11419 } }
    const sem = apurarDeclaracao(base)
    const com = apurarDeclaracao({
      ...base,
      deducoes: { ...base.deducoes, saude: 40000, previdenciaPrivada: 60000 },
    })
    expect(com.devido).toBeLessThan(sem.devido)
    expect(com.escolhido.nome).toBe('completo')
  })

  it('dependente abate pela tabela anual, e mais dependente abate mais', () => {
    const um = apurarDeclaracao({ rendimentos: 600000, ndep: 1, deducoes: { saude: 90000 } })
    const tres = apurarDeclaracao({ rendimentos: 600000, ndep: 3, deducoes: { saude: 90000 } })
    expect(um.dependentes).toBeCloseTo(par.dependente.mensal * 12, 6)
    expect(tres.devido).toBeLessThan(um.devido)
  })
})

describe('tetos das deduções', () => {
  it('previdência privada para em 12% do rendimento, e o corte é relatado', () => {
    const r = apurarDeclaracao({ rendimentos: 200000, deducoes: { previdenciaPrivada: 50000 } })
    expect(r.deducoesAceitas.previdenciaPrivada).toBeCloseTo(24000, 6) // 12% de 200k
    expect(r.cortes).toContainEqual({ linha: 'previdenciaPrivada', informado: 50000, aceito: 24000 })
  })

  it('instrução tem teto por pessoa: cresce com os dependentes', () => {
    const teto = par.declaracao.instrucaoPorPessoa
    const so = apurarDeclaracao({ rendimentos: 200000, deducoes: { instrucao: 99999 } })
    const comDois = apurarDeclaracao({ rendimentos: 200000, ndep: 2, deducoes: { instrucao: 99999 } })
    expect(so.deducoesAceitas.instrucao).toBeCloseTo(teto, 6)
    expect(comDois.deducoesAceitas.instrucao).toBeCloseTo(teto * 3, 6)
  })

  it('saúde não tem teto', () => {
    const r = apurarDeclaracao({ rendimentos: 300000, deducoes: { saude: 250000 } })
    expect(r.deducoesAceitas.saude).toBe(250000)
    expect(r.cortes.map((c) => c.linha)).not.toContain('saude')
  })

  it('dedução dentro do teto não vira corte', () => {
    const r = apurarDeclaracao({ rendimentos: 200000, deducoes: { previdenciaPrivada: 10000 } })
    expect(r.cortes).toEqual([])
  })
})

describe('a dedução do IRPFM passa a ser o imposto devido', () => {
  it('o IRRF do pró-labore vira antecipação, não dedução', () => {
    const c = computeIrpfm(p({ vals: makeVals({ salario: 240000, divBR: 900000 }) }))
    const sc = calcSalarioAnual(240000, 0)
    // o que era retido mês a mês continua visível, mas fora da dedução
    expect(c.irAntecipado).toBeCloseTo(sc.irMensal * 12, 4)
    expect(c.deducoes).toBeCloseTo(c.irpfDevido + c.irDefinitivo, 6)
    expect(c.deducoes).not.toBeCloseTo(sc.irAnual, 2)
  })

  it('13º e adicional de férias entram como definitivos: são exclusivos na fonte', () => {
    const c = computeIrpfm(p({ vals: makeVals({ salario: 240000, divBR: 900000 }) }))
    const sc = calcSalarioAnual(240000, 0)
    expect(c.irDefinitivo).toBeCloseTo(sc.ir13 + sc.irFer, 6)
  })

  it('informar despesa médica AUMENTA o IRPFM, porque derruba o imposto devido', () => {
    const vals = makeVals({ salario: 600000, divBR: 900000 })
    const sem = computeIrpfm(p({ vals }))
    const com = computeIrpfm(p({ vals, deducoes: { saude: 80000 } }))
    expect(com.irpfDevido).toBeLessThan(sem.irpfDevido)
    expect(com.liquido).toBeGreaterThan(sem.liquido)
  })

  it('IR pago no exterior compensa o devido em vez de abater o IRPFM por fora', () => {
    const vals = makeVals({ exterior: 300000, divBR: 900000 })
    const sem = computeIrpfm(p({ vals }))
    const com = computeIrpfm(p({ vals: { ...vals, exterior_ir: 20000 } }))
    expect(sem.irpfDevido - com.irpfDevido).toBeCloseTo(20000, 6)
  })

  it('retenção exclusiva (CDB, bolsa, dividendo) continua abatendo direto', () => {
    const c = computeIrpfm(p({ vals: makeVals({ divBR: 900000, divBR_ir: 90000 }) }))
    expect(c.irDefinitivo).toBeCloseTo(90000, 6)
    expect(c.irpfDevido).toBe(0) // nada tributável na declaração
    expect(c.aRestituir).toBeCloseTo(45000, 6)
  })

  it('a conservação continua valendo com o novo modelo de dedução', () => {
    const c = computeIrpfm(
      p({
        vals: makeVals({ salario: 300000, aluguel: 120000, aluguel_ir: 18000, divBR: 800000, divBR_ir: 80000 }),
        ndep: 2,
        deducoes: { saude: 30000, instrucao: 12000, previdenciaPrivada: 40000 },
      }),
    )
    expect(c.liquido - c.aRestituir).toBeCloseTo(c.bruto - c.deducoes - c.redutor, 6)
    expect(c.deducoes).toBeCloseTo(c.irpfDevido + c.irDefinitivo, 6)
  })
})

describe('forma das deduções', () => {
  it('o padrão é tudo zerado', () => {
    const d = defDeducoes()
    Object.values(d).forEach((v) => expect(v).toBe(0))
  })

  it('toda linha da tela tem campo, rótulo e explicação', () => {
    const chaves = Object.keys(defDeducoes()) as (keyof DeducoesLegais)[]
    expect(LINHAS_DEDUCAO.map((l) => l.key).sort()).toEqual([...chaves].sort())
    LINHAS_DEDUCAO.forEach((l) => {
      expect(l.label.length).toBeGreaterThan(0)
      expect(l.info.length).toBeGreaterThan(0)
    })
  })
})
