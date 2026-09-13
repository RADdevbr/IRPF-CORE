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
 * Os potes de compensação. Prejuízo de um pote não abate lucro de outro: é a
 * regra da apuração, e misturá-los inventaria imposto a menos.
 *
 * `etf` existe porque ETF de ações não é ação nem é FII, e caía sempre no pote
 * errado: em `comum` ganhava a isenção mensal dos R$ 20 mil, que ETF não tem;
 * marcado como fundo pelo sufixo 11, pagava 20% em vez de 15%. São dois erros
 * de sinais opostos, e nenhum deles se resolve escolhendo o «menos errado» —
 * a alíquota é 15% e a isenção não existe.
 *
 * ETF de renda fixa tem regra própria (25%/20%/15% por prazo) e NÃO cabe aqui:
 * quem tiver um continua lançando à mão, e a tela diz isso.
 */
export type Modalidade = 'comum' | 'daytrade' | 'fii' | 'etf'

export const MODALIDADES: Modalidade[] = ['comum', 'daytrade', 'fii', 'etf']

/**
 * A soma dos potes.
 *
 * Existe porque cinco lugares somavam `comum + daytrade + fii` à mão, e um pote
 * novo entraria no app inteiro sendo INVISÍVEL em todos eles — vendido, ganho e
 * imposto de ETF sumindo do painel, da memória de cálculo e da base realizada
 * sem uma linha de erro. Derivar de `MODALIDADES` é o que faz o próximo pote
 * aparecer sozinho.
 */
export const somaPotes = (r: Record<Modalidade, number>): number =>
  MODALIDADES.reduce((s, p) => s + (r[p] || 0), 0)

/** O nome de cada pote na tela, para não haver dois vocabulários. */
export const NOME_MODALIDADE: Record<Modalidade, string> = {
  comum: 'ações (comum)',
  daytrade: 'day trade',
  fii: 'FII',
  etf: 'ETF de ações',
}

/** Alíquotas do IR sobre o ganho, por pote. */
export const ALIQUOTAS: Record<Modalidade, number> = {
  comum: 0.15,
  daytrade: 0.20,
  fii: 0.20,
  // ETF de ações: 15%, como ação — e, ao contrário dela, sem a isenção mensal.
  etf: 0.15,
}

/** Teto mensal de vendas abaixo do qual o ganho em ações é isento. */
export const ISENCAO_MENSAL = 20000

