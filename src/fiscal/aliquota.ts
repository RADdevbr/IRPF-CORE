// Núcleo de cálculo do IRPFM 2027 (Lei 15.270/2025).
// Portado fielmente do standalone original e validado por testes (irpfm.test.ts).
// Parâmetros confirmados contra o texto primário da lei — ver PLAN.md.
//
// As tabelas (INSS, IRRF, dependente) e as constantes da lei moram em
// `params.ts`, com ano e fonte declarados; aqui ficam só as contas. Toda função
// aceita um conjunto de parâmetros — o padrão é o do ano-base do app.

import { parametros, type ParametrosAno } from './params'
import { calcINSS, calcIRRF, aplicaReducao } from './tabela'
import { apurarDeclaracao, type DeducoesLegais, type ResultadoDeclaracao } from './declaracao'
export type { FaixaINSS, FaixaIRRF } from './params'
export { parametros, pendencias, ANO_BASE, PARAMS } from './params'
// A aritmética das tabelas mora em `tabela.ts` (ver o porquê lá); quem importava
// daqui continua importando daqui.
export { calcINSS, calcIRRF, aplicaReducao } from './tabela'

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
  /**
   * O rendimento é tributado na DECLARAÇÃO de ajuste anual?
   *
   * Decide o que fazer com o IR da fonte, e é a diferença entre as duas contas.
   * `true` → a retenção é ANTECIPAÇÃO: quem fecha o ano é o ajuste, e é o
   * imposto devido nele que a Lei 15.270/2025 manda abater do IRPFM.
   * `false` → tributação exclusiva ou definitiva: a retenção é o imposto final,
   * e ela abate o IRPFM diretamente.
   */
  naDeclaracao: boolean
  info: string
}

