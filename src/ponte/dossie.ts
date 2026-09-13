// O dossiê da carteira: o que os arquivos provam, num arquivo que dá para
// entregar a quem vai analisar.
//
// É o terceiro pacote que sai de um app da família, e difere dos outros dois num
// ponto que decide o desenho inteiro. O pacote de histórico e o de base vão para
// outro app DESTA família — software conhecido, que pode perguntar o que não
// entendeu. Este vai para FORA, para ser lido por alguém que não é este código.
// Por isso ele carrega o próprio manifesto, e por isso a anonimização é
// invariante testado e não convenção de quem escreve.
//
// ------------------------------------------------------------------ o modo
//
// O dossiê é RELATIVO. O único valor absoluto é o preço médio unitário — «R$
// 28,41 por ação» —, porque é ele que se compara com a cotação e é ele que
// dispara a pergunta «vendo?». Ganho vai em percentual, provento em rendimento
// sobre custo, alocação em proporção.
//
// O que sai de fora por consequência, e é contraintuitivo: QUANTIDADE e CUSTO
// TOTAL. `precoMedio × quantidade` é o patrimônio; basta a quantidade vazar para
// o arquivo dizer o tamanho da carteira.
//
// E não se perde análise nenhuma, o que é propriedade e não esperança. Com a
// proporção medida sobre o custo e o preço médio de cada papel, quem tiver a
// cotação do dia reconstrói o peso REAL de mercado:
//
//     custo_i     = quantidade_i × precoMedio_i
//     proporcao_i ∝ custo_i
//     valor_i     = quantidade_i × preçoHoje_i = custo_i × (preçoHoje_i ÷ precoMedio_i)
//
//     ⇒ pesoDeMercado_i ∝ proporcao_i × (preçoHoje_i ÷ precoMedio_i)
//
// Normalizando sobre os papéis, saem os pesos verdadeiros; e o retorno não
// realizado da carteira inteira é `Σ proporcao_i × (preçoHoje_i ÷ precoMedio_i) − 1`.
// O modo relativo perde o TAMANHO da carteira, e só isso — que é exatamente o
// que se queria perder.
//
// ------------------------------------------------------- o que ele ainda é
//
// Mesmo sem reais e sem identificação, a lista de tickers com datas É a carteira
// de alguém. Não é arquivo para publicar; é arquivo para o cofre, o Drive e o
// projeto de quem o gerou. O manifesto diz isso dentro do próprio arquivo,
// porque quem abrir um JSON solto seis meses depois não vai ter este comentário
// à mão.
//
// E cotação continua de fora (não existe em relatório nenhum que a família lê):
// o dossiê leva o preço médio, e quem analisa busca o preço do dia na hora.
// Preço embutido envelheceria dentro do arquivo, que é o modo de falha que o
// resto desta base de código existe para evitar.

import type { ApuracaoBolsa, Operacao, Posicao, VendaEvento } from '../bolsa/bolsa.js'
import { REGIME, type ClassePatrimonio } from '../historico/historico.js'
import { janelaDeMeses, yieldSobreCusto, type SerieProventos, type TipoProvento } from '../bolsa/proventos.js'

/**
 * Formato do dossiê. Separado de `PACOTE_VERSAO` porque os dois mudam por
 * motivos diferentes, e prendê-los faria um subir por causa do outro.
 */
export const DOSSIE_VERSAO = 1

/** As classes que o dossiê reconhece. O que não for uma delas vira `outro`. */
export const CLASSES_DOSSIE = ['acao', 'fii', 'etf', 'unit', 'outro'] as const
export type ClasseNoDossie = (typeof CLASSES_DOSSIE)[number]

export interface DossieManifesto {
  versao: number
  /** ISO. */
  geradoEm: string
  geradoPor: string
  /** Período coberto, `aaaa-mm`. */
  de: string
  ate: string
  /** `relativo`: sem valores absolutos, exceto o preço médio unitário. */
  modo: 'relativo'
  /** O que está aqui dentro, em português, para quem abrir o arquivo. */
  incluido: string[]
  /** O que foi deliberadamente deixado de fora. */
  excluido: string[]
  /** O que este dossiê NÃO enxerga, e por isso não deve ser lido como se visse. */
  ressalvas: string[]
}

