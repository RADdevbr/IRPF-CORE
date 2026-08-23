// Histórico plurianual das declarações — ver PLAN-CONTA-E-HISTORICO.md §2.
//
// Importar UM .DEC responde "se 2026 repetir 2025, caio no IRPFM?". Importar N
// responde três perguntas que nenhuma calculadora responde: quanto o patrimônio
// cresceu, se a lei nova teria pegado os anos passados, e — o ponto do pedido —
// QUANTO do patrimônio, se resgatado, joga rendimento na base do IRPFM.

import type { DecResult, Lancamento } from './decParser'
import { computeIrpfm } from '../calc/irpfm'

/** O que acontece com a base do IRPFM quando este bem vira dinheiro. */
export type Regime = 'inBase' | 'foraBase' | 'depende'

export interface PosicaoAno {
  id: string
  descricao: string
  classe: ClassePatrimonio
  regime: Regime
  saldoAnterior: number
  saldoAtual: number
}

export interface Declaracao {
  exercicio: number // ano da DECLARAÇÃO (2026 = ano-base 2025)
  anoBase: number
  arquivo: string
  importadoEm: string
  vals: Record<string, number>
  ndep: number
  posicoes: PosicaoAno[]
  base: number // base do IRPFM com a renda daquele ano
  irpfm: number // o que teria sido devido sob a Lei 15.270
  patrimonio: number
}

export type Historico = Record<string, Declaracao> // chave: anoBase

export type ClassePatrimonio =
  | 'cdb'
  | 'tesouro'
  | 'fundo'
  | 'debentureComum'
  | 'lci'
  | 'cri'
  | 'debentureInc'
  | 'poupanca'
  | 'fii'
  | 'acoes'
  | 'imovel'
  | 'previdencia'
  | 'veiculo'
  | 'contaCorrente'
  | 'exterior'
  | 'desconhecido'

/**
 * Regime de cada classe. Onde a lei ainda não está clara (ganho de capital em
 * ações, venda de imóvel, resgate de PGBL/VGBL) o valor é 'depende' — aparece na
 * tela como faixa, nunca como número afirmado.
 */
export const REGIME: Record<ClassePatrimonio, Regime> = {
  cdb: 'inBase',
  tesouro: 'inBase',
  fundo: 'inBase',
  debentureComum: 'inBase',
  exterior: 'inBase',
  lci: 'foraBase',
  cri: 'foraBase',
  debentureInc: 'foraBase',
  poupanca: 'foraBase',
  fii: 'foraBase', // o rendimento mensal é isento; a VENDA da cota é 'depende'
  contaCorrente: 'foraBase',
  acoes: 'depende',
  imovel: 'depende',
  previdencia: 'depende',
  veiculo: 'depende',
  desconhecido: 'depende',
}

export const NOME_CLASSE: Record<ClassePatrimonio, string> = {
  cdb: 'CDB / RDB',
  tesouro: 'Tesouro Direto',
  fundo: 'Fundos tributáveis',
  debentureComum: 'Debêntures comuns',
  lci: 'LCI / LCA',
  cri: 'CRI / CRA',
  debentureInc: 'Debêntures incentivadas',
  poupanca: 'Poupança',
  fii: 'FII',
  acoes: 'Ações',
  imovel: 'Imóveis',
  previdencia: 'Previdência (PGBL/VGBL)',
  veiculo: 'Veículos',
  contaCorrente: 'Conta corrente',
  exterior: 'Exterior',
  desconhecido: 'Não classificado',
}

/**
 * Classifica pela descrição do Bens e Direitos, que é texto livre.
 * O default é 'desconhecido' — e 'desconhecido' é 'depende', NÃO 'inBase':
 * chutar que um bem não identificado solta base do IRPFM inventaria imposto.
 */
export function classificaPatrimonio(descricao: string): ClassePatrimonio {
  const d = descricao.toUpperCase()
  if (/POUPAN/.test(d)) return 'poupanca'
  if (/\bLC[IA]\b|LETRA DE CR[ÉE]DITO/.test(d)) return 'lci'
  if (/\bCR[IA]\b|CERTIFICAD[OA] DE RECEB/.test(d)) return 'cri'
  if (/INCENTIVAD/.test(d)) return 'debentureInc'
  if (/DEB[ÊE]NTURE/.test(d)) return 'debentureComum'
  if (/\bFII\b|FUNDO DE INVEST.*IMOBILI|IMOBILI[ÁA]RIO/.test(d)) return 'fii'
  if (/TESOURO|NTN-|\bLFT\b|\bLTN\b|SELIC/.test(d)) return 'tesouro'
  if (/\bCDB\b|\bRDB\b|\bLC\b/.test(d)) return 'cdb'
  if (/PGBL|VGBL|PREVID/.test(d)) return 'previdencia'
  if (/A[ÇC][ÕO]ES|\bON\b|\bPN\b|B3|BOLSA/.test(d)) return 'acoes'
  if (/APARTAMENTO|CASA|TERRENO|IM[ÓO]VEL|SALA COMERCIAL|CHACARA|CH[ÁA]CARA|FAZENDA/.test(d)) return 'imovel'
  if (/VE[ÍI]CULO|AUTOM[ÓO]VEL|CARRO|MOTOCICLETA/.test(d)) return 'veiculo'
  if (/CONTA CORRENTE|CONTA-CORRENTE|DEP[ÓO]SITO/.test(d)) return 'contaCorrente'
  if (/EXTERIOR|OFFSHORE|\bUSD\b/.test(d)) return 'exterior'
  if (/FUNDO|\bFIC\b|COTAS/.test(d)) return 'fundo'
  return 'desconhecido'
}

