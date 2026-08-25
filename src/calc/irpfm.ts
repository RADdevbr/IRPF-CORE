// Núcleo de cálculo do IRPFM 2027 (Lei 15.270/2025).
// Portado fielmente do standalone original e validado por testes (irpfm.test.ts).
// Parâmetros confirmados contra o texto primário da lei — ver PLAN.md.
//
// As tabelas (INSS, IRRF, dependente) e as constantes da lei moram em
// `params.ts`, com ano e fonte declarados; aqui ficam só as contas. Toda função
// aceita um conjunto de parâmetros — o padrão é o do ano-base do app.

import { parametros, type ParametrosAno } from './params'
export type { FaixaINSS, FaixaIRRF } from './params'
export { parametros, pendencias, ANO_BASE, PARAMS } from './params'

const PADRAO = parametros()

// Reexportadas para quem só quer os números do ano-base corrente.
export const INSS_FAIXAS = PADRAO.inss.faixas
export const IRRF_FAIXAS = PADRAO.irrf.faixas
export const DEP_MENSAL = PADRAO.dependente.mensal

export interface Field {
  key: string
  label: string
  ir: string | null
  base: boolean
  autoSal: boolean
  autoCdb: boolean
  info: string
}

export const FIELDS: Field[] = [
  { key: 'salario', label: 'Salário / pró-labore', ir: 'salario_ir', base: true, autoSal: true, autoCdb: false, info: 'Total anual bruto incluindo 13º e adicional de férias.' },
  { key: 'divBR', label: 'Dividendos de ações BR', ir: 'divBR_ir', base: true, autoSal: false, autoCdb: false, info: 'IRRF de 10% sobre distribuições acima de R$50k/mês por CNPJ.' },
  { key: 'divFII', label: 'Dividendos de FIIs', ir: null, base: false, autoSal: false, autoCdb: false, info: 'ISENTOS do IRPFM por lei.' },
  { key: 'exterior', label: 'Rendimentos no exterior', ir: 'exterior_ir', base: true, autoSal: false, autoCdb: false, info: 'IR pago no exterior pode ser deduzido.' },
  { key: 'aluguel', label: 'Aluguéis', ir: 'aluguel_ir', base: true, autoSal: false, autoCdb: false, info: 'Incluso na base do IRPFM.' },
  { key: 'cdb', label: 'CDB, fundos e invest. tributáveis', ir: 'cdb_ir', base: true, autoSal: false, autoCdb: true, info: 'IR retido exclusivamente na fonte é deduzido.' },
  { key: 'bolsa', label: 'Ganho em bolsa (renda variável)', ir: 'bolsa_ir', base: true, autoSal: false, autoCdb: false, info: 'Ganho líquido na venda de ações, ETF e FII. A entrada na base do IRPFM é leitura da lei, não texto expresso — veja o painel da apuração.' },
  { key: 'outros', label: 'Outros rendimentos tributáveis', ir: 'outros_ir', base: true, autoSal: false, autoCdb: false, info: 'Qualquer outro rendimento não isento por lei.' },
]

export const REDUTORES = [
  { label: '34% — empresas em geral', val: 0.34 },
  { label: '40% — seguradoras / capitalização', val: 0.4 },
  { label: '45% — bancos', val: 0.45 },
]

export const CDB_ALIQ = [
  { label: '15%', val: 0.15 },
  { label: '17,5%', val: 0.175 },
  { label: '20%', val: 0.2 },
]

// INSS acumulado por faixas até a base b.
export function calcINSS(b: number, par: ParametrosAno = PADRAO): number {
  let t = 0
  let a = 0
  for (const f of par.inss.faixas) {
    if (b <= a) break
    t += (Math.min(f.ate, b) - a) * f.aliq
    a = f.ate
    if (b <= f.ate) break
  }
  return t
}

// IRRF bruto (antes de reduções) e alíquota nominal para a base b.
export function calcIRRF(b: number, par: ParametrosAno = PADRAO): { bruto: number; aliq: number } {
  for (const f of par.irrf.faixas) {
    if (b <= f.ate) return { bruto: Math.max(0, b * f.aliq - f.ded), aliq: f.aliq }
  }
  return { bruto: 0, aliq: 0 }
}

// Redução do IR mensal — Art. 3º-A da Lei 9.250/1995 (Lei 15.270/2025).
// até 5.000 → imposto zero; 5.000,01–7.350 → 978,62 − 0,133145 × base.
export function aplicaReducao(b: number, br: number, par: ParametrosAno = PADRAO): number {
  const r = par.reducao
  if (b <= r.isencaoAte) return 0
  if (b <= r.reducaoAte) return Math.max(0, br - Math.max(0, r.constante - r.coeficiente * b))
  return br
}

// Tributação exclusiva (13º / adicional de férias): sem a redução do Art. 3º-A.
export function calcExclusivo(v: number, nd: number, par: ParametrosAno = PADRAO): {
  ir: number
  base: number
  inss: number
  aliq: number
} {
  const i = calcINSS(v, par)
  const b = Math.max(0, v - i - par.dependente.mensal * nd)
  const { bruto, aliq } = calcIRRF(b, par)
  return { ir: Math.max(0, bruto), base: b, inss: i, aliq }
}

