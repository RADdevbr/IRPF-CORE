// Consistência patrimonial: o patrimônio cresceu mais do que a renda explica?
//
// É a conta que a Receita faz sozinha ao cruzar declarações — "acréscimo
// patrimonial a descoberto". Fazer a conta ANTES serve para achar o que faltou
// declarar (uma venda, um empréstimo, uma herança, um resgate) enquanto ainda dá
// para corrigir, não depois da intimação.
//
// Nada aqui acusa ninguém de nada. Diferença sem cobertura quase sempre é
// informação faltando, não irregularidade — e o app não tem como saber a
// diferença. Por isso a saída é "revisar isto", nunca "você sonegou".
//
// Duas decisões de modelagem que mudam o número:
//
// 1. Usamos a VARIAÇÃO do patrimônio, não as aquisições do ano. Nesse formato o
//    dinheiro que estava na conta em janeiro e foi gasto já entra como queda de
//    saldo — somá-lo de novo como "recurso disponível" contaria duas vezes o
//    mesmo dinheiro e esconderia buraco real.
// 2. O .DEC que o app lê não traz dívidas e ônus. Sem elas, um bem financiado
//    parece crescimento que a renda não cobre. Por isso dívidas são informadas
//    à mão, por ano, e o app avisa quando não foram.

import type { Historico } from './historico'

/** O que só a pessoa sabe — o arquivo não conta. */
export interface EntradaAno {
  /**
   * Veio do preenchimento rápido, não de um número conferido.
   *
   * Marcar importa por dois motivos: a tela mostra que aquilo é chute, e o
   * preenchimento rápido só sobrescreve o que ele mesmo escreveu — número
   * digitado à mão nunca é apagado por uma estimativa.
   */
  estimado?: boolean | { despesas?: boolean; dividas?: boolean }
  /** Dívidas e ônus no fim do ano (financiamentos, empréstimos a pagar). */
  dividas?: number
  /** Venda de bens, empréstimos tomados, doações e heranças recebidas, resgates. */
  receitasNaoRecorrentes?: number
  /** Custo de vida, impostos pagos, doações feitas — o que saiu e não virou bem. */
  despesas?: number
  /** Nota livre, para lembrar de onde veio o número. */
  nota?: string
}

export type Entradas = Record<string, EntradaAno> // chave: anoBase

export type CampoEstimavel = 'despesas' | 'dividas'

/**
 * Aquele campo daquele ano veio de estimativa?
 *
 * Aceita o formato antigo (`estimado: true` valendo para o ano inteiro) porque
 * estado já gravado não se joga fora. A marca virou por campo pelo motivo que
 * apareceu no uso: quem ajustava o custo de vida de um ano perdia o ajuste no
 * preenchimento rápido seguinte, porque o ano continuava marcado como chute.
 */
export function foiEstimado(e: EntradaAno | undefined, campo: CampoEstimavel): boolean {
  if (!e || e.estimado === undefined) return false
  if (typeof e.estimado === 'boolean') return e.estimado
  return e.estimado[campo] === true
}

const comMarca = (e: EntradaAno, campo: CampoEstimavel, valor: boolean): EntradaAno => {
  const atual: { despesas?: boolean; dividas?: boolean } =
    typeof e.estimado === 'boolean' ? { despesas: e.estimado, dividas: e.estimado } : { ...(e.estimado ?? {}) }
  atual[campo] = valor
  return { ...e, estimado: atual }
}

/**
 * Valor digitado à mão para um ano — e a marca de estimativa daquele campo cai.
 *
 * É o que garante o ajuste ano a ano: variação de custo de vida entre anos é a
 * regra, não a exceção, e o número que a pessoa digitou tem de sobreviver ao
 * próximo preenchimento rápido.
 */
