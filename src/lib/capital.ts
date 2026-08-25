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
import { chaveAporte, NOME_CLASSE, type Aportes, type ClassePatrimonio, type Historico } from './historico'

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

// ------------------------------------------------------------ por classe

export interface AnoClasse {
  anoBase: number
  /** Valor no começo do ano dos bens que entram na conta. */
  inicial: number
  final: number
  aporte: number
  /** final − inicial − aporte, só dos bens que ficaram o ano inteiro. */
  rendimento: number
  /** Base do retorno: inicial + metade do aporte (entrada no meio do ano). */
  base: number
  retorno: number | null
  /** Valor que ficou de fora por ter entrado ou saído no ano sem aporte informado. */
  foraDaConta: number
  /** Algum bem ficou de fora: o retorno é do que ficou parado, não da classe toda. */
  parcial: boolean
}

export interface ClasseRetorno {
  classe: ClassePatrimonio
  nome: string
  anos: AnoClasse[]
  /** Média simples dos anos com base — sem os anos que não deram para medir. */
  retornoMedio: number | null
  saldoFinal: number
  algumParcial: boolean
}

/**
 * Retorno de cada classe, ano a ano — sem depender dos vínculos entre anos.
 *
 * O saldo de 31/12 do ano anterior vem dentro da própria linha do Registro 27,
 * então dá para medir a classe sem saber qual bem virou qual: soma o que valia
 * no começo, soma o que valia no fim, tira o que você aportou.
 *
 * A regra que faz o número significar alguma coisa: **só entra o bem que ficou
 * o ano inteiro**. Bem comprado em julho aparece com saldo anterior zero e o
 * valor todo viraria "rendimento"; bem vendido some do saldo e viraria
 * prejuízo. Os dois ficam de fora, e a linha diz quanto ficou. A exceção é o
 * aporte informado: aí o app sabe quanto foi dinheiro novo e o bem entra na
 * conta, com a entrada valendo meio ano na base.
 */
export function retornoPorClasse(h: Historico, aportes: Aportes = {}): ClasseRetorno[] {
  const porClasse = new Map<ClassePatrimonio, AnoClasse[]>()

  for (const d of Object.values(h).sort((a, b) => a.anoBase - b.anoBase)) {
    const grupos = new Map<ClassePatrimonio, typeof d.posicoes>()
    for (const p of d.posicoes) {
      const atual = grupos.get(p.classe)
      if (atual) atual.push(p)
      else grupos.set(p.classe, [p])
    }

    for (const [classe, posicoes] of grupos) {
      let inicial = 0
      let final = 0
      let aporte = 0
      let base = 0
      let foraDaConta = 0
      let parcial = false

      for (const p of posicoes) {
        const chave = chaveAporte(p.id, d.anoBase)
        const informado = chave in aportes
        const ficouOAnoInteiro = p.saldoAnterior > 0 && p.saldoAtual > 0
        if (!informado && !ficouOAnoInteiro) {
          foraDaConta += Math.max(p.saldoAtual, p.saldoAnterior)
          parcial = true
          continue
        }
        const a = informado ? aportes[chave] : 0
        inicial += p.saldoAnterior
        final += p.saldoAtual
        aporte += a
        // dinheiro que entrou no meio do ano rendeu meio ano: contar inteiro
        // afundaria o retorno de quem aportou muito
        base += p.saldoAnterior + a / 2
      }

      const rendimento = final - inicial - aporte
      const linha: AnoClasse = {
        anoBase: d.anoBase,
        inicial,
        final,
        aporte,
        rendimento,
        base,
        retorno: base > 0 ? rendimento / base : null,
        foraDaConta,
        parcial,
      }
      const lista = porClasse.get(classe)
      if (lista) lista.push(linha)
      else porClasse.set(classe, [linha])
    }
  }

  return [...porClasse.entries()]
    .map(([classe, anos]) => {
      const medidos = anos.filter((a) => a.retorno !== null)
      return {
        classe,
        nome: NOME_CLASSE[classe],
        anos,
        retornoMedio:
          medidos.length > 0 ? medidos.reduce((s, a) => s + (a.retorno as number), 0) / medidos.length : null,
        saldoFinal: anos[anos.length - 1]?.final ?? 0,
        algumParcial: anos.some((a) => a.parcial),
      }
    })
    .sort((a, b) => b.saldoFinal - a.saldoFinal)
}

/** Retorno descontada a inflação: o que sobrou de poder de compra. */
export function retornoReal(nominal: number, inflacao: number): number {
  return (1 + nominal) / (1 + inflacao) - 1
}
