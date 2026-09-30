// O que não fecha de uma declaração para a seguinte — bem a bem.
//
// Cada linha de Bens e Direitos traz dois saldos: o de 31/12 do ano anterior e
// o deste ano. O primeiro tem de repetir o segundo da declaração passada, e é
// daí que sai a conferência que nenhuma tela fazia:
//
//   · o bem que tinha saldo e SUMIU da declaração seguinte. Vendido ou
//     resgatado, ele deveria continuar lá com saldo atual zero; mudou de nome,
//     o casamento entre anos o perde;
//   · o bem que ENTROU dizendo que já valia algo no ano passado, sem par na
//     declaração passada — quase sempre o mesmo de cima, com outro nome;
//   · o mesmo bem com saldo anterior DIFERENTE do que a declaração passada
//     disse;
//   · o bem ZERADO e REABERTO no mesmo ano com outro nome. O arquivo não liga
//     um ao outro (o novo diz que não valia nada no ano passado), e a série do
//     bem parte em duas;
//   · a DESCRIÇÃO que mudou entre anos de um bem que o app ou a pessoa já
//     ligou. Usar a mesma descrição na próxima declaração é o que dispensa a
//     ligação.
//
// Nada aqui muda número nenhum: é o que conferir, com o par sugerido quando o
// próprio arquivo aponta um. O zerado-e-reaberto fica de propósito só como
// sugestão — ligar duas linhas do MESMO ano no mesmo bem somaria um bem que
// termina com outro que começa, e as séries por bem não esperam isso.

import { COMO_VALORA, resolverCadeias, type ClassePatrimonio, type Historico, type PosicaoAno, type Vinculos } from './historico.js'
import { semelhanca } from './vinculoAuto.js'

export type TipoAchado = 'sumiuComSaldo' | 'entrouComSaldoAnterior' | 'saldoAnteriorDiferente' | 'zeradoEReaberto' | 'descricaoMudou'

export interface AchadoContinuidade {
  tipo: TipoAchado
  /** O ano da declaração em que o problema aparece — o mais novo do par. */
  anoBase: number
  /** Id do bem (já com as ligações aplicadas). */
  id: string
  descricao: string
  classe: ClassePatrimonio
  /** O saldo em jogo: o que sumiu, o saldo anterior sem par, a diferença, o valor zerado. */
  valor: number
  /** O par que o arquivo aponta, quando aponta. */
  par?: { id: string; anoBase: number; descricao: string; valor: number }
  /** O que fazer, em uma frase. */
  oQueFazer: string
}

export interface ContinuidadeDoAno {
  anoBase: number
  /** Patrimônio que a declaração do ano anterior declarou em 31/12. */
  patrimonioAnterior: number
  /** A soma dos «saldo em 31/12 do ano anterior» desta declaração. */
  somaDosSaldosAnteriores: number
  /** Deveria ser zero. */
  diferenca: number
}

export interface Continuidade {
  achados: AchadoContinuidade[]
  /** Só pares de anos seguidos: com buraco no meio, não há o que comparar. */
  porAno: ContinuidadeDoAno[]
}

/** Abaixo disto é arredondamento, não diferença. */
export const TOLERANCIA_SALDO = 1

interface Bem {
  id: string
  descricao: string
  classe: ClassePatrimonio
  s0: number
  s1: number
}

/** As linhas do ano por id — a ligação pode ter juntado duas. */
function porId(posicoes: readonly PosicaoAno[]): Map<string, Bem> {
  const m = new Map<string, Bem>()
  for (const p of posicoes) {
    const b = m.get(p.id)
    if (b) {
      b.s0 += p.saldoAnterior
      b.s1 += p.saldoAtual
    } else {
      m.set(p.id, { id: p.id, descricao: p.descricao, classe: p.classe, s0: p.saldoAnterior, s1: p.saldoAtual })
    }
  }
  return m
}