/**
 * O resto do patrimônio, em peso e só em peso.
 *
 * Sem isto o dossiê é a fatia de bolsa apresentada como «minha carteira», e uma
 * análise de risco lida em cima dele fala de concentração que não existe: quem
 * tem 70% em renda fixa não está concentrado porque três ações somam metade da
 * parte de ações.
 *
 * Vem do histórico das declarações, que é o que o app tem — saldo de 31/12 por
 * classe, sem operação. Por isso é PESO e nunca valor: o modo relativo continua
 * inteiro. A data de referência vai junto porque um peso de 31/12 do ano passado
 * é outra coisa que um peso de hoje.
 */
export interface ContextoPatrimonial {
  /** `aaaa-mm-dd` da posição de onde estes pesos saíram. */
  referencia: string
  /**
   * Peso de cada classe sobre o patrimônio declarado. Soma 1.
   *
   * `ClassePatrimonio`, e não string livre, pelo mesmo motivo de
   * `PapelNoDossie.classe`: aqui entra um campo que vem do histórico das
   * declarações, e um rótulo que passasse direto seria a única porta do dossiê
   * por onde texto de fora sai sem passar por vocabulário conhecido.
   * `montarDossie` normaliza o que não reconhecer.
   */
  porClasse: { classe: ClassePatrimonio; proporcao: number }[]
  /** Peso da parte que o resto deste dossiê descreve, dentro do total acima. */
  pesoDaBolsa: number
}

export interface PapelNoDossie {
  ticker: string
  classe: ClasseNoDossie
  /** R$ por unidade. O ÚNICO absoluto do dossiê. */
  precoMedio: number
  /** Peso sobre o custo total da carteira. */
  proporcao: number
  /** `aaaa-mm`. Ausente quando a posição veio de antes do que os arquivos cobrem. */
  primeiraCompra?: string
  ultimaCompra?: string
  /** Resultado já realizado neste papel, sobre o custo baixado. `null` = sem venda. */
  resultadoRealizado: number | null
  /** Provento ÷ custo da posição. `null` = sem posição sobre a qual render. */
  rendimento12m: number | null
  rendimentoPeriodo: number | null
  /** Sem custo conhecido: entra listado e fica FORA de toda conta. */
  semCusto?: true
}

export interface VendaNoDossie {
  /** `aaaa-mm-dd` quando o extrato trouxe o dia; `aaaa-mm` quando não trouxe. */
  data: string
  ticker: string
  modalidade: string
  /** R$ por unidade, bruto. */
  precoVenda: number
  precoMedioNaVenda: number
  resultadoPct: number | null
  parteDaPosicao: number
  /** Caiu na isenção mensal dos R$ 20 mil. Só o pote comum a tem. */
  isenta: boolean
}

export interface Dossie {
  manifesto: DossieManifesto
  /**
   * Ausente quando não há histórico importado — e aí o manifesto diz, nas
   * ressalvas, que o dossiê descreve só a bolsa.
   */
  contexto?: ContextoPatrimonial
  carteira: PapelNoDossie[]
  vendas: VendaNoDossie[]
  proventos: {
    meses: { ano: number; mes: number; rendimento: number; porTipo: Record<string, number> }[]
    porAno: { ano: number; rendimento: number; porTipo: Record<string, number> }[]
    porTicker: { ticker: string; periodo: number | null; ultimos12m: number | null }[]
  }
  resumo: {
    papeis: number
    porClasse: { classe: string; proporcao: number }[]
    concentracao: { top1: number; top5: number; hhi: number }
    resultadoPorAno: { ano: number; resultadoPct: number | null; giro: number }[]
    /** Papéis fora das contas por falta de custo. Listados, nunca chutados. */
    semCusto: string[]
  }
}

