// Como um app da família entrega dado ao outro.
//
// O problema que isto resolve nasceu da separação. Quem lê os arquivos é o
// IRPF-calc: o `.DEC` de cada ano, os extratos da B3. Mas quem precisa do
// resultado são os outros dois — o painel de patrimônio não existe sem o
// histórico, e a estimativa do IRPFM fica muito melhor com o ano passado como
// base. Enquanto era um app só, isso era o mesmo objeto em memória.
//
// As três respostas possíveis, e por que esta:
//
//   · Reimportar em cada app. Honesto e ruim: são dez `.DEC` e dois extratos por
//     ano, e a pessoa faria o mesmo trabalho três vezes. Pior, as três cópias
//     divergiriam na primeira correção manual de classe.
//   · Cofre único compartilhado. É o monolito de volta pela porta dos fundos: os
//     três apps voltariam a depender do formato de estado um do outro, que é
//     exatamente o acoplamento que a separação desfez.
//   · Um PACOTE explícito, que sai de um app e entra no outro. É esta.
//
// O pacote é um arquivo JSON que a pessoa baixa de um app e solta no outro (e que
// também trafega direto, quando os dois estão na mesma conta). Ele é um CONTRATO,
// não um estado: tem só os campos que o outro lado precisa, e cada campo é dado
// derivado de arquivo — nenhuma preferência de tela, nenhum cenário, nada que só
// faça sentido dentro de quem o gerou.
//
// É a fronteira estreita de propósito. Um pacote que carregasse o estado inteiro
// reataria os apps: mudar um campo interno de um quebraria a leitura do outro, e
// estaríamos de volta ao tipo único que ninguém conseguia mexer.

import type { Historico, Overrides, Aportes, Vinculos } from '../historico/historico.js'
import type { Entradas } from '../historico/consistencia.js'
import type { OrigemPorPagador } from '../patrimonio/renda.js'

/**
 * Formato do pacote. Suba ao mudar o SIGNIFICADO de um campo; campo novo e
 * opcional não exige subir.
 *
 * Quem lê recusa versão maior do que conhece, com mensagem — ler um campo que
 * mudou de unidade e apresentar o número como certo é o pior estrago possível
 * aqui, porque o número vai para uma declaração.
 */
export const PACOTE_VERSAO = 1

export interface Cabecalho {
  versao: number
  /** ISO. Serve para a tela dizer «este pacote é de março». */
  geradoEm: string
  /** Qual app gerou — aparece na tela de quem importa. */
  geradoPor: string
}

/**
 * O histórico plurianual das declarações, como sai do IRPF-calc.
 *
 * Vai junto o trabalho MANUAL que a pessoa fez sobre ele, e é isso que faz o
 * pacote valer a pena: a classe corrigida à mão, o aporte informado, a ligação
 * entre anos de um bem que o banco renomeou, o que só ela sabe (dívidas, gasto de
 * vida). Sem esses campos, o outro app receberia os números e pediria o trabalho
 * de novo.
 */
export interface PacoteHistorico extends Cabecalho {
  tipo: 'historico'
  historico: Historico
  /** Correções manuais de classe por posição. */
  classeOverrides?: Overrides
  /** Aportes informados por ano. */
  aportes?: Aportes
  /** Ligações entre anos confirmadas à mão. */
  vinculos?: Vinculos
  /** Ligações automáticas que a pessoa desfez — o app não as refaz. */
  vetados?: string[]
  /** Dívidas, entradas não recorrentes e gasto de vida, por ano. */
  consistencia?: Entradas
  /**
   * O que é trabalho e o que é capital, por pagador.
   *
   * É a resposta que só a pessoa tem: o lucro que a PJ dela distribui é
   * pagamento pelo que ela fez, e o provento do ETF ao lado, na mesma ficha da
   * declaração, não é. Sem este campo o painel de patrimônio perguntaria tudo de
   * novo — e é para isso que o pacote existe.
   */
  origemPagador?: OrigemPorPagador
}

