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
  descontinuidades: { de: number; para: number; diferenca: number }[]
  /** O que falta informar para a conta valer alguma coisa. */
  faltando: string[]
}

/**
 * Piso de relevância. Abaixo disto a diferença não vira "inconsistência
 * relevante" nem com percentual alto: num patrimônio de milhões, R$ 20 mil de
 * diferença é arredondamento de classificação, não sinal de nada.
 */
export const PISO_RELEVANCIA = 50_000

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
    const descoberto = Math.max(0, -saldo)

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
      semDividas: e.dividas === undefined,
    })
  }

  // Continuidade: o patrimônio final de um ano tem de ser o inicial do seguinte.
  // Quando não é, ou falta um ano no meio, ou algum bem entrou/saiu sem registro.
  const descontinuidades: Consolidado['descontinuidades'] = []
  for (let i = 1; i < decs.length; i++) {
    const anterior = decs[i - 1]
    const atual = decs[i]
    if (atual.anoBase - anterior.anoBase !== 1) continue
    const declarado = atual.posicoes.reduce((s, p) => s + p.saldoAnterior, 0)
    const dif = declarado - anterior.patrimonio
    if (Math.abs(dif) > 1) descontinuidades.push({ de: anterior.anoBase, para: atual.anoBase, diferenca: dif })
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
  if (anos.some((a) => a.semDespesas)) faltando.push('custo de vida anual (sem ele, a conta fica otimista demais)')
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
