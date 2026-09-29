// Quanto a renda fixa rendeu em cada ano — pelo juro, e não pelo saldo.
//
// A conta pelo saldo (fim − início − aporte) só vale para o bem declarado pelo
// valor ATUALIZADO, em que o juro do ano entra no número. Boa parte da renda
// fixa é declarada pelo valor APLICADO: o saldo só anda com aplicação e resgate,
// e o juro aparece em outro lugar do `.DEC` — no rendimento que o CNPJ pagou
// (`RendimentoDeAplicacao`), e só quando o papel é resgatado. Ler o saldo aí dá
// o absurdo que a pessoa viu: aporte vestido de rendimento, e resgate vestido de
// prejuízo.
//
// O que a declaração dá, e o que se faz com cada coisa:
//
//   · o que cada CNPJ PAGOU no ano. Número exato, mas de caixa: o CDB de três
//     anos resgatado agora põe os três anos de juro neste ano;
//   · a história do saldo de cada bem. No valor aplicado, a variação dele é o
//     que entrou e saiu de dinheiro — sem precisar de aporte informado —, e daí
//     saem os lotes: quanto entrou, quando, e quanto saiu, quando (o primeiro a
//     entrar é o primeiro a sair);
//   · o CNPJ na linha do bem, que liga o juro pago ao bem que o gerou.
//
// Juntando: cada instituição (cada CNPJ) paga uma fração do CDI — a `taxa`,
// calibrada para que o juro que o modelo põe nos lotes resgatados bata com o que
// ela de fato pagou. Com a taxa, o juro é espalhado pelos anos em que o dinheiro
// ficou lá (competência), e o lote resgatado é ajustado para somar exatamente o
// que foi pago. O dinheiro que ainda está aplicado rende à mesma taxa, e sai
// marcado como estimado.
//
// No valor atualizado, o saldo já diz o juro — quando não houve aplicação nem
// resgate no ano. Aí ele é medido; nos anos com movimento, a mesma taxa estima.
//
// O extrato da B3, quando existe, dá o que a declaração não tem: a DATA de cada
// aplicação e de cada resgate (ver `MovimentoDatado`). Com ela o lote entra no
// dia em que entrou, e não no meio do ano; o lote que a primeira declaração já
// encontra ganha a data em que foi aplicado, anos antes — e o resgate dele passa
// a medir a taxa, em vez de ficar de fora por não se saber há quanto tempo o
// dinheiro estava lá. No valor atualizado, o ano com movimento deixa de ser
// estimado: saldo final − inicial − o que entrou e saiu é o juro.

import { cnpjValido } from '../dec/decParser.js'
import type { ClassePatrimonio, Historico } from '../historico/historico.js'
import { taxaDoAno, type BenchmarksInformados } from './benchmarks.js'

/** Como a instituição declara o saldo da renda fixa: pelo valor aplicado, ou com o juro dentro. */
export type ComoDeclara = 'aplicado' | 'atualizado'

/** A resposta da pessoa, por CNPJ. Costuma seguir o informe de rendimentos de cada instituição. */
export type ComoDeclaraPorCnpj = Record<string, ComoDeclara>

/**
 * De onde saiu a taxa do CNPJ.
 *
 *   · `resgates` — do juro pago nos resgates, contra o tempo que o dinheiro ficou;
 *   · `saldo` — do saldo que andou sozinho, no valor atualizado;
 *   · `pagamentos` — do juro pago em ano sem resgate (cupom, juro periódico);
 *   · `cdi` — de nada que meça. Renda fixa de banco: supõe 100% do CDI;
 *   · `nenhuma` — de nada, e o pote é só de fundo. Um fundo parado pelo custo
 *     pode ser de ações; supor CDI ali seria inventar o número. Fica sem medida.
 */
export type OrigemDaTaxa = 'resgates' | 'saldo' | 'pagamentos' | 'cdi' | 'nenhuma'

/**
 * Dinheiro que entrou (+) ou saiu (−) de um bem, na data. É o que o extrato da B3
 * dá, bem a bem (ver `movimentosDosBens`, em `b3`).
 *
 * O resgate vem BRUTO — o que saiu, com o juro dentro. No valor aplicado, quem
 * diz quanto disso era principal é a declaração: a data e o peso de cada resgate
 * vêm daqui, o total de principal vem da queda do saldo.
 */
export interface MovimentoDatado {
  /** aaaa-mm-dd. */
  data: string
  valor: number
}

/** Os movimentos datados, por bem (id do histórico já preparado). */
export type MovimentosPorBem = Record<string, readonly MovimentoDatado[]>

