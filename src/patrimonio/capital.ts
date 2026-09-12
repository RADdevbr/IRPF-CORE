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

import { analisarConsistencia, type Entradas } from '../historico/consistencia.js'
import { taxaDoPeriodo, ultimoFechamento, NOME_INDICE, type BenchmarksInformados } from './benchmarks.js'
import { composicaoRenda } from './renda.js'
import { chaveAporte, NOME_CLASSE, COMO_VALORA, quedaEhSaida, type Aportes, type ClassePatrimonio, type ComoValora, type Historico } from '../historico/historico.js'

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

export interface PontoAcumuladoRetorno {
  anoBase: number
  /** Retorno acumulado desde o primeiro ponto da série. */
  retorno: number | null
  cdi: number | null
  ipca: number | null
  /** Algum ano até aqui era piso — o acumulado também é piso, não medida. */
  piso: boolean
}

/**
 * Compõe os retornos ano a ano num acumulado do período.
 *
 * O anual responde "como foi este ano"; o acumulado responde "e no fim das
 * contas". As respostas divergem, e é por isso que as duas existem: um ano ruim
 * no meio pesa igual a um bom na leitura ano a ano, e não pesa igual no
 * acumulado, onde ele derruba tudo o que vem depois.
 *
 * Compor é multiplicar, não somar: 10% seguido de 10% dá 21%, não 20%. E os
 * pontos que cobrem vários anos já são o total do período deles — o índice ao
 * lado também —, então entram na multiplicação inteiros, sem anualizar antes.
 *
 * Ano sem retorno mensurável INTERROMPE a série em vez de pular por cima: pular
 * afirmaria que o ano rendeu 0%, que é diferente de não ter como saber. O piso,
 * ao contrário, contamina para frente e fica marcado — acumulado de piso é piso.
 */
export function acumularRetorno(pontos: PontoRetorno[]): PontoAcumuladoRetorno[] {
  const saida: PontoAcumuladoRetorno[] = []
  let fr = 1
  let fc = 1
  let fi = 1
  let vivoR = true
  let vivoC = true
  let vivoI = true
  let piso = false

  for (const p of pontos) {
    if (p.retorno === null) vivoR = false
    else if (vivoR) fr *= 1 + p.retorno
    if (p.cdi === null) vivoC = false
    else if (vivoC) fc *= 1 + p.cdi
    if (p.ipca === null) vivoI = false
    else if (vivoI) fi *= 1 + p.ipca
    if (p.piso) piso = true

    saida.push({
      anoBase: p.anoBase,
      retorno: vivoR ? fr - 1 : null,
      cdi: vivoC ? fc - 1 : null,
      ipca: vivoI ? fi - 1 : null,
      piso,
    })
  }
  return saida
}

// ------------------------------------------------------------ por classe

export interface AnoClasse {
  anoBase: number
  /** Valor no começo do ano dos bens que entram na conta. */
  inicial: number
  final: number
  /**
   * Saldo declarado da classe inteira em 31/12 — inclusive o que ficou fora da
   * medição. É o número que a pessoa reconhece da declaração; `final` é só a
   * parte que sustenta um retorno, e os dois divergem sempre que há bem
   * comprado, vendido ou resgatado no ano.
   */
  saldoDeclarado: number
  /** O mesmo, no começo do ano. */
  saldoDeclaradoInicial: number
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
  /**
   * Quanto saiu de bens que não podem cair sozinhos (ver `ACUMULA_JUROS`).
   *
   * É PISO, não valor: a LCA que caiu R$ 10 mil teve resgate de pelo menos R$ 10
   * mil — foi mais, pelo tanto que ela rendeu no caminho. O número existe para a
   * tela dizer «houve saque de ao menos X» no lugar onde dizia «rendeu −10%».
   */
  resgatePresumido: number
  /**
   * Nenhum bem desta classe teve fluxo informado no ano.
   *
   * O retorno então SUPÕE que não houve aporte nem resgate — e um aporte não
   * informado aparece inteiro como rendimento. Não é erro de conta, é o limite
   * do dado: a declaração traz saldo, não movimento. A tela mostra o número
   * marcado, e o caminho para apertá-lo é informar o fluxo (ou importar o
   * extrato da B3, que os traz).
   */
  presumido: boolean
}