export interface Operacao {
  ano: number
  /** 1 a 12. */
  mes: number
  /**
   * `dd/mm/aaaa`. Ausente = a fonte não trouxe dia (Consolidado Anual, extrato
   * antigo, lançamento digitado à mão).
   *
   * É o que permite a ordem cronológica de verdade dentro do mês — ver
   * `ordenar`, que só a usa onde ela existe para o papel inteiro.
   */
  data?: string
  ticker: string
  tipo: 'compra' | 'venda'
  quantidade: number
  precoUnitario: number
  /**
   * Corretagem, emolumentos e taxa de liquidação desta ordem, quando a fonte
   * traz (o ReVar traz; o Extrato de Movimentação não).
   *
   * Na compra entram no custo de aquisição; na venda saem do resultado — e
   * NÃO do valor de alienação, que é o que a isenção mensal olha. Ver o
   * comentário do razão em `apurarBolsa`.
   */
  custos?: number
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
  /** `dd/mm/aaaa`, mesmo contrato de `Operacao.data`. */
  data?: string
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

/**
 * Uma venda, como ela aconteceu. O razão por trás de `MesApurado`.
 *
 * Existe porque o agregado por mês × pote não é conferível: a pessoa lê «março
 * deu R$ 4.212 de ganho» e não tem como saber quais vendas somam isso, com que
 * custo médio cada uma saiu, e qual delas caiu na isenção. Um número de imposto
 * que não dá para abrir é um número que ninguém consegue contestar — nem quando
 * está errado.
 *
 * É também a entrada do dossiê da carteira, que descreve resultado em percentual
 * sobre o custo baixado.
 */
export interface VendaEvento {
  /** `dd/mm/aaaa` quando a fonte trouxe o dia. */
  data?: string
  ano: number
  mes: number
  ticker: string
  modalidade: Modalidade
  quantidade: number
  /** Preço unitário da venda, BRUTO — os custos não entram aqui. */
  precoVenda: number
  /** Custo médio do papel NO MOMENTO desta venda, não o da posição que sobrou. */
  custoMedioNaVenda: number
  /**
   * Fração da posição do papel que saiu nesta venda, 0..1, medida ANTES da
   * baixa. Vender tudo dá 1.
   */
  parteDaPosicao: number
  /** `quantidade × precoVenda`. É o valor de alienação, que a isenção olha. */
  valorVenda: number
  /** `quantidade × custoMedioNaVenda`. */
  custoBaixado: number
  /** Corretagem e emolumentos desta ordem. 0 quando a fonte não traz. */
  custos: number
  /** `valorVenda − custoBaixado − custos`. */
  resultado: number
  /**
   * `resultado ÷ custoBaixado`. `null` quando o custo baixado é zero — papel
   * que entrou na carteira a custo nenhum não tem percentual, e devolver 0 ali
   * esconderia um ganho inteiro.
   */
  resultadoPct: number | null
  /**
   * Esta venda caiu na isenção mensal dos R$ 20 mil.
   *
   * Só o pote `comum`: FII e ETF não têm a isenção, e day trade também não.
   * Por isso o campo é da VENDA e não do mês — num mês isento com venda de FII
   * ao lado, marcar as duas seria afirmar uma isenção que uma delas não tem.
   */
  isenta: boolean
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
  /**
   * O razão: uma linha por venda, na ordem em que aconteceram. `meses` e
   * `vendasPorTicker` são somas DESTA lista, não contas paralelas.
   */
  vendas: VendaEvento[]
  /**
   * Lançamentos descartados por não terem mês de 1 a 12.
   *
   * Existia como CRASH: o fold do razão indexa `vendas[mes]`, que só tem as
   * chaves 1..12, e uma planilha com o mês ilegível derrubava a apuração
   * inteira com um TypeError. Sai contado, como o `ignorados` da série de
   * proventos — um lançamento perdido é dinheiro que some, e some visível.
   */
  ignorados: number
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

const zeros = (): Record<Modalidade, number> => ({ comum: 0, daytrade: 0, fii: 0, etf: 0 })

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
  // SÓ quantidade. Este passo decide uma coisa só — houve venda sem custo? — e
  // ela é decidida por quantidade. A versão anterior mantinha um `custoTotal`
  // que ninguém lia e que, desde que `apurarBolsa` passou a somar `custos` na
  // compra, já divergia do custo de verdade: dois razões que deviam concordar,
  // um deles calado e errado, esperando o próximo leitor confiar nele.
  const quantidades = new Map<string, number>()
  e.posicaoInicial?.forEach((p) => quantidades.set(p.ticker, p.quantidade))
  const sem = new Set<string>()

  ordenar(e).forEach((lanc) => {
    const atual = quantidades.get(lanc.ticker) ?? 0
    if ('delta' in lanc) {
      if (quantidades.has(lanc.ticker)) quantidades.set(lanc.ticker, atual + lanc.delta)
      return
    }
    if (lanc.tipo === 'compra') {
      quantidades.set(lanc.ticker, atual + lanc.quantidade)
      return
    }
    // Tolerância de 1e-9: fração de cota de FII vira dízima e não é venda a descoberto.
    if (lanc.quantidade > atual + 1e-9) sem.add(lanc.ticker)
    quantidades.set(lanc.ticker, atual - Math.min(lanc.quantidade, atual))
  })

