/**
 * Renda variável: do extrato de operações até o que entra na base do IRPFM.
 *
 * ⚠️ Duas dúvidas de lei atravessam este módulo inteiro, e as duas mudam o
 * resultado (`PLAN-PRECISAO-E-USO.md`, item 1):
 *
 * 1. Ganho líquido em bolsa entra na base do IRPFM? As exclusões do Art. 16-A
 *    § 2º são lista fechada e renda variável não aparece nela — o que puxa para
 *    "entra", pela mesma leitura que já pôs CDB e Tesouro dentro. É leitura,
 *    não texto expresso.
 * 2. A isenção mensal dos R$ 20 mil na venda de ações continua valendo para o
 *    mínimo, ou é isenção do IR comum que não alcança o IRPFM?
 *
 * Por isso `paraBase` recebe as duas leituras como parâmetro e ninguém aqui
 * decide sozinho. O módulo apura o ganho — quem diz o que fazer com ele é a
 * tela, mostrando as duas contas.
 *
 * O que este módulo NÃO sabe, e a tela precisa dizer: corretagem, emolumentos e
 * taxa de liquidação não estão no extrato da B3, então o ganho sai levemente
 * para cima; e operação fora da B3 (exterior, cripto) não passa por aqui.
 */

/**
 * Os três potes de compensação. Prejuízo de um pote não abate lucro de outro:
 * é a regra da apuração, e misturá-los inventaria imposto a menos.
 */
export type Modalidade = 'comum' | 'daytrade' | 'fii'

export const MODALIDADES: Modalidade[] = ['comum', 'daytrade', 'fii']

/** Alíquotas do IR sobre o ganho, por pote. */
export const ALIQUOTAS: Record<Modalidade, number> = {
  comum: 0.15,
  daytrade: 0.20,
  fii: 0.20,
}

/** Teto mensal de vendas abaixo do qual o ganho em ações é isento. */
export const ISENCAO_MENSAL = 20000

export interface Operacao {
  ano: number
  /** 1 a 12. */
  mes: number
  ticker: string
  tipo: 'compra' | 'venda'
  quantidade: number
  precoUnitario: number
  /** Ausente = `comum`. FII e day trade têm pote e alíquota próprios. */
  modalidade?: Modalidade
}

/**
 * Evento que muda a quantidade sem mudar o custo total: desdobro, grupamento,
 * bonificação em ativos. O custo médio por ação muda por consequência, nunca
 * por lançamento próprio.
 */
export interface EventoQuantidade {
  ano: number
  mes: number
  ticker: string
  /** Positivo no desdobro e na bonificação; negativo no grupamento. */
  delta: number
}

export interface Posicao {
  ticker: string
  quantidade: number
  custoMedio: number
}

/**
 * Resumo das vendas do ano por papel: quanto saiu, a que preço médio de
 * venda, com que custo médio de aquisição (o preço médio de COMPRA do lote
 * que foi vendido, não o da posição que sobrou) e o resultado disso.
 *
 * Existe separado de `MesApurado` porque mês×pote mistura papéis — a
 * pergunta "a que preço médio vendi PETR4 este ano" precisa do ticker
 * isolado, e a soma mensal por pote não guarda isso.
 */
export interface VendaTicker {
  ticker: string
  quantidadeVendida: number
  precoMedioVenda: number
  /** Custo médio de aquisição do que foi vendido — não da posição restante. */
  custoMedioNaVenda: number
  resultado: number
}

export interface MesApurado {
  mes: number
  /** Total vendido no mês, por pote. */
  vendas: Record<Modalidade, number>
  /** Ganho (+) ou prejuízo (−) do mês, antes de compensar. */
  resultado: Record<Modalidade, number>
  /** Regra dos R$ 20 mil: vale só para ações fora de day trade. */
  isentoNoMes: boolean
  ganhoIsento: number
  /** Ganho que sobra depois de abater prejuízo acumulado, por pote. */
  tributavel: Record<Modalidade, number>
  ir: number
}