export function definirCampo(
  entradas: Entradas,
  ano: number,
  campo: 'despesas' | 'dividas' | 'receitasNaoRecorrentes',
  valor: number,
): Entradas {
  const chave = String(ano)
  const atual = entradas[chave] ?? {}
  const base: EntradaAno =
    campo === 'receitasNaoRecorrentes' ? { ...atual } : comMarca(atual, campo, false)
  return { ...entradas, [chave]: { ...base, [campo]: valor } }
}

export type Classificacao = 'compatível' | 'atenção' | 'inconsistência relevante'

export interface AnoAnalisado {
  anoBase: number
  patrimonioInicial: number
  patrimonioFinal: number
  dividasInicial: number
  dividasFinal: number
  liquidoInicial: number
  liquidoFinal: number
  evolucao: number
  rendimentos: number
  receitasNaoRecorrentes: number
  fontes: number
  despesas: number
  necessidade: number
  saldo: number
  descoberto: number
  /** Fração do descoberto sobre as fontes (0 a 1). Sem fontes, 1. */
  proporcao: number
  classificacao: Classificacao
  /** Primeiro ano importado não tem com o que comparar. */
  semAnoAnterior: boolean
  /** Não dá para afirmar nada sem custo de vida informado. */
  semDespesas: boolean
  semDividas: boolean
  /**
   * Pagamentos que a própria declaração informa (plano de saúde, previdência,
   * instrução…). É despesa REAL, saída do bolso que não virou patrimônio — e a
   * única parte do custo de vida que não precisa de chute.
   */
  pagamentosDeclarados: number
  /** Cada linha, para a pessoa reconhecer pelo nome de quem recebeu. */
  pagamentos: { codigo: string; beneficiario: string; valor: number }[]
  /**
   * Este ano foi importado antes de o app saber ler pagamentos.
   *
   * Não é o mesmo que "não pagou nada": o arquivo pode ter, e o histórico salvo
   * simplesmente não guardou. Sem esta distinção a tela ficava muda e a pessoa
   * ia procurar um bloco que nunca ia aparecer.
   */
  importadoSemPagamentos: boolean
}

export interface Consolidado {
  anos: AnoAnalisado[]
  totalFontes: number
  totalNecessidade: number
  totalDescoberto: number
  /** Anos com descoberto, do maior para o menor. */
  prioritarios: AnoAnalisado[]
  /** Descobertos em anos seguidos — o padrão que muda a leitura. */
  sequenciaRecorrente: boolean
  /** Sobra acumulada dos anos anteriores que poderia cobrir o buraco. */
  folgaAcumuladaCobre: boolean
  /** Buracos na série: o patrimônio final de um ano não é o inicial do seguinte. */
  descontinuidades: Descontinuidade[]
  /** O que falta informar para a conta valer alguma coisa. */
  faltando: string[]
}

/** Um bem e quanto ELE contribuiu para o degrau entre dois anos. */
export interface ItemDegrau {
  id: string
  descricao: string
  /** Positivo: entrou saldo que o ano anterior não tinha. Negativo: sumiu. */
  diferenca: number
  motivo: 'apareceu' | 'sumiu' | 'saldo-nao-bate'
  /** O que o ano seguinte diz que era o saldo anterior deste bem. */
  declarado: number
  /** O que o ano anterior fechou para o mesmo bem. */
  fechado: number
}

export interface Descontinuidade {
  de: number
  para: number
  diferenca: number
  /** Quem causou, do maior para o menor em valor absoluto. */
  itens: ItemDegrau[]
}

/**
 * Piso de relevância. Abaixo disto a diferença não vira "inconsistência
 * relevante" nem com percentual alto: num patrimônio de milhões, R$ 20 mil de
 * diferença é arredondamento de classificação, não sinal de nada.
 */
export const PISO_RELEVANCIA = 50_000

/**
 * Abaixo de um real, não é diferença.
 *
 * A soma de dezenas de saldos em ponto flutuante não fecha exatamente: quem
 * informa a entrada que cobre o buraco na vírgula acabava vendo "R$ 0,00 sem
 * cobertura" classificado como atenção — alarme sobre nada.
 */
