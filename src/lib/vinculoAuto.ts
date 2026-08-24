// Liga sozinho o mesmo investimento entre anos.
//
// O casamento automático que já existia era por identidade exata (classe +
// descrição normalizada). Basta o banco renomear o produto, o layout cortar o
// texto noutro ponto ou o ano mudar o esquema de códigos para a série partir em
// duas — e aí o rendimento embutido some. Ligar isso na mão, bem a bem e ano a
// ano, é inviável numa declaração real.
//
// O sinal que faltava estava no próprio arquivo: o Registro 27 traz o saldo do
// ANO ANTERIOR de cada bem. Se o saldo anterior de 2025 é igual ao saldo atual
// de 2024, é o mesmo bem — não é parecido, é o mesmo, dito pelo arquivo. Vale só
// entre anos consecutivos; para anos com buraco no meio sobram a descrição e o
// código, que sozinhos não bastam para afirmar, então exigem-se dois sinais.

import type { Historico, PosicaoAno, Vinculos } from './historico'

export interface LigacaoAuto {
  /** Id da posição mais antiga (a que passa a apontar para a outra). */
  de: string
  /** Id canônico, sempre o do ano mais novo. */
  para: string
  anoDe: number
  anoPara: number
  descricaoDe: string
  descricaoPara: string
  pontos: number
  motivos: string[]
}

/**
 * O que basta para afirmar que é o mesmo bem.
 *
 * Ou o saldo anterior que o arquivo declara (6 sozinho), ou descrição quase
 * igual + mesmo código + mesma classe (3+2+1). Deixei de fora "descrição meio
 * parecida + mesmo código", que dá 5: metade da renda fixa divide o mesmo
 * código, e juntar dois bens diferentes estraga a série e o rendimento
 * embutido dos dois de uma vez.
 */
export const LIMIAR = 6

const normaliza = (s: string) =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Palavras que não distinguem nada e só inflam a semelhança. */
const VAZIAS = new Set(['BANCO', 'FUNDO', 'FUNDOS', 'INVESTIMENTO', 'INVESTIMENTOS', 'DE', 'DA', 'DO', 'DOS', 'LTDA'])

const palavras = (s: string) =>
  new Set(
    normaliza(s)
      .split(' ')
      .filter((t) => t.length >= 3 && !VAZIAS.has(t)),
  )

/** Semelhança entre descrições: fração de palavras em comum (0 a 1). */
export function semelhanca(a: string, b: string): number {
  const pa = palavras(a)
  const pb = palavras(b)
  if (pa.size === 0 || pb.size === 0) return 0
  let comuns = 0
  for (const t of pa) if (pb.has(t)) comuns += 1
  return comuns / Math.min(pa.size, pb.size)
}

const REAL = 0.01

interface ComAno extends PosicaoAno {
  anoBase: number
}

/** Quanto se pode afirmar que `velha` e `nova` são o mesmo bem. */
export function pontuar(velha: ComAno, nova: ComAno): { pontos: number; motivos: string[] } {
  const motivos: string[] = []
  let pontos = 0

  // O sinal forte, e o único que o próprio arquivo afirma.
  const consecutivos = nova.anoBase - velha.anoBase === 1
  const saldoBate = consecutivos && nova.saldoAnterior > 0 && Math.abs(nova.saldoAnterior - velha.saldoAtual) < REAL
  if (saldoBate) {
    pontos += 6
    motivos.push('o saldo anterior declarado bate com o saldo do ano passado')
  }

  const cod = (p: ComAno) => `${(p.codigo ?? '').trim()}·${(p.subcodigo ?? '').trim()}`
  if (cod(velha).replace(/[·\s]/g, '') && cod(velha) === cod(nova)) {
    pontos += 2
    motivos.push('mesmo código do bem')
  }

  // Número comprido na descrição costuma ser vencimento ou nº de contrato — é
  // exatamente o que separa dois papéis do mesmo banco. Sem o saldo do arquivo
  // para afirmar, números que não batem derrubam a semelhança em vez de somar.
  if (!saldoBate) {
    const numeros = (t: string) => new Set(normaliza(t).split(' ').filter((x) => /^\d{4,}$/.test(x)))
    const nv = numeros(velha.descricao)
    const nn = numeros(nova.descricao)
    if (nv.size > 0 && nn.size > 0 && ![...nv].some((x) => nn.has(x))) {
      pontos -= 3
      motivos.push('números diferentes na descrição (vencimento ou contrato)')
    }
  }

  const s = semelhanca(velha.descricao, nova.descricao)
  if (s >= 0.6) {
    pontos += 3
    motivos.push('descrição quase igual')
  } else if (s >= 0.35) {
    pontos += 2
    motivos.push('descrição parecida')
  } else if (s > 0) {
    pontos += 1
    motivos.push('alguma palavra em comum')
  }

  if (velha.classe === nova.classe && velha.classe !== 'desconhecido') {
    pontos += 1
    motivos.push('mesma classe')
  }

  return { pontos, motivos }
}

