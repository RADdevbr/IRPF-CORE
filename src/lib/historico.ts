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
  codigo: string
  subcodigo?: string
  /** Linha original do .DEC. Fica no cofre cifrado, junto do resto. */
  bruta?: string
  classe: ClassePatrimonio
  regime: Regime
  saldoAnterior: number
  saldoAtual: number
}

/** O que o parser conseguiu extrair — mostrado por arquivo, para anos antigos. */
export interface Diagnostico {
  registros: { tipo: string; count: number }[]
  lancamentos: number
  posicoes: number
  totalLinhas: number
  anoDetectado: boolean
}

export interface Declaracao {
  diagnostico: Diagnostico
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
  | 'participacao'
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
  participacao: 'depende',
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
  participacao: 'Participação societária (quotas)',
  desconhecido: 'Não classificado',
}

/**
 * Código antigo do bem (até o exercício 2018) → classe. Conferido contra um
 * arquivo real de 2020, cada código batendo com a descrição da própria linha:
 * 21 com placa de veículo, 31 com ticker e quantidade, 32 com "participação de
 * X% no capital social", 61 com agência e conta.
 *
 * De 2019 em diante o campo passou a ser o GRUPO, e os valores dos dois
 * esquemas não colidem (antigos 21–79, novos 01–10 e 99), então esta tabela
 * pode ser consultada sem saber o ano.
 *
 * Os códigos de FUNDOS (71, 72, 73, 74, 79) ficam DE FORA de propósito: a
 * família é clara, o subtipo não, e errar entre "fundo tributável" e "FII"
 * trocaria isento por tributável — inventaria imposto. E o esquema novo não
 * entra aqui de jeito nenhum: com as descrições anonimizadas não deu para
 * confirmar nenhum par grupo/código, e chutar seria pior que deixar em aberto.
 * Para esses, a tela classifica uma vez e aplica a todos com o mesmo código.
 */
export const CLASSE_POR_CODIGO: Record<string, ClassePatrimonio> = {
  '21': 'veiculo',
  '31': 'acoes',
  '32': 'participacao',
  '41': 'poupanca',
  '45': 'cdb',
  '61': 'contaCorrente',
}

/** Como o código aparece na tela: "45" no esquema antigo, "03·01" no novo. */
export function rotuloCodigo(codigo?: string, subcodigo?: string): string {
  const c = (codigo ?? '').trim()
  if (!c) return ''
  const s = (subcodigo ?? '').trim()
  return s && s !== '01' ? `${c}·${s}` : c
}

/** Chave de agrupamento: bens com o mesmo par recebem a mesma classificação. */
export const chaveCodigo = (p: { codigo?: string; subcodigo?: string }) =>
  `${(p.codigo ?? '').trim()}·${(p.subcodigo ?? '').trim()}`

/**
 * Ids de todas as posições, em todos os anos, que compartilham o código.
 *
 * Sem código não há grupo: arquivo antigo (ou linha que o layout cortou) chega
 * com o campo em branco, e agrupar por "vazio" juntaria bens que não têm nada a
 * ver — o imóvel viraria renda fixa junto com o resto.
 */