const FOLGA = 1

/** Acima disto a insuficiência deixa de ser ruído, se passar do piso. */
export const PROPORCAO_RELEVANTE = 0.2

/** Rendas que o .DEC informa. FII entra: é renda recebida, ainda que isenta. */
function rendimentosDeclarados(vals: Record<string, number>): number {
  const chaves = ['salario', 'divBR', 'divFII', 'exterior', 'aluguel', 'cdb', 'outros']
  return chaves.reduce((s, k) => s + (vals[k] || 0), 0)
}

function classificar(descoberto: number, fontes: number): Classificacao {
  if (descoberto <= 0) return 'compatível'
  const prop = fontes > 0 ? descoberto / fontes : 1
  if (prop >= PROPORCAO_RELEVANTE && descoberto >= PISO_RELEVANCIA) return 'inconsistência relevante'
  return 'atenção'
}

/**
 * Aplica a mesma estimativa a todos os anos, sem pisar no que foi digitado.
 *
 * Custo de vida é a peça que falta em toda análise, e ninguém tem o número
 * exato de seis anos atrás — mas quase todo mundo sabe dizer quanto gasta por
 * mês. Um chute igual em todos os anos vale muito mais do que zero, que é o que
 * havia antes e fazia a conta parecer boa.
 */
export function aplicarEstimativa(
  entradas: Entradas,
  anos: number[],
  valores: { despesas?: number; dividas?: number },
): Entradas {
  const saida: Entradas = { ...entradas }
  for (const ano of anos) {
    const chave = String(ano)
    const atual = saida[chave] ?? {}
    // só mexe onde está vazio ou onde a estimativa anterior escreveu
    const podeEscrever = (v: number | undefined, campo: CampoEstimavel) =>
      v === undefined || v === 0 || foiEstimado(atual, campo)
    let novo: EntradaAno = { ...atual }
    let mexeu = false
    if (valores.despesas !== undefined && podeEscrever(atual.despesas, 'despesas')) {
      novo = comMarca({ ...novo, despesas: valores.despesas }, 'despesas', true)
      mexeu = true
    }
    if (valores.dividas !== undefined && podeEscrever(atual.dividas, 'dividas')) {
      novo = comMarca({ ...novo, dividas: valores.dividas }, 'dividas', true)
      mexeu = true
    }
    if (mexeu) saida[chave] = novo
  }
  return saida
}

/**
 * Quem causou o degrau, bem a bem.
 *
 * Cada bem do Registro 27 declara o próprio saldo do ano anterior, e os anos
 * estão ligados pelo id (inclusive pelas ligações automáticas). Então dá para
 * abrir o total em parcelas em vez de deixar a pessoa procurando no escuro:
 *
 *   · o bem existe nos dois anos e os saldos não batem → restatement, correção;
 *   · o bem só aparece no ano novo, já com saldo anterior → veio de fora, ou
 *     estava faltando na declaração passada;
 *   · o bem sumiu → foi vendido ou resgatado, e o saldo dele saiu da série.
 *
 * A soma das parcelas é EXATAMENTE o degrau — é a mesma subtração, reagrupada.
 */
