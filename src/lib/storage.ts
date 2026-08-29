// Persistência local: autosave do estado + cenários nomeados + export/import.
//
// Quem decide ONDE gravar é `armazenamento.ts` — inclusive a resposta "em lugar
// nenhum", que é o modo visita. Aqui não há mais `if (visita) return` espalhado:
// essa checagem campo a campo era o que deixava o cofre, o sync e o token da
// conta de fora da promessa.

import {
  armazenamentoLocal,
  PREFIXO,
  modoVisita,
  setModoVisita,
  chavesGravadas,
  apagarTudoDesteAparelho,
} from './armazenamento'

export { PREFIXO, modoVisita, setModoVisita, chavesGravadas, apagarTudoDesteAparelho }

const STATE_KEY = 'irpfm2027:state:v1'
const SCEN_KEY = 'irpfm2027:scenarios:v1'

import type { YtdConfig, DivGrid } from '../calc/ytd'
import type { Carteira } from '../calc/rendafixa'
import type { HoldingConfig } from '../calc/holding'
import type { Historico, Overrides, Aportes, Vinculos } from './historico'
import type { Entradas } from './consistencia'
import type { Operacao, EventoQuantidade, Posicao, Modalidade } from '../calc/bolsa'
import type { PapelNaCarteira } from './b3posicao'
import type { Origem } from './origem'
import type { OverridesParametros } from '../calc/params'
import type { DeducoesLegais } from '../calc/declaracao'
import type { CategoriaDeducao } from './deducoes'

export type CdbMode = 'anual' | 'ytd' | 'carteira'

/**
 * Formato do estado salvo. Suba este número ao mudar o significado de um campo
 * (renomear, trocar unidade, remover) e ensine `migrarEstado` a converter — o
 * app lê arquivos de formatos anteriores e recusa, com aviso, os de formatos
 * futuros. Campo novo e opcional NÃO exige subir: o estado antigo continua
 * válido sem ele.
 *
 * 1 — formato original, sem o campo (tudo o que foi salvo até agora).
 * 2 — passa a carregar `schemaVersion` e a normalizar os primitivos na leitura.
 */
export const SCHEMA_VERSION = 2

export interface PersistedState {
  /** Ausente = formato 1, gravado antes de o app versionar o estado. */
  schemaVersion?: number
  vals: Record<string, number>
  ndep: number
  cdbA: number | null
  red: boolean
  aliqEmp: number
  limR: number
  // Projeção YTD (opcionais — cenários antigos podem não ter).
  mesRef?: number
  ytd?: Record<string, YtdConfig>
  divGrid?: DivGrid
  // Renda fixa detalhada (opcional).
  cdbMode?: CdbMode
  carteira?: Carteira
  // Comparador de holding (opcional).
  holding?: HoldingConfig
  // Projeção de vencimentos (opcional).
  maturity?: { anoBase: number; rendaRecorrente: number; horizonte: number }
  // Baseline do ano anterior (opcional).
  priorYear?: { aberto: boolean; vals: Record<string, number>; ndep: number }
  // Histórico plurianual das declarações (opcional).
  historico?: Historico
  // Correções manuais de classe por posição, e aportes informados por ano.
  classeOverrides?: Overrides
  aportes?: Aportes
  vinculos?: Vinculos
  /** Ligações automáticas desfeitas à mão — o app não as refaz. */
  vetados?: string[]
  /** Ligação automática entre anos. Ausente = ligada (é o padrão útil). */
  autoLigar?: boolean
  /** O que só a pessoa sabe, por ano: dívidas, entradas não recorrentes, gastos. */
  consistencia?: Entradas
  /** Lucros da própria PJ contam como trabalho na origem da renda. */
  dividendosSaoTrabalho?: boolean
  /** CDI/Selic/IPCA informados à mão — chave `indice:ano`, valor em fração. */
  benchmarks?: Record<string, number>
  /**
   * O que cada texto de movimentação/evento da B3 significa, respondido uma vez
   * na tela de import. Guardado porque o catálogo é grande e estável: no ano
   * seguinte só os tipos novos perguntam de novo.
   */
  b3?: Record<string, 'base' | 'isento' | 'ignorar' | 'indefinido'>
  /** O mesmo, para a carteira: que movimentação é compra, venda ou evento. */
  b3Carteira?: Record<string, PapelNaCarteira>
  /**
   * De onde veio cada número, pela mesma chave dos `vals`. Ausente = não
   * registrado (estado salvo antes deste campo existir), que é diferente de
   * digitado.
   */
  origem?: Record<string, Origem>
  /**
   * Deduções legais da declaração de ajuste anual, no ano.
   *
   * Não entram na base do IRPFM — entram no imposto DEVIDO, que é o que a Lei
   * 15.270/2025 manda abater. Ausente = nada informado, e aí o único abatimento
   * é a previdência oficial, que o app deriva do próprio pró-labore.
   */
  deducoes?: Partial<DeducoesLegais>
  /**
   * Em que linha da declaração entra cada beneficiário do Registro 26,
   * respondido uma vez. Mesmo arranjo do `b3`: o texto vem de fora, a resposta
   * fica guardada, e no ano seguinte só o que é novo pergunta de novo.
   */
  deducoesCategoria?: Record<string, CategoriaDeducao>
  /**
   * Tabelas fiscais trocadas à mão. INSS e IRRF de 2026 são estimativa aqui;
   * quando a portaria sair, ninguém deveria esperar um deploy para ter a conta
   * certa.
   */
  parametros?: OverridesParametros
  /**
   * Renda variável: as operações do ano e as duas leituras da lei que ainda
   * estão em aberto. Guarda a ENTRADA da apuração, nunca o resultado — o ganho
   * é sempre recalculado, para não congelar um número apurado com uma regra
   * que mudou depois.
   */
  bolsa?: {
    operacoes: Operacao[]
    eventos?: EventoQuantidade[]
    /** Posição em 31/12 do ano anterior, com custo médio de aquisição. */
    posicaoInicial?: Posicao[]
    prejuizoAnterior?: Partial<Record<Modalidade, number>>
    /** ⟨confirmar⟩ Ganho em bolsa entra na base do IRPFM? */
    entraNaBase: boolean
    /** ⟨confirmar⟩ A isenção mensal dos R$ 20 mil alcança o mínimo? */
    isentoEntraNaBase: boolean
  }
}