export interface ApuracaoBolsa {
  ano: number
  meses: MesApurado[]
  ganhoTributavel: number
  ganhoIsento: number
  ir: number
  /** O que sobra de prejuízo para levar ao ano seguinte, por pote. */
  prejuizoAcumulado: Record<Modalidade, number>
  /**
   * Papéis cuja venda não tinha custo conhecido. Ficam INTEIROS de fora da
   * conta — não entram nem como ganho nem como prejuízo — e são listados para
   * a pessoa completar. Chutar custo zero aqui inventaria imposto.
   */
  semCusto: string[]
  posicaoFinal: Posicao[]
  /** Uma linha por papel vendido no ano, com preço médio de venda e de custo. */
  vendasPorTicker: VendaTicker[]
}

export interface EntradaBolsa {
  ano: number
  operacoes: Operacao[]
  eventos?: EventoQuantidade[]
  /** Posição em 31/12 do ano anterior, com o custo médio de aquisição. */
  posicaoInicial?: Posicao[]
  /** Prejuízo trazido de anos anteriores, por pote. */
  prejuizoAnterior?: Partial<Record<Modalidade, number>>
}

const zeros = (): Record<Modalidade, number> => ({ comum: 0, daytrade: 0, fii: 0 })

const pote = (o: Operacao): Modalidade => o.modalidade ?? 'comum'

interface Carteira {
  quantidade: number
  custoTotal: number
}

/**
 * Papéis que em algum momento do ano foram vendidos sem custo conhecido.
 *
 * Acontece com quem já tinha carteira antes do primeiro extrato importado: a
 * B3 dá preço de fechamento e valor atualizado, que não são custo de aquisição.
 * A regra é conservadora de propósito — basta uma venda a descoberto de custo
 * para o papel inteiro sair da apuração, porque um custo médio construído pela
 * metade produz ganho errado em todas as outras vendas do mesmo papel.
 */
function tickersSemCusto(e: EntradaBolsa): Set<string> {
  const carteira = new Map<string, Carteira>()
  e.posicaoInicial?.forEach((p) =>
    carteira.set(p.ticker, { quantidade: p.quantidade, custoTotal: p.quantidade * p.custoMedio }),
  )
  const sem = new Set<string>()

  ordenar(e).forEach((lanc) => {
    if ('delta' in lanc) {
      const c = carteira.get(lanc.ticker)
      if (c) c.quantidade += lanc.delta
      return
    }
    const c = carteira.get(lanc.ticker) ?? { quantidade: 0, custoTotal: 0 }
    carteira.set(lanc.ticker, c)
    if (lanc.tipo === 'compra') {
      c.quantidade += lanc.quantidade
      c.custoTotal += lanc.quantidade * lanc.precoUnitario
      return
    }
    // Tolerância de 1e-9: fração de cota de FII vira dízima e não é venda a descoberto.
    if (lanc.quantidade > c.quantidade + 1e-9) sem.add(lanc.ticker)
    const baixa = Math.min(lanc.quantidade, c.quantidade)
    const medio = c.quantidade > 0 ? c.custoTotal / c.quantidade : 0
    c.quantidade -= baixa
    c.custoTotal -= baixa * medio
  })

  return sem
}

/** Lançamentos do ano em ordem de mês, com compra antes de venda no mesmo mês. */
function ordenar(e: EntradaBolsa): (Operacao | EventoQuantidade)[] {
  const doAno = <T extends { ano: number; mes: number }>(l: T[]) => l.filter((x) => x.ano === e.ano)
  const peso = (l: Operacao | EventoQuantidade) =>
    'delta' in l ? 0 : l.tipo === 'compra' ? 1 : 2
  return [...doAno(e.eventos ?? []), ...doAno(e.operacoes)].sort(
    (a, b) => a.mes - b.mes || peso(a) - peso(b),
  )
}

/**
 * Apura o ano: preço médio, ganho por mês e por pote, isenção mensal e
 * compensação de prejuízo.
 *
 * Venda não mexe no custo médio — baixa quantidade e custo na mesma proporção.
 * É isso que faz a venda seguinte do mesmo papel continuar certa.
 */
