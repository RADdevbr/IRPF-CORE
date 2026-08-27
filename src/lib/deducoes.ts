// Dos "Pagamentos e Doações Efetuados" da declaração para as deduções legais.
//
// O Registro 26 do `.DEC` já é lido — nome de quem recebeu, valor pago e a
// parcela não dedutível. O que faltava era levar esses números para onde eles
// mudam o imposto: o ajuste anual, que agora é a dedução do IRPFM.
//
// A classificação segue a mesma regra do resto do app: o texto vem de fora, o
// app SUGERE e quem confirma é quem está olhando. Um catálogo de códigos
// decorado aqui viraria bug silencioso no ano em que a Receita renumerar algo —
// e o estrago seria uma dedução inventada ou perdida no imposto devido.
//
// A parcela não dedutível (reembolso do plano, por exemplo) é descontada
// sozinha: ela está na própria linha do arquivo, e somá-la seria deduzir
// despesa que alguém devolveu.

import type { Pagamento } from './decParser'
import { defDeducoes, type DeducoesLegais } from '../calc/declaracao'

/** Para qual linha da declaração vai o pagamento. */
export type CategoriaDeducao = keyof DeducoesLegais | 'naoDedutivel' | 'indefinido'

export interface SugestaoDeducao {
  categoria: CategoriaDeducao
  porque: string
}

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()

/**
 * Palpite pelo nome de quem recebeu.
 *
 * Só o que é inequívoco vira sugestão. «Indefinido» é resposta legítima e é o
 * padrão: uma linha não classificada fica de fora da conta até alguém dizer o
 * que ela é, que é melhor do que entrar na categoria errada.
 */
export function sugerirCategoria(p: { beneficiario: string }): SugestaoDeducao {
  const n = semAcento(p.beneficiario)
  if (!n) return { categoria: 'indefinido', porque: 'linha sem nome de beneficiário' }

  if (/UNIMED|AMIL|BRADESCO SAUDE|SULAMERICA|HAPVIDA|PLANO DE SAUDE|ASSIST[EÊ]NCIA MEDICA/.test(n)) {
    return { categoria: 'saude', porque: 'operadora de plano de saúde' }
  }
  if (/HOSPITAL|CLINICA|LABORATORI|ODONTO|DENTIST|FISIOTERAP|PSICOLOG|FONOAUDIOLOG|IMAGEM|DIAGNOSTIC/.test(n)) {
    return { categoria: 'saude', porque: 'serviço de saúde' }
  }
  if (/COLEGIO|ESCOLA|UNIVERSIDADE|FACULDADE|CENTRO EDUCACIONAL|INSTITUTO DE ENSINO|CRECHE|PRE-ESCOLA/.test(n)) {
    return { categoria: 'instrucao', porque: 'instituição de ensino — o teto por pessoa se aplica' }
  }
  if (/PREVID|PGBL|BRASILPREV|ICATU|PREVIDENCIA COMPLEMENTAR|FUNDO DE PENSAO/.test(n)) {
    return { categoria: 'previdenciaPrivada', porque: 'previdência complementar — dedutível até 12% do rendimento' }
  }
  if (/INSS|INSTITUTO NACIONAL DO SEGURO/.test(n)) {
    return { categoria: 'previdenciaOficial', porque: 'previdência oficial' }
  }
  if (/PENSAO ALIMENT/.test(n)) {
    return { categoria: 'pensao', porque: 'pensão alimentícia — só vale por decisão judicial ou acordo homologado' }
  }
  return { categoria: 'indefinido', porque: 'não sei classificar sozinho — diga em que linha isto entra' }
}

/** Chave de agrupamento: mesmo beneficiário responde uma vez só. */
export const chavePagamento = (p: { codigo: string; beneficiario: string }) =>
  `${p.codigo.trim()}·${semAcento(p.beneficiario)}`

export interface GrupoPagamento {
  chave: string
  codigo: string
  beneficiario: string
  /** Já líquido da parcela não dedutível informada no próprio arquivo. */
  total: number
  /** Quanto foi descontado por ser reembolso / parcela não dedutível. */
  naoDedutivel: number
  quantos: number
  sugestao: CategoriaDeducao
  porque: string
}

/** Uma linha por beneficiário, para a tela perguntar uma vez e guardar. */
export function agruparPagamentos(pagamentos: Pagamento[]): GrupoPagamento[] {
  const porChave = new Map<string, Pagamento[]>()
  pagamentos.forEach((p) => {
    const k = chavePagamento(p)
    const atual = porChave.get(k)
    if (atual) atual.push(p)
    else porChave.set(k, [p])
  })

  return [...porChave.entries()]
    .map(([chave, linhas]) => {
      const { categoria, porque } = sugerirCategoria(linhas[0])
      const naoDedutivel = linhas.reduce((s, l) => s + Math.max(0, l.naoDedutivel), 0)
      const bruto = linhas.reduce((s, l) => s + Math.max(0, l.valor), 0)
      return {
        chave,
        codigo: linhas[0].codigo,
        beneficiario: linhas[0].beneficiario,
        total: Math.max(0, bruto - naoDedutivel),
        naoDedutivel,
        quantos: linhas.length,
        sugestao: categoria,
        porque,
      }
    })
    .filter((g) => g.total > 0 || g.naoDedutivel > 0)
    .sort((a, b) => b.total - a.total)
}

/**
 * Soma os grupos nas linhas da declaração, respeitando o que foi respondido.
 *
 * `atribuicoes` manda; sem resposta vale a sugestão. «Indefinido» e «não
 * dedutível» não somam em lugar nenhum — e é assim que a linha em dúvida deixa
 * de mexer no imposto até alguém decidir.
 */
export function somarPagamentos(
  grupos: GrupoPagamento[],
  atribuicoes: Record<string, CategoriaDeducao> = {},
): DeducoesLegais {
  const out = defDeducoes()
  grupos.forEach((g) => {
    const cat = atribuicoes[g.chave] ?? g.sugestao
    if (cat === 'indefinido' || cat === 'naoDedutivel') return
    out[cat] += g.total
  })
  return out
}

/** Quanto ficou de fora por estar sem resposta — a tela precisa cobrar isso. */
export function totalIndefinido(
  grupos: GrupoPagamento[],
  atribuicoes: Record<string, CategoriaDeducao> = {},
): number {
  return grupos
    .filter((g) => (atribuicoes[g.chave] ?? g.sugestao) === 'indefinido')
    .reduce((s, g) => s + g.total, 0)
}