export function culpados(
  anterior: { posicoes: { id: string; descricao: string; saldoAtual: number }[] },
  atual: { posicoes: { id: string; descricao: string; saldoAnterior: number }[] },
): ItemDegrau[] {
  const fechadoPorId = new Map<string, { descricao: string; saldo: number }>()
  for (const p of anterior.posicoes) {
    const ja = fechadoPorId.get(p.id)
    fechadoPorId.set(p.id, { descricao: p.descricao, saldo: (ja?.saldo ?? 0) + p.saldoAtual })
  }

  const itens: ItemDegrau[] = []
  const vistos = new Set<string>()

  for (const p of atual.posicoes) {
    const antes = fechadoPorId.get(p.id)
    vistos.add(p.id)
    const fechado = antes?.saldo ?? 0
    const dif = p.saldoAnterior - fechado
    if (Math.abs(dif) <= 0.005) continue
    itens.push({
      id: p.id,
      descricao: p.descricao,
      diferenca: dif,
      motivo: antes ? 'saldo-nao-bate' : 'apareceu',
      declarado: p.saldoAnterior,
      fechado,
    })
  }

  for (const [id, antes] of fechadoPorId) {
    if (vistos.has(id) || Math.abs(antes.saldo) <= 0.005) continue
    itens.push({
      id,
      descricao: antes.descricao,
      diferenca: -antes.saldo,
      motivo: 'sumiu',
      declarado: 0,
      fechado: antes.saldo,
    })
  }

  return itens.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
}

/**
 * Leva os pagamentos declarados para o campo de despesas.
 *
 * Não marca como estimativa: o número veio do arquivo, não de chute — e marcar
 * deixaria o preenchimento rápido apagá-lo depois. Mas é PISO, não o custo de
 * vida inteiro: a tela diz isso, e o resto se soma por cima.
 *
 * Só escreve onde está vazio ou onde a estimativa escreveu. Número digitado à
 * mão continua sendo o da pessoa.
 */
export function usarPagamentosComoDespesa(
  entradas: Entradas,
  anos: { anoBase: number; pagamentosDeclarados: number }[],
): Entradas {
  let saida = entradas
  for (const a of anos) {
    if (a.pagamentosDeclarados <= 0) continue
    const atual = saida[String(a.anoBase)] ?? {}
    const vazio = atual.despesas === undefined || atual.despesas === 0
    if (!vazio && !foiEstimado(atual, 'despesas')) continue
    saida = definirCampo(saida, a.anoBase, 'despesas', a.pagamentosDeclarados)
  }
  return saida
}