export interface CompetenciaAno {
  anoBase: number
  /** Juro do ano que já foi pago, espalhado de volta pelos anos em que rendeu. */
  medido: number
  /** Juro do ano de dinheiro ainda aplicado (ou sem pagamento lido), à taxa do CNPJ. */
  estimado: number
  /** Dinheiro que entrou (+) ou saiu (−) do bem no ano, sem o juro. */
  fluxo: number
  saldoInicial: number
  saldoFinal: number
  /** O dinheiro do ano entrou e saiu nas datas do extrato, e não no meio do ano. */
  peloExtrato?: true
}

export interface PoteDeRendimento {
  cnpj: string
  /** O nome que os rendimentos dão ao CNPJ; vazio se ele não pagou nada lido. */
  nome: string
  /** Os bens (ids) cujo juro este CNPJ paga. */
  bens: string[]
  comoDeclara: ComoDeclara
  /** O que o app acha, e por quê — a pessoa confirma ou troca. */
  sugerido: ComoDeclara
  porqueSugerido: string
  respondido: boolean
  /** Fração do CDI que o CNPJ rende (0,95 = 95% do CDI). `null` = sem medida (ver `OrigemDaTaxa`). */
  taxa: number | null
  origemDaTaxa: OrigemDaTaxa
  /** A taxa ficou no limite do razoável — o dado não sustentou o número que deu. */
  taxaNoLimite: boolean
  /** Juro pago no ano, por ano-base. `null` = ano lido antes de o leitor separar o juro. */
  pago: Record<number, number | null>
  /** Algum bem do pote teve as datas do extrato da B3 — ver `MovimentoDatado`. */
  comExtrato: boolean
}

export interface RendimentoPorCompetencia {
  potes: PoteDeRendimento[]
  /** Por bem (id), os anos que deu para calcular — ano sem CDI conhecido fica de fora. */
  porBem: Record<string, CompetenciaAno[]>
  /** Juro pago por CNPJ que nenhum bem do histórico leva — fundo sem linha, CNPJ só na descrição… */
  semBem: { cnpj: string; nome: string; anoBase: number; valor: number }[]
}

/**
 * Classes cujo juro quem paga é o CNPJ que a guarda (ou, no fundo, o próprio
 * fundo). Poupança fica de fora: o saldo dela já traz o juro creditado todo mês,
 * e o que ela rende é tirado do juro pago pelo banco (ver `rendimentoDaPoupanca`).
 */
const RENDE_JURO: ReadonlySet<ClassePatrimonio> = new Set([
  'cdb',
  'lci',
  'cri',
  'debentureComum',
  'debentureInc',
  'tesouro',
  'fundo',
])

/** Limites da taxa, em fração do CDI. Fora disso é o dado que não fecha, não a instituição. */
const TAXA_MIN = 0.2
const TAXA_MAX = 2.5

/** Menos de um centavo não é dinheiro — é arredondamento das somas. */
const EPS = 0.005

interface InfoBem {
  id: string
  classe: ClassePatrimonio
  cnpj?: string
  grupo?: string
  subcodigo?: string
}

const CNPJ_NA_DESCRICAO = /\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g

/**
 * O CNPJ do bem: o da linha, do ano mais recente que o traz; senão, um CNPJ
 * válido escrito na descrição — era assim que se fazia antes de o campo existir.
 */
function infoDosBens(h: Historico): Map<string, InfoBem> {
  const info = new Map<string, InfoBem>()
  for (const d of Object.values(h).sort((a, b) => a.anoBase - b.anoBase)) {
    for (const p of d.posicoes) {
      const atual = info.get(p.id) ?? { id: p.id, classe: p.classe }
      atual.classe = p.classe
      const naDescricao = [...p.descricao.matchAll(CNPJ_NA_DESCRICAO)].map((m) => cnpjValido(m[0])).find(Boolean)
      const cnpj = p.cnpj ?? naDescricao
      if (cnpj) atual.cnpj = cnpj
      if (p.subcodigo) {
        atual.grupo = p.codigo
        atual.subcodigo = p.subcodigo
      }
      info.set(p.id, atual)
    }
  }
  return info
}

/** Entra no pote do CNPJ: renda fixa e fundo, ou o não classificado do grupo de aplicações e de fundos. */
function entraNoPote(b: InfoBem): boolean {
  if (!b.cnpj) return false
  if (RENDE_JURO.has(b.classe)) return true
  if (b.classe !== 'desconhecido') return false
  if (b.grupo === '07') return true
  return b.grupo === '04' && b.subcodigo !== '01'
}

/** Renda fixa de banco: a que costuma seguir o CDI, e em que supô-lo é um palpite defensável. */
const ehRendaFixa = (b: InfoBem) =>
  b.classe === 'cdb' ||
  b.classe === 'lci' ||
  b.classe === 'cri' ||
  b.classe === 'debentureComum' ||
  b.classe === 'debentureInc' ||
  b.classe === 'tesouro' ||
  (b.classe === 'desconhecido' && b.grupo === '04')

const ehPoupanca = (b: InfoBem) => b.classe === 'poupanca' || (b.grupo === '04' && b.subcodigo === '01')