const perto = (a: number, b: number) => Math.abs(a - b) <= TOLERANCIA_SALDO
const texto = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * O bem zerado e o aberto no mesmo ano são o mesmo?
 *
 * O valor igual só vale como sinal onde o saldo não anda sozinho — no bem
 * declarado pelo custo (ação, FII, carro): ali o novo repete o velho ao
 * centavo. Na renda fixa, o novo título com o valor do velho é coincidência
 * tanto quanto é renomeação. A descrição parecida vale para os dois.
 */
function mesmoBem(fim: Bem, inicio: Bem): number {
  if (fim.classe !== inicio.classe) return 0
  let pontos = 0
  if (COMO_VALORA[fim.classe] === 'custo' && perto(fim.s0, inicio.s1)) pontos += 3
  const s = semelhanca(fim.descricao, inicio.descricao)
  if (s >= 0.6) pontos += 3
  else if (s >= 0.35) pontos += 1
  // valor muito longe desmente a descrição parecida: é outro bem
  const razao = fim.s0 > 0 ? inicio.s1 / fim.s0 : 0
  if (razao < 0.5 || razao > 2) pontos -= 3
  return pontos
}

/**
 * O que conferir entre cada declaração e a seguinte.
 *
 * `h` é o histórico cru e `vinculos` as ligações efetivas (automáticas e à
 * mão): é depois delas que se sabe o que continua faltando, e é com elas que se
 * vê que descrição mudou.
 */