export interface ClasseRetorno {
  classe: ClassePatrimonio
  nome: string
  /** Como o valor declarado é formado — ver `COMO_VALORA`. */
  comoValora: ComoValora
  anos: AnoClasse[]
  /**
   * Média simples dos anos com base — sem os anos que não deram para medir.
   *
   * `null` também quando a classe não é declarada a mercado: ali `final −
   * inicial` mede compra e venda, não valorização, e devolver esse número como
   * «retorno» é o erro que o PAT-01 corrige. Quem consome não pode cair nele
   * por descuido, então some daqui em vez de sair com aviso ao lado.
   */
  retornoMedio: number | null
  saldoFinal: number
  algumParcial: boolean
  /** Algum ano mediu supondo fluxo zero — ver `AnoClasse.presumido`. */
  algumPresumido: boolean
  /** Soma dos resgates presumidos de todos os anos. Piso, nunca valor exato. */
  resgatePresumido: number
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
 *
 * A segunda regra veio de um caso concreto: **uma LCA que cai de um ano para o
 * outro não rendeu negativo — saiu dinheiro dela**. O bem ficou o ano inteiro,
 * então passava pela primeira regra e entrava na conta com o resgate inteiro
 * vestido de prejuízo. Onde o valor declarado acumula juros (`ACUMULA_JUROS`) e
 * o saldo caiu sem fluxo informado, o bem sai da medição e a queda vira
 * `resgatePresumido` — piso do que foi sacado, nunca «rendeu −10%».
 *
 * O que sobra de honesto para dizer, quando ninguém informou fluxo nenhum, é que
 * o número SUPÕE fluxo zero: é o que `presumido` marca. Aporte não informado
 * ainda entra como rendimento, e essa é a distância entre este número e a
 * verdade — a mesma que o extrato da B3 fecha quando é importado.
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
      let resgatePresumido = 0
      let entrouSemFluxo = false
      let entrouComFluxo = false
      const saldoDeclarado = posicoes.reduce((t, p) => t + p.saldoAtual, 0)
      const saldoDeclaradoInicial = posicoes.reduce((t, p) => t + p.saldoAnterior, 0)

      for (const p of posicoes) {
        const chave = chaveAporte(p.id, d.anoBase)
        const informado = chave in aportes
        const ficouOAnoInteiro = p.saldoAnterior > 0 && p.saldoAtual > 0
        if (!informado && !ficouOAnoInteiro) {
          foraDaConta += Math.max(p.saldoAtual, p.saldoAnterior)
          parcial = true
          continue
        }
        // Queda em bem que só sobe: é saque, e o app não sabe de quanto. Medir
        // aqui produziria o «rendeu −10%» que na verdade era uma retirada.
        if (!informado && p.saldoAtual < p.saldoAnterior && quedaEhSaida(classe)) {
          resgatePresumido += p.saldoAnterior - p.saldoAtual
          foraDaConta += p.saldoAnterior
          parcial = true
          continue
        }
        const a = informado ? aportes[chave] : 0
        if (informado) entrouComFluxo = true
        else entrouSemFluxo = true
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
        saldoDeclarado,
        saldoDeclaradoInicial,
        aporte,
        rendimento,
        base,
        retorno: base > 0 ? rendimento / base : null,
        foraDaConta,
        parcial,
        resgatePresumido,
        // só é «presumido» se sobrou alguém medido supondo fluxo zero
        presumido: entrouSemFluxo && !entrouComFluxo,
      }
      const lista = porClasse.get(classe)
      if (lista) lista.push(linha)
      else porClasse.set(classe, [linha])
    }
  }

  return [...porClasse.entries()]
    .map(([classe, anos]) => {
      const medidos = anos.filter((a) => a.retorno !== null)
      const comoValora = COMO_VALORA[classe]
      const mensuravel = comoValora === 'mercado'
      return {
        classe,
        nome: NOME_CLASSE[classe],
        comoValora,
        anos,
        retornoMedio:
          mensuravel && medidos.length > 0
            ? medidos.reduce((s, a) => s + (a.retorno as number), 0) / medidos.length
            : null,
        saldoFinal: anos[anos.length - 1]?.saldoDeclarado ?? 0,
        algumParcial: anos.some((a) => a.parcial),
        algumPresumido: anos.some((a) => a.presumido && a.retorno !== null),
        resgatePresumido: anos.reduce((t, a) => t + a.resgatePresumido, 0),
      }
    })
    .sort((a, b) => b.saldoFinal - a.saldoFinal)
}

/** Retorno descontada a inflação: o que sobrou de poder de compra. */
export function retornoReal(nominal: number, inflacao: number): number {
  return (1 + nominal) / (1 + inflacao) - 1
}
