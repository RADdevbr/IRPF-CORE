// Dividendos: a grade [mês × pagador] e a retenção do Art. 6º-A.
//
// Saiu de `calc/ytd.ts`, onde convivia com a projeção YTD da renda. As duas
// coisas moravam juntas por terem nascido juntas, mas respondem a perguntas de
// donos diferentes: a projeção é do app de estimativa do IRPFM ("com o que já
// recebi, onde fecho o ano?"), e a grade é do MODELO — quem importa o extrato da
// B3 precisa dela para reconstituir o dividendo bruto, e quem projeta o imposto
// precisa dela para saber quanto foi retido.
//
// Duas decisões que mudam número, e que é por isso que isto é um só lugar:
//
//   · O gatilho dos R$ 50 mil é POR PAGADOR E POR MÊS. A grade não soma
//     pagadores e não soma o ano: agregar inventaria uma retenção que ninguém
//     sofreu, ou joga fora uma que aconteceu.
//   · A retenção só existe a partir do ano-base de `DIV_ANO_RETENCAO`. Antes
//     dele o valor creditado já é o bruto.

export type Method = 'runrate' | 'last' | 'manual'

export interface DivPJ {
  nome: string
  /**
   * Renda do MESMO pagador que entra na base e NÃO entra no gatilho mensal —
   * hoje, o JCP. Bruto por mês (12 posições).
   *
   * Mora na PJ, e não numa matriz paralela a `cells`, porque a tela adiciona e
   * remove coluna: uma segunda matriz sairia de alinhamento no primeiro «tirar
   * PJ» e passaria o JCP de uma companhia para outra.
   *
   * Está aqui porque o gatilho do Art. 6º-A é do dividendo. O JCP sofre 15% na
   * fonte, por conta própria; somá-lo na célula do dividendo fazia o app cobrar
   * 10% de quem recebeu R$ 30 mil de dividendo e R$ 25 mil de JCP no mês — uma
   * retenção que ninguém sofreu — e, do outro lado, jogava fora os 15% que
   * abatem o IRPFM.
   */
  jcp?: number[]
  /** IRRF já retido nesse JCP, mês a mês. É dedução do próprio IRPFM. */
  jcpIr?: number[]
}

export interface DivGrid {
  mode: 'anual' | 'ytd'
  pjs: DivPJ[]
  cells: number[][] // [pjIndex][mês 0..11] — valores realizados (dividendos são mensais)
  method: Method
  manualMonthly: number[] // projeção da média mensal por PJ (method='manual')
}

// Dividendos: gatilho e alíquota do IRRF mensal (Art. 6º-A, Lei 15.270/2025).
export const DIV_TRIGGER = 50000

export const DIV_ALIQ = 0.1

/**
 * Primeiro ano-base em que o dividendo pago à pessoa física sofre retenção na
 * fonte.
 *
 * Antes disso o valor creditado no extrato JÁ É o bruto: não há o que
 * reconstituir, e reconstituir inventaria imposto que ninguém pagou. É por isso
 * que a reconstituição precisa saber o ano, e é por isso que ela mora no
 * caminho do extrato — que tem data — e não na grade, que não tem.
 */
export const DIV_ANO_RETENCAO = 2026

export const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export interface DivPjResult {
  nome: string
  /** JCP bruto do ano e o IRRF que veio com ele — fora do gatilho mensal. */
  jcpAnual: number
  jcpIr: number
  /** A parte do JCP que caiu nos meses já fechados. */
  jcpRealizado: number
  sumRealizado: number
  irrfRealizado: number
  /** Estimativa mensal aplicada aos meses futuros ainda em branco. */
  futMensal: number
  futTotal: number
  irrfFuturo: number
  annual: number
  irrf: number
  /** Os 12 meses já resolvidos: lançado onde há valor, estimado no resto. */
  mensal: number[]
  /** Quais dos 12 vieram de estimativa — a tela mostra esses em cinza. */
  estimados: boolean[]
}

export interface DivResult {
  pjs: DivPjResult[]
  annual: number
  realized: number
  irrf: number
  /** Quantos meses do ano já têm valor lançado (fechados ou digitados à frente). */
  mesesComLancamento: number
}

const irrfDoMes = (v: number) => (v > DIV_TRIGGER ? DIV_ALIQ * v : 0)