/**
 * Quanto a poupança rendeu no ano, para sair do juro pago pelo banco.
 *
 * O código 12 dos isentos junta poupança com LCI e LCA, e o banco que tem os
 * dois paga numa linha só. A poupança rende 70% da Selic, ou 6,17% ao ano com a
 * Selic acima de 8,5% — sem a TR, que é pequena. Aproximação, e é só para não
 * somar o juro da poupança ao da LCA.
 */
function rendimentoDaPoupanca(saldoMedio: number, ano: number, informados: BenchmarksInformados): number {
  const selic = taxaDoAno('selic', ano, informados)
  if (selic === null || saldoMedio <= 0) return 0
  return saldoMedio * (selic > 0.085 ? 0.0617 : 0.7 * selic)
}

interface Saldo {
  s0: number
  s1: number
}

/** Saldo do bem no ano: a soma das linhas do mesmo id (o vínculo pode ter juntado duas). */
function saldosDoAno(h: Historico, ano: number, id: string): Saldo | null {
  const d = h[String(ano)]
  if (!d) return null
  const ps = d.posicoes.filter((p) => p.id === id)
  if (ps.length === 0) return null
  return { s0: ps.reduce((s, p) => s + p.saldoAnterior, 0), s1: ps.reduce((s, p) => s + p.saldoAtual, 0) }
}

/** Valor redondo: múltiplo de R$ 100, sem centavo — é aplicação, não juro. */
const redondo = (v: number) => Math.round(Math.abs(v) * 100) % 10_000 === 0

/**
 * Como a instituição declara o saldo, pelo que ele fez de um ano para o outro.
 *
 * Juro nunca dá número redondo, e nunca deixa o saldo parado: o bem que ficou o
 * ano inteiro com o mesmo saldo, ou andou em valor redondo, está pelo valor
 * aplicado. O que andou pouco, sem ser redondo, e dentro do que o CDI daria,
 * está com o juro dentro. Sem ano para comparar, supõe valor aplicado — é o jeito
 * que o juro vem separado, que é o caso que a conta pelo saldo erra.
 */
export function sugerirComoDeclara(
  h: Historico,
  bens: readonly string[],
  informados: BenchmarksInformados = {},
): { sugerido: ComoDeclara; porque: string } {
  let aplicado = 0
  let atualizado = 0
  for (const d of Object.values(h)) {
    const cdi = taxaDoAno('cdi', d.anoBase, informados)
    for (const id of bens) {
      const s = saldosDoAno(h, d.anoBase, id)
      if (!s || s.s0 <= 0 || s.s1 <= 0) continue
      const delta = s.s1 - s.s0
      if (Math.abs(delta) < EPS || redondo(delta)) aplicado++
      else if (cdi !== null && delta > 0 && delta <= s.s0 * cdi * 2) atualizado++
    }
  }
  if (atualizado > aplicado) {
    return { sugerido: 'atualizado', porque: `o saldo andou como juro — sem valor redondo — em ${atualizado} ${atualizado === 1 ? 'ano' : 'anos'} de bem` }
  }
  if (aplicado > 0) {
    return { sugerido: 'aplicado', porque: `o saldo ficou parado ou andou em valor redondo em ${aplicado} ${aplicado === 1 ? 'ano' : 'anos'} de bem` }
  }
  return { sugerido: 'aplicado', porque: 'sem ano que mostre: suposto pelo valor aplicado — confira' }
}

// ------------------------------------------------------------ valor aplicado

interface Lote {
  principal: number
  juros: number
  /** Ano em que entrou (fracionário, meio do ano). `null` = já estava lá antes do primeiro ano. */
  entrada: number | null
  porAno: Map<number, number>
}

interface Saida {
  bem: string
  ano: number
  juros: number
  datada: boolean
  porAno: Map<number, number>
}

const escalar = (m: Map<number, number>, f: number) => new Map([...m].map(([k, v]) => [k, v * f]))

function acumular(lotes: Lote[], taxaAno: number | null, fracao: number, ano: number) {
  if (taxaAno === null) return
  const f = (1 + taxaAno) ** fracao - 1
  for (const l of lotes) {
    const j = (l.principal + l.juros) * f
    l.juros += j
    l.porAno.set(ano, (l.porAno.get(ano) ?? 0) + j)
  }
}

/** Tira `valor` de principal, do lote mais antigo para o mais novo, com o juro proporcional. */
function tirar(lotes: Lote[], valor: number): Lote[] {
  const saem: Lote[] = []
  let falta = valor
  while (falta > EPS && lotes.length > 0) {
    const l = lotes[0]
    if (l.principal <= falta + EPS) {
      saem.push(l)
      lotes.shift()
      falta -= l.principal
    } else {
      const f = falta / l.principal
      saem.push({ principal: falta, juros: l.juros * f, entrada: l.entrada, porAno: escalar(l.porAno, f) })
      l.principal -= falta
      l.juros *= 1 - f
      l.porAno = escalar(l.porAno, 1 - f)
      falta = 0
    }
  }
  return saem
}

