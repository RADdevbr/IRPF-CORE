// Do extrato para os bens da declaração: que posição é qual bem.
//
// O extrato fala em PRODUTO numa INSTITUIÇÃO («PETR4 - PETROBRAS» na XP, «CDB -
// … - BANCO X» no BTG); a declaração fala em texto livre, um bem por linha. Ligar
// os dois é o que transforma o extrato em três coisas que a declaração não diz:
//
//   · quanto entrou e saiu de cada bem em cada ano — o aporte, que separa o
//     dinheiro novo do rendimento;
//   · em que dia — o que permite ao juro por competência saber há quanto tempo o
//     dinheiro estava lá quando foi resgatado;
//   · onde o papel está guardado — a coluna «Instituição» é a custódia, que a
//     declaração só diz, e mal, para conta e renda fixa.
//
// A ligação é por POSIÇÃO (o papel numa instituição), e não por papel: a mesma
// ação em duas corretoras costuma ser declarada em duas linhas, e é a instituição
// que separa uma da outra.
//
// Duas forças de ligação, e a diferença importa:
//
//   · pelo TICKER dentro da descrição do bem — o casamento de sempre (ver
//     `casarAtivo`), que se afirma sozinho: «VALE3» na linha do bem é a VALE3;
//   · pelo NOME, na renda fixa, que não tem ticker. «CDB - … - BANCO X» e «CDB
//     BANCO X 2027» dividem palavras, e dividir palavras é indício, não prova.
//     Fica como sugestão, e só entra na conta quando a pessoa confirma.
//
// A resposta da pessoa manda sobre as duas, inclusive para dizer «nenhum bem».

import {
  chaveAporte,
  nomeParaCasar,
  resolverCadeias,
  type Aportes,
  type ClassePatrimonio,
  type Historico,
  type Vinculos,
} from '../historico/historico.js'
import { nomesPorCnpj } from '../historico/instituicao.js'
import type { MovimentoDatado } from '../patrimonio/competencia.js'
import { dinheiroDaLinha } from './fluxos.js'
import { dataOrdenavel, type Movimento } from './movimentacao.js'
import { casarAtivo, type PapelNaCarteira } from './papel.js'
import { tickerDoProduto } from './produto.js'

/** O papel numa instituição, com o que o extrato diz dele. */
export interface PosicaoDoExtrato {
  /** `ATIVO@INSTITUICAO` — a chave da resposta da pessoa. */
  chave: string
  ativo: string
  /** O produto como veio no arquivo, na primeira grafia. */
  produto: string
  /** A instituição como veio no arquivo, na primeira grafia. */
  instituicao: string
  /** Anos com alguma linha desta posição. */
  anos: number[]
  /** Dinheiro que entrou (compra, aplicação) e que saiu (venda, resgate), somado. */
  aportado: number
  resgatado: number
  /** A data da linha mais recente, de qualquer tipo, em aaaa-mm-dd. */
  ultima: string
}

/** A chave de uma linha: o ticker e a instituição sem acento, caixa nem pontuação. */
export const chaveDaPosicao = (l: Pick<Movimento, 'produto' | 'instituicao'>): string =>
  `${tickerDoProduto(l.produto)}@${nomeParaCasar(l.instituicao)}`

/**
 * As posições do extrato, com o dinheiro de cada uma.
 *
 * Entram todas as linhas, inclusive as que não movem dinheiro (provento,
 * desdobro, transferência): elas dizem que o papel estava naquela instituição
 * naquele dia, e é isso que a custódia lê. O dinheiro soma só o que
 * `dinheiroDaLinha` diz que é dinheiro.
 */