export interface EntradaDossie {
  /** A série inteira, como `apurarSerie` devolve. */
  apuracoes: readonly ApuracaoBolsa[]
  /**
   * As operações que geraram a série.
   *
   * O plano não as previa, e elas são necessárias: a data da primeira e da
   * última compra de cada papel não está na apuração, que guarda posição e
   * vendas. «Há quanto tempo tenho isto» e «ainda estou acumulando» são duas
   * das perguntas que mais mudam uma sugestão.
   */
  operacoes: readonly Operacao[]
  proventos: SerieProventos
  /** Posição atual com custo médio — tipicamente a `posicaoFinal` do último ano. */
  posicao: readonly Posicao[]
  /** A classe de cada papel, por ticker. O que não for conhecido vira `outro`. */
  classes?: Readonly<Record<string, string>>
  /** Peso por classe vindo do histórico. Ausente = dossiê só de bolsa. */
  contexto?: ContextoPatrimonial
  geradoPor: string
  /** ISO. Entra por parâmetro para o arquivo ser reproduzível no teste. */
  agora: string
}

// ------------------------------------------------------------------ utilidades

/** Arredonda para deixar o arquivo legível — 0,18300000000000002 não ajuda ninguém. */
const arred = (v: number, casas: number) => {
  const f = 10 ** casas
  return Math.round(v * f) / f
}

const PESO = 6
const PRECO = 4

