// A base do IRPFM projetada FICHA A FICHA — o fim do RT-03.
//
// A base é a soma de sete fichas que a lei manda somar (`FIELDS` com
// `base: true`), e os dois apps a estendiam pelo mesmo atalho: uma taxa média
// tirada do histórico da SOMA, aplicada à SOMA. Isso trata como uma grandeza só
// coisas que andam por motivos sem relação nenhuma —
//
//   · o pró-labore anda com a carreira;
//   · o dividendo e o CDB andam com o tamanho da carteira;
//   · o aluguel anda com a inflação e com mais nada;
//   · o ganho em bolsa não anda: ele acontece, ou não.
//
// e o resultado dessa mistura sai no número mais consequente da família — «em
// que ano eu cruzo os R$ 600 mil», que é a resposta que o app existe para dar.
// Carteira compondo rápido empurrava o pró-labore junto; contrato novo empurrava
// a carteira junto. Os dois erros acontecem na vida real, e são simétricos.
//
// Aqui cada fatia cresce pela sua própria regra, e a regra sai da RESPOSTA da
// pessoa sobre quem pagou (fase 3) — não da ficha. Lucro da própria PJ é
// trabalho e cresce como trabalho, mesmo estando na ficha 09 ao lado do provento
// do ETF, que é capital e cresce com a carteira.
//
// O que este módulo NÃO faz: projetar o patrimônio. Ele recebe o patrimônio já
// projetado de quem o projeta, justamente para que a renda de capital daqui
// caiba no patrimônio de lá. Duas projeções da mesma vida, cada uma com a sua
// premissa, foi o achado da fase 4 — e repeti-lo aqui seria não ter aprendido.

import { FIELDS } from '../fiscal/fontes.js'
import type { Entradas } from '../historico/consistencia.js'
import type { Historico } from '../historico/historico.js'
import { analiseCapital, type AnaliseCapital } from './capital.js'
import { composicaoDoAno, type OpcoesOrigem, type Origem } from './renda.js'

/**
 * Inflação de longo prazo — premissa, não previsão.
 *
 * Mora aqui porque duas contas da família dependem dela e precisam concordar: o
 * custo de vida, que cresce sozinho, e o aluguel, que é a única renda que não
 * acompanha nem a carreira nem a carteira. Dois números diferentes para a mesma
 * premissa fariam a mesma tela dizer duas coisas.
 */
export const INFLACAO_LONGO_PRAZO = 0.045

/**
 * Como uma fatia da base cresce de um ano para o outro.
 *
 * `carteira` é a regra que fecha a conta com a projeção do patrimônio: a fatia
 * não é extrapolada por ritmo próprio, ela É uma fração do patrimônio do ano
 * anterior. Carteira maior distribui mais, na mesma proporção.
 */
export type RegraBase = 'trabalho' | 'carteira' | 'inflacao' | 'evento'

export const ROTULO_REGRA: Record<RegraBase, string> = {
  trabalho: 'cresce com a sua carreira',
  carteira: 'acompanha o tamanho da carteira',
  inflacao: 'acompanha a inflação',
  evento: 'repete o último ano — é evento, não série',
}

/** As fichas que a lei soma na base do imposto mínimo. */
export const CHAVES_DA_BASE = FIELDS.filter((f) => f.base).map((f) => f.key)

/**
 * Qual regra rege uma fatia — a decisão do módulo inteiro, em cinco linhas.
 *
 * Três fichas têm regra própria, e cada uma por um motivo diferente:
 *
 *   · `salario` é trabalho por definição, e não há pagador que mude isso;
 *   · `aluguel` é renda de capital, mas o imóvel entra na declaração pelo CUSTO
 *     de aquisição e nunca é remarcado. Projetá-lo pelo patrimônio faria o
 *     aluguel subir porque você comprou ação — então ele segue a inflação;
 *   · `bolsa` é ganho REALIZADO numa venda. Não é série: quem vendeu um imóvel
 *     uma vez não vende todo ano, e extrapolá-lo é inventar uma venda anual.
 *
 * O resto — dividendo, exterior, CDB, outros — segue a origem que a pessoa
 * respondeu sobre o pagador. Quem não respondeu vira faixa, e é por isso que
 * `indefinido` não tem regra: ele é projetado DAS DUAS FORMAS, e o intervalo
 * entre elas é o tamanho do que ainda não se sabe.
 */