export function posicoesDoExtrato(
  linhas: readonly Movimento[],
  papeis: Record<string, PapelNaCarteira> = {},
): PosicaoDoExtrato[] {
  const porChave = new Map<string, PosicaoDoExtrato>()
  for (const l of linhas) {
    const chave = chaveDaPosicao(l)
    const p = porChave.get(chave) ?? {
      chave,
      ativo: tickerDoProduto(l.produto),
      produto: l.produto.trim(),
      instituicao: l.instituicao.trim(),
      anos: [],
      aportado: 0,
      resgatado: 0,
      ultima: '',
    }
    if (!p.anos.includes(l.ano)) p.anos.push(l.ano)
    const data = dataOrdenavel(l.data)
    if (data > p.ultima) p.ultima = data
    const d = dinheiroDaLinha(l, papeis)
    if (d.tipo === 'dinheiro') {
      if (d.valor > 0) p.aportado += d.valor
      else p.resgatado -= d.valor
    }
    porChave.set(chave, p)
  }
  return [...porChave.values()]
    .map((p) => ({ ...p, anos: p.anos.sort((a, b) => a - b) }))
    .sort((a, b) => a.ativo.localeCompare(b.ativo) || a.instituicao.localeCompare(b.instituicao))
}

// ------------------------------------------------------------------- os bens

/** Um bem do histórico, como a tela o oferece para ligar. */
export interface BemParaLigar {
  id: string
  /** A descrição do ano mais recente — a que a pessoa reconhece. */
  descricao: string
  classe: ClassePatrimonio
  anos: number[]
  /** As descrições de todos os anos: o ticker pode estar numa e não na outra. */
  descricoes: string[]
  cnpj?: string
}

/** Classes que o extrato da B3 pode ter: bolsa, fundo listado e renda fixa registrada. */
const NA_B3: ReadonlySet<ClassePatrimonio> = new Set([
  'acoes',
  'fii',
  'fundo',
  'cdb',
  'lci',
  'cri',
  'debentureComum',
  'debentureInc',
  'tesouro',
  'exterior',
  'desconhecido',
])

/** Os bens do histórico (já preparado) que podem receber movimento do extrato. */
export function bensParaLigar(h: Historico): BemParaLigar[] {
  const porId = new Map<string, BemParaLigar>()
  for (const d of Object.values(h).sort((a, b) => a.anoBase - b.anoBase)) {
    for (const p of d.posicoes) {
      const b = porId.get(p.id) ?? { id: p.id, descricao: p.descricao, classe: p.classe, anos: [], descricoes: [] }
      b.descricao = p.descricao
      b.classe = p.classe
      if (!b.anos.includes(d.anoBase)) b.anos.push(d.anoBase)
      if (!b.descricoes.includes(p.descricao)) b.descricoes.push(p.descricao)
      if (p.cnpj) b.cnpj = p.cnpj
      porId.set(p.id, b)
    }
  }
  return [...porId.values()].filter((b) => NA_B3.has(b.classe)).sort((a, b) => a.descricao.localeCompare(b.descricao))
}

// ------------------------------------------------------------------ a ligação

/** Como a posição chegou ao bem. */
export type OrigemDaLigacao = 'resposta' | 'ticker' | 'nenhuma'

export interface Ligacao {
  /** O bem que recebe os movimentos desta posição. `null` = nenhum. */
  bem: string | null
  origem: OrigemDaLigacao
  /**
   * O palpite pelo nome, na renda fixa sem ticker. Não entra em conta nenhuma
   * até a pessoa confirmar: dividir palavras com a descrição é indício.
   */
  sugerido?: { id: string; porque: string }
}

/** O que a pessoa respondeu, por posição: o id do bem, ou '' para «nenhum». */
export type RespostasDeLigacao = Record<string, string>

/** Palavras que não distinguem ninguém: forma jurídica, tipo de instituição, preposição. */
const VAZIAS = new Set([
  'S', 'A', 'SA', 'S/A', 'LTDA', 'CIA', 'COMPANHIA', 'DE', 'DO', 'DA', 'DOS', 'DAS', 'E', 'EM',
  'BANCO', 'BCO', 'CORRETORA', 'DISTRIBUIDORA', 'CCTVM', 'DTVM', 'CTVM', 'TITULOS', 'VALORES',
  'MOBILIARIOS', 'CAMBIO', 'INVESTIMENTOS', 'FINANCEIRA', 'MULTIPLO', 'CUSTODIA', 'CUSTODIADO',
  'NA', 'NO', 'PARA', 'COM', 'SEM',
])

