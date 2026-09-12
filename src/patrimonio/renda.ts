// De onde vem a renda: trabalho, capital, ou o que ainda não dá para afirmar.
//
// A pergunta que isto responde não é fiscal, é de vida: quanto do que entra
// depende de você acordar cedo e quanto o patrimônio produz sozinho. É também o
// que dá sentido ao rendimento do capital — sem separar as duas, "renda"
// misturada não se compara com o CDI de nada.
//
// A decisão que organiza o arquivo inteiro: **a origem é do PAGADOR, não da
// ficha.** Lucros e dividendos da SUA empresa são trabalho — o médico que
// distribui lucro da própria clínica não está vivendo de renda, está sendo pago
// pelo que fez —, e o provento do ETF que está na mesma ficha é capital. Nenhuma
// regra sobre `divBR` separa os dois, porque a informação que separa não está na
// ficha: está em quem pagou.
//
// Por isso a classificação é uma RESPOSTA da pessoa, guardada por pagador, no
// mesmo formato da classe corrigida à mão. O app sugere com o motivo à vista
// (`sugerirOrigens`) e nunca afirma.

import type { RendaPorPagador } from '../historico/historico.js'

export type Origem = 'trabalho' | 'capital' | 'indefinido'

export interface FonteRenda {
  /** A ficha. Pode repetir na lista quando a mesma ficha se divide em duas origens. */
  chave: string
  /**
   * Identidade única dentro da lista.
   *
   * É `chave` no caso comum e `chave·origem` quando a ficha se divide — o que só
   * acontece com resposta por pagador. Existe porque quem desenha precisa de uma
   * chave estável por fatia, e `chave` deixou de servir no dia em que a mesma
   * ficha passou a aparecer duas vezes na mesma barra.
   */
  id: string
  rotulo: string
  valor: number
  origem: Origem
}

/** A resposta da pessoa: `id do pagador → origem`. Vale para todos os anos. */
export type OrigemPorPagador = Record<string, Origem>

interface Fonte {
  chave: string
  rotulo: string
  origem: Origem
  /**
   * A ficha admite as duas leituras, e só o pagador desempata.
   *
   * Marcada, um pagador sem resposta cai em `indefinido` em vez de herdar o
   * padrão da ficha: o padrão ali é chute, e chute que entra na proporção sem se
   * identificar é o que fazia a tela dizer «45% do que entra é capital» com
   * metade do número vindo de uma suposição.
   */
  perguntar?: boolean
}

/**
 * Chaves de `vals` que são renda recebida (as `*_ir` são imposto retido, não
 * renda) e o que cada uma significa na hora de separar trabalho de capital.
 */
const FONTES: Fonte[] = [
  { chave: 'salario', rotulo: 'Salário / pró-labore', origem: 'trabalho' },
  // A ficha 09 junta o lucro da própria PJ com o provento de ação e ETF.
  { chave: 'divBR', rotulo: 'Lucros e dividendos', origem: 'capital', perguntar: true },
  { chave: 'divFII', rotulo: 'Dividendos de FII', origem: 'capital' },
  { chave: 'cdb', rotulo: 'Aplicações — tributação exclusiva', origem: 'capital' },
  { chave: 'aluguel', rotulo: 'Aluguéis', origem: 'capital' },
  { chave: 'isentos', rotulo: 'Isentos e não tributáveis', origem: 'capital' },
  // 22 junta exterior e carnê-leão; "outros" cai em vários lugares. Chutar a
  // origem aqui contaminaria a proporção que a tela afirma.
  { chave: 'exterior', rotulo: 'Exterior', origem: 'indefinido', perguntar: true },
  { chave: 'outros', rotulo: 'Outros rendimentos', origem: 'indefinido', perguntar: true },
]

/**
 * Ordem canônica das fontes — é o que dá cor estável a cada uma.
 *
 * A cor tem de seguir a fonte, não a posição no ranking: se o dividendo é azul
 * num ano, tem de ser azul em todos, senão a barra muda de significado quando a
 * ordem muda. As duas fontes sem origem definida ficam de fora — elas usam o
 * cinza de "a classificar" e não gastam cor de série.
 */
export const FONTES_COM_COR = FONTES.filter((f) => f.origem !== 'indefinido').map((f) => f.chave)

/**
 * A ficha admite as duas leituras, e só o pagador desempata.
 *
 * É o que separa «tenho de perguntar sobre este pagador» de «não há o que
 * perguntar»: ninguém precisa responder de onde vem o rendimento do CDB de um
 * banco, e pôr essa linha na frente da pessoa gasta a atenção dela no que já
 * está resolvido.
 */