export function regraDaFatia(chave: string, origem: Origem): RegraBase {
  if (chave === 'salario') return 'trabalho'
  if (chave === 'aluguel') return 'inflacao'
  if (chave === 'bolsa') return 'evento'
  return origem === 'trabalho' ? 'trabalho' : 'carteira'
}

export interface FatiaBase {
  chave: string
  rotulo: string
  /** A resposta sobre o pagador, como ela chegou. */
  origem: Origem
  regra: RegraBase
  /** Valor da fatia no último ano declarado — de onde a projeção parte. */
  valor: number
  /**
   * Regra `carteira`: fração do patrimônio médio que esta fatia devolveu por ano.
   *
   * Medida nos mesmos anos e com o mesmo denominador de `yieldDistribuido`, o
   * que faz a soma das fatias bater com o yield inteiro — a decomposição não
   * cria nem perde renda.
   */
  taxa: number | null
  /** A origem não foi respondida: esta fatia é projetada das duas formas. */
  indefinida: boolean
}

export interface FatiasDaBase {
  /** Último ano declarado — a projeção começa no seguinte. */
  anoBase: number
  fatias: FatiaBase[]
  /** Soma das fatias no último ano declarado. É a base daquele ano. */
  base: number
  /** Há fatia com origem por responder: a projeção da base é faixa. */
  temFaixa: boolean
  /** Há ganho em bolsa repetido adiante — a tela precisa dizer isso. */
  temEvento: boolean
}

const chave = (f: { chave: string; origem: Origem }) => `${f.chave}·${f.origem}`

/**
 * De que fatias a base é feita, e a que ritmo cada uma anda.
 *
 * O corte é por ficha E por origem, porque é assim que a fase 3 respondeu: a
 * ficha 09 de quem tem PJ e corretora vira duas fatias com regras opostas, e
 * tratá-la como uma só é exatamente o erro que este plano existe para desfazer.
 */
export function fatiasDaBase(
  h: Historico,
  entradas: Entradas = {},
  opts: OpcoesOrigem = {},
  analisePronta?: AnaliseCapital,
): FatiasDaBase {
  const analise = analisePronta ?? analiseCapital(h, entradas, opts)
  const ultimo = analise.anos[analise.anos.length - 1]
  if (!ultimo) return { anoBase: 0, fatias: [], base: 0, temFaixa: false, temEvento: false }

  // As taxas saem dos MESMOS anos e do MESMO denominador de `yieldDistribuido`.
  // Ficha ausente num ano entra com zero, e isso é de propósito: ela não
  // distribuiu nada naquele ano, e excluí-la da média faria a soma das fatias
  // estourar o yield medido.
  const medidos = analise.anos.filter(
    (a) => a.anosCobertos === 1 && a.patrimonioInicial + a.patrimonioFinal > 0,
  )
  const somaTaxa = new Map<string, number>()
  for (const a of medidos) {
    const medio = (a.patrimonioInicial + a.patrimonioFinal) / 2
    for (const f of composicaoDoAno(h[String(a.anoBase)], opts).fontes) {
      if (!CHAVES_DA_BASE.includes(f.chave)) continue
      somaTaxa.set(chave(f), (somaTaxa.get(chave(f)) ?? 0) + f.valor / medio)
    }
  }
  const taxaDe = (k: string): number | null =>
    medidos.length > 0 ? (somaTaxa.get(k) ?? 0) / medidos.length : null

  const d = h[String(ultimo.anoBase)]
  const fatias: FatiaBase[] = []
  for (const f of composicaoDoAno(d, opts).fontes) {
    if (!CHAVES_DA_BASE.includes(f.chave)) continue
    const regra = regraDaFatia(f.chave, f.origem)
    fatias.push({
      chave: f.chave,
      rotulo: f.rotulo,
      origem: f.origem,
      regra,
      valor: f.valor,
      taxa: regra === 'carteira' ? taxaDe(chave(f)) : null,
      indefinida: f.origem === 'indefinido',
    })
  }

  // `bolsa` entra por fora: ela é ficha da BASE (`FIELDS`) e não é ficha de
  // RENDA (`FONTES`) — ganho na venda de um papel não é a carteira distribuindo,
  // é ela virando dinheiro. A composição não a conhece, e é certo que não
  // conheça: somá-la ali inflaria o yield com uma venda que não se repete.
  const bolsa = d?.vals?.bolsa || 0
  if (bolsa > 0) {
    fatias.push({
      chave: 'bolsa',
      rotulo: 'Ganho em bolsa',
      origem: 'capital',
      regra: 'evento',
      valor: bolsa,
      taxa: null,
      indefinida: false,
    })
  }

  fatias.sort((a, b) => b.valor - a.valor)
  return {
    anoBase: ultimo.anoBase,
    fatias,
    base: fatias.reduce((s, f) => s + f.valor, 0),
    temFaixa: fatias.some((f) => f.indefinida),
    temEvento: fatias.some((f) => f.regra === 'evento'),
  }
}

