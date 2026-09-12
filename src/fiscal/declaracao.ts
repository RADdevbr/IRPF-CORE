// A declaração de ajuste anual — e por que ela precisa existir aqui.
//
// A Lei 15.270/2025 manda abater do IRPFM o imposto DEVIDO na declaração, mais
// o que foi retido em definitivo. O app abatia a soma das retenções, que é
// outra coisa: retenção de salário e de aluguel é ANTECIPAÇÃO, e o que fecha o
// ano é o ajuste — com previdência, saúde, instrução, dependentes e livro-caixa
// dentro.
//
// Para quem só tem salário e nada a deduzir os dois números quase coincidem, e
// era por isso que a simplificação passava despercebida. Para o perfil que este
// app atende — PJ com pró-labore, plano de saúde, PGBL, dependentes — eles
// divergem em milhares de reais, nos DOIS sentidos: dedução legal derruba o
// imposto devido (e portanto o abatimento do IRPFM), enquanto o desconto
// simplificado costuma derrubá-lo mais ainda em renda alta.
//
// Nada aqui apura imposto de verdade: é a mesma estimativa de planejamento do
// resto do app, com os limites declarados em `params.ts` e o modelo escolhido
// visível na tela.

import { parametros, type FaixaIRRF, type ParametrosAno } from './params.js'
import { calcIRRF, aplicaReducao } from './tabela.js'

/**
 * As deduções legais, no ano, como a pessoa informa.
 *
 * `previdenciaOficial` fica separada das outras porque o app costuma saber esse
 * número sozinho: quando o IRRF do pró-labore é calculado aqui, o INSS já saiu
 * da mesma conta.
 */
export interface DeducoesLegais {
  /** INSS / previdência oficial paga no ano. */
  previdenciaOficial: number
  /** PGBL e fundos de pensão — limitados a uma fração do rendimento. */
  previdenciaPrivada: number
  /** Médicos, dentistas, hospitais, planos de saúde. Sem teto. */
  saude: number
  /** Instrução — com teto por pessoa. */
  instrucao: number
  /** Pensão alimentícia por decisão judicial ou acordo homologado. */
  pensao: number
  /** Livro-caixa da atividade autônoma. */
  livroCaixa: number
  /** O que não coube nas outras linhas. */
  outras: number
}

export function defDeducoes(): DeducoesLegais {
  return {
    previdenciaOficial: 0,
    previdenciaPrivada: 0,
    saude: 0,
    instrucao: 0,
    pensao: 0,
    livroCaixa: 0,
    outras: 0,
  }
}

export const DEDUCOES_ZERO = defDeducoes()

/** Rótulo e explicação de cada linha, para a tela e para a memória. */
export const LINHAS_DEDUCAO: {
  key: keyof DeducoesLegais
  label: string
  info: string
}[] = [
  { key: 'previdenciaOficial', label: 'Previdência oficial (INSS)', info: 'Preenchida sozinha quando o app calcula o IRRF do pró-labore.' },
  { key: 'previdenciaPrivada', label: 'Previdência privada (PGBL)', info: 'Dedutível até 12% do rendimento tributável. VGBL não é dedutível.' },
  { key: 'saude', label: 'Despesas médicas', info: 'Médicos, dentistas, hospitais, exames e plano de saúde. Sem teto.' },
  { key: 'instrucao', label: 'Instrução', info: 'Teto por pessoa, contribuinte e cada dependente. Curso livre não entra.' },
  { key: 'pensao', label: 'Pensão alimentícia', info: 'Só por decisão judicial ou acordo homologado.' },
  { key: 'livroCaixa', label: 'Livro-caixa', info: 'Despesas de custeio da atividade autônoma, limitadas à receita dela.' },
  { key: 'outras', label: 'Outras deduções', info: 'O que não coube acima — doações incentivadas, por exemplo.' },
]

/**
 * Tabela progressiva ANUAL, derivada da mensal.
 *
 * É assim que a tabela do ajuste se relaciona com a da retenção: mesma
 * alíquota, faixa e parcela a deduzir multiplicadas por doze. Derivar em vez de
 * digitar mantém as duas coladas — trocar a tabela mensal à mão, que o app já
 * permite, passa a valer para o ajuste também, sem uma segunda edição.
 */
export function tabelaAnual(par: ParametrosAno = parametros()): FaixaIRRF[] {
  return par.irrf.faixas.map((f) => ({
    ate: f.ate === Infinity ? Infinity : f.ate * 12,
    aliq: f.aliq,
    ded: f.ded * 12,
  }))
}

/**
 * A redução do Art. 3º-A no ano.
 *
 * ⟨confirmar⟩ A lei escreve a redução no mensal. O ajuste anual precisa da
 * contrapartida, senão a isenção concedida mês a mês seria desfeita em abril —
 * então aqui ela é a MESMA regra anualizada: os limites e a constante vezes
 * doze, o coeficiente igual (ele é adimensional). A conta fecha: 978,62 × 12 =
 * 11.743,44, que zera exatamente em 7.350 × 12 = 88.200.
 */