const mesTexto = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`

/** `dd/mm/aaaa` → `aaaa-mm-dd`; sem dia legível, cai no mês da operação. */
const dataTexto = (v: VendaEvento): string => {
  const m = v.data === undefined ? null : /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(v.data)
  return m === null ? mesTexto(v.ano, v.mes) : `${m[3]}-${m[2]}-${m[1]}`
}

const classeDe = (bruto: string | undefined): ClasseNoDossie =>
  (CLASSES_DOSSIE as readonly string[]).includes(bruto ?? '')
    ? (bruto as ClasseNoDossie)
    : 'outro'

const razao = (numerador: number, denominador: number, casas: number): number | null =>
  denominador > 0 ? arred(numerador / denominador, casas) : null

const entre = (v: number, min: number, max: number) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0

/**
 * Passa o contexto pelo vocabulário conhecido antes de deixá-lo entrar.
 *
 * É a única porta do dossiê por onde chegaria um rótulo de fora — o resto é
 * ticker, data, número e união fechada. Classe que não for do catálogo vira
 * `desconhecido`, e duas desconhecidas somam numa só em vez de aparecerem como
 * duas fatias sem nome. Data que não for `aaaa-mm-dd` sai vazia, porque uma
 * referência ilegível é pior que nenhuma: ela sugere precisão que não há.
 */
function normalizarContexto(c: ContextoPatrimonial): ContextoPatrimonial {
  // As chaves de `REGIME`, e não uma segunda lista: o tipo obriga aquele mapa a
  // ser exaustivo, então ele já É o catálogo. Uma cópia aqui ficaria para trás
  // na primeira classe nova.
  const catalogo = new Set<string>(Object.keys(REGIME))
  const somas = new Map<ClassePatrimonio, number>()
  c.porClasse.forEach(({ classe, proporcao }) => {
    const k: ClassePatrimonio = catalogo.has(classe) ? classe : 'desconhecido'
    somas.set(k, (somas.get(k) ?? 0) + entre(proporcao, 0, 1))
  })
  return {
    referencia: /^\d{4}-\d{2}-\d{2}$/.test(c.referencia) ? c.referencia : '',
    porClasse: [...somas.entries()]
      .map(([classe, proporcao]) => ({ classe, proporcao: arred(proporcao, PESO) }))
      .sort((a, b) => b.proporcao - a.proporcao),
    pesoDaBolsa: arred(entre(c.pesoDaBolsa, 0, 1), PESO),
  }
}

// ------------------------------------------------------------------ a montagem

/**
 * Monta o dossiê. Pura: a tela só baixa o que sai daqui, e o script da pasta
 * gera o MESMO arquivo de fora do navegador.
 *
 * É o que permite o invariante da anonimização ser testado uma vez, num lugar, e
 * não a cada caminho que gere o arquivo.
 */
export function montarDossie(e: EntradaDossie): Dossie {
  const vendas = e.apuracoes.flatMap((a) => a.vendas)
  const semCusto = [...new Set(e.apuracoes.flatMap((a) => a.semCusto))].sort()

  const custoDe = (p: Posicao) => p.quantidade * p.custoMedio
  const custoTotal = e.posicao.reduce((s, p) => s + custoDe(p), 0)

  // A janela de doze meses é a mesma para todos os papéis, e sai do fim da série
  // de proventos — não da data de hoje: um dossiê gerado em janeiro sobre dados
  // que param em outubro tem de falar de outubro.
  const janela = e.proventos.ate === undefined || e.proventos.ate === null
    ? undefined
    : janelaDeMeses(e.proventos.ate, 12)
  const doPeriodo = new Map(yieldSobreCusto(e.proventos, e.posicao).map((r) => [r.ticker, r]))
  const dos12 = new Map(yieldSobreCusto(e.proventos, e.posicao, janela).map((r) => [r.ticker, r]))

  const compras = new Map<string, string[]>()
  e.operacoes.forEach((o) => {
    if (o.tipo !== 'compra') return
    const lista = compras.get(o.ticker) ?? []
    lista.push(mesTexto(o.ano, o.mes))
    compras.set(o.ticker, lista)
  })

  const realizadoDe = (ticker: string): number | null => {
    const doPapel = vendas.filter((v) => v.ticker === ticker)
    return razao(
      doPapel.reduce((s, v) => s + v.resultado, 0),
      doPapel.reduce((s, v) => s + v.custoBaixado, 0),
      6,
    )
  }

  const carteira: PapelNoDossie[] = e.posicao
    .map((p) => {
      const datas = (compras.get(p.ticker) ?? []).sort()
      return {
        ticker: p.ticker,
        classe: classeDe(e.classes?.[p.ticker]),
        precoMedio: arred(p.custoMedio, PRECO),
        proporcao: custoTotal > 0 ? arred(custoDe(p) / custoTotal, PESO) : 0,
        ...(datas.length > 0 ? { primeiraCompra: datas[0], ultimaCompra: datas[datas.length - 1] } : {}),
        resultadoRealizado: realizadoDe(p.ticker),
        rendimento12m: dos12.get(p.ticker)?.rendimento ?? null,
        rendimentoPeriodo: doPeriodo.get(p.ticker)?.rendimento ?? null,
      }
    })
    .sort((a, b) => b.proporcao - a.proporcao || a.ticker.localeCompare(b.ticker))

  // Papel sem custo conhecido entra LISTADO e fora das contas — nunca chutado, e
  // nunca omitido: quem lê precisa saber que a carteira é maior que a tabela.
  const forasDaConta: PapelNoDossie[] = semCusto
    .filter((t) => !e.posicao.some((p) => p.ticker === t))
    .map((ticker) => ({
      ticker,
      classe: classeDe(e.classes?.[ticker]),
      precoMedio: 0,
      proporcao: 0,
      resultadoRealizado: null,
      rendimento12m: null,
      rendimentoPeriodo: null,
      semCusto: true as const,
    }))

  const porClasse = [...new Set(carteira.map((p) => p.classe))]
    .map((classe) => ({
      classe,
      proporcao: arred(
        carteira.filter((p) => p.classe === classe).reduce((s, p) => s + p.proporcao, 0),
        PESO,
      ),
    }))
    .sort((a, b) => b.proporcao - a.proporcao)

  const pesos = carteira.map((p) => p.proporcao)
  const ordenados = [...pesos].sort((a, b) => b - a)

  const anos = [...new Set(e.apuracoes.map((a) => a.ano))].sort((a, b) => a - b)
  const resultadoPorAno = anos.map((ano) => {
    const doAno = vendas.filter((v) => v.ano === ano)
    return {
      ano,
      resultadoPct: razao(
        doAno.reduce((s, v) => s + v.resultado, 0),
        doAno.reduce((s, v) => s + v.custoBaixado, 0),
        6,
      ),
      // Giro: quanto saiu no ano, contra o custo da carteira de hoje. Relativo,
      // como tudo mais — diz se a carteira é girada ou parada.
      giro: custoTotal > 0 ? arred(doAno.reduce((s, v) => s + v.valorVenda, 0) / custoTotal, PESO) : 0,
    }
  })

  const rendimentoDoMes = (total: number) => (custoTotal > 0 ? arred(total / custoTotal, PESO) : 0)
  const emRendimento = (porTipo: Record<TipoProvento, number>) =>
    Object.fromEntries(
      Object.entries(porTipo).map(([tipo, v]) => [tipo, rendimentoDoMes(v)]),
    ) as Record<string, number>

  const mesesDeOperacao = e.operacoes.map((o) => mesTexto(o.ano, o.mes))
  const mesesDeProvento = e.proventos.meses.map((m) => mesTexto(m.ano, m.mes))
  const todosOsMeses = [...mesesDeOperacao, ...mesesDeProvento, ...vendas.map((v) => mesTexto(v.ano, v.mes))].sort()

  const manifesto: DossieManifesto = {
    versao: DOSSIE_VERSAO,
    geradoEm: e.agora,
    geradoPor: e.geradoPor,
    de: todosOsMeses[0] ?? '',
    ate: todosOsMeses[todosOsMeses.length - 1] ?? '',
    modo: 'relativo',
    incluido: [
      'ticker de cada papel',
      'preço médio de compra, em R$ por unidade — o único valor absoluto',
      'proporção de cada papel sobre o custo total da carteira',
      'classe (ação, FII, ETF, unit)',
      'mês da primeira e da última compra',
      'resultado realizado, em percentual sobre o custo',
      'rendimento de proventos sobre o custo, em 12 meses e no período',
      'uma linha por venda: data, preço, custo médio na data, resultado em percentual',
      'provento mês a mês e ano a ano, em rendimento sobre o custo, por tipo',
      'concentração da carteira e peso por classe',
      ...(e.contexto === undefined ? [] : ['peso de cada classe do patrimônio, do histórico das declarações']),
    ],
    excluido: [
      'CPF, CNPJ, nome, corretora, número de conta',
      'quantidade de cada papel e custo total — precoMedio × quantidade seria o patrimônio',
      'valores em reais de ganho, perda e provento',
      'declarações, patrimônio, dívidas e gasto de vida',
      'nomes dos arquivos importados',
      'cotação: ela não existe em nenhum relatório da B3 que o app lê, e embutir preço envelheceria o arquivo',
    ],
    ressalvas: [
      'a lista de tickers com datas É a carteira de quem gerou este arquivo: ele não é para publicar',
      'operações fora da B3 — exterior e cripto — não passam por aqui',
      'corretagem e emolumentos não vêm no Extrato de Movimentação, então o ganho sai levemente superestimado',
      'proporção e rendimento são sobre CUSTO, não sobre mercado: um papel que multiplicou pesa mais do que a proporção diz',
      ...(semCusto.length > 0
        ? [`${semCusto.length} papel(is) sem custo conhecido ficaram fora das contas, listados em resumo.semCusto`]
        : []),
      ...(e.contexto === undefined
        ? ['este dossiê descreve só a bolsa; o resto do patrimônio não está aqui, nem como peso']
        : []),
    ],
  }

  return {
    manifesto,
    ...(e.contexto === undefined ? {} : { contexto: normalizarContexto(e.contexto) }),
    carteira: [...carteira, ...forasDaConta],
    vendas: vendas
      .map((v) => ({
        data: dataTexto(v),
        ticker: v.ticker,
        modalidade: v.modalidade,
        precoVenda: arred(v.precoVenda, PRECO),
        precoMedioNaVenda: arred(v.custoMedioNaVenda, PRECO),
        resultadoPct: v.resultadoPct === null ? null : arred(v.resultadoPct, 6),
        parteDaPosicao: arred(v.parteDaPosicao, PESO),
        isenta: v.isenta,
      }))
      .sort((a, b) => a.data.localeCompare(b.data) || a.ticker.localeCompare(b.ticker)),
    proventos: {
      meses: e.proventos.meses.map((m) => ({
        ano: m.ano,
        mes: m.mes,
        rendimento: rendimentoDoMes(m.total),
        porTipo: emRendimento(m.porTipo),
      })),
      porAno: e.proventos.porAno.map((a) => ({
        ano: a.ano,
        rendimento: rendimentoDoMes(a.total),
        porTipo: emRendimento(a.porTipo),
      })),
      porTicker: [...new Set([...doPeriodo.keys(), ...dos12.keys()])]
        .sort((a, b) => a.localeCompare(b))
        .map((ticker) => ({
          ticker,
          periodo: doPeriodo.get(ticker)?.rendimento ?? null,
          ultimos12m: dos12.get(ticker)?.rendimento ?? null,
        })),
    },
    resumo: {
      papeis: carteira.length,
      porClasse,
      concentracao: {
        top1: arred(ordenados[0] ?? 0, PESO),
        top5: arred(ordenados.slice(0, 5).reduce((s, v) => s + v, 0), PESO),
        hhi: arred(pesos.reduce((s, v) => s + v * v, 0), PESO),
      },
      resultadoPorAno,
      semCusto,
    },
  }
}

// ------------------------------------------------------------------ o briefing

const pct = (v: number | null | undefined, casas = 1) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(casas)}%`