export interface FatiaProjetada {
  chave: string
  rotulo: string
  regra: RegraBase
  valor: number
}

export interface PontoBase {
  anoBase: number
  base: number
  fatias: FatiaProjetada[]
  projetado: boolean
}

export interface OpcoesProjetarBase {
  /**
   * Patrimônio no INÍCIO de cada ano projetado (= o fechamento do ano anterior),
   * um por ano. É ele que passou o ano rendendo, e é dele que sai a fatia
   * `carteira` — a mesma defasagem de `projetarRenda`.
   */
  patrimonio: number[]
  /** Ritmo da renda de trabalho. null = mantém o nível, sem inventar carreira. */
  taxaTrabalho: number | null
  /** Ritmo do aluguel. Padrão: `INFLACAO_LONGO_PRAZO`. */
  inflacao?: number
  /**
   * Como resolver a fatia sem origem respondida.
   *
   * Não há lado «conservador» aqui: dependendo de a carreira andar mais rápido
   * ou mais devagar que a carteira, cada suposição pode dar a base maior. Por
   * isso quem desenha a faixa projeta as duas e tira mínimo e máximo, em vez de
   * escolher um lado e chamá-lo de piso.
   */
  indefinidoComo?: 'trabalho' | 'carteira'
  /**
   * Multiplica as fatias de `carteira` — a porta pela qual a faixa entra.
   *
   * O yield que projeta é a MÉDIA dos anos medidos, e os anos medidos não são
   * iguais entre si: uma carteira que devolveu 3,1% num ano e 4,8% noutro tem
   * essa distância como incerteza de verdade, medida, não estimada. Quem desenha
   * a faixa projeta com as duas pontas e o fator é como ele pede isso.
   *
   * Fator, e não uma taxa nova, porque as fatias têm taxas próprias: o que a
   * ponta do intervalo diz é «tudo o que a carteira distribui, na proporção
   * medida, mas neste ritmo» — e é a proporção entre as fatias que precisa
   * sobreviver.
   */
  fatorCarteira?: number
}

/**
 * Estende a base ano a ano, cada fatia pela sua regra.
 *
 * Devolve só os anos PROJETADOS: os declarados o chamador já tem, com o número
 * que a declaração provou, e reconstruí-los aqui seria oferecer uma segunda
 * versão do passado.
 */
export function projetarBase(f: FatiasDaBase, opts: OpcoesProjetarBase): PontoBase[] {
  const inflacao = opts.inflacao ?? INFLACAO_LONGO_PRAZO
  const comoIndefinido = opts.indefinidoComo ?? 'carteira'
  const saida: PontoBase[] = []

  for (let i = 0; i < opts.patrimonio.length; i++) {
    const pat = opts.patrimonio[i]
    const n = i + 1
    const fatias: FatiaProjetada[] = f.fatias.map((x) => {
      const regra = x.indefinida ? comoIndefinido : x.regra
      const valor =
        regra === 'trabalho'
          ? x.valor * Math.pow(1 + (opts.taxaTrabalho ?? 0), n)
          : regra === 'inflacao'
            ? x.valor * Math.pow(1 + inflacao, n)
            : regra === 'carteira'
              ? pat * (x.taxa ?? 0) * (opts.fatorCarteira ?? 1)
              : // evento: repete o nível, sem crescer. Ver `regraDaFatia`.
                x.valor
      return { chave: x.chave, rotulo: x.rotulo, regra, valor }
    })
    saida.push({
      anoBase: f.anoBase + n,
      base: fatias.reduce((s, x) => s + x.valor, 0),
      fatias,
      projetado: true,
    })
  }
  return saida
}