  return sem
}

/**
 * Dia de uma data `dd/mm/aaaa`. `null` quando não há data, ou ela não é essa.
 *
 * Aceita um dígito no dia e no mês (`3/5/2026`), que é como um CSV exportado de
 * planilha costuma sair. A máscara estrita de dois dígitos rebaixava o papel
 * INTEIRO para a heurística de mês por causa de uma linha — e sem dizer,
 * porque a demoção não tinha contador.
 */
function diaDe(data: string | undefined): number | null {
  if (data === undefined) return null
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(data)
  if (m === null) return null
  const dia = Number(m[1])
  const mes = Number(m[2])
  return dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 ? dia : null
}

/**
 * Papéis cujos lançamentos do ano TODOS trazem dia legível.
 *
 * A ordem cronológica é a certa — o custo médio de uma venda é o da data dela,
 * e não o de depois de uma compra que ainda não aconteceu. Mas ela só pode
 * valer onde o dia existe para o papel inteiro: com metade dos lançamentos
 * datados, a outra metade ordenaria no dia 0 e uma compra do dia 20 passaria a
 * vir antes de uma venda do dia 3 — pior que a heurística que ela substitui.
 *
 * Por PAPEL, e não por arquivo, porque cada papel tem a sua carteira: um
 * extrato velho sem data para PETR4 não tem por que rebaixar VALE3.
 *
 * É esta função que faz estado gravado antes da data abrir com o mesmo número.
 */
function tickersComDia(lancamentos: (Operacao | EventoQuantidade)[]): Set<string> {
  const sem = new Set<string>()
  lancamentos.forEach((l) => {
    if (diaDe(l.data) === null) sem.add(l.ticker)
  })
  return new Set(lancamentos.map((l) => l.ticker).filter((t) => !sem.has(t)))
}

/**
 * Lançamentos do ano em ordem: mês, depois dia (onde há), depois evento antes
 * de compra e compra antes de venda.
 *
 * O peso desempata o mesmo dia e é a ordem INTEIRA onde não há dia — que é a
 * heurística antiga, preservada de propósito. Ela erra para o lado seguro:
 * adiantar a compra garante custo disponível, e inventar prejuízo é pior que
 * adiar ganho.
 *
 * A ordem ENTRE papéis diferentes não muda conta nenhuma: cada papel tem a sua
 * carteira, e o total do mês soma na ordem que vier. Basta que a ordem DENTRO
 * de cada papel esteja certa — e é por isso que o dia 0 dos papéis fora do modo
 * cronológico não estraga os que estão dentro.
 */
export const mesValido = (l: { mes: number }) => Number.isInteger(l.mes) && l.mes >= 1 && l.mes <= 12

function ordenar(e: EntradaBolsa): (Operacao | EventoQuantidade)[] {
  const doAno = <T extends { ano: number; mes: number }>(l: T[]) =>
    l.filter((x) => x.ano === e.ano && mesValido(x))
  const todos = [...doAno(e.eventos ?? []), ...doAno(e.operacoes)]
  const comDia = tickersComDia(todos)
  const peso = (l: Operacao | EventoQuantidade) =>
    'delta' in l ? 0 : l.tipo === 'compra' ? 1 : 2
  const dia = (l: Operacao | EventoQuantidade) =>
    comDia.has(l.ticker) ? (diaDe(l.data) ?? 0) : 0
  return todos.sort((a, b) => a.mes - b.mes || dia(a) - dia(b) || peso(a) - peso(b))
}

/**
 * Apura o ano: preço médio, ganho por mês e por pote, isenção mensal e
 * compensação de prejuízo.
 *
 * Venda não mexe no custo médio — baixa quantidade e custo na mesma proporção.
 * É isso que faz a venda seguinte do mesmo papel continuar certa.
 */
export function apurarBolsa(e: EntradaBolsa): ApuracaoBolsa {
  const doAno = <T extends { ano: number; mes: number }>(l: readonly T[]) => l.filter((x) => x.ano === e.ano)
  const ignorados =
    doAno(e.operacoes).filter((o) => !mesValido(o)).length +
    doAno(e.eventos ?? []).filter((v) => !mesValido(v)).length

  const semCusto = tickersSemCusto(e)
  const vale = (ticker: string) => !semCusto.has(ticker)

  const carteira = new Map<string, Carteira>()
  e.posicaoInicial
    ?.filter((p) => vale(p.ticker))
    .forEach((p) =>
      carteira.set(p.ticker, { quantidade: p.quantidade, custoTotal: p.quantidade * p.custoMedio }),
    )

  /**
   * O razão, montado enquanto a carteira anda. Tudo o mais desta função é soma
   * dele: `vendas[mês][pote]`, `resultado[mês][pote]` e `vendasPorTicker`.
   *
   * Eram três contas em paralelo dentro deste mesmo laço, e nada impedia que
   * divergissem — a mais fina, que é a única conferível, nem existia. Com o
   * razão como fonte, o invariante «o mês é a soma das suas vendas» deixa de
   * ser algo a testar e passa a ser algo que não tem como ser falso.
   */
  const razao: VendaEvento[] = []

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
      // Corretagem e emolumentos da compra entram no custo de aquisição, que é
      // onde a lei os põe — e é o que faz o ganho da venda seguinte sair certo.
      c.custoTotal += lanc.quantidade * lanc.precoUnitario + (lanc.custos ?? 0)
      return
    }