/**
 * Projeção dos dividendos pela grade [mês × PJ].
 *
 * A grade tem os 12 meses sempre: o usuário vai lançando conforme o ano corre e
 * a estimativa anual se ajusta sozinha. Cada mês resolve assim:
 *   · até o mês de referência → o que foi lançado (realizado);
 *   · depois dele, com valor digitado → esse valor (planejado por você);
 *   · depois dele, em branco → a estimativa do método escolhido.
 *
 * Antes, valor digitado além do mês de referência era IGNORADO — quem lançasse
 * um mês à frente via o número sumir da conta.
 *
 * O IRRF é calculado mês a mês (Art. 6º-A: 10% sobre o total pago no mês quando
 * a mesma PJ passa de R$ 50k), então concentrar ou pulverizar muda o resultado.
 */
export function divProjection(grid: DivGrid, mesRef: number): DivResult {
  const k = Math.max(0, Math.min(12, mesRef))
  const pjs = grid.pjs.map((pj, j) => {
    const row = grid.cells[j] || []
    const realizados: number[] = []
    for (let m = 0; m < k; m++) realizados.push(row[m] || 0)
    const sumRealizado = realizados.reduce((s, x) => s + x, 0)
    const irrfRealizado = realizados.reduce((s, x) => s + irrfDoMes(x), 0)

    // Estimativa para os meses futuros que continuam em branco.
    let futMensal = grid.manualMonthly[j] || 0
    if (k > 0) {
      if (grid.method === 'runrate') futMensal = sumRealizado / k
      else if (grid.method === 'last') futMensal = realizados[k - 1] || 0
    }

    const mensal: number[] = []
    const estimados: boolean[] = []
    for (let m = 0; m < 12; m++) {
      if (m < k) {
        mensal.push(row[m] || 0)
        estimados.push(false)
      } else {
        const digitado = row[m] || 0
        mensal.push(digitado > 0 ? digitado : futMensal)
        estimados.push(!(digitado > 0))
      }
    }

    const futuros = mensal.slice(k)
    const futTotal = futuros.reduce((s, x) => s + x, 0)
    const irrfFuturo = futuros.reduce((s, x) => s + irrfDoMes(x), 0)

    // O JCP entra pelo que foi lançado, e não é projetado: ele vem do extrato,
    // que só tem o passado. Projetá-lo pela média do dividendo suporia um
    // pagamento que não é o mesmo evento nem tem o mesmo calendário. Fica de
    // fora de `sumRealizado` porque é dali que sai a média do run-rate — somá-lo
    // ali inflaria a projeção dos meses futuros de dividendo.
    const jcpMeses = pj.jcp ?? []
    const jcpIrMeses = pj.jcpIr ?? []
    const soma = (v: number[], ate = 12) => v.slice(0, ate).reduce((s, x) => s + (x || 0), 0)
    const jcpAnual = soma(jcpMeses)
    const jcpIr = soma(jcpIrMeses)

    return {
      nome: pj.nome,
      jcpAnual,
      jcpIr,
      jcpRealizado: soma(jcpMeses, k),
      sumRealizado,
      irrfRealizado,
      futMensal,
      futTotal,
      irrfFuturo,
      annual: sumRealizado + futTotal + jcpAnual,
      irrf: irrfRealizado + irrfFuturo + jcpIr,
      mensal,
      estimados,
    }
  })

  // Um mês conta como lançado quando qualquer PJ tem valor nele.
  let mesesComLancamento = 0
  for (let m = 0; m < 12; m++) {
    const temDividendo = grid.pjs.some((_, j) => (grid.cells[j]?.[m] || 0) > 0)
    const temJcp = grid.pjs.some((p) => (p.jcp?.[m] || 0) > 0)
    if (temDividendo || temJcp) mesesComLancamento += 1
  }

  return {
    pjs,
    annual: pjs.reduce((s, p) => s + p.annual, 0),
    realized: pjs.reduce((s, p) => s + p.sumRealizado + p.jcpRealizado, 0),
    irrf: pjs.reduce((s, p) => s + p.irrf, 0),
    mesesComLancamento,
  }
}

export function defDivGrid(): DivGrid {
  return { mode: 'anual', pjs: [{ nome: 'PJ 1' }], cells: [[]], method: 'runrate', manualMonthly: [] }
}