export interface NamedScenario {
  name: string
  savedAt: string
  state: PersistedState
}

const num = (v: unknown, padrao: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : padrao

/** Só os pares chave→número finito; o resto do objeto é descartado. */
function somenteNumeros(o: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    Object.entries(o as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    })
  }
  return out
}

/**
 * Porta de entrada de todo estado que vem de fora da sessão: localStorage,
 * arquivo JSON importado, cofre sincronizado de outro aparelho. Recusa o que
 * não dá para usar (com mensagem que diz o quê) e normaliza os primitivos em
 * que o app indexa — um `mesRef` fora de 1..12, por exemplo, quebrava a
 * projeção inteira sem nenhum aviso.
 *
 * O que não é primitivo conhecido passa como está: campo novo em versão futura
 * do app não deve sumir só porque esta função não o conhecia.
 */
export function migrarEstado(bruto: unknown): PersistedState {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error('Arquivo inválido: o conteúdo não é um objeto JSON.')
  }
  const o = bruto as Record<string, unknown>
  const versao = num(o.schemaVersion, 1)
  if (versao > SCHEMA_VERSION) {
    throw new Error(
      `Arquivo gravado por uma versão mais nova do app (formato ${versao}; este lê até ${SCHEMA_VERSION}). Atualize a página e tente de novo.`,
    )
  }
  if (!o.vals || typeof o.vals !== 'object' || Array.isArray(o.vals)) {
    throw new Error('Arquivo inválido: falta o campo "vals" com as fontes de renda.')
  }

  const mesRef = Math.min(12, Math.max(1, Math.round(num(o.mesRef, 6))))
  return {
    ...(o as unknown as PersistedState),
    schemaVersion: SCHEMA_VERSION,
    vals: somenteNumeros(o.vals),
    ndep: Math.max(0, Math.round(num(o.ndep, 0))),
    cdbA: typeof o.cdbA === 'number' && Number.isFinite(o.cdbA) ? o.cdbA : null,
    red: Boolean(o.red),
    aliqEmp: num(o.aliqEmp, 0),
    limR: num(o.limR, 0.34),
    mesRef,
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = armazenamentoLocal().getItem(STATE_KEY)
    return raw ? migrarEstado(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveState(state: PersistedState): void {
  try {
    armazenamentoLocal().setItem(STATE_KEY, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }))
  } catch {
    /* armazenamento indisponível — ignora silenciosamente */
  }
}

export function loadScenarios(): NamedScenario[] {
  try {
    const raw = armazenamentoLocal().getItem(SCEN_KEY)
    const list = raw ? (JSON.parse(raw) as NamedScenario[]) : []
    if (!Array.isArray(list)) return []
    // Um cenário corrompido não pode levar os outros junto.
    return list.flatMap((s) => {
      try {
        return [{ ...s, state: migrarEstado(s?.state) }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function saveScenarios(list: NamedScenario[]): void {
  try {
    armazenamentoLocal().setItem(SCEN_KEY, JSON.stringify(list))
  } catch {
    /* ignora */
  }
}

// Insere ou atualiza um cenário pelo nome. Devolve a nova lista.
export function upsertScenario(
  list: NamedScenario[],
  name: string,
  state: PersistedState,
  now: string,
): NamedScenario[] {
  const next = list.filter((s) => s.name !== name)
  next.push({ name, savedAt: now, state: { ...state, schemaVersion: SCHEMA_VERSION } })
  next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return next
}

export function removeScenario(list: NamedScenario[], name: string): NamedScenario[] {
  return list.filter((s) => s.name !== name)
}

// Dispara o download de um arquivo JSON no navegador.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Lê um arquivo escolhido pelo usuário e valida o formato mínimo.
export function readStateFile(file: File): Promise<PersistedState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(migrarEstado(JSON.parse(String(reader.result))))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('JSON inválido.'))
      }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.readAsText(file)
  })
}