const palavras = (texto: string): string[] =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p.length >= 2 && !VAZIAS.has(p))

/** Renda fixa e Tesouro: o produto que não tem ticker de bolsa. */
const RENDA_FIXA: ReadonlySet<ClassePatrimonio> = new Set([
  'cdb',
  'lci',
  'cri',
  'debentureComum',
  'debentureInc',
  'tesouro',
  'desconhecido',
])

const TIPO_DE_RENDA_FIXA = /^(CDB|LCI|LCA|LC|LF|LIG|LH|CRI|CRA|DEB|DEBENTURE|CCB|RDB|TESOURO|NTN|LTN|LFT)\b/

/**
 * Liga cada posição a um bem. A resposta manda; sem ela, o ticker; sem ticker, a
 * renda fixa ganha um palpite pelo nome, que espera confirmação.
 *
 * Quando o ticker casa com mais de um bem, desempata a instituição escrita na
 * descrição («PETR4 NA XP»), e depois o bem que existe nos anos do extrato. O
 * que ainda empata vai para o primeiro — como no casamento por ano.
 */
export function ligarPosicoes(
  h: Historico,
  posicoes: readonly PosicaoDoExtrato[],
  respostas: RespostasDeLigacao = {},
  vinculos: Vinculos = {},
): Record<string, Ligacao> {
  const bens = bensParaLigar(h)
  const existe = new Set(bens.map((b) => b.id))
  const destino = resolverCadeias(vinculos)
  const nomeDoCnpj = nomesPorCnpj(h)
  const saida: Record<string, Ligacao> = {}

  for (const p of posicoes) {
    const r = respostas[p.chave]
    if (r !== undefined) {
      const id = r === '' ? '' : (destino[r] ?? r)
      // Resposta para um bem que saiu do histórico não é resposta: cai no palpite.
      if (id === '' || existe.has(id)) {
        saida[p.chave] = { bem: id || null, origem: 'resposta' }
        continue
      }
    }

    const doTicker = bens.filter((b) => b.descricoes.some((d) => casarAtivo(d, p.ativo)))
    if (doTicker.length > 0) {
      const daInstituicao = palavras(p.instituicao)
      const pontos = (b: BemParaLigar) => {
        const na = new Set(b.descricoes.flatMap(palavras))
        const inst = daInstituicao.filter((w) => na.has(w)).length
        const anos = b.anos.filter((a) => p.anos.includes(a)).length
        return inst * 100 + anos
      }
      const melhor = doTicker.reduce((a, b) => (pontos(b) > pontos(a) ? b : a))
      saida[p.chave] = { bem: melhor.id, origem: 'ticker' }
      continue
    }

    saida[p.chave] = { bem: null, origem: 'nenhuma', ...sugestaoPeloNome(p, bens, nomeDoCnpj) }
  }
  return saida
}

/**
 * O palpite da renda fixa: o bem de renda fixa que mais divide palavras com o
 * produto. Precisa de duas palavras em comum — o tipo sozinho («CDB») casaria
 * com todo CDB — e de não empatar com outro bem.
 */
function sugestaoPeloNome(
  p: PosicaoDoExtrato,
  bens: readonly BemParaLigar[],
  nomeDoCnpj: Record<string, string>,
): Pick<Ligacao, 'sugerido'> {
  const produto = p.produto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
  if (!TIPO_DE_RENDA_FIXA.test(produto)) return {}
  const doProduto = new Set(palavras(produto))
  const pontuados = bens
    .filter((b) => RENDA_FIXA.has(b.classe))
    .map((b) => {
      const texto = [...b.descricoes, b.cnpj ? (nomeDoCnpj[b.cnpj] ?? '') : ''].join(' ')
      const comuns = [...new Set(palavras(texto))].filter((w) => doProduto.has(w))
      return { b, comuns }
    })
    .filter((x) => x.comuns.length >= 2)
    .sort((a, c) => c.comuns.length - a.comuns.length)
  if (pontuados.length === 0) return {}
  if (pontuados.length > 1 && pontuados[1].comuns.length === pontuados[0].comuns.length) return {}
  const { b, comuns } = pontuados[0]
  return { sugerido: { id: b.id, porque: `«${comuns.join(' ')}» no produto e no bem` } }
}