export const fichaPrecisaDeResposta = (chave: string): boolean =>
  FONTES.some((f) => f.chave === chave && f.perguntar === true)

/** Todas as fontes, na ordem em que a tela deve empilhá-las dentro do grupo. */
export const ORDEM_FONTES = FONTES.map((f) => f.chave)

/** O rótulo de uma ficha, para a tela não repetir a tabela. */
export const rotuloDaFicha = (chave: string): string =>
  FONTES.find((f) => f.chave === chave)?.rotulo ?? chave

export interface ComposicaoRenda {
  fontes: FonteRenda[]
  /** As mesmas fatias, já agrupadas — a tela não precisa reagrupar para empilhar. */
  porOrigem: Record<Origem, FonteRenda[]>
  total: number
  trabalho: number
  capital: number
  indefinido: number
  /** Fração da renda que veio do capital (0 a 1). Sem renda, 0. */
  fracaoCapital: number
}

/**
 * Como ler a origem da renda — o que todo consumidor do histórico precisa passar.
 *
 * Separado de `OpcoesComposicao` porque `porPagador` NÃO entra aqui: ele é do
 * ano, não da preferência, e vem de dentro da própria declaração. Quem passasse
 * os dois correria o risco de casar o detalhamento de um ano com os `vals` de
 * outro — e o erro sairia como uma proporção plausível, sem avisar.
 */
export interface OpcoesOrigem {
  /** O que a pessoa respondeu sobre cada pagador. */
  origens?: OrigemPorPagador
  /** @deprecated Ver `OpcoesComposicao.dividendosSaoTrabalho`. */
  dividendosSaoTrabalho?: boolean
}

export interface OpcoesComposicao extends OpcoesOrigem {
  /** Renda por pagador do ano (ver `Declaracao.porPagador`). Vazio = só `vals`. */
  porPagador?: RendaPorPagador[]
}

const VAZIO = (): Record<Origem, FonteRenda[]> => ({ trabalho: [], capital: [], indefinido: [] })

export function composicaoRenda(
  vals: Record<string, number>,
  opts: OpcoesComposicao = {},
): ComposicaoRenda {
  const porPagador = opts.porPagador ?? []
  const origens = opts.origens ?? {}

  /** O que a ficha diz sozinha, já com o booleano antigo aplicado. */
  const padrao = (f: Fonte): Origem =>
    f.chave === 'divBR' && opts.dividendosSaoTrabalho ? 'trabalho' : f.origem

  /**
   * Origem de um pagador que ninguém respondeu.
   *
   * Ficha sem ambiguidade responde por ele — não há o que perguntar sobre o CDB
   * de um banco.
   *
   * O booleano antigo é resposta NOS DOIS ESTADOS, e isto custou uma leitura
   * errada: marcado ele diz «são da minha PJ, conte como trabalho», desmarcado
   * ele diz «vêm de ações e fundos», que é a palavra da própria tela. Tratar o
   * desmarcado como ausência de resposta jogava todo dividendo de quem tinha a
   * caixa vazia em «a classificar» — e com ele ia embora o yield da carteira,
   * que é medido justamente sobre a renda de capital. Só a AUSÊNCIA do campo é
   * ausência de resposta.
   *
   * Fora esses casos, «a classificar» — e essa é a resposta honesta, não um
   * estado de erro.
   */
  const semResposta = (f: Fonte): Origem => {
    if (!f.perguntar) return padrao(f)
    if (f.chave === 'divBR' && opts.dividendosSaoTrabalho !== undefined) {
      return opts.dividendosSaoTrabalho ? 'trabalho' : 'capital'
    }
    return 'indefinido'
  }

  const fontes: FonteRenda[] = []
  for (const f of FONTES) {
    const total = vals[f.chave] || 0
    if (total <= 0) continue

    const soma = new Map<Origem, number>()
    let atribuido = 0
    for (const p of porPagador) {
      if (p.alvo !== f.chave || p.valor <= 0) continue
      const o = origens[p.pagador.id] ?? semResposta(f)
      soma.set(o, (soma.get(o) ?? 0) + p.valor)
      atribuido += p.valor
    }

    // O que nenhum pagador cobre segue o padrão da ficha. É o Registro 22, que
    // não traz fonte pagadora, e é todo ano importado por leitura anterior à 4 —
    // nos dois, `porPagador` está vazio e o resto é a ficha inteira.
    const resto = total - atribuido
    if (resto > 0.005) soma.set(padrao(f), (soma.get(padrao(f)) ?? 0) + resto)

    // Uma entrada por origem: a ficha que se divide vira duas fatias vizinhas,
    // cada uma no seu grupo, em vez de uma fatia com a origem da maioria.
    const divide = soma.size > 1
    for (const [origem, valor] of soma) {
      if (valor <= 0) continue
      fontes.push({
        chave: f.chave,
        id: divide ? `${f.chave}·${origem}` : f.chave,
        rotulo: f.rotulo,
        valor,
        origem,
      })
    }
  }

  fontes.sort((a, b) => b.valor - a.valor)

  const porOrigem = VAZIO()
  for (const f of fontes) porOrigem[f.origem].push(f)
  const soma = (o: Origem) => porOrigem[o].reduce((s, f) => s + f.valor, 0)
  const trabalho = soma('trabalho')
  const capital = soma('capital')
  const indefinido = soma('indefinido')
  const total = trabalho + capital + indefinido

  return {
    fontes,
    porOrigem,
    total,
    trabalho,
    capital,
    indefinido,
    fracaoCapital: total > 0 ? capital / total : 0,
  }
}

