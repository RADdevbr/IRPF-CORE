// O que a bolsa rendeu e a declaração não conta.
//
// Ação, FII e ETF entram na declaração pelo custo. Com a posição da B3 em 31/12
// (ver `lerPosicao`), cada um tem também o valor de mercado, e a diferença entre
// os dois é o ganho ainda não realizado. De um ano para o outro, o que esse
// ganho andou é a valorização do ano — rendimento do capital que o patrimônio
// declarado só vai mostrar no dia da venda.
//
// A ligação é pelo TICKER dentro da descrição do bem (`casarAtivo`), como em
// todo o resto do extrato. O papel que não casa com bem nenhum fica de fora, e
// contado: sem o custo dele não há ganho a medir, e chutar o custo inventaria
// valorização.
//
// A valorização de um ano só existe com a posição dos DOIS 31/12. Com um só,
// sabe-se o ganho acumulado, mas não quanto dele é do ano.

import type { ItemDaPosicao } from '../b3/posicao.js'
import { casarAtivo } from '../b3/papel.js'
import type { ClassePatrimonio, Historico } from '../historico/historico.js'

/** As posições da B3 por ano-base — a de 31/12 daquele ano. */
export type PosicoesPorAno = Record<number, readonly ItemDaPosicao[]>

export interface BemAMercado {
  id: string
  descricao: string
  classe: ClassePatrimonio
  /** O saldo declarado em 31/12 — o custo. */
  custo: number
  /** A soma do valor atualizado dos papéis que casaram com ele. */
  mercado: number
  ativos: string[]
}

export interface MercadoDoAno {
  anoBase: number
  /** Σ (mercado − custo) dos bens que casaram: o ganho ainda não realizado em 31/12. */
  ganho: number
  bens: BemAMercado[]
  /** Papéis da posição sem bem na declaração — sem o custo, fora da conta. */
  semBem: ItemDaPosicao[]
  /**
   * A valorização do ano: o ganho de 31/12 menos o do ano anterior. `null` sem a
   * posição do ano anterior — o ganho acumulado não diz quanto é deste ano.
   */
  valorizacao: number | null
}

/**
 * O valor de mercado dos bens em cada 31/12 com posição, e a valorização de cada
 * ano que tem a posição do anterior.
 *
 * Cada papel da posição vai para UM bem: o primeiro cuja descrição traga o
 * ticker. Dois bens com o mesmo ticker (a mesma ação em duas corretoras, uma
 * linha cada) recebem juntos: o custo dos dois soma contra o mercado dos dois.
 */
export function aMercado(h: Historico, posicoes: PosicoesPorAno): Record<number, MercadoDoAno> {
  const saida: Record<number, MercadoDoAno> = {}
  const anos = Object.keys(posicoes)
    .map(Number)
    .filter((a) => h[String(a)])
    .sort((a, b) => a - b)

  for (const ano of anos) {
    const d = h[String(ano)]
    // o mercado de cada ticker, somado entre corretoras
    const porAtivo = new Map<string, number>()
    for (const it of posicoes[ano]) porAtivo.set(it.ativo, (porAtivo.get(it.ativo) ?? 0) + it.valor)

    const bens = new Map<string, BemAMercado>()
    const usados = new Set<string>()
    for (const [ativo, valor] of porAtivo) {
      const casam = d.posicoes.filter((p) => p.saldoAtual > 0 && casarAtivo(p.descricao, ativo))
      if (casam.length === 0) continue
      usados.add(ativo)
      // o mercado do ticker é dividido entre os bens dele pelo custo de cada um
      const custoTotal = casam.reduce((t, p) => t + p.saldoAtual, 0)
      for (const p of casam) {
        const b = bens.get(p.id) ?? { id: p.id, descricao: p.descricao, classe: p.classe, custo: 0, mercado: 0, ativos: [] }
        if (!b.ativos.includes(ativo)) {
          b.ativos.push(ativo)
          b.custo += p.saldoAtual
        }
        b.mercado += custoTotal > 0 ? (valor * p.saldoAtual) / custoTotal : 0
        bens.set(p.id, b)
      }
    }
    const lista = [...bens.values()]
    const ganho = lista.reduce((t, b) => t + b.mercado - b.custo, 0)
    const anterior = saida[ano - 1]
    saida[ano] = {
      anoBase: ano,
      ganho,
      bens: lista.sort((a, b) => b.mercado - a.mercado),
      semBem: posicoes[ano].filter((it) => !usados.has(it.ativo)),
      valorizacao: anterior ? ganho - anterior.ganho : null,
    }
  }
  return saida
}