export function idsPorCodigo(h: Historico, chave: string): string[] {
  if (!chave.replace(/[·\s]/g, '')) return []
  const ids = new Set<string>()
  for (const d of Object.values(h)) {
    for (const p of d.posicoes) if (chaveCodigo(p) === chave) ids.add(p.id)
  }
  return [...ids]
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

/**
 * Classe da posição: a descrição manda quando reconhece algo, porque distingue
 * o que o código não distingue (LCI/LCA e incentivadas têm o mesmo código de
 * renda fixa e regime oposto). O código entra quando a descrição não diz nada.
 */
export function classificaPosicao(descricao: string, codigo?: string): ClassePatrimonio {
  const pelaDescricao = classificaPatrimonio(descricao)
  if (pelaDescricao !== 'desconhecido') return pelaDescricao
  return (codigo && CLASSE_POR_CODIGO[codigo.trim()]) || 'desconhecido'
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
      const classe = classificaPosicao(p.descricao, p.codigo)
      return {
        id: idPosicao(p.descricao, classe),
        descricao: p.descricao,
        codigo: p.codigo,
        subcodigo: p.subcodigo,
        bruta: p.bruta,
        classe,
        regime: REGIME[classe],
        saldoAnterior: p.saldoAnterior,
        saldoAtual: p.saldoAtual,
      }
    })

  return {
    diagnostico: {
      registros: dec.registros.map((r) => ({ tipo: r.tipo, count: r.count })),
      lancamentos: dec.lancamentos.length,
      posicoes: dec.posicoes.length,
      totalLinhas: dec.totalLinhas,
      anoDetectado: dec.ano !== null,
    },
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

const DIAGNOSTICO_VAZIO: Diagnostico = { registros: [], lancamentos: 0, posicoes: 0, totalLinhas: 0, anoDetectado: true }

/**
 * Migra histórico gravado por versões anteriores. Declarações da fase A não têm
 * `diagnostico` nem `codigo` nas posições — ler esses campos sem checar derrubava
 * o app inteiro na tela preta. Estado velho encontrando código novo é a classe de
 * bug mais provável num app que guarda dados por anos; então a leitura conserta.
 */
export function normalizaHistorico(h: Historico | undefined | null): Historico {
  if (!h || typeof h !== 'object') return {}
  const saida: Historico = {}
  for (const [ano, d] of Object.entries(h)) {
    if (!d || typeof d !== 'object') continue
    const posicoes = (Array.isArray(d.posicoes) ? d.posicoes : []).map((p) => ({ ...p, codigo: p.codigo ?? '' }))
    saida[ano] = {
      ...d,
      posicoes,
      diagnostico: d.diagnostico ?? { ...DIAGNOSTICO_VAZIO, posicoes: posicoes.length },
    }
  }
  return saida
}

export function upsertDeclaracao(h: Historico, d: Declaracao): Historico {
  return { ...h, [String(d.anoBase)]: d }
}

/**
 * Corrige o ano de uma declaração já importada. O ano vem de uma busca por
 * "20xx" no começo do arquivo, o que acerta na maioria dos casos e erra em
 * alguns — dígitos de valores podem parecer ano. Em vez de tornar a heurística
 * mais esperta e quebrar o que já funciona, a tela deixa consertar.
 */
export function reatribuirAno(h: Historico, anoBaseAtual: number, novoExercicio: number): Historico {
  const d = h[String(anoBaseAtual)]
  if (!d) return h
  const { [String(anoBaseAtual)]: _, ...resto } = h
  return { ...resto, [String(novoExercicio - 1)]: { ...d, exercicio: novoExercicio, anoBase: novoExercicio - 1 } }
}

export function removerAno(h: Historico, anoBase: number): Historico {
  const { [String(anoBase)]: _, ...resto } = h
  return resto
}

// ---------------------------------------------------------------- correções manuais

/**
 * A descrição do Bens e Direitos é texto livre; nenhum reconhecimento automático
 * acerta sempre. Em vez de esconder isso, a tela deixa corrigir a classe — e a
 * correção vale para TODOS os anos, porque o id da posição é estável. Uma
 * correção, a série inteira arrumada.
 */
export type Overrides = Record<string, ClassePatrimonio>

export function aplicarOverrides(h: Historico, ov: Overrides): Historico {
  if (Object.keys(ov).length === 0) return h
  const saida: Historico = {}
  for (const [ano, d] of Object.entries(h)) {
    const posicoes = d.posicoes.map((p) => {
      const classe = ov[p.id]
      return classe ? { ...p, classe, regime: REGIME[classe] } : p
    })
    saida[ano] = { ...d, posicoes }
  }
  return saida
}

// ---------------------------------------------------------------- vínculos entre anos

/**
 * Ligação manual entre posições de anos diferentes: `id de origem → id canônico`.
 *
 * O casamento automático usa classe + descrição normalizada, o que quebra quando
 * o banco muda o nome do produto entre um ano e outro ("CDB BCO X" vira "CDB
 * BANCO X S.A."). Sem isso a mesma aplicação vira duas séries curtas e o
 * rendimento embutido some. Aqui o usuário diz que são a mesma coisa.
 */
export type Vinculos = Record<string, string>

export function aplicarVinculos(h: Historico, v: Vinculos): Historico {
  if (Object.keys(v).length === 0) return h
  const saida: Historico = {}
  for (const [ano, d] of Object.entries(h)) {
    saida[ano] = { ...d, posicoes: d.posicoes.map((p) => (v[p.id] ? { ...p, id: v[p.id] } : p)) }
  }
  return saida
}

/** Overrides e vínculos sempre juntos: as duas correções valem para tudo. */
export function prepararHistorico(h: Historico, overrides: Overrides, vinculos: Vinculos): Historico {
  return aplicarVinculos(aplicarOverrides(h, overrides), vinculos)
}

/** Posições de um ano específico — o mapa deixou de ser só do ano mais recente. */
export function posicoesDoAno(h: Historico, anoBase: number): PosicaoAno[] {
  const d = h[String(anoBase)]
  return d ? [...d.posicoes].sort((a, b) => b.saldoAtual - a.saldoAtual) : []
}

/** Anos disponíveis, do mais recente para o mais antigo. */
export function anosDisponiveis(h: Historico): number[] {
  return Object.values(h)
    .map((d) => d.anoBase)
    .sort((a, b) => b - a)
}

/** Posições dos OUTROS anos — candidatas a vincular com a que está na tela. */
export function candidatasVinculo(h: Historico, anoBase: number): { anoBase: number; posicoes: PosicaoAno[] }[] {
  return Object.values(h)
    .filter((d) => d.anoBase !== anoBase)
    .sort((a, b) => b.anoBase - a.anoBase)
    .map((d) => ({ anoBase: d.anoBase, posicoes: [...d.posicoes].sort((a, b) => b.saldoAtual - a.saldoAtual) }))
}

// ---------------------------------------------------------------- base estocada

/** Saldo de uma mesma posição ao longo dos anos — o casamento entre declarações. */
export function serieDaPosicao(h: Historico, id: string): { anoBase: number; saldo: number; anterior: number }[] {
  return Object.values(h)
    .map((d) => {
      const p = d.posicoes.find((x) => x.id === id)
      return p ? { anoBase: d.anoBase, saldo: p.saldoAtual, anterior: p.saldoAnterior } : null
    })
    .filter((x): x is { anoBase: number; saldo: number; anterior: number } => x !== null)
    .sort((a, b) => a.anoBase - b.anoBase)
}

/** Aportes informados pelo usuário, por posição e ano: chave `id@anoBase`. */
export type Aportes = Record<string, number>

export const chaveAporte = (id: string, anoBase: number) => `${id}@${anoBase}`

export interface Embutido {
  id: string
  descricao: string
  classe: ClassePatrimonio
  saldoAtual: number
  embutido: number
  /** true quando algum ano entrou sem aporte informado — então é estimativa alta. */
  estimado: boolean
  porAno: { anoBase: number; crescimento: number; aporte: number; embutido: number; informado: boolean }[]
}

/**
 * "Base estocada": quanto de rendimento está embutido nas posições cujo resgate
 * cai na base do IRPFM.
 *
 * LIMITE HONESTO: o .DEC mostra saldo, não separa aporte de rendimento. Sem o
 * aporte informado, o crescimento inteiro do ano é tratado como rendimento — o
 * que SUPERESTIMA. Por isso cada linha diz se é número informado ou estimativa.
 */
export function baseEstocada(h: Historico, aportes: Aportes = {}): { total: number; itens: Embutido[]; algumEstimado: boolean } {
  const anos = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  const recente = anos[anos.length - 1]
  if (!recente) return { total: 0, itens: [], algumEstimado: false }

  const itens: Embutido[] = recente.posicoes
    .filter((p) => p.regime === 'inBase')
    .map((p) => {
      const porAno = serieDaPosicao(h, p.id).map((ponto) => {
        const chave = chaveAporte(p.id, ponto.anoBase)
        const informado = chave in aportes
        const aporte = informado ? aportes[chave] : 0
        const crescimento = ponto.saldo - ponto.anterior
        return { anoBase: ponto.anoBase, crescimento, aporte, embutido: Math.max(0, crescimento - aporte), informado }
      })
      return {
        id: p.id,
        descricao: p.descricao,
        classe: p.classe,
        saldoAtual: p.saldoAtual,
        embutido: porAno.reduce((s, a) => s + a.embutido, 0),
        estimado: porAno.some((a) => !a.informado && a.crescimento > 0),
        porAno,
      }
    })
    .filter((x) => x.saldoAtual > 0)
    .sort((a, b) => b.embutido - a.embutido)

  return {
    total: itens.reduce((s, i) => s + i.embutido, 0),
    itens,
    algumEstimado: itens.some((i) => i.estimado),
  }
}

/** Posições do ano mais recente, para a tela de correção e de aportes. */
export function posicoesRecentes(h: Historico): PosicaoAno[] {
  const anos = Object.values(h).sort((a, b) => b.anoBase - a.anoBase)
  return anos[0] ? [...anos[0].posicoes].sort((a, b) => b.saldoAtual - a.saldoAtual) : []
}