export function continuidadeEntreAnos(h: Historico, vinculos: Vinculos = {}): Continuidade {
  const mapa = resolverCadeias(vinculos)
  const idDe = (id: string) => mapa[id] ?? id
  const decs = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  const achados: AchadoContinuidade[] = []
  const porAno: ContinuidadeDoAno[] = []

  const ligado = decs.map((d) => ({ anoBase: d.anoBase, bens: porId(d.posicoes.map((p) => ({ ...p, id: idDe(p.id) }))) }))

  for (let i = 1; i < ligado.length; i++) {
    const ant = ligado[i - 1]
    const atual = ligado[i]
    if (atual.anoBase - ant.anoBase !== 1) continue
    const ano = atual.anoBase

    const patrimonioAnterior = [...ant.bens.values()].reduce((t, b) => t + b.s1, 0)
    const somaDosSaldosAnteriores = [...atual.bens.values()].reduce((t, b) => t + b.s0, 0)
    porAno.push({ anoBase: ano, patrimonioAnterior, somaDosSaldosAnteriores, diferenca: somaDosSaldosAnteriores - patrimonioAnterior })

    const sumiram = [...ant.bens.values()].filter((b) => !atual.bens.has(b.id) && b.s1 > TOLERANCIA_SALDO)
    const entraram = [...atual.bens.values()].filter((b) => !ant.bens.has(b.id) && b.s0 > TOLERANCIA_SALDO)

    // o par que o arquivo aponta: o saldo anterior do novo é o saldo do velho
    const pareados = new Set<string>()
    for (const v of sumiram) {
      const n = entraram.find((e) => !pareados.has(e.id) && perto(e.s0, v.s1))
      if (n) pareados.add(n.id)
      achados.push({
        tipo: 'sumiuComSaldo',
        anoBase: ano,
        id: v.id,
        descricao: v.descricao,
        classe: v.classe,
        valor: v.s1,
        ...(n ? { par: { id: n.id, anoBase: ano, descricao: n.descricao, valor: n.s0 } } : {}),
        oQueFazer: n
          ? `é o mesmo bem com outro nome em ${ano} — o saldo anterior dele repete este. Ligue os dois, e na próxima declaração mantenha uma descrição só`
          : `sumiu da declaração de ${ano} com saldo. Vendido ou resgatado, ele continua lá com saldo atual zero; com outro nome, ligue ao novo`,
      })
    }
    for (const n of entraram) {
      if (pareados.has(n.id)) continue
      achados.push({
        tipo: 'entrouComSaldoAnterior',
        anoBase: ano,
        id: n.id,
        descricao: n.descricao,
        classe: n.classe,
        valor: n.s0,
        oQueFazer: `a declaração de ${ano} diz que ele já valia isso em 31/12/${ano - 1}, e a de ${ano - 1} não o traz com esse nome — ligue ao bem do ano passado`,
      })
    }

    for (const b of atual.bens.values()) {
      const a = ant.bens.get(b.id)
      if (!a || perto(a.s1, b.s0)) continue
      achados.push({
        tipo: 'saldoAnteriorDiferente',
        anoBase: ano,
        id: b.id,
        descricao: b.descricao,
        classe: b.classe,
        valor: b.s0 - a.s1,
        par: { id: a.id, anoBase: ant.anoBase, descricao: a.descricao, valor: a.s1 },
        oQueFazer: `o saldo em 31/12/${ano - 1} é um na declaração de ${ano - 1} e outro na de ${ano} — um dos dois está errado`,
      })
    }
  }

  // Zerado e reaberto no mesmo ano: o velho termina (saldo atual zero) e um
  // novo começa (saldo anterior zero) — só o nome mudou, e o arquivo não diz.
  for (const d of ligado) {
    const fins = [...d.bens.values()].filter((b) => b.s0 > TOLERANCIA_SALDO && b.s1 <= TOLERANCIA_SALDO)
    const inicios = [...d.bens.values()].filter((b) => b.s0 <= TOLERANCIA_SALDO && b.s1 > TOLERANCIA_SALDO)
    const pares = fins
      .flatMap((f) => inicios.map((n) => ({ f, n, pontos: mesmoBem(f, n) })))
      .filter((p) => p.pontos >= 3)
      .sort((a, b) => b.pontos - a.pontos)
    const usados = new Set<string>()
    for (const { f, n } of pares) {
      if (usados.has(f.id) || usados.has(n.id)) continue
      usados.add(f.id)
      usados.add(n.id)
      achados.push({
        tipo: 'zeradoEReaberto',
        anoBase: d.anoBase,
        id: f.id,
        descricao: f.descricao,
        classe: f.classe,
        valor: f.s0,
        par: { id: n.id, anoBase: d.anoBase, descricao: n.descricao, valor: n.s1 },
        oQueFazer: `zerado e aberto de novo com outro nome em ${d.anoBase}. Se é o mesmo bem, na próxima declaração mantenha uma linha só, com a descrição de antes — a série dele fica partida em duas`,
      })
    }
  }

  // A descrição que mudou num bem já ligado: a mais recente é a que vale.
  const descricoes = new Map<string, { anoBase: number; descricao: string; classe: ClassePatrimonio }[]>()
  for (const d of decs) {
    for (const p of d.posicoes) {
      const id = idDe(p.id)
      const lista = descricoes.get(id) ?? []
      lista.push({ anoBase: d.anoBase, descricao: p.descricao, classe: p.classe })
      descricoes.set(id, lista)
    }
  }
  for (const [id, lista] of descricoes) {
    const distintas = new Map<string, { anoBase: number; descricao: string }>()
    for (const x of lista) if (!distintas.has(texto(x.descricao))) distintas.set(texto(x.descricao), x)
    if (distintas.size < 2) continue
    const ordem = [...distintas.values()].sort((a, b) => a.anoBase - b.anoBase)
    const ultima = ordem[ordem.length - 1]
    const antes = ordem[ordem.length - 2]
    achados.push({
      tipo: 'descricaoMudou',
      anoBase: ultima.anoBase,
      id,
      descricao: ultima.descricao,
      classe: lista[lista.length - 1].classe,
      valor: 0,
      par: { id, anoBase: antes.anoBase, descricao: antes.descricao, valor: 0 },
      oQueFazer: `a descrição mudou ${distintas.size - 1 === 1 ? 'uma vez' : `${distintas.size - 1} vezes`} entre os anos. Use sempre a mesma na próxima declaração — é o que liga o bem sem depender de ninguém`,
    })
  }

  const ordemTipo: TipoAchado[] = ['sumiuComSaldo', 'entrouComSaldoAnterior', 'saldoAnteriorDiferente', 'zeradoEReaberto', 'descricaoMudou']
  achados.sort((a, b) => b.anoBase - a.anoBase || ordemTipo.indexOf(a.tipo) - ordemTipo.indexOf(b.tipo) || Math.abs(b.valor) - Math.abs(a.valor))
  return { achados, porAno }
}
