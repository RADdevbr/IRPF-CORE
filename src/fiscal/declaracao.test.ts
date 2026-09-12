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
import { FIELDS } from './fontes'

const par = parametros()

function makeVals(over: Record<string, number> = {}): Record<string, number> {
  const v: Record<string, number> = {}
  FIELDS.forEach((f) => {
    v[f.key] = 0
    if (f.ir) v[f.ir] = 0
  })
  return { ...v, ...over }
}

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