// ------------------------------------------------------- o que sai da ligação

/** Um movimento de dinheiro do extrato, já no bem: entra (+) ou sai (−), na data. */
export interface MovimentoDoBem extends MovimentoDatado {
  instituicao: string
  ativo: string
}

/**
 * Os movimentos de dinheiro de cada bem ligado, em ordem de data.
 *
 * Só a ligação firme conta (resposta ou ticker). O palpite pelo nome não —
 * movimento posto no bem errado muda o juro e o aporte de um bem que não tem
 * nada com ele.
 */
export function movimentosDosBens(
  linhas: readonly Movimento[],
  papeis: Record<string, PapelNaCarteira>,
  ligacoes: Record<string, Ligacao>,
): Record<string, MovimentoDoBem[]> {
  const saida: Record<string, MovimentoDoBem[]> = {}
  for (const l of linhas) {
    const bem = ligacoes[chaveDaPosicao(l)]?.bem
    if (!bem) continue
    const d = dinheiroDaLinha(l, papeis)
    if (d.tipo !== 'dinheiro') continue
    const data = dataOrdenavel(l.data)
    if (!data) continue
    ;(saida[bem] ??= []).push({ data, valor: d.valor, instituicao: l.instituicao.trim(), ativo: tickerDoProduto(l.produto) })
  }
  for (const lista of Object.values(saida)) lista.sort((a, b) => a.data.localeCompare(b.data))
  return saida
}

/**
 * O aporte de cada bem em cada ano, pelo extrato: o que entrou menos o que saiu.
 *
 * Só onde o bem está na declaração daquele ano — aporte num ano sem o bem não
 * tem saldo para descontar, e só enganaria quem lê a lista.
 */
export function aportesDoExtrato(h: Historico, movimentos: Record<string, readonly MovimentoDatado[]>): Aportes {
  const noAno = new Map<number, Set<string>>()
  for (const d of Object.values(h)) noAno.set(d.anoBase, new Set(d.posicoes.map((p) => p.id)))
  const saida: Aportes = {}
  for (const [bem, lista] of Object.entries(movimentos)) {
    for (const m of lista) {
      const ano = Number(m.data.slice(0, 4))
      if (!noAno.get(ano)?.has(bem)) continue
      const k = chaveAporte(bem, ano)
      saida[k] = (saida[k] ?? 0) + m.valor
    }
  }
  return saida
}

/** Onde o extrato diz que o bem está, e desde qual linha isso se sabe. */
export interface CustodiaDoExtrato {
  instituicao: string
  /** A data da linha mais recente que põe o bem ali, em aaaa-mm-dd. */
  data: string
}

/**
 * A custódia de cada bem ligado: a instituição da linha mais recente.
 *
 * A mais recente, e não a de mais dinheiro: quem transferiu a carteira de uma
 * corretora para outra tem o passado inteiro na primeira, e o papel na segunda.
 * Provento e desdobro contam — caem na corretora onde o papel está.
 */
export function custodiaDoExtrato(
  posicoes: readonly PosicaoDoExtrato[],
  ligacoes: Record<string, Ligacao>,
): Record<string, CustodiaDoExtrato> {
  const saida: Record<string, CustodiaDoExtrato> = {}
  for (const p of posicoes) {
    const bem = ligacoes[p.chave]?.bem
    if (!bem || !p.instituicao) continue
    const atual = saida[bem]
    if (!atual || p.ultima > atual.data) saida[bem] = { instituicao: p.instituicao, data: p.ultima }
  }
  return saida
}