const reais = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })

const tabela = (cabecalho: string[], linhas: string[][]) =>
  [
    `| ${cabecalho.join(' | ')} |`,
    `|${cabecalho.map(() => '---').join('|')}|`,
    ...linhas.map((l) => `| ${l.join(' | ')} |`),
  ].join('\n')

/**
 * O mesmo dossiê em texto, para quem vai LER.
 *
 * Existe porque o JSON é para máquina e o briefing é para leitura: quem receber
 * os dois gasta o esforço pesquisando mercado em vez de interpretando estrutura.
 *
 * A seção «Como ler» não é cortesia — é o que impede o erro mais provável de
 * quem abre este arquivo: tomar a proporção sobre custo por peso de mercado. A
 * fórmula que converte um no outro vai escrita ali, porque o leitor tem a
 * cotação e este arquivo não.
 */
export function dossieEmTexto(d: Dossie): string {
  const m = d.manifesto
  const partes: string[] = []

  partes.push(
    `# Dossiê da carteira — ${m.de} a ${m.ate}`,
    '',
    `Gerado por ${m.geradoPor} em ${m.geradoEm}. Formato ${m.versao}, modo **${m.modo}**.`,
    '',
    '## Como ler',
    '',
    'Este arquivo não traz valores em reais, exceto o **preço médio unitário** de cada',
    'papel. Ganho, provento e alocação vêm em percentual. Isso não tira análise nenhuma:',
    '',
    '- **Peso real de mercado** — a `proporcao` é medida sobre o CUSTO. Com a cotação de',
    '  hoje, o peso verdadeiro de cada papel é proporcional a',
    '  `proporcao × (preçoHoje ÷ precoMedio)`, normalizado sobre os papéis.',
    '- **Retorno não realizado da carteira** — `Σ proporcao × (preçoHoje ÷ precoMedio) − 1`.',
    '- **Sugestão de venda** — em fração da posição («realize um terço»), nunca em número',
    '  de ações: a quantidade não está aqui, de propósito.',
    '',
    '## Antes de concluir qualquer coisa',
    '',
    ...m.ressalvas.map((r) => `- ${r}`),
    '',
  )

  if (d.contexto !== undefined) {
    partes.push(
      `## Onde a bolsa entra no patrimônio (posição de ${d.contexto.referencia})`,
      '',
      `A bolsa é **${pct(d.contexto.pesoDaBolsa)}** do patrimônio declarado. O resto do`,
      'arquivo descreve só essa fatia — concentração e risco daqui não são os do todo.',
      '',
      tabela(
        ['Classe', 'Peso'],
        d.contexto.porClasse.map((c) => [c.classe, pct(c.proporcao)]),
      ),
      '',
    )
  }

  const naCarteira = d.carteira.filter((p) => p.semCusto !== true)
  partes.push(
    `## Carteira — ${d.resumo.papeis} ${d.resumo.papeis === 1 ? 'papel' : 'papéis'}`,
    '',
    tabela(
      ['Papel', 'Classe', 'Peso', 'Preço médio', 'Desde', 'Últ. compra', 'Realizado', 'Rend. 12m', 'Rend. período'],
      naCarteira.map((p) => [
        p.ticker,
        p.classe,
        pct(p.proporcao),
        reais(p.precoMedio),
        p.primeiraCompra ?? '—',
        p.ultimaCompra ?? '—',
        pct(p.resultadoRealizado),
        pct(p.rendimento12m),
        pct(p.rendimentoPeriodo),
      ]),
    ),
    '',
    `**Concentração** — maior posição ${pct(d.resumo.concentracao.top1)}, ` +
      `cinco maiores ${pct(d.resumo.concentracao.top5)}, HHI ${d.resumo.concentracao.hhi.toFixed(3)}.`,
    '',
    `**Por classe** — ${d.resumo.porClasse.map((c) => `${c.classe} ${pct(c.proporcao)}`).join(' · ')}`,
    '',
  )

  if (d.resumo.semCusto.length > 0) {
    partes.push(
      '### Fora das contas',
      '',
      `Sem custo de aquisição conhecido, e por isso fora de toda conta acima: ` +
        `${d.resumo.semCusto.join(', ')}. A carteira é maior que a tabela.`,
      '',
    )
  }

  if (d.resumo.resultadoPorAno.length > 0) {
    partes.push(
      '## Resultado realizado, ano a ano',
      '',
      tabela(
        ['Ano', 'Resultado sobre o custo', 'Giro'],
        d.resumo.resultadoPorAno.map((a) => [String(a.ano), pct(a.resultadoPct), pct(a.giro)]),
      ),
      '',
      '_Giro: quanto saiu no ano contra o custo da carteira de hoje._',
      '',
    )
  }

  if (d.proventos.porAno.length > 0) {
    partes.push(
      '## Proventos, em rendimento sobre o custo da carteira',
      '',
      tabela(
        ['Ano', 'Rendimento', 'Dividendo', 'JCP', 'FII', 'Outro'],
        d.proventos.porAno.map((a) => [
          String(a.ano),
          pct(a.rendimento, 2),
          pct(a.porTipo.dividendo ?? 0, 2),
          pct(a.porTipo.jcp ?? 0, 2),
          pct(a.porTipo.rendimento ?? 0, 2),
          pct(a.porTipo.outro ?? 0, 2),
        ]),
      ),
      '',
      '### Por papel',
      '',
      tabela(
        ['Papel', '12 meses', 'Período'],
        d.proventos.porTicker.map((t) => [t.ticker, pct(t.ultimos12m, 2), pct(t.periodo, 2)]),
      ),
      '',
    )
  }

  if (d.vendas.length > 0) {
    const ultimas = d.vendas.slice(-20)
    partes.push(
      `## Vendas — ${d.vendas.length} no período` +
        (ultimas.length < d.vendas.length ? ` (as ${ultimas.length} últimas abaixo; o JSON tem todas)` : ''),
      '',
      tabela(
        ['Data', 'Papel', 'Pote', 'Preço', 'Custo médio', 'Resultado', 'Da posição', 'Isenta'],
        ultimas.map((v) => [
          v.data,
          v.ticker,
          v.modalidade,
          reais(v.precoVenda),
          reais(v.precoMedioNaVenda),
          pct(v.resultadoPct),
          pct(v.parteDaPosicao),
          v.isenta ? 'sim' : 'não',
        ]),
      ),
      '',
    )
  }

  partes.push(
    '## O que este arquivo não tem',
    '',
    ...m.excluido.map((x) => `- ${x}`),
    '',
  )

  return partes.join('\n')
}