/** Soma os lançamentos por campo de destino, ignorando os sem destino. */
export function somaPorAlvo(lancamentos: Lancamento[]): Record<string, number> {
  const vals: Record<string, number> = {}
  for (const l of lancamentos) {
    if (!l.alvo) continue
    vals[l.alvo] = (vals[l.alvo] ?? 0) + l.valor
  }
  return vals
}

/** Identidade estável da posição entre anos: classe + descrição normalizada. */
export function idPosicao(descricao: string, classe: ClassePatrimonio): string {
  const norm = descricao
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return `${classe}:${norm}`
}

/**
 * Converte o resultado do parser numa declaração do histórico, já com a base do
 * IRPFM e o imposto que teria sido devido naquele ano.
 */
export function montarDeclaracao(dec: DecResult, arquivo: string, agora: string, exercicioManual?: number): Declaracao | null {
  const exercicio = exercicioManual ?? (dec.ano ? parseInt(dec.ano, 10) : NaN)
  if (!Number.isFinite(exercicio)) return null

  const vals = somaPorAlvo(dec.lancamentos)
  const r = computeIrpfm({ vals, ndep: dec.ndep, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 })

  const posicoes: PosicaoAno[] = dec.posicoes
    .filter((p) => p.saldoAtual > 0 || p.saldoAnterior > 0)
    .map((p) => {
      const classe = classificaPatrimonio(p.descricao)
      return {
        id: idPosicao(p.descricao, classe),
        descricao: p.descricao,
        classe,
        regime: REGIME[classe],
        saldoAnterior: p.saldoAnterior,
        saldoAtual: p.saldoAtual,
      }
    })

  return {
    exercicio,
    anoBase: exercicio - 1,
    arquivo,
    importadoEm: agora,
    vals,
    ndep: dec.ndep,
    posicoes,
    base: r.base,
    irpfm: r.liquido,
    patrimonio: posicoes.reduce((s, p) => s + p.saldoAtual, 0),
  }
}

// ---------------------------------------------------------------- séries

export interface PontoPatrimonio {
  anoBase: number
  inBase: number
  foraBase: number
  depende: number
  total: number
}

export function seriePatrimonio(h: Historico): PontoPatrimonio[] {
  return Object.values(h)
    .map((d) => {
      const p = { anoBase: d.anoBase, inBase: 0, foraBase: 0, depende: 0, total: 0 }
      for (const pos of d.posicoes) {
        p[pos.regime] += pos.saldoAtual
        p.total += pos.saldoAtual
      }
      return p
    })
    .sort((a, b) => a.anoBase - b.anoBase)
}

export interface PontoBacktest {
  anoBase: number
  base: number
  irpfm: number
  cruzou: boolean
}

export function serieBacktest(h: Historico): PontoBacktest[] {
  return Object.values(h)
    .map((d) => ({ anoBase: d.anoBase, base: d.base, irpfm: d.irpfm, cruzou: d.base > 600_000 }))
    .sort((a, b) => a.anoBase - b.anoBase)
}

/** Crescimento anual composto entre o primeiro e o último ano com patrimônio. */
export function cagr(serie: PontoPatrimonio[]): number | null {
  const comValor = serie.filter((p) => p.total > 0)
  if (comValor.length < 2) return null
  const ini = comValor[0]
  const fim = comValor[comValor.length - 1]
  const anos = fim.anoBase - ini.anoBase
  if (anos <= 0 || ini.total <= 0) return null
  return Math.pow(fim.total / ini.total, 1 / anos) - 1
}

/** Total por classe no ano mais recente — alimenta o mapa de resgate. */
export function porClasse(h: Historico): { classe: ClassePatrimonio; regime: Regime; total: number }[] {
  const anos = Object.values(h).sort((a, b) => b.anoBase - a.anoBase)
  if (anos.length === 0) return []
  const soma = new Map<ClassePatrimonio, number>()
  for (const p of anos[0].posicoes) soma.set(p.classe, (soma.get(p.classe) ?? 0) + p.saldoAtual)
  return [...soma.entries()]
    .map(([classe, total]) => ({ classe, regime: REGIME[classe], total }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
}

export function upsertDeclaracao(h: Historico, d: Declaracao): Historico {
  return { ...h, [String(d.anoBase)]: d }
}

export function removerAno(h: Historico, anoBase: number): Historico {
  const { [String(anoBase)]: _, ...resto } = h
  return resto
}
