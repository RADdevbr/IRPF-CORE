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

import { idPagador, normalizarNome, type RendaPorPagador } from '../historico/historico.js'

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
  /**
   * A sugestão veio de nomes PARECIDOS, e não de identidade.
   *
   * Existe porque a tela oferece «aceitar tudo», e aceitar em bloco é aceitar
   * sem ler o motivo. Contenção é frouxa de propósito — é ela que faz o indício
   * encontrar alguém —, e a companhia listada cujo nome inteiro está dentro do
   * nome da PJ de quem usa o app é o caso em que ela erra. Errar ali marcando a
   * PJ como capital é o único desfecho que este módulo não pode ter.
   *
   * Então quem casou por identidade entra no bloco, e quem casou por parecença
   * fica para a pessoa olhar uma vez. A sugestão continua na tela, com o nome
   * que casou escrito no motivo.
   */
  aproximada?: boolean
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
/**
 * Nome preparado para CASAR — não para identificar.
 *
 * Sem espaço, porque «S.A.» e «SA» são a mesma companhia e `normalizarNome`
 * preserva a separação. `idPagador` continua usando a forma com espaço: ali a
 * string é identidade, e afrouxá-la juntaria pagadores diferentes.
 */
const paraCasar = (nome: string) => normalizarNome(nome).replace(/ /g, '')

/**
 * O menor nome que pode casar por contenção.
 *
 * Contenção é frouxa de propósito — «PETROLEOBRASILEIROSA» dentro de
 * «PETROLEOBRASILEIROSAPETROBRAS» é o caso que precisa passar. Mas frouxa sem
 * piso é perigosa: «WEGSA» está dentro de «WEGSANTOSLTDA», e marcar a PJ de
 * quem usa o app como capital é o erro que este módulo inteiro existe para não
 * cometer.
 *
 * Doze caracteres deixam passar nome de companhia inteiro e barram pedaço curto
 * demais para significar alguma coisa. Vale só para a CONTENÇÃO: nome idêntico
 * não tem ambiguidade nenhuma para o piso proteger.
 */
const MINIMO_PARA_CASAR = 12

/**
 * A mesma companhia, escrita de dois jeitos. Recebe as formas JÁ preparadas.
 *
 * Igualdade primeiro, e sem piso. Com o piso valendo para ela também, «VALE SA»
 * e «VALE S.A.» — que viram a MESMA string — não casavam, e com elas Vale, WEG,
 * Gerdau, Ambev, Suzano e toda companhia de nome curto: o conserto deixava de
 * fora justamente metade dos casos que ele existe para pegar.
 *
 * Contenção depois, com piso, e só entre NOMES (ver `sugerirOrigens`): raiz de
 * ticker não chega aqui, porque «VALE» dentro de «VALE DO SOL COMERCIO LTDA» é
 * contenção verdadeira e conclusão falsa.
 */
function casaPorNome(x: string, y: string): boolean {
  if (x === '' || y === '') return false
  if (x === y) return true
  const menor = x.length <= y.length ? x : y
  const maior = menor === x ? y : x
  return menor.length >= MINIMO_PARA_CASAR && maior.includes(menor)
}

export function sugerirOrigens(
  porPagador: RendaPorPagador[],
  opts: {
    /**
     * Quem veio do extrato da corretora — por id de pagador OU pelo nome cru.
     *
     * Aceita os dois porque os dois lados existem: o extrato da corretora traz
     * o NOME do pagador e não traz CNPJ, enquanto o `.DEC` traz os dois e o id
     * sai do CNPJ. Casar só por id nunca encontraria nada, e este indício
     * ficaria decorativo.
     *
     * Casa só por IGUALDADE. É aqui que entra a raiz do ticker, e raiz contida
     * num nome é conclusão falsa: «VALE» está dentro de «VALE DO SOL COMERCIO
     * LTDA», que pode ser a PJ de quem está usando o app.
     */
    pagadoresDaCorretora?: string[]
    /**
     * Os NOMES de companhia que o extrato traz, quando quem chama sabe que são
     * nomes — «PETROLEO BRASILEIRO SA», e não «PETR».
     *
     * Separado do de cima porque a diferença é conhecida na origem e adivinhá-la
     * aqui custava caro: com as duas coisas num monte só, a única defesa contra
     * confundir raiz com nome era o comprimento, e o piso que barra a raiz barra
     * junto toda companhia de nome curto. Quem sabe o que é nome diz que é nome,
     * e aí a contenção pode valer — é ela que resolve o caso de fato, porque a
     * B3 escreve «PETR4 - PETROLEO BRASILEIRO SA» e o `.DEC` escreve «PETROLEO
     * BRASILEIRO S.A. PETROBRAS». Ver `casaPorNome`.
     */
    nomesDaCorretora?: string[]
  } = {},
): Record<string, Sugestao> {
  const idDe = (x: string) => (x.startsWith('cnpj:') || x.startsWith('nome:') ? x : idPagador(x))
  // O id VAZIO fica de fora. `idPagador` devolve '' para nome que não nomeia
  // ninguém — um «-» na coluna de produto —, e um '' no conjunto casaria com
  // todo pagador que o `.DEC` traz sem nome, sugerindo capital para todos eles.
  const daCorretora = new Set(
    [...(opts.pagadoresDaCorretora ?? []), ...(opts.nomesDaCorretora ?? [])].map(idDe).filter((x) => x !== ''),
  )
  // Normaliza cada nome UMA vez, e não uma vez por pagador: `paraCasar` faz
  // NFD, quatro regexes e um corte, e o laço abaixo é pagadores × nomes.
  const nomesDaCorretora = (opts.nomesDaCorretora ?? [])
    .map((cru) => ({ cru, chave: paraCasar(cru) }))
    .filter((n) => n.chave !== '')
  const nomeDe = new Map(porPagador.map((p) => [p.pagador.id, p.pagador.nome]))
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
    const nome = nomeDe.get(id) ?? ''
    if (daCorretora.has(id) || daCorretora.has(idPagador(nome))) {
      saida[id] = { origem: 'capital', motivo: 'veio do extrato da corretora' }
      continue
    }
    // Quando a igualdade não dá, a contenção ainda pode: a corretora e a
    // declaração escrevem a mesma companhia de dois jeitos. O motivo diz QUAL
    // nome casou, porque uma sugestão sem o porquê à vista não é confirmável.
    const chave = paraCasar(nome)
    const casou = nomesDaCorretora.find((n) => casaPorNome(n.chave, chave))
    if (casou !== undefined) {
      saida[id] = {
        origem: 'capital',
        motivo: `veio do extrato da corretora, como «${casou.cru}»`,
        aproximada: casou.chave !== chave,
      }
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