function reducaoAnual(rendimentoAnual: number, impostoBruto: number, par: ParametrosAno): number {
  const r = par.reducao
  const anual = {
    ...par,
    reducao: {
      ...r,
      isencaoAte: r.isencaoAte * 12,
      reducaoAte: r.reducaoAte * 12,
      constante: r.constante * 12,
    },
  }
  return aplicaReducao(rendimentoAnual, impostoBruto, anual)
}

/** Um dos dois modelos da declaração, já apurado. */
export interface Modelo {
  nome: 'completo' | 'simplificado'
  /** O que foi abatido do rendimento neste modelo. */
  abatimento: number
  base: number
  /** Imposto pela tabela, antes da redução do Art. 3º-A. */
  bruto: number
  /** Imposto depois da redução. É o "devido" deste modelo. */
  devido: number
}

export interface ResultadoDeclaracao {
  /** Rendimentos tributáveis na declaração, no ano. */
  rendimentos: number
  /** Dedução por dependente aplicada (anual). */
  dependentes: number
  /** Deduções legais depois de aplicados os tetos. */
  deducoesAceitas: DeducoesLegais
  /** O que cada teto cortou, para a tela poder dizer. */
  cortes: { linha: keyof DeducoesLegais; informado: number; aceito: number }[]
  completo: Modelo
  simplificado: Modelo
  /** O modelo mais barato — é o que a pessoa escolheria, e o que o app usa. */
  escolhido: Modelo
  /** O imposto devido na declaração: a dedução que a lei manda abater do IRPFM. */
  devido: number
}

const soma = (d: DeducoesLegais) =>
  d.previdenciaOficial + d.previdenciaPrivada + d.saude + d.instrucao + d.pensao + d.livroCaixa + d.outras

/** Imposto pela tabela anual, já com a redução do Art. 3º-A anualizada. */
function impostoAnual(base: number, rendimentos: number, par: ParametrosAno): { bruto: number; devido: number } {
  const comTabelaAnual: ParametrosAno = { ...par, irrf: { ...par.irrf, faixas: tabelaAnual(par) } }
  const { bruto } = calcIRRF(Math.max(0, base), comTabelaAnual)
  return { bruto, devido: Math.max(0, reducaoAnual(rendimentos, bruto, par)) }
}

/**
 * Apura o imposto devido na declaração, nos dois modelos, e devolve o menor.
 *
 * Escolher o menor não é otimização: é o que qualquer contribuinte faz, e é o
 * que o programa da Receita sugere sozinho. Fingir o modelo completo quando o
 * simplificado é mais barato superestimaria a dedução do IRPFM.
 */
export function apurarDeclaracao(entrada: {
  rendimentos: number
  deducoes?: Partial<DeducoesLegais>
  ndep?: number
  par?: ParametrosAno
}): ResultadoDeclaracao {
  const par = entrada.par ?? parametros()
  const rendimentos = Math.max(0, entrada.rendimentos)
  const ndep = Math.max(0, Math.floor(entrada.ndep ?? 0))
  const informado: DeducoesLegais = { ...defDeducoes(), ...entrada.deducoes }

  // Os tetos, aplicados um a um e relatados: um limite que corta em silêncio
  // vira "informei e não mudou nada", que é a reclamação certa.
  const tetoPrevidencia = rendimentos * par.declaracao.previdenciaPrivadaFracao
  const tetoInstrucao = par.declaracao.instrucaoPorPessoa * (1 + ndep)
  const deducoesAceitas: DeducoesLegais = {
    ...informado,
    previdenciaPrivada: Math.min(Math.max(0, informado.previdenciaPrivada), tetoPrevidencia),
    instrucao: Math.min(Math.max(0, informado.instrucao), tetoInstrucao),
  }
  const cortes = (['previdenciaPrivada', 'instrucao'] as const)
    .filter((k) => informado[k] > deducoesAceitas[k] + 0.005)
    .map((linha) => ({ linha, informado: informado[linha], aceito: deducoesAceitas[linha] }))

  const dependentes = par.dependente.mensal * 12 * ndep

  const abatimentoCompleto = soma(deducoesAceitas) + dependentes
  const baseCompleta = Math.max(0, rendimentos - abatimentoCompleto)
  const c = impostoAnual(baseCompleta, rendimentos, par)
  const completo: Modelo = {
    nome: 'completo',
    abatimento: abatimentoCompleto,
    base: baseCompleta,
    bruto: c.bruto,
    devido: c.devido,
  }

  const abatimentoSimples = Math.min(
    rendimentos * par.declaracao.descontoSimplificadoAliq,
    par.declaracao.descontoSimplificadoTeto,
  )
  const baseSimples = Math.max(0, rendimentos - abatimentoSimples)
  const s = impostoAnual(baseSimples, rendimentos, par)
  const simplificado: Modelo = {
    nome: 'simplificado',
    abatimento: abatimentoSimples,
    base: baseSimples,
    bruto: s.bruto,
    devido: s.devido,
  }

  // Empate fica com o completo: ele é o que a pessoa efetivamente preencheu, e
  // é o que a memória de cálculo consegue justificar linha a linha.
  const escolhido = simplificado.devido < completo.devido ? simplificado : completo

  return {
    rendimentos,
    dependentes,
    deducoesAceitas,
    cortes,
    completo,
    simplificado,
    escolhido,
    devido: escolhido.devido,
  }
}