/** Tira `valor` de lotes pelo que VALEM (principal e juro), do mais antigo — o resgate bruto. */
function tirarPorValor(lotes: Lote[], valor: number) {
  let falta = valor
  while (falta > EPS && lotes.length > 0) {
    const l = lotes[0]
    const vale = l.principal + l.juros
    if (vale <= falta + EPS) {
      lotes.shift()
      falta -= vale
    } else {
      const f = 1 - falta / vale
      l.principal *= f
      l.juros *= f
      l.porAno = escalar(l.porAno, f)
      falta = 0
    }
  }
}

/** A data como fração de ano: 2 de julho de 2024 ≈ 2024,5. `null` se não for data. */
function quando(data: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data)
  if (!m) return null
  const ano = Number(m[1])
  const dia = Date.UTC(ano, Number(m[2]) - 1, Number(m[3]))
  const inicio = Date.UTC(ano, 0, 1)
  return ano + (dia - inicio) / (Date.UTC(ano + 1, 0, 1) - inicio)
}

/** Rende de `de` até `ate`, cada trecho com o CDI do seu ano. */
function acumularEntre(lotes: Lote[], k: number, de: number, ate: number, informados: BenchmarksInformados) {
  let t = de
  while (t < ate - 1e-9) {
    const ano = Math.floor(t)
    const fim = Math.min(ate, ano + 1)
    const cdi = taxaDoAno('cdi', ano, informados)
    acumular(lotes, cdi === null ? null : k * cdi, fim - t, ano)
    t = fim
  }
}

interface Evento {
  t: number
  valor: number
}

const eventos = (lista: readonly MovimentoDatado[] | undefined): Evento[] =>
  (lista ?? [])
    .map((m) => ({ t: quando(m.data), valor: m.valor }))
    .filter((e): e is Evento => e.t !== null && Math.abs(e.valor) > EPS)
    .sort((a, b) => a.t - b.t)

interface Simulacao {
  saidas: Saida[]
  /** Lotes que continuam aplicados no fim, por bem. */
  abertos: Map<string, Lote[]>
}

/**
 * O pote inteiro, ano a ano, a uma taxa `k` (fração do CDI).
 *
 * Dentro do ano, aplicação e resgate acontecem no meio: o dinheiro que entrou
 * rende meio ano, o que saiu rendeu meio ano antes de sair. O saldo do começo
 * do ano que não bate com os lotes (primeiro ano, ano faltando no meio) vira
 * lote sem data — ou saída sem data, que não entra na calibração.
 *
 * Com o extrato, o bem troca o meio do ano pelas datas dele:
 *
 *   · o que entrou ANTES da primeira declaração vira lote com data, e rende
 *     desde lá — os resgates de antes saem pelo valor bruto, que é o que o
 *     extrato diz. O que a primeira declaração encontra além disso é dinheiro
 *     mais velho que o extrato, e vai para a frente da fila;
 *   · no ano, cada aplicação entra no dia dela. O principal que sai é o da
 *     declaração (aplicado − variação do saldo), repartido entre os resgates do
 *     ano pelo valor bruto de cada um. O que a declaração mostra e o extrato não
 *     — aplicação por fora, resgate sem linha — continua no meio do ano.
 */
