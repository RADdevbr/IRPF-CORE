// Quanto o capital rendeu — a conta que a declaração não faz.
//
// A ideia, em uma linha: o que você poupou no ano é renda menos gasto; o que o
// patrimônio cresceu além disso não veio do seu bolso, veio do próprio dinheiro
// trabalhando.
//
//   poupado          = renda declarada − gasto informado
//   embutido         = crescimento do patrimônio − poupado
//   rendimento total = embutido + a renda que já veio do capital
//
// O "embutido" precisa dessa soma no fim para virar retorno comparável: o
// dividendo que caiu na conta e foi reinvestido aparece nas DUAS pontas (é
// renda e é crescimento), então some do embutido — mas é rendimento do capital
// do mesmo jeito. Sem devolvê-lo, quem vive de dividendos apareceria com
// retorno perto de zero.
//
// Tudo aqui é estimativa, e a maior fonte de erro é o gasto: informado a menos,
// o poupado infla e o rendimento do capital some. Por isso cada linha diz se o
// gasto daquele ano foi informado.

import { analisarConsistencia, type Entradas } from './consistencia'
import { composicaoRenda } from './renda'
import type { Historico } from './historico'

export interface AnoCapital {
  anoBase: number
  patrimonioInicial: number
  patrimonioFinal: number
  /** Variação do patrimônio líquido no ano. */
  crescimento: number
  renda: number
  /** Parte da renda que veio do capital (dividendos, aplicações, aluguel…). */
  rendaDeCapital: number
  gasto: number
  /** renda − gasto: o que sobrou do seu bolso para virar patrimônio. */
  poupado: number
  /** Crescimento que o que você poupou não explica. */
  embutido: number
  /** embutido + renda de capital: o que o patrimônio produziu no ano. */
  rendimento: number
  /** rendimento ÷ patrimônio médio do ano. Sem patrimônio, null. */
  retorno: number | null
  /** Gasto do ano não informado: o rendimento aqui é PISO, não estimativa. */
  semGasto: boolean
  /** Primeiro ano importado — o inicial vem do saldo que o próprio arquivo declara. */
  semAnoAnterior: boolean
  /** A evolução cobre mais de um ano: falta declaração no meio. */
  anosCobertos: number
}

export interface AnaliseCapital {
  anos: AnoCapital[]
  /** Anos com gasto informado e patrimônio — os únicos que sustentam média. */
  retornoMedio: number | null
  totalRendimento: number
  totalPoupado: number
}

export function analiseCapital(
  h: Historico,
  entradas: Entradas = {},
  opts: { dividendosSaoTrabalho?: boolean } = {},
): AnaliseCapital {
  const consistencia = analisarConsistencia(h, entradas)

  const anos: AnoCapital[] = consistencia.anos.map((a) => {
    const d = h[String(a.anoBase)]
    const comp = composicaoRenda(d?.vals ?? {}, opts)
    const renda = a.rendimentos
    const gasto = a.despesas
    const poupado = renda - gasto
    const embutido = a.evolucao - poupado
    const rendimento = embutido + comp.capital
    const medio = (a.liquidoInicial + a.liquidoFinal) / 2

    return {
      anoBase: a.anoBase,
      patrimonioInicial: a.liquidoInicial,
      patrimonioFinal: a.liquidoFinal,
      crescimento: a.evolucao,
      renda,
      rendaDeCapital: comp.capital,
      gasto,
      poupado,
      embutido,
      rendimento,
      retorno: medio > 0 ? rendimento / medio : null,
      semGasto: a.semDespesas,
      semAnoAnterior: a.semAnoAnterior,
      anosCobertos: a.anosCobertos,
    }
  })

  // Média só do que se pode afirmar: ano sem gasto informado tem rendimento
  // subestimado, e período com buraco mistura anos. Entrar na média com isso é
  // publicar um número que ninguém mediu.
  const confiaveis = anos.filter((a) => !a.semGasto && a.anosCobertos === 1 && a.retorno !== null)
  const retornoMedio =
    confiaveis.length > 0 ? confiaveis.reduce((s, a) => s + (a.retorno as number), 0) / confiaveis.length : null

  return {
    anos,
    retornoMedio,
    totalRendimento: anos.reduce((s, a) => s + a.rendimento, 0),
    totalPoupado: anos.reduce((s, a) => s + a.poupado, 0),
  }
}