export const FIELDS: Field[] = [
  { key: 'salario', label: 'Salário / pró-labore', ir: 'salario_ir', base: true, autoSal: true, autoCdb: false, naDeclaracao: true, info: 'Total anual bruto incluindo 13º e adicional de férias. O IRRF retido é antecipação: quem abate o IRPFM é o imposto devido na declaração.' },
  { key: 'divBR', label: 'Dividendos de ações BR', ir: 'divBR_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'IRRF de 10% sobre distribuições acima de R$50k/mês por CNPJ.' },
  { key: 'divFII', label: 'Dividendos de FIIs', ir: null, base: false, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'ISENTOS do IRPFM por lei.' },
  { key: 'exterior', label: 'Rendimentos no exterior', ir: 'exterior_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: true, info: 'Tributado na declaração; o IR pago no exterior é compensado contra o imposto devido aqui.' },
  { key: 'aluguel', label: 'Aluguéis', ir: 'aluguel_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: true, info: 'Tributado na declaração. O carnê-leão recolhido no mês é antecipação, não imposto final.' },
  { key: 'cdb', label: 'CDB, fundos e invest. tributáveis', ir: 'cdb_ir', base: true, autoSal: false, autoCdb: true, naDeclaracao: false, info: 'IR retido exclusivamente na fonte é deduzido.' },
  { key: 'bolsa', label: 'Ganho em bolsa (renda variável)', ir: 'bolsa_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'Ganho líquido na venda de ações, ETF e FII. A entrada na base do IRPFM é leitura da lei, não texto expresso — veja o painel da apuração.' },
  { key: 'outros', label: 'Outros rendimentos tributáveis', ir: 'outros_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'Qualquer outro rendimento não isento por lei, tributado só na fonte.' },
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
  /** Rendimento bruto de um mês — a base do que vai à declaração de ajuste. */
  rendMensal: number
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
    irAnual: 0, rendMensal: 0, inssMensal: 0, baseMensal: 0, aliqNom: 0, irMensal: 0,
    ir13: 0, base13: 0, inss13: 0, aliq13: 0,
    irFer: 0, baseFer: 0, inssFer: 0, aliqFer: 0,
  }
  if (!anual || anual <= 0) return vz
  const m = anual / (12 + 1 + 1 / 3)
  const i = calcINSS(m, par)
  const b = Math.max(0, m - i - par.dependente.mensal * nd)
  const { bruto, aliq } = calcIRRF(b, par)
  // `m` (rendimento do mês) e não `b` (base): ver aplicaReducao.
  const irM = aplicaReducao(m, bruto, par)
  const d13 = calcExclusivo(m, nd, par)
  const dF = calcExclusivo(m / 3, nd, par)
  return {
    irAnual: irM * 12 + d13.ir + dF.ir,
    rendMensal: m,
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
  /**
   * Deduções legais da declaração de ajuste anual.
   *
   * Ausente = nenhuma informada (a previdência oficial ainda é preenchida
   * sozinha a partir do INSS do pró-labore). Elas não entram na base do IRPFM —
   * entram no imposto DEVIDO, que é o que abate o IRPFM.
   */
  deducoes?: Partial<DeducoesLegais>
  /** Parâmetros fiscais do ano-base; o padrão é o ano corrente do app. */
  par?: ParametrosAno
}

export interface CalcResult extends SalarioAnual {
  base: number
  aliqMin: number
  bruto: number
  deducoes: number
  redutor: number
  /** Imposto devido na declaração de ajuste — a primeira parcela da dedução. */
  irpfDevido: number
  /** IR exclusivo ou definitivo já retido — a segunda parcela da dedução. */
  irDefinitivo: number
  /**
   * IRRF e carnê-leão já recolhidos sobre rendimento que vai à declaração.
   *
   * NÃO deduz o IRPFM: é adiantamento do imposto do ajuste, e quem abate é o
   * devido. Fica no resultado para a tela poder dizer isso em vez de o número
   * simplesmente sumir da conta de quem já o via ali.
   */
  irAntecipado: number
  /** A apuração inteira do ajuste, para a tela e para a memória. */
  declaracao: ResultadoDeclaracao
  /** O que ainda há a pagar. Zero quando a retenção já cobriu o mínimo. */
  liquido: number
  /**
   * O que foi retido ALÉM do mínimo devido — volta como restituição na
   * declaração do ano seguinte.
   *
   * Antes isto era o lado negativo de `liquido`, apagado pelo piso em zero.
   * Apagar era errado nos dois sentidos: some um valor que é do contribuinte, e
   * faz "concentrar dividendo acima do gatilho" parecer neutro quando ela custa
   * caixa até a restituição chegar. Quem retém exatamente 10% sobre uma base na
   * rampa fica sempre deste lado.
   */
  aRestituir: number
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

  // ---- Deduções: o imposto DEVIDO na declaração, mais o retido em definitivo.
  //
  // A lei manda abater "o imposto devido na declaração de ajuste anual" e o que
  // foi retido em definitivo — não a soma das retenções, que era o que ficava
  // aqui. A diferença entre as duas leituras é exatamente o que as deduções
  // legais (previdência, saúde, instrução, dependentes, livro-caixa) fazem, e o
  // que o desconto simplificado faz em renda alta.
  //
  // O 13º e o adicional de férias entram como DEFINITIVOS: eles são tributados
  // exclusivamente na fonte e não passam pelo ajuste.
  const rendimentosNaDeclaracao = FIELDS.filter((f) => f.naDeclaracao).reduce(
    (s, f) => s + (f.key === 'salario' ? sc.rendMensal * 12 : vals[f.key] || 0),
    0,
  )
  const declaracao = apurarDeclaracao({
    rendimentos: rendimentosNaDeclaracao,
    // A previdência oficial o app já conhece quando calcula o IRRF do
    // pró-labore; informada à mão, a informada manda.
    deducoes: { ...p.deducoes, previdenciaOficial: p.deducoes?.previdenciaOficial ?? sc.inssMensal * 12 },
    ndep,
    par,
  })
  // Imposto pago no exterior é COMPENSADO contra o imposto devido aqui sobre a
  // mesma renda — não é uma dedução paralela do IRPFM.
  const irpfDevido = Math.max(0, declaracao.devido - (vals.exterior_ir || 0))

  const irDefinitivo =
    sc.ir13 +
    sc.irFer +
    FIELDS.filter((f) => f.ir && !f.naDeclaracao).reduce(
      (s, f) => s + (f.key === 'cdb' ? cdbIr : vals[f.ir as string] || 0),
      0,
    )

  const irAntecipado = salIr - sc.ir13 - sc.irFer + (vals.aluguel_ir || 0)
  const deducoes = irpfDevido + irDefinitivo

  let redutor = 0
  if (red && aliqMin > 0) {
    const soma = aliqMin + aliqEmp / 100
    if (soma > limR) redutor = (soma - limR) * (vals.divBR || 0)
  }

  // Uma subtração só, lida dos dois lados: positivo é o que falta pagar,
  // negativo é o que sobrou de retenção. `liquido + (−aRestituir)` reconstrói o
  // saldo — é essa conservação que o teste trava.
  const saldo = bruto - deducoes - redutor
  const liquido = Math.max(0, saldo)
  const aRestituir = Math.max(0, -saldo)
  return {
    base, aliqMin, bruto, deducoes, redutor, liquido, aRestituir,
    irpfDevido, irDefinitivo, irAntecipado: Math.max(0, irAntecipado), declaracao,
    aliqEf: base > 0 ? liquido / base : 0,
    cdbAuto, ...sc,
  }
}
