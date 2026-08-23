// Persistência local: autosave do estado + cenários nomeados + export/import.

const STATE_KEY = 'irpfm2027:state:v1'
const SCEN_KEY = 'irpfm2027:scenarios:v1'

import type { YtdConfig, DivGrid } from '../calc/ytd'
import type { Carteira } from '../calc/rendafixa'
import type { HoldingConfig } from '../calc/holding'
import type { Historico, Overrides, Aportes, Vinculos } from './historico'

export type CdbMode = 'anual' | 'ytd' | 'carteira'

export interface PersistedState {
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
}

export interface NamedScenario {
  name: string
  savedAt: string
  state: PersistedState
}

export function loadState(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? (JSON.parse(raw) as PersistedState) : null
  } catch {
    return null
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    /* localStorage indisponível — ignora silenciosamente */
  }
}

export function loadScenarios(): NamedScenario[] {
  try {
    const raw = localStorage.getItem(SCEN_KEY)
    const list = raw ? (JSON.parse(raw) as NamedScenario[]) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function saveScenarios(list: NamedScenario[]): void {
  try {
    localStorage.setItem(SCEN_KEY, JSON.stringify(list))
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
  next.push({ name, savedAt: now, state })
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
        const parsed = JSON.parse(String(reader.result))
        if (parsed && typeof parsed === 'object' && parsed.vals) {
          resolve(parsed as PersistedState)
        } else {
          reject(new Error('Arquivo inválido: falta o campo "vals".'))
        }
      } catch (e) {
        reject(e instanceof Error ? e : new Error('JSON inválido.'))
      }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.readAsText(file)
  })
}