export function analisarConsistencia(h: Historico, entradas: Entradas = {}): Consolidado {
  const decs = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  const anos: AnoAnalisado[] = []

  for (let i = 0; i < decs.length; i++) {
    const d = decs[i]
    const anterior = i > 0 ? decs[i - 1] : null
    const e = entradas[String(d.anoBase)] ?? {}
    const eAnterior = anterior ? (entradas[String(anterior.anoBase)] ?? {}) : {}

    // Sem o ano anterior importado, o saldo do próprio Registro 27 serve de
    // ponto de partida: é o que a declaração afirma sobre o ano que passou.
    const patrimonioInicial = anterior
      ? anterior.patrimonio
      : d.posicoes.reduce((s, p) => s + p.saldoAnterior, 0)
    const dividasInicial = anterior ? (eAnterior.dividas ?? 0) : 0
    const dividasFinal = e.dividas ?? 0

    const liquidoInicial = patrimonioInicial - dividasInicial
    const liquidoFinal = d.patrimonio - dividasFinal
    const evolucao = liquidoFinal - liquidoInicial

    const rendimentos = rendimentosDeclarados(d.vals)
    const receitasNaoRecorrentes = e.receitasNaoRecorrentes ?? 0
    const fontes = rendimentos + receitasNaoRecorrentes

    const despesas = e.despesas ?? 0
    const necessidade = evolucao + despesas

    const saldo = fontes - necessidade
    const bruto = Math.max(0, -saldo)
    const descoberto = bruto < FOLGA ? 0 : bruto

    anos.push({
      anoBase: d.anoBase,
      patrimonioInicial,
      patrimonioFinal: d.patrimonio,
      dividasInicial,
      dividasFinal,
      liquidoInicial,
      liquidoFinal,
      evolucao,
      rendimentos,
      receitasNaoRecorrentes,
      fontes,
      despesas,
      necessidade,
      saldo,
      descoberto,
      proporcao: fontes > 0 ? descoberto / fontes : descoberto > 0 ? 1 : 0,
      classificacao: classificar(descoberto, fontes),
      semAnoAnterior: !anterior,
      semDespesas: !(e.despesas && e.despesas > 0),
      importadoSemPagamentos: d.pagamentos === undefined,
      pagamentosDeclarados: (d.pagamentos ?? []).reduce((soma, p) => soma + p.valor, 0),
      pagamentos: (d.pagamentos ?? [])
        .filter((p) => p.valor > 0)
        .map((p) => ({ codigo: p.codigo, beneficiario: p.beneficiario, valor: p.valor }))
        .sort((a, b) => b.valor - a.valor),
      semDividas: e.dividas === undefined,
    })
  }

  // Continuidade: o patrimônio final de um ano tem de ser o inicial do seguinte.
  // Quando não é, ou falta um ano no meio, ou algum bem entrou/saiu sem registro.
  const descontinuidades: Descontinuidade[] = []
  for (let i = 1; i < decs.length; i++) {
    const anterior = decs[i - 1]
    const atual = decs[i]
    if (atual.anoBase - anterior.anoBase !== 1) continue
    const declarado = atual.posicoes.reduce((s, p) => s + p.saldoAnterior, 0)
    const dif = declarado - anterior.patrimonio
    if (Math.abs(dif) > 1) {
      descontinuidades.push({
        de: anterior.anoBase,
        para: atual.anoBase,
        diferenca: dif,
        itens: culpados(anterior, atual),
      })
    }
  }

  const comDescoberto = anos.filter((a) => a.descoberto > 0)
  let sequenciaRecorrente = false
  for (let i = 1; i < anos.length; i++) {
    if (anos[i].descoberto > 0 && anos[i - 1].descoberto > 0) sequenciaRecorrente = true
  }

  // Sobra de um ano pode cobrir o buraco do seguinte — dinheiro guardado não
  // some no dia 31 de dezembro.
  let acumulado = 0
  let folgaAcumuladaCobre = comDescoberto.length > 0
  for (const a of anos) {
    acumulado += a.saldo
    if (acumulado < 0) folgaAcumuladaCobre = false
  }

  const faltando: string[] = []
  const comPagamentos = anos.filter((a) => a.pagamentosDeclarados > 0)
  const desatualizados = anos.filter((a) => a.importadoSemPagamentos)
  if (desatualizados.length > 0) {
    faltando.push(
      `reimportar o .DEC de ${desatualizados.map((a) => a.anoBase).join(', ')} — esses anos foram lidos antes de o app extrair os pagamentos (plano de saúde, previdência)`,
    )
  }
  if (anos.some((a) => a.semDespesas)) {
    faltando.push(
      comPagamentos.length > 0
        ? 'o resto do custo de vida — a declaração já informa os pagamentos dedutíveis, mas mercado, moradia e viagem não estão nela'
        : 'custo de vida anual (sem ele, a conta fica otimista demais)',
    )
  }
  if (anos.some((a) => a.semDividas)) faltando.push('dívidas e ônus por ano — o .DEC lido aqui não traz essa parte')
  if (comDescoberto.length > 0) {
    faltando.push('comprovantes de venda de bens, empréstimos, doações ou heranças no ano com diferença')
    faltando.push('saldo em conta no início do período, se ele bancou parte das compras')
  }
  if (descontinuidades.length > 0) faltando.push('a declaração dos anos que faltam entre os importados')

  return {
    anos,
    totalFontes: anos.reduce((s, a) => s + a.fontes, 0),
    totalNecessidade: anos.reduce((s, a) => s + a.necessidade, 0),
    totalDescoberto: anos.reduce((s, a) => s + a.descoberto, 0),
    prioritarios: [...comDescoberto].sort((a, b) => b.descoberto - a.descoberto),
    sequenciaRecorrente,
    folgaAcumuladaCobre,
    descontinuidades,
    faltando,
  }
}