function simular(
  h: Historico,
  anos: readonly number[],
  bens: readonly string[],
  k: number,
  informados: BenchmarksInformados,
  movimentos: MovimentosPorBem = {},
): Simulacao {
  const lotes = new Map<string, Lote[]>(bens.map((b) => [b, []]))
  const saidas: Saida[] = []
  const primeiro = anos[0]
  const doBem = new Map(bens.map((b) => [b, eventos(movimentos[b])]))

  for (const bem of bens) {
    const antes = (doBem.get(bem) as Evento[]).filter((e) => e.t < primeiro)
    if (antes.length === 0) continue
    const ls = lotes.get(bem) as Lote[]
    let t = antes[0].t
    for (const e of antes) {
      acumularEntre(ls, k, t, e.t, informados)
      t = e.t
      if (e.valor > 0) ls.push({ principal: e.valor, juros: 0, entrada: e.t, porAno: new Map() })
      else tirarPorValor(ls, -e.valor)
    }
    acumularEntre(ls, k, t, primeiro, informados)
  }

  for (const ano of anos) {
    const cdi = taxaDoAno('cdi', ano, informados)
    const taxaAno = cdi === null ? null : k * cdi
    for (const bem of bens) {
      const ls = lotes.get(bem) as Lote[]
      const s = saldosDoAno(h, ano, bem) ?? { s0: 0, s1: 0 }
      const principal = ls.reduce((t, l) => t + l.principal, 0)
      if (s.s0 > principal + EPS) {
        const velho: Lote = { principal: s.s0 - principal, juros: 0, entrada: null, porAno: new Map() }
        // No primeiro ano, o que o extrato não explica é anterior a ele.
        if (ano === primeiro) ls.unshift(velho)
        else ls.push(velho)
      } else if (s.s0 < principal - EPS) {
        for (const l of tirar(ls, principal - s.s0)) saidas.push({ bem, ano, juros: l.juros, datada: false, porAno: l.porAno })
      }

      const doAno = (doBem.get(bem) as Evento[]).filter((e) => Math.floor(e.t) === ano)
      if (doAno.length === 0) {
        acumular(ls, taxaAno, 0.5, ano)
        const delta = s.s1 - s.s0
        if (delta < -EPS) {
          for (const l of tirar(ls, -delta)) saidas.push({ bem, ano, juros: l.juros, datada: l.entrada !== null, porAno: l.porAno })
        } else if (delta > EPS) {
          ls.push({ principal: delta, juros: 0, entrada: ano + 0.5, porAno: new Map() })
        }
        acumular(ls, taxaAno, 0.5, ano)
        continue
      }

      const entrou = doAno.filter((e) => e.valor > 0).reduce((t, e) => t + e.valor, 0)
      const saiuBruto = doAno.filter((e) => e.valor < 0).reduce((t, e) => t - e.valor, 0)
      const principalSai = entrou - (s.s1 - s.s0)
      const agenda: { t: number; entra?: number; sai?: number }[] = []
      for (const e of doAno) {
        if (e.valor > 0) agenda.push({ t: e.t, entra: e.valor })
        else if (principalSai > EPS && saiuBruto > EPS) agenda.push({ t: e.t, sai: (principalSai * -e.valor) / saiuBruto })
      }
      if (principalSai < -EPS) agenda.push({ t: ano + 0.5, entra: -principalSai })
      else if (principalSai > EPS && saiuBruto <= EPS) agenda.push({ t: ano + 0.5, sai: principalSai })
      agenda.sort((a, b) => a.t - b.t)

      let t = ano
      for (const ev of agenda) {
        acumular(ls, taxaAno, ev.t - t, ano)
        t = ev.t
        if (ev.entra) ls.push({ principal: ev.entra, juros: 0, entrada: ev.t, porAno: new Map() })
        if (ev.sai) {
          for (const l of tirar(ls, ev.sai)) saidas.push({ bem, ano, juros: l.juros, datada: l.entrada !== null, porAno: l.porAno })
        }
      }
      acumular(ls, taxaAno, ano + 1 - t, ano)
    }
  }
  return { saidas, abertos: lotes }
}

function calibrar(
  h: Historico,
  anos: readonly number[],
  bens: readonly string[],
  pago: Record<number, number | null>,
  informados: BenchmarksInformados,
  rendaFixa: boolean,
  movimentos: MovimentosPorBem,
): { taxa: number | null; origem: OrigemDaTaxa; anosDaTaxa: Set<number> } {
  // Os anos que calibram: juro pago lido, e todo resgate do ano com data de entrada.
  const base = simular(h, anos, bens, 1, informados, movimentos)
  const anosDaTaxa = new Set<number>()
  for (const ano of anos) {
    const doAno = base.saidas.filter((s) => s.ano === ano)
    // Resgate com juro pago zero não é taxa zero: é juro pago por outro CNPJ (o
    // emissor, e não quem guarda), e medir com ele puxaria a taxa para o chão.
    if ((pago[ano] ?? 0) <= EPS || doAno.length === 0 || doAno.some((s) => !s.datada)) continue
    if (doAno.reduce((t, s) => t + s.juros, 0) > EPS) anosDaTaxa.add(ano)
  }

  if (anosDaTaxa.size > 0) {
    const alvo = [...anosDaTaxa].reduce((t, a) => t + (pago[a] as number), 0)
    const modelado = (k: number) =>
      simular(h, anos, bens, k, informados, movimentos)
        .saidas.filter((s) => anosDaTaxa.has(s.ano))
        .reduce((t, s) => t + s.juros, 0)
    let lo = 0
    let hi = TAXA_MAX * 2
    for (let i = 0; i < 50; i++) {
      const meio = (lo + hi) / 2
      if (modelado(meio) < alvo) lo = meio
      else hi = meio
    }
    return { taxa: (lo + hi) / 2, origem: 'resgates', anosDaTaxa }
  }

  const cupom = taxaPorCupom(h, anos, bens, pago, informados)
  if (cupom !== null) return { taxa: cupom, origem: 'pagamentos', anosDaTaxa }
  return { ...padrao(rendaFixa), anosDaTaxa }
}

