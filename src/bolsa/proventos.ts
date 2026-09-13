// O que a carteira PAGOU, mês a mês — ao lado do que ela rendeu ao ser vendida.
//
// Mora em `/bolsa`, e não em `/fiscal`, por uma razão de agrupamento e não de
// arrumação. A grade de `/fiscal` é por PAGADOR, porque o gatilho do Art. 6º-A
// conta os R$ 50 mil por CNPJ: PETR3 e PETR4 somam ali, e têm de somar. Esta
// série é por PAPEL, porque a pergunta dela é outra — «quanto este papel me
// paga pelo que paguei nele» —, e PETR3 e PETR4 somados não dizem o rendimento
// de nenhum dos dois.
//
// Juntar as duas faria a segunda herdar o agrupamento da primeira, que é
// exatamente o achado CAR-06 do plano. Por isso são duas, e por isso as duas
// nascem do MESMO `ProventoRecebido`: uma verdade, dois recortes.
//
// O que NÃO está aqui, e não vai estar: cotação. Nenhum relatório que a família
// lê traz preço de fechamento, então o rendimento daqui é sempre sobre CUSTO —
// e o campo diz isso no nome e no comentário, porque rendimento sobre custo e
// rendimento sobre mercado são números diferentes que respondem perguntas
// diferentes, e trocar um pelo outro em silêncio seria o pior desfecho.

import type { Posicao } from './bolsa.js'

/**
 * O que o crédito é, tributariamente. Quem traduz o texto da B3 para cá é o app
 * que lê o arquivo — o catálogo muda de nome, e decorá-lo no núcleo viraria bug
 * silencioso na base do imposto.
 *
 * `outro` existe para o que a pessoa classificou como provento sem ser um dos
 * três: ele soma no total e fica visível separado, em vez de ser diluído num
 * dos outros ou sumir.
 */
export type TipoProvento = 'dividendo' | 'jcp' | 'rendimento' | 'outro'

export const TIPOS_PROVENTO: TipoProvento[] = ['dividendo', 'jcp', 'rendimento', 'outro']

export const NOME_TIPO_PROVENTO: Record<TipoProvento, string> = {
  dividendo: 'Dividendo',
  jcp: 'Juros sobre capital próprio',
  rendimento: 'Rendimento (FII)',
  outro: 'Outro provento',
}

/** Um mês, como eixo. */
export interface MesAno {
  ano: number
  /** 1 a 12. */
  mes: number
}

/**
 * Um crédito, como ele caiu.
 *
 * `valor` é BRUTO — o app já reconstitui o bruto do JCP e do dividendo retido
 * antes de chegar aqui, e `ir` guarda o que foi retido. Somar líquido aqui
 * subestimaria as duas coisas ao mesmo tempo: a renda e a dedução.
 */
export interface ProventoRecebido {
  ano: number
  /** 1 a 12. */
  mes: number
  ticker: string
  /** O pagador da grade fiscal — guardado para os dois recortes se conferirem. */
  pagador: string
  tipo: TipoProvento
  /** Bruto. */
  valor: number
  /** IR retido na fonte. 0 = sem retenção (rendimento de FII). */
  ir: number
}

export interface MesDeProvento extends MesAno {
  total: number
  ir: number
  porTipo: Record<TipoProvento, number>
}

export interface AnoDeProvento {
  ano: number
  total: number
  ir: number
  porTipo: Record<TipoProvento, number>
}

export interface PapelDeProvento {
  ticker: string
  total: number
  ir: number
  porTipo: Record<TipoProvento, number>
  /** Chave: o ano como texto. */
  porAno: Record<string, number>
  /**
   * Mês a mês, na MESMA grade contínua de `SerieProventos.meses` — inclusive os
   * meses anteriores à primeira compra deste papel, zerados.
   *
   * É o que permite pôr dois papéis lado a lado sem desalinhar, e é o que a
   * janela de doze meses precisa para atravessar a virada do ano.
   */
  meses: MesDeProvento[]
}

export interface SerieProventos {
  /**
   * Do primeiro ao último mês com provento, SEM buracos: mês sem crédito entra
   * zerado.
   *
   * Pular o mês vazio desenharia um gráfico que mente sobre a regularidade — e
   * regularidade é metade do que se olha num FII. Um papel que pagou em janeiro
   * e em junho não pagou «dois meses seguidos».
   */
  meses: MesDeProvento[]
  porAno: AnoDeProvento[]
  porTicker: PapelDeProvento[]
  total: number
  ir: number
  de: MesAno | null
  ate: MesAno | null
  /**
   * Créditos descartados por não terem mês de 1 a 12, ou por trazerem valor que
   * não é número.
   *
   * Sai contado, e não em silêncio: uma linha perdida aqui é renda que some, e
   * a regra da casa é que quem olha a tela veja o buraco em vez de o imposto.
   */
  ignorados: number
}

const zerosTipo = (): Record<TipoProvento, number> => ({
  dividendo: 0,
  jcp: 0,
  rendimento: 0,
  outro: 0,
})

/** O mês como número corrido, para comparar e para iterar sem pensar em virada. */
const ordem = (m: MesAno) => m.ano * 12 + (m.mes - 1)
const doNumero = (o: number): MesAno => ({ ano: Math.floor(o / 12), mes: (o % 12) + 1 })

const novoMes = (m: MesAno): MesDeProvento => ({ ...m, total: 0, ir: 0, porTipo: zerosTipo() })

const somar = (alvo: { total: number; ir: number; porTipo: Record<TipoProvento, number> }, p: ProventoRecebido) => {
  alvo.total += p.valor
  alvo.ir += p.ir
  alvo.porTipo[p.tipo] += p.valor
}