    const medio = c.quantidade > 0 ? c.custoTotal / c.quantidade : 0
    // BRUTO, e de propósito: é o valor de alienação, e é ele que a isenção dos
    // R$ 20 mil olha. Descontar os custos aqui empurraria para dentro da
    // isenção uma venda que a lei deixa de fora — mover a fronteira dos 20 mil
    // por causa de corretagem é inventar isenção.
    const valorVenda = lanc.quantidade * lanc.precoUnitario
    const custoBaixado = lanc.quantidade * medio
    const custos = lanc.custos ?? 0
    const resultadoDaVenda = valorVenda - custoBaixado - custos

    razao.push({
      data: lanc.data,
      ano: lanc.ano,
      mes: lanc.mes,
      ticker: lanc.ticker,
      modalidade: pote(lanc),
      quantidade: lanc.quantidade,
      precoVenda: lanc.precoUnitario,
      custoMedioNaVenda: medio,
      parteDaPosicao: c.quantidade > 0 ? Math.min(1, lanc.quantidade / c.quantidade) : 0,
      valorVenda,
      custoBaixado,
      custos,
      resultado: resultadoDaVenda,
      resultadoPct: custoBaixado > 0 ? resultadoDaVenda / custoBaixado : null,
      // O mês ainda não fechou; quem decide isto é o laço da isenção, abaixo.
      isenta: false,
    })

    c.quantidade -= lanc.quantidade
    c.custoTotal -= custoBaixado
  })

  const vendas: Record<number, Record<Modalidade, number>> = {}
  const resultado: Record<number, Record<Modalidade, number>> = {}
  for (let m = 1; m <= 12; m++) {
    vendas[m] = zeros()
    resultado[m] = zeros()
  }
  razao.forEach((v) => {
    vendas[v.mes][v.modalidade] += v.valorVenda
    resultado[v.mes][v.modalidade] += v.resultado
  })

  const prejuizo: Record<Modalidade, number> = {
    comum: e.prejuizoAnterior?.comum ?? 0,
    daytrade: e.prejuizoAnterior?.daytrade ?? 0,
    fii: e.prejuizoAnterior?.fii ?? 0,
    etf: e.prejuizoAnterior?.etf ?? 0,
  }

  const meses: MesApurado[] = []
  let ganhoTributavel = 0
  let ganhoIsento = 0
  let ir = 0

  for (let m = 1; m <= 12; m++) {
    // A isenção olha o total VENDIDO no mês, não o lucro, e só alcança ações
    // fora de day trade. Cota de FII nunca é isenta, e cota de ETF também não —
    // por isso `vendas[m].comum`, e não a soma do mês: incluir ETF aqui daria a
    // ele uma isenção que a lei não dá, e ainda faria uma venda de ETF empurrar
    // a venda de ações para fora da isenção que ela tem.
    const isentoNoMes = vendas[m].comum > 0 && vendas[m].comum <= ISENCAO_MENSAL
    // Só o pote comum: é dele a isenção, e marcar a venda de FII do mesmo mês
    // afirmaria uma isenção que ela não tem.
    if (isentoNoMes) {
      razao.forEach((v) => {
        if (v.mes === m && v.modalidade === 'comum') v.isenta = true
      })
    }
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

  // A mesma venda do razão, somada por papel: é o que dá o preço médio de
  // venda e o custo médio do lote vendido, que a agregação por mês × pote perde
  // ao misturar papéis diferentes dentro do mesmo pote.
  const porTicker = new Map<string, { quantidade: number; valorVenda: number; custoVenda: number; custos: number }>()
  razao.forEach((v) => {
    const t = porTicker.get(v.ticker) ?? { quantidade: 0, valorVenda: 0, custoVenda: 0, custos: 0 }
    t.quantidade += v.quantidade
    t.valorVenda += v.valorVenda
    t.custoVenda += v.custoBaixado
    t.custos += v.custos
    porTicker.set(v.ticker, t)
  })

  const vendasPorTicker: VendaTicker[] = [...porTicker.entries()]
    .map(([ticker, v]) => ({
      ticker,
      quantidadeVendida: v.quantidade,
      precoMedioVenda: v.valorVenda / v.quantidade,
      custoMedioNaVenda: v.custoVenda / v.quantidade,
      resultado: v.valorVenda - v.custoVenda - v.custos,
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
    vendas: razao,
    ignorados,
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