/** Sem nada que meça: CDI na renda fixa de banco, e sem medida no pote só de fundo. */
const padrao = (rendaFixa: boolean): { taxa: number | null; origem: OrigemDaTaxa } =>
  rendaFixa ? { taxa: 1, origem: 'cdi' } : { taxa: null, origem: 'nenhuma' }

/**
 * A taxa pelo juro pago em ano SEM resgate — cupom, juro semestral.
 *
 * É o único caso em que juro pago ÷ saldo mede a taxa. Em ano com resgate, o
 * juro pago é o do papel que venceu, acumulado em anos: dividir pelo saldo mede
 * o vencimento, e não o rendimento. Conferido num arquivo real: um banco com
 * LCAs vencendo aos poucos saía com 20% do CDI.
 */
function taxaPorCupom(
  h: Historico,
  anos: readonly number[],
  bens: readonly string[],
  pago: Record<number, number | null>,
  informados: BenchmarksInformados,
): number | null {
  let juro = 0
  let base = 0
  for (const ano of anos) {
    const cdi = taxaDoAno('cdi', ano, informados)
    if ((pago[ano] ?? 0) <= EPS || cdi === null) continue
    const saldos = bens.map((b) => saldosDoAno(h, ano, b)).filter((x): x is Saldo => x !== null)
    if (saldos.some((x) => x.s1 < x.s0 - EPS)) continue
    const inicio = saldos.reduce((t, x) => t + x.s0, 0)
    if (inicio <= EPS) continue
    const fluxo = saldos.reduce((t, x) => t + x.s1 - x.s0, 0)
    // Pote que cresceu muito no ano também não mede: o juro pago é do dinheiro
    // antigo, e o novo ainda não venceu nada. Pior, a linha que soma várias LCAs
    // esconde os vencimentos — o saldo só cresce, e parece cupom. Conferido no
    // mesmo arquivo: 35% do CDI num pote que cresceu 80% no ano.
    if (fluxo > inicio * 0.2) continue
    juro += pago[ano] as number
    base += (inicio + fluxo / 2) * cdi
  }
  return juro > EPS && base > EPS ? juro / base : null
}

interface Resultado {
  taxa: number | null
  origem: OrigemDaTaxa
  noLimite: boolean
  porBem: Record<string, CompetenciaAno[]>
}

const limitar = (t: number) => Math.min(TAXA_MAX, Math.max(TAXA_MIN, t))

function competenciaAplicado(
  h: Historico,
  anos: readonly number[],
  bens: readonly string[],
  pago: Record<number, number | null>,
  informados: BenchmarksInformados,
  rendaFixa: boolean,
  movimentos: MovimentosPorBem,
): Resultado {
  const cal = calibrar(h, anos, bens, pago, informados, rendaFixa, movimentos)
  if (cal.taxa === null) return { taxa: null, origem: cal.origem, noLimite: false, porBem: {} }
  const taxa = limitar(cal.taxa)
  const sim = simular(h, anos, bens, taxa, informados, movimentos)

  // O resgate de um ano que calibrou soma exatamente o que foi pago: o modelo só
  // decide COMO o juro se espalha pelos anos, não QUANTO foi. Fora de 0,5–2× o
  // ajuste não é feito — ano assim tem juro que não é de resgate (cupom, outro
  // bem), e esticar os lotes para caber nele inventaria juro nos anos de trás.
  for (const ano of cal.anosDaTaxa) {
    const doAno = sim.saidas.filter((s) => s.ano === ano)
    const modelado = doAno.reduce((t, s) => t + s.juros, 0)
    const f = modelado > EPS ? (pago[ano] as number) / modelado : 1
    if (f < 0.5 || f > 2) continue
    for (const s of doAno) s.porAno = escalar(s.porAno, f)
  }

  const porBem: Record<string, CompetenciaAno[]> = {}
  for (const bem of bens) {
    const linhas: CompetenciaAno[] = []
    for (const ano of anos) {
      if (taxaDoAno('cdi', ano, informados) === null) continue
      const s = saldosDoAno(h, ano, bem)
      if (!s) continue
      let medido = 0
      let estimado = 0
      for (const sd of sim.saidas) {
        if (sd.bem !== bem) continue
        const v = sd.porAno.get(ano) ?? 0
        // Juro de lote com data que saiu num ano com pagamento lido é juro que
        // foi pago. O lote sem data rendeu também antes do primeiro ano, e o
        // pagamento dele não diz quanto foi dentro da janela.
        if (sd.datada && pago[sd.ano] != null) medido += v
        else estimado += v
      }
      for (const l of sim.abertos.get(bem) ?? []) estimado += l.porAno.get(ano) ?? 0
      linhas.push({
        anoBase: ano,
        medido,
        estimado,
        fluxo: s.s1 - s.s0,
        saldoInicial: s.s0,
        saldoFinal: s.s1,
        ...(temNoAno(movimentos[bem], ano) ? { peloExtrato: true as const } : {}),
      })
    }
    porBem[bem] = linhas
  }
  return { taxa, origem: cal.origem, noLimite: taxa !== cal.taxa, porBem }
}