export function apurarBolsa(e: EntradaBolsa): ApuracaoBolsa {
  const semCusto = tickersSemCusto(e)
  const vale = (ticker: string) => !semCusto.has(ticker)

  const carteira = new Map<string, Carteira>()
  e.posicaoInicial
    ?.filter((p) => vale(p.ticker))
    .forEach((p) =>
      carteira.set(p.ticker, { quantidade: p.quantidade, custoTotal: p.quantidade * p.custoMedio }),
    )

  const vendas: Record<number, Record<Modalidade, number>> = {}
  const resultado: Record<number, Record<Modalidade, number>> = {}
  for (let m = 1; m <= 12; m++) {
    vendas[m] = zeros()
    resultado[m] = zeros()
  }

  // Mesma venda que alimenta `resultado` (mês×pote), somada agora por ticker:
  // é o que dá o preço médio de venda e o custo médio do lote vendido, que a
  // agregação por mês×pote perde ao misturar papéis diferentes no mesmo pote.
  const porTicker = new Map<string, { quantidade: number; valorVenda: number; custoVenda: number }>()

  ordenar(e).forEach((lanc) => {
    if (!vale(lanc.ticker)) return

    if ('delta' in lanc) {
      const c = carteira.get(lanc.ticker)
      if (c) c.quantidade += lanc.delta
      return
    }

    const c = carteira.get(lanc.ticker) ?? { quantidade: 0, custoTotal: 0 }
    carteira.set(lanc.ticker, c)

    if (lanc.tipo === 'compra') {
      c.quantidade += lanc.quantidade
      c.custoTotal += lanc.quantidade * lanc.precoUnitario
      return
    }

    const p = pote(lanc)
    const medio = c.quantidade > 0 ? c.custoTotal / c.quantidade : 0
    const bruto = lanc.quantidade * lanc.precoUnitario
    vendas[lanc.mes][p] += bruto
    resultado[lanc.mes][p] += bruto - lanc.quantidade * medio
    c.quantidade -= lanc.quantidade
    c.custoTotal -= lanc.quantidade * medio

    const t = porTicker.get(lanc.ticker) ?? { quantidade: 0, valorVenda: 0, custoVenda: 0 }
    t.quantidade += lanc.quantidade
    t.valorVenda += bruto
    t.custoVenda += lanc.quantidade * medio
    porTicker.set(lanc.ticker, t)
  })

  const prejuizo: Record<Modalidade, number> = {
    comum: e.prejuizoAnterior?.comum ?? 0,
    daytrade: e.prejuizoAnterior?.daytrade ?? 0,
    fii: e.prejuizoAnterior?.fii ?? 0,
  }

  const meses: MesApurado[] = []
  let ganhoTributavel = 0
  let ganhoIsento = 0
  let ir = 0

  for (let m = 1; m <= 12; m++) {
    // A isenção olha o total VENDIDO no mês, não o lucro, e só alcança ações
    // fora de day trade. Cota de FII nunca é isenta.
    const isentoNoMes = vendas[m].comum > 0 && vendas[m].comum <= ISENCAO_MENSAL
    const tributavel = zeros()
    let irDoMes = 0
    let isentoDoMes = 0

    MODALIDADES.forEach((p) => {
      const r = resultado[m][p]
      if (p === 'comum' && isentoNoMes) {
        // Mês isento não gera imposto — e também não gera prejuízo compensável:
        // o resultado de operação isenta não entra no estoque de prejuízo.
        if (r > 0) isentoDoMes += r
        return
      }
      if (r < 0) {
        prejuizo[p] += -r
        return
      }
      const abate = Math.min(r, prejuizo[p])
      prejuizo[p] -= abate
      tributavel[p] = r - abate
      irDoMes += tributavel[p] * ALIQUOTAS[p]
    })

    meses.push({
      mes: m,
      vendas: vendas[m],
      resultado: resultado[m],
      isentoNoMes,
      ganhoIsento: isentoDoMes,
      tributavel,
      ir: irDoMes,
    })
    ganhoTributavel += MODALIDADES.reduce((s, p) => s + tributavel[p], 0)
    ganhoIsento += isentoDoMes
    ir += irDoMes
  }

  const posicaoFinal = [...carteira.entries()]
    .filter(([, c]) => c.quantidade > 1e-9)
    .map(([ticker, c]) => ({
      ticker,
      quantidade: c.quantidade,
      custoMedio: c.custoTotal / c.quantidade,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))

  const vendasPorTicker: VendaTicker[] = [...porTicker.entries()]
    .map(([ticker, v]) => ({
      ticker,
      quantidadeVendida: v.quantidade,
      precoMedioVenda: v.valorVenda / v.quantidade,
      custoMedioNaVenda: v.custoVenda / v.quantidade,
      resultado: v.valorVenda - v.custoVenda,
    }))
    .sort((a, b) => a.ticker.localeCompare(b.ticker))

  return {
    ano: e.ano,
    meses,
    ganhoTributavel,
    ganhoIsento,
    ir,
    prejuizoAcumulado: prejuizo,
    semCusto: [...semCusto].sort(),
    posicaoFinal,
    vendasPorTicker,
  }
}

/**
 * Do ganho apurado para a base do IRPFM, nas duas leituras em aberto.
 *
 * `isentoEntraNaBase` é a segunda dúvida: se a isenção dos R$ 20 mil for do IR
 * comum e não alcançar o mínimo, aquele ganho isento vira base também.
 *
 * O IR pago (15/20%) volta como dedução, do mesmo jeito que o IRRF do JCP e o
 * da renda fixa — é imposto já recolhido sobre renda que está na base.
 */
/**
 * Entrada da apuração ENCADEADA — vários anos, um atrás do outro.
 *
 * Diferente de `EntradaBolsa`: aqui não há um `ano`, porque a série apura todos
 * os que aparecem nas operações. `posicaoInicial` e `prejuizoAnterior` valem
 * para antes do PRIMEIRO ano, não para cada um.
 */
export interface EntradaSerie {
  operacoes: Operacao[]
  eventos?: EventoQuantidade[]
  /** Posição antes do primeiro ano: papéis comprados antes do que o extrato cobre. */
  posicaoInicial?: Posicao[]
  /** Prejuízo trazido de antes do primeiro ano. */
  prejuizoAnterior?: Partial<Record<Modalidade, number>>
  /** Apurar até aqui mesmo sem operação no ano — o ano-base, tipicamente. */
  ate?: number
  /**
   * Anos a apurar mesmo sem operação neles.
   *
   * O confronto com a declaração precisa disto: um ano em que não houve negócio
   * nenhum continua tendo posição em 31/12 — a que veio do ano anterior — e é
   * essa que a declaração daquele ano informa. Sem estes anos, o ano parado
   * simplesmente não era conferido.
   */
  anosExtras?: number[]
}

/**
 * Apura ano a ano, encadeando o que a lei encadeia.
 *
 * Apurar um ano isolado é errado por dois motivos, e os dois custam imposto:
 *
 *   · o CUSTO MÉDIO vem das compras dos anos anteriores. Uma ação comprada em
 *     2023 e vendida em 2026, apurada só em 2026, aparece como venda sem custo
 *     conhecido — o papel inteiro sai da conta, e a compra de 2023 fica guardada
 *     sem servir para nada;
 *   · o PREJUÍZO de um ano abate o ganho do seguinte, sem prazo. Sem a cadeia,
 *     ele some e o imposto sai maior do que é.
 *
 * A posição final de cada ano vira a inicial do próximo, e o prejuízo
 * acumulado vira o anterior. É por isso que a série existe em vez de um
 * seletor de ano por cima de `apurarBolsa`.
 */
export function apurarSerie(e: EntradaSerie): ApuracaoBolsa[] {
  const anos = [
    ...new Set([
      ...e.operacoes.map((o) => o.ano),
      ...(e.eventos ?? []).map((v) => v.ano),
      ...(e.ate === undefined ? [] : [e.ate]),
      ...(e.anosExtras ?? []),
    ]),
  ].sort((a, b) => a - b)

  let posicaoInicial = e.posicaoInicial
  let prejuizoAnterior = e.prejuizoAnterior
  const saida: ApuracaoBolsa[] = []
  for (const ano of anos) {
    const a = apurarBolsa({ ano, operacoes: e.operacoes, eventos: e.eventos, posicaoInicial, prejuizoAnterior })
    saida.push(a)
    posicaoInicial = a.posicaoFinal
    prejuizoAnterior = a.prejuizoAcumulado
  }
  return saida
}

export function paraBase(
  ap: ApuracaoBolsa,
  opcoes: { entraNaBase: boolean; isentoEntraNaBase: boolean },
): { base: number; deducao: number } {
  if (!opcoes.entraNaBase) return { base: 0, deducao: 0 }
  return {
    base: ap.ganhoTributavel + (opcoes.isentoEntraNaBase ? ap.ganhoIsento : 0),
    deducao: ap.ir,
  }
}