/**
 * Agrega os créditos nos três recortes que as telas pedem: mês a mês, ano a ano
 * e papel a papel.
 *
 * Um crédito entra nos três — são a mesma soma vista de ângulos diferentes, e é
 * por isso que ela é feita uma vez só, aqui, em vez de cada tela refazer a sua.
 */
export function serieProventos(recebidos: readonly ProventoRecebido[]): SerieProventos {
  const legivel = (p: ProventoRecebido) =>
    Number.isInteger(p.mes) &&
    p.mes >= 1 &&
    p.mes <= 12 &&
    Number.isInteger(p.ano) &&
    Number.isFinite(p.valor) &&
    Number.isFinite(p.ir)

  const bons = recebidos.filter(legivel)
  const ignorados = recebidos.length - bons.length

  if (bons.length === 0) {
    return { meses: [], porAno: [], porTicker: [], total: 0, ir: 0, de: null, ate: null, ignorados }
  }

  const ordens = bons.map(ordem)
  const de = doNumero(Math.min(...ordens))
  const ate = doNumero(Math.max(...ordens))
  const grade = Array.from({ length: ordem(ate) - ordem(de) + 1 }, (_, i) => doNumero(ordem(de) + i))

  const meses = grade.map(novoMes)
  const porMes = new Map(meses.map((m) => [ordem(m), m]))

  const porAno = new Map<number, AnoDeProvento>()
  const porTicker = new Map<string, PapelDeProvento>()

  bons.forEach((p) => {
    somar(porMes.get(ordem(p))!, p)

    const a = porAno.get(p.ano) ?? { ano: p.ano, total: 0, ir: 0, porTipo: zerosTipo() }
    somar(a, p)
    porAno.set(p.ano, a)

    const t =
      porTicker.get(p.ticker) ??
      {
        ticker: p.ticker,
        total: 0,
        ir: 0,
        porTipo: zerosTipo(),
        porAno: {} as Record<string, number>,
        meses: grade.map(novoMes),
      }
    somar(t, p)
    t.porAno[String(p.ano)] = (t.porAno[String(p.ano)] ?? 0) + p.valor
    somar(t.meses[ordem(p) - ordem(de)], p)
    porTicker.set(p.ticker, t)
  })

  return {
    meses,
    porAno: [...porAno.values()].sort((x, y) => x.ano - y.ano),
    porTicker: [...porTicker.values()].sort((x, y) => x.ticker.localeCompare(y.ticker)),
    total: bons.reduce((s, p) => s + p.valor, 0),
    ir: bons.reduce((s, p) => s + p.ir, 0),
    de,
    ate,
    ignorados,
  }
}

/**
 * A janela dos últimos `quantos` meses terminando em `ate`, inclusive nas duas
 * pontas. Doze meses terminando em março de 2026 começam em abril de 2025.
 */
export function janelaDeMeses(ate: MesAno, quantos: number): { de: MesAno; ate: MesAno } {
  return { de: doNumero(ordem(ate) - (Math.max(1, quantos) - 1)), ate }
}

export interface RendimentoDoPapel {
  ticker: string
  /** Provento bruto recebido na janela. */
  provento: number
  /** Custo da posição ATUAL: quantidade × custo médio. `null` = sem posição. */
  custo: number | null
  /**
   * `provento ÷ custo`. `null` quando não há posição — papel vendido por
   * inteiro não tem sobre o que render — ou quando a posição custou zero.
   */
  rendimento: number | null
}

/**
 * Quanto cada papel pagou, contra o que ele custou.
 *
 * Sobre CUSTO, e não sobre mercado, porque é o que este núcleo sabe: nenhum
 * relatório da B3 que a família lê traz cotação. Quem tiver o preço do dia
 * calcula o outro a partir daqui; os dois respondem perguntas diferentes, e o
 * de custo é o que diz se a compra foi boa.
 *
 * A aproximação que vale declarar: o custo é o da posição de HOJE, e o provento
 * é o da janela inteira — uma posição que dobrou durante o período divide um
 * provento antigo por um custo novo. Na janela de doze meses o erro é pequeno;
 * no período todo de quem acumulou muito, ele subestima. É o mesmo yield on
 * cost de sempre, com a mesma ressalva de sempre.
 *
 * Papel com posição e sem provento sai com `rendimento: 0` — «não pagou nada»
 * é resposta, e omiti-lo faria a lista parecer menor do que a carteira é.
 */
export function yieldSobreCusto(
  serie: SerieProventos,
  posicao: readonly Posicao[],
  janela?: { de: MesAno; ate: MesAno },
): RendimentoDoPapel[] {
  const dentro = (m: MesAno) =>
    janela === undefined || (ordem(m) >= ordem(janela.de) && ordem(m) <= ordem(janela.ate))

  const custoDe = new Map(posicao.map((p) => [p.ticker, p.quantidade * p.custoMedio]))
  const tickers = new Set([...serie.porTicker.map((t) => t.ticker), ...custoDe.keys()])

  return [...tickers]
    .sort((a, b) => a.localeCompare(b))
    .map((ticker) => {
      const t = serie.porTicker.find((x) => x.ticker === ticker)
      const provento = (t?.meses ?? []).filter(dentro).reduce((s, m) => s + m.total, 0)
      const custo = custoDe.get(ticker) ?? null
      return {
        ticker,
        provento,
        custo,
        rendimento: custo !== null && custo > 0 ? provento / custo : null,
      }
    })
}