/**
 * A composição da renda de UMA declaração — a porta por onde ela deve sair.
 *
 * Existe porque `porPagador` mora dentro da declaração e chamar `composicaoRenda`
 * direto convida a esquecê-lo: o resultado então não quebra nada, só ignora em
 * silêncio tudo o que a pessoa respondeu e devolve a leitura antiga com cara de
 * nova. Uma porta, e ninguém esquece.
 */
export function composicaoDoAno(
  d: { vals: Record<string, number>; porPagador?: RendaPorPagador[] } | undefined,
  opts: OpcoesOrigem = {},
): ComposicaoRenda {
  return composicaoRenda(d?.vals ?? {}, { ...opts, porPagador: d?.porPagador })
}

// ------------------------------------------------------------- a sugestão

export interface Sugestao {
  origem: Origem
  /** Por que o app sugeriu isso — vai para a tela, ao lado da sugestão. */
  motivo: string
}

/**
 * O que o app acha que cada pagador é, e por quê — sugestão, nunca afirmação.
 *
 * Três indícios, nesta ordem, e nenhum deles é dedução a partir do nome ou do
 * CNPJ: um mapa de «quem parece holding» viraria bug silencioso na proporção que
 * a tela afirma, e o arquivo não prova sociedade.
 *
 *   1. O pagador também paga o seu pró-labore. Então você trabalha lá, e o que
 *      ele distribui é pagamento pelo que você fez.
 *   2. O pagador veio da corretora (`pagadoresDaCorretora`, que o app de arquivos
 *      monta dos proventos da B3). Então é papel listado.
 *   3. Todas as fichas dele têm uma leitura só — CDB, aluguel, FII. Não há o que
 *      perguntar.
 *
 * Quem não cai em nenhum dos três fica `indefinido`, e é a resposta certa: a PJ
 * que distribui lucro sem pagar pró-labore é exatamente esse caso, e chutá-la
 * para um lado erraria metade das pessoas em silêncio.
 */
export function sugerirOrigens(
  porPagador: RendaPorPagador[],
  opts: { pagadoresDaCorretora?: string[] } = {},
): Record<string, Sugestao> {
  const daCorretora = new Set(opts.pagadoresDaCorretora ?? [])
  const fichasDe = new Map<string, Set<string>>()
  for (const p of porPagador) {
    const atual = fichasDe.get(p.pagador.id)
    if (atual) atual.add(p.alvo)
    else fichasDe.set(p.pagador.id, new Set([p.alvo]))
  }

  const saida: Record<string, Sugestao> = {}
  for (const [id, fichas] of fichasDe) {
    if (fichas.has('salario')) {
      saida[id] = { origem: 'trabalho', motivo: 'também paga o seu salário ou pró-labore' }
      continue
    }
    if (daCorretora.has(id)) {
      saida[id] = { origem: 'capital', motivo: 'veio do extrato da corretora' }
      continue
    }
    const definidas = [...fichas]
      .map((a) => FONTES.find((f) => f.chave === a))
      .filter((f): f is Fonte => f !== undefined && !f.perguntar)
    if (definidas.length === fichas.size && definidas.length > 0) {
      saida[id] = { origem: definidas[0].origem, motivo: `a ficha «${definidas[0].rotulo}» não tem outra leitura` }
      continue
    }
    saida[id] = { origem: 'indefinido', motivo: 'o arquivo não diz — só você sabe' }
  }
  return saida
}
