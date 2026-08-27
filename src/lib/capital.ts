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
import { taxaDoPeriodo, ultimoFechamento, NOME_INDICE, type BenchmarksInformados } from './benchmarks'
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

// ------------------------------------------------- retorno contra os índices

export interface PontoRetorno {
  anoBase: number
  /** Retorno medido do capital no ano. null quando não dá para medir. */
  retorno: number | null
  /** Gasto do ano não informado: o retorno é PISO, não medida. */
  piso: boolean
  /** Quantos anos o ponto cobre. >1 quando falta declaração no meio. */
  anosCobertos: number
  /** CDI (ou Selic, se só ela existir) no MESMO período do ponto. */
  cdi: number | null
  ipca: number | null
}

export interface RetornoVsIndices {
  pontos: PontoRetorno[]
  /** Média dos anos que sustentam afirmação — a mesma regra do retornoMedio. */
  retornoMedio: number | null
  /** Média dos índices NOS MESMOS anos, para comparar maçã com maçã. */
  cdiMedio: number | null
  ipcaMedio: number | null
  /** 'CDI / Selic' quando as duas existem; só uma delas quando falta a outra. */
  rotuloCdi: string
  /** Quantos anos entraram nas médias. */
  anosNaMedia: number
}

/**
 * O retorno que o capital deu, ano a ano, ao lado do que os índices deram.
 *
 * É a comparação que faz sentido com um índice, e a que o painel não fazia: CDI
 * é TAXA DE RETORNO, então o par dele é o retorno da carteira — não a trajetória
 * do patrimônio, que inclui tudo o que a pessoa aportou e por isso ganha do
 * índice por construção.
 *
 * O retorno aqui é medido, não projetado: sai de `analiseCapital`, que desconta
 * o que foi poupado do crescimento do patrimônio. E o índice de cada ponto cobre
 * o mesmo período dele — ponto que mede três anos (falta declaração no meio)
 * compara com três anos de índice compostos.
 *
 * As médias usam só os anos que sustentam afirmação — com gasto informado e sem
 * buraco —, e o índice entra na média pelos MESMOS anos. Comparar a média de
 * cinco anos de retorno com a média de sete de CDI seria comparar períodos
 * diferentes e chamar de comparação.
 */
export function retornoVsIndices(
  h: Historico,
  entradas: Entradas = {},
  benchmarks: BenchmarksInformados = {},
  opts: { dividendosSaoTrabalho?: boolean } = {},
): RetornoVsIndices {
  const analise = analiseCapital(h, entradas, opts)
  const temCdi = ultimoFechamento('cdi', benchmarks) !== null
  const temSelic = ultimoFechamento('selic', benchmarks) !== null
  const indiceCdi = temCdi ? 'cdi' : 'selic'
  const rotuloCdi =
    temCdi && temSelic ? `${NOME_INDICE.cdi} / ${NOME_INDICE.selic}` : NOME_INDICE[temCdi ? 'cdi' : 'selic']

  const pontos: PontoRetorno[] = analise.anos.map((a) => ({
    anoBase: a.anoBase,
    retorno: a.retorno,
    piso: a.semGasto,
    anosCobertos: a.anosCobertos,
    cdi: taxaDoPeriodo(indiceCdi, a.anoBase, a.anosCobertos, benchmarks),
    ipca: taxaDoPeriodo('ipca', a.anoBase, a.anosCobertos, benchmarks),
  }))

  // os mesmos anos que o retornoMedio aceita, e nenhum outro
  const confiaveis = analise.anos
    .map((a, i) => ({ a, p: pontos[i] }))
    .filter(({ a }) => !a.semGasto && a.anosCobertos === 1 && a.retorno !== null)

  const media = (vals: (number | null)[]) => {
    const bons = vals.filter((v): v is number => v !== null)
    return bons.length > 0 ? bons.reduce((s, v) => s + v, 0) / bons.length : null
  }

  return {
    pontos,
    retornoMedio: analise.retornoMedio,
    cdiMedio: media(confiaveis.map(({ p }) => p.cdi)),
    ipcaMedio: media(confiaveis.map(({ p }) => p.ipca)),
    rotuloCdi,
    anosNaMedia: confiaveis.length,
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