/** O extrato traz dinheiro deste bem neste ano. */
const temNoAno = (lista: readonly MovimentoDatado[] | undefined, ano: number) =>
  eventos(lista).some((e) => Math.floor(e.t) === ano)

// ---------------------------------------------------------- valor atualizado

/**
 * O que entrou e saiu do bem no ano, pelo extrato, e o saldo que rendeu — o do
 * começo mais cada movimento pelo pedaço do ano em que ficou lá.
 */
function movimentoDoAno(lista: readonly MovimentoDatado[] | undefined, ano: number, s0: number): { fluxo: number; base: number } | null {
  const doAno = eventos(lista).filter((e) => Math.floor(e.t) === ano)
  if (doAno.length === 0) return null
  return {
    fluxo: doAno.reduce((t, e) => t + e.valor, 0),
    base: s0 + doAno.reduce((t, e) => t + e.valor * (ano + 1 - e.t), 0),
  }
}

function competenciaAtualizado(
  h: Historico,
  anos: readonly number[],
  bens: readonly string[],
  pago: Record<number, number | null>,
  informados: BenchmarksInformados,
  rendaFixa: boolean,
  movimentos: MovimentosPorBem,
): Resultado {
  // O ano em que o saldo andou sozinho: bem o ano inteiro, e a alta cabe no que
  // o juro daria. Ali o saldo MEDE o juro, e é dele que sai a taxa.
  const sozinho = (s: Saldo, cdi: number) => s.s0 > 0 && s.s1 > 0 && s.s1 - s.s0 >= 0 && s.s1 - s.s0 <= s.s0 * cdi * 2
  // O ano com movimento que o extrato conta: o que sobra do saldo, tirado o que
  // entrou e saiu, é o juro — se couber no que o juro daria. Se não couber, falta
  // movimento no extrato, e o ano volta a ser estimado.
  const peloExtrato = (s: Saldo, cdi: number, bem: string, ano: number) => {
    const m = movimentoDoAno(movimentos[bem], ano, s.s0)
    if (!m || m.base <= EPS) return null
    const juro = s.s1 - s.s0 - m.fluxo
    return juro >= -EPS && juro <= m.base * cdi * 2 ? { juro: Math.max(0, juro), fluxo: m.fluxo, base: m.base } : null
  }
  let alta = 0
  let esperado = 0
  for (const ano of anos) {
    const cdi = taxaDoAno('cdi', ano, informados)
    if (cdi === null) continue
    for (const bem of bens) {
      const s = saldosDoAno(h, ano, bem)
      if (!s) continue
      const ex = peloExtrato(s, cdi, bem, ano)
      if (ex) {
        alta += ex.juro
        esperado += ex.base * cdi
      } else if (sozinho(s, cdi)) {
        alta += s.s1 - s.s0
        esperado += s.s0 * cdi
      }
    }
  }
  const cupom = alta > EPS && esperado > EPS ? null : taxaPorCupom(h, anos, bens, pago, informados)
  const achada: { taxa: number | null; origem: OrigemDaTaxa } =
    alta > EPS && esperado > EPS
      ? { taxa: alta / esperado, origem: 'saldo' }
      : cupom !== null
        ? { taxa: cupom, origem: 'pagamentos' }
        : padrao(rendaFixa)
  if (achada.taxa === null) return { taxa: null, origem: achada.origem, noLimite: false, porBem: {} }
  const taxa = achada.taxa
  const origem = achada.origem
  const limitada = limitar(taxa)

  const porBem: Record<string, CompetenciaAno[]> = {}
  for (const bem of bens) {
    const linhas: CompetenciaAno[] = []
    for (const ano of anos) {
      const cdi = taxaDoAno('cdi', ano, informados)
      const s = saldosDoAno(h, ano, bem)
      if (cdi === null || !s) continue
      const ex = peloExtrato(s, cdi, bem, ano)
      if (ex) {
        linhas.push({ anoBase: ano, medido: ex.juro, estimado: 0, fluxo: ex.fluxo, saldoInicial: s.s0, saldoFinal: s.s1, peloExtrato: true })
      } else if (sozinho(s, cdi)) {
        linhas.push({ anoBase: ano, medido: s.s1 - s.s0, estimado: 0, fluxo: 0, saldoInicial: s.s0, saldoFinal: s.s1 })
      } else {
        // Com dinheiro entrando ou saindo, o saldo não separa juro de movimento:
        // o juro é estimado sobre o saldo médio, e o resto é movimento.
        const juro = limitada * cdi * ((s.s0 + s.s1) / 2)
        linhas.push({ anoBase: ano, medido: 0, estimado: juro, fluxo: s.s1 - s.s0 - juro, saldoInicial: s.s0, saldoFinal: s.s1 })
      }
    }
    porBem[bem] = linhas
  }
  return { taxa: limitada, origem, noLimite: limitada !== taxa, porBem }
}