export interface SalarioAnual {
  irAnual: number
  inssMensal: number
  baseMensal: number
  aliqNom: number
  irMensal: number
  ir13: number
  base13: number
  inss13: number
  aliq13: number
  irFer: number
  baseFer: number
  inssFer: number
  aliqFer: number
}

// Decompõe o salário/pró-labore anual em mensal + 13º + 1/3 de férias e
// devolve o IRRF anual total já com a redução do Art. 3º-A no mensal.
export function calcSalarioAnual(anual: number, nd: number, par: ParametrosAno = PADRAO): SalarioAnual {
  const vz: SalarioAnual = {
    irAnual: 0, inssMensal: 0, baseMensal: 0, aliqNom: 0, irMensal: 0,
    ir13: 0, base13: 0, inss13: 0, aliq13: 0,
    irFer: 0, baseFer: 0, inssFer: 0, aliqFer: 0,
  }
  if (!anual || anual <= 0) return vz
  const m = anual / (12 + 1 + 1 / 3)
  const i = calcINSS(m, par)
  const b = Math.max(0, m - i - par.dependente.mensal * nd)
  const { bruto, aliq } = calcIRRF(b, par)
  const irM = aplicaReducao(b, bruto, par)
  const d13 = calcExclusivo(m, nd, par)
  const dF = calcExclusivo(m / 3, nd, par)
  return {
    irAnual: irM * 12 + d13.ir + dF.ir,
    inssMensal: i, baseMensal: b, aliqNom: aliq, irMensal: irM,
    ir13: d13.ir, base13: d13.base, inss13: d13.inss, aliq13: d13.aliq,
    irFer: dF.ir, baseFer: dF.base, inssFer: dF.inss, aliqFer: dF.aliq,
  }
}

/**
 * Folga contra ruído de ponto flutuante nas buscas (limiar, teto).
 *
 * Quem retém exatamente 10% fica com o IRPFM bruto e a dedução colados no teto
 * da alíquota mínima: em teoria empatam, na prática a subtração devolve algo
 * como 1e-9. Sem essa folga, esse ruído era lido como "nasceu imposto" e
 * inventava limiares e tetos que não existem. Um real é irrelevante em imposto
 * e grande demais para qualquer erro de arredondamento.
 */
export const FOLGA_IMPOSTO = 1

// Alíquota mínima progressiva do IRPFM (Art. 16-A): 0 até 600k, rampa linear
// até 10% em 1,2M, fixa em 10% acima.
export function aliqMinima(base: number, par: ParametrosAno = PADRAO): number {
  const { baseIsenta, baseAliqCheia, aliqMax } = par.irpfm
  if (base > baseAliqCheia) return aliqMax
  if (base > baseIsenta) return ((base - baseIsenta) / (baseAliqCheia - baseIsenta)) * aliqMax
  return 0
}

// IRPFM bruto (antes de deduções) a partir de uma base já somada.
export function irpfmBrutoFromBase(base: number, par: ParametrosAno = PADRAO): number {
  return base * aliqMinima(base, par)
}

export interface CalcParams {
  vals: Record<string, number>
  ndep: number
  cdbA: number | null
  red: boolean
  aliqEmp: number
  limR: number
  /** Parâmetros fiscais do ano-base; o padrão é o ano corrente do app. */
  par?: ParametrosAno
}

export interface CalcResult extends SalarioAnual {
  base: number
  aliqMin: number
  bruto: number
  deducoes: number
  redutor: number
  liquido: number
  aliqEf: number
  cdbAuto: number | null
}

// Cálculo agregado do IRPFM anual.
// Alíquota mínima progressiva (Art. 16-A): 0 até 600k, rampa linear até 10%
// em 1,2M, fixa em 10% acima. FIIs ficam fora da base (isentos).
export function computeIrpfm(p: CalcParams): CalcResult {
  const { vals, ndep, cdbA, red, aliqEmp, limR, par = PADRAO } = p
  const sc = calcSalarioAnual(vals.salario || 0, ndep, par)
  const salIr = (vals.salario_ir || 0) > 0 ? vals.salario_ir : sc.irAnual
  const cdbAuto = cdbA != null ? (vals.cdb || 0) * cdbA : null
  const cdbIr = cdbAuto != null ? cdbAuto : vals.cdb_ir || 0

  const base = FIELDS.filter((f) => f.base).reduce((s, f) => s + (vals[f.key] || 0), 0)

  const aliqMin = aliqMinima(base, par)
  const bruto = base * aliqMin

  const deducoes = FIELDS.filter((f) => f.ir).reduce((s, f) => {
    if (f.key === 'salario') return s + salIr
    if (f.key === 'cdb') return s + cdbIr
    return s + (vals[f.ir as string] || 0)
  }, 0)

  let redutor = 0
  if (red && aliqMin > 0) {
    const soma = aliqMin + aliqEmp / 100
    if (soma > limR) redutor = (soma - limR) * (vals.divBR || 0)
  }

  const liquido = Math.max(0, bruto - deducoes - redutor)
  return {
    base, aliqMin, bruto, deducoes, redutor, liquido,
    aliqEf: base > 0 ? liquido / base : 0,
    cdbAuto, ...sc,
  }
}