/**
 * A base do ano seguinte, como sai do IRPF-calc para a estimativa do IRPFM.
 *
 * É a resposta a «prepara um básico para o preenchimento do ano que vem»: os
 * rendimentos por fonte que os arquivos já provam, o que foi retido, as deduções
 * legais que os pagamentos da declaração revelam, e a posição de 31/12 com custo
 * médio — que é o que a apuração de bolsa do ano seguinte precisa para começar.
 *
 * Não vai projeção nenhuma: projetar é a pergunta do outro app, e mandar um
 * número projetado daqui seria decidir por ele.
 */
export interface PacoteBaseline extends Cabecalho {
  tipo: 'baseline'
  /** Ano-base a que estes números se referem. */
  anoBase: number
  /** Rendimentos por fonte, nas chaves de `fiscal/fontes.ts`. */
  vals: Record<string, number>
  ndep: number
  /** Deduções legais somadas dos «Pagamentos e Doações Efetuados». */
  deducoes?: Record<string, number>
  /** Provento por pagador, mês a mês — o gatilho do Art. 6º-A é mensal. */
  proventos?: { pagador: string; meses: number[] }[]
  /** Posição em 31/12 com custo médio, para a apuração de bolsa começar. */
  posicaoInicial?: { ticker: string; quantidade: number; custoMedio: number }[]
  /** Prejuízo acumulado a compensar, por modalidade. */
  prejuizoAcumulado?: Record<string, number>
}

export type Pacote = PacoteHistorico | PacoteBaseline

export function novoPacoteHistorico(
  geradoPor: string,
  agora: string,
  dados: Omit<PacoteHistorico, keyof Cabecalho | 'tipo'>,
): PacoteHistorico {
  return { versao: PACOTE_VERSAO, geradoEm: agora, geradoPor, tipo: 'historico', ...dados }
}

export function novoPacoteBaseline(
  geradoPor: string,
  agora: string,
  dados: Omit<PacoteBaseline, keyof Cabecalho | 'tipo'>,
): PacoteBaseline {
  return { versao: PACOTE_VERSAO, geradoEm: agora, geradoPor, tipo: 'baseline', ...dados }
}

/**
 * Porta de entrada do pacote. Recusa com mensagem em vez de aceitar pela metade.
 *
 * `tipoEsperado` existe para o app não aceitar o pacote errado: soltar o baseline
 * no importador de histórico devolveria um painel vazio sem explicar por quê.
 */
export function lerPacote<T extends Pacote['tipo']>(bruto: unknown, tipoEsperado: T): Extract<Pacote, { tipo: T }> {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error('Arquivo inválido: o conteúdo não é um objeto JSON.')
  }
  const o = bruto as Record<string, unknown>
  if (typeof o.versao !== 'number' || !Number.isFinite(o.versao)) {
    throw new Error('Este arquivo não é um pacote da família IRPF (falta o campo "versao").')
  }
  if (o.versao > PACOTE_VERSAO) {
    throw new Error(
      `Pacote gerado por uma versão mais nova (formato ${o.versao}; este lê até ${PACOTE_VERSAO}). Atualize a página e tente de novo.`,
    )
  }
  if (o.tipo !== tipoEsperado) {
    const nomes: Record<Pacote['tipo'], string> = {
      historico: 'histórico das declarações',
      baseline: 'base do ano seguinte',
    }
    const recebido = typeof o.tipo === 'string' && o.tipo in nomes ? nomes[o.tipo as Pacote['tipo']] : 'desconhecido'
    throw new Error(
      `Este pacote é de ${recebido}, e aqui entra o de ${nomes[tipoEsperado]}. Verifique qual arquivo você baixou.`,
    )
  }
  if (tipoEsperado === 'historico' && (!o.historico || typeof o.historico !== 'object')) {
    throw new Error('Pacote de histórico sem o campo "historico".')
  }
  if (tipoEsperado === 'baseline' && (!o.vals || typeof o.vals !== 'object')) {
    throw new Error('Pacote de base sem o campo "vals" com os rendimentos por fonte.')
  }
  return o as unknown as Extract<Pacote, { tipo: T }>
}

/** Nome de arquivo estável e reconhecível na pasta de downloads. */
export function nomeDoArquivo(tipo: Pacote['tipo'], agora: string): string {
  const dia = agora.slice(0, 10)
  return tipo === 'historico' ? `irpf-historico-${dia}.json` : `irpf-base-${dia}.json`
}