// ------------------------------------------------------------------ a entrada

/**
 * O juro de cada bem de renda fixa e de fundo, ano a ano, por competência.
 *
 * Recebe o histórico JÁ PREPARADO (overrides e vínculos aplicados): o lote que
 * entra num ano e sai três anos depois precisa ser o mesmo bem nos três.
 *
 * Os potes são por CNPJ — é o que liga o juro pago ao bem. O bem sem CNPJ (ano
 * antigo, sem o campo nem o número na descrição) não entra, e quem lê continua
 * medindo ele pelo saldo.
 */
export function rendimentoPorCompetencia(
  h: Historico,
  opcoes: {
    informados?: BenchmarksInformados
    comoDeclara?: ComoDeclaraPorCnpj
    /** As datas do extrato da B3, por bem. Sem elas, o meio do ano. */
    movimentos?: MovimentosPorBem
  } = {},
): RendimentoPorCompetencia {
  const informados = opcoes.informados ?? {}
  const movimentos = opcoes.movimentos ?? {}
  const anos = Object.values(h)
    .map((d) => d.anoBase)
    .sort((a, b) => a - b)
  const info = infoDosBens(h)

  const bensPorCnpj = new Map<string, string[]>()
  const poupancaPorCnpj = new Map<string, string[]>()
  for (const b of info.values()) {
    if (!b.cnpj) continue
    const alvo = entraNoPote(b) ? bensPorCnpj : ehPoupanca(b) ? poupancaPorCnpj : null
    if (!alvo) continue
    alvo.set(b.cnpj, [...(alvo.get(b.cnpj) ?? []), b.id])
  }

  // O juro pago por CNPJ e ano, sem o que é da poupança do mesmo banco.
  const nomes = new Map<string, string>()
  const pagoPorCnpj = new Map<string, Record<number, number | null>>()
  const semBem: RendimentoPorCompetencia['semBem'] = []
  for (const d of Object.values(h)) {
    const lido = Array.isArray(d.rendimentoDeAplicacao)
    for (const cnpj of bensPorCnpj.keys()) {
      const reg = pagoPorCnpj.get(cnpj) ?? {}
      reg[d.anoBase] = lido ? 0 : null
      pagoPorCnpj.set(cnpj, reg)
    }
    if (!lido) continue
    for (const r of d.rendimentoDeAplicacao ?? []) {
      if (r.nome && !nomes.has(r.cnpj)) nomes.set(r.cnpj, r.nome)
      let valor = r.valor
      if (r.isento) {
        const poupanca = (poupancaPorCnpj.get(r.cnpj) ?? []).reduce((t, id) => {
          const s = saldosDoAno(h, d.anoBase, id)
          return t + (s ? rendimentoDaPoupanca((s.s0 + s.s1) / 2, d.anoBase, informados) : 0)
        }, 0)
        valor = Math.max(0, valor - poupanca)
      }
      const reg = pagoPorCnpj.get(r.cnpj)
      if (reg) reg[d.anoBase] = (reg[d.anoBase] ?? 0) + valor
      else if (valor > EPS) semBem.push({ cnpj: r.cnpj, nome: r.nome, anoBase: d.anoBase, valor })
    }
  }

  const potes: PoteDeRendimento[] = []
  const porBem: Record<string, CompetenciaAno[]> = {}
  for (const [cnpj, bens] of bensPorCnpj) {
    const pago = pagoPorCnpj.get(cnpj) ?? {}
    const sug = sugerirComoDeclara(h, bens, informados)
    const respondido = opcoes.comoDeclara?.[cnpj]
    const comoDeclara = respondido ?? sug.sugerido
    const rendaFixa = bens.some((id) => ehRendaFixa(info.get(id) as InfoBem))
    const r =
      comoDeclara === 'aplicado'
        ? competenciaAplicado(h, anos, bens, pago, informados, rendaFixa, movimentos)
        : competenciaAtualizado(h, anos, bens, pago, informados, rendaFixa, movimentos)
    Object.assign(porBem, r.porBem)
    potes.push({
      cnpj,
      nome: nomes.get(cnpj) ?? '',
      bens,
      comoDeclara,
      sugerido: sug.sugerido,
      porqueSugerido: sug.porque,
      respondido: !!respondido,
      taxa: r.taxa,
      origemDaTaxa: r.origem,
      taxaNoLimite: r.noLimite,
      pago,
      comExtrato: bens.some((id) => eventos(movimentos[id]).length > 0),
    })
  }
  return { potes, porBem, semBem: semBem.sort((a, b) => a.anoBase - b.anoBase || b.valor - a.valor) }
}