/**
 * Ligações que o app se sente à vontade para fazer sozinho.
 *
 * Casamento um-para-um e guloso pelo melhor par: um bem de 2024 não pode virar
 * dois de 2025. Ligações manuais mandam — o que a pessoa disse não se
 * sobrescreve.
 */
export function sugerirLigacoes(h: Historico, manuais: Vinculos = {}): LigacaoAuto[] {
  const anos = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  const ligacoes: LigacaoAuto[] = []

  for (let i = 0; i + 1 < anos.length; i++) {
    const velho = anos[i]
    const novo = anos[i + 1]
    const comAno = (d: (typeof anos)[number]) => d.posicoes.map((p): ComAno => ({ ...p, anoBase: d.anoBase }))
    const novas = comAno(novo)
    const idsNovos = new Set(novas.map((p) => p.id))

    // Quem já cai no mesmo id não precisa de ligação — o casamento por
    // identidade já resolveu. Tirar do bolo também evita roubar um par.
    const velhas = comAno(velho).filter((p) => !idsNovos.has(p.id) && !manuais[p.id])
    const candidatas = novas.filter((p) => !velho.posicoes.some((q) => q.id === p.id))

    const pares: LigacaoAuto[] = []
    for (const v of velhas) {
      for (const n of candidatas) {
        const { pontos, motivos } = pontuar(v, n)
        if (pontos >= LIMIAR) {
          pares.push({
            de: v.id,
            para: n.id,
            anoDe: v.anoBase,
            anoPara: n.anoBase,
            descricaoDe: v.descricao,
            descricaoPara: n.descricao,
            pontos,
            motivos,
          })
        }
      }
    }

    pares.sort((a, b) => b.pontos - a.pontos || a.de.localeCompare(b.de))
    const usadasVelhas = new Set<string>()
    const usadasNovas = new Set<string>()
    for (const par of pares) {
      if (usadasVelhas.has(par.de) || usadasNovas.has(par.para)) continue
      usadasVelhas.add(par.de)
      usadasNovas.add(par.para)
      ligacoes.push(par)
    }
  }

  return ligacoes
}

/**
 * As ligações viram o mapa que o resto do app já entende.
 *
 * `aplicarVinculos` dá um salto só, então a cadeia 2020→2023→2025 precisa
 * chegar pronta apontando tudo para 2025 — senão o bem de 2020 pararia no meio
 * do caminho e a série continuaria partida.
 */
export function vinculosAutomaticos(h: Historico, manuais: Vinculos = {}): Vinculos {
  const direto: Vinculos = {}
  for (const l of sugerirLigacoes(h, manuais)) direto[l.de] = l.para

  const destinoFinal = (id: string): string => {
    const vistos = new Set<string>([id])
    let atual = id
    while (direto[atual] && !vistos.has(direto[atual])) {
      atual = direto[atual]
      vistos.add(atual)
    }
    return atual
  }

  const mapa: Vinculos = {}
  for (const de of Object.keys(direto)) {
    const para = destinoFinal(de)
    if (para !== de) mapa[de] = para
  }
  return mapa
}

/** Manual manda: o que a pessoa ligou na mão não é sobrescrito. */
export function unirVinculos(auto: Vinculos, manuais: Vinculos): Vinculos {
  return { ...auto, ...manuais }
}
