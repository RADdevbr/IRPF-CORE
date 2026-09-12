// Persistência local: autosave do estado + cenários nomeados + export/import.
//
// Quem decide ONDE gravar é `armazenamento.ts` — inclusive a resposta "em lugar
// nenhum", que é o modo visita. Aqui não há `if (visita) return` espalhado: essa
// checagem campo a campo era o que deixava o cofre, o sync e o token da conta de
// fora da promessa.
//
// O que mudou ao virar núcleo compartilhado: este módulo não conhece mais o
// formato do estado. Ele conhecia — era `PersistedState`, com os campos do
// IRPFM, do histórico, da B3 e do patrimônio no mesmo tipo. Esse tipo único era
// metade do «aglomerado»: qualquer app que quisesse guardar duas coisas herdava
// as declarações das outras duas.
//
// Agora cada app declara o SEU estado e passa a função que valida o que vem de
// fora. O que fica aqui é o que não depende do formato: onde gravar, como
// versionar, como recusar arquivo de uma versão futura, e a lista de cenários.

import {
  armazenamentoLocal,
  chaveApp,
  modoVisita,
  setModoVisita,
  chavesGravadas,
  apagarTudoDesteAparelho,
} from './armazenamento.js'

export { chaveApp, modoVisita, setModoVisita, chavesGravadas, apagarTudoDesteAparelho }

/** Um cenário salvo com nome — "e se eu distribuir em dezembro". */
export interface NamedScenario<T> {
  name: string
  savedAt: string
  state: T
}

/**
 * O mínimo que este módulo precisa saber do estado de qualquer app.
 *
 * Só `schemaVersion`, e por um motivo: é ela que permite recusar, com mensagem,
 * um arquivo gravado por uma versão mais nova do app — em vez de ler campos que
 * mudaram de significado e mostrar número errado com cara de certo.
 */
export interface EstadoVersionado {
  /** Ausente = o formato mais antigo, gravado antes de o app versionar. */
  schemaVersion?: number
}

export const num = (v: unknown, padrao: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : padrao

/** Só os pares chave→número finito; o resto do objeto é descartado. */
export function somenteNumeros(o: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    Object.entries(o as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    })
  }
  return out
}

/**
 * A parte da migração que é igual em todo app: é objeto? veio do futuro?
 *
 * Devolve o objeto cru para o app continuar dali, normalizando o que só ele sabe
 * normalizar. Separado assim porque a checagem de versão futura é a que ninguém
 * lembra de escrever, e é a que evita o pior estrago — ler um campo que mudou de
 * unidade e apresentar o resultado como se fosse o certo.
 */
export function conferirEnvelope(bruto: unknown, versaoMax: number): Record<string, unknown> {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error('Arquivo inválido: o conteúdo não é um objeto JSON.')
  }
  const o = bruto as Record<string, unknown>
  const versao = num(o.schemaVersion, 1)
  if (versao > versaoMax) {
    throw new Error(
      `Arquivo gravado por uma versão mais nova do app (formato ${versao}; este lê até ${versaoMax}). Atualize a página e tente de novo.`,
    )
  }
  return o
}

export interface OpcoesPersistencia<T extends EstadoVersionado> {
  /**
   * Formato atual do estado deste app. Suba ao mudar o SIGNIFICADO de um campo
   * (renomear, trocar unidade, remover) e ensine `migrar` a converter. Campo novo
   * e opcional não exige subir: o estado antigo continua válido sem ele.
   */
  versao: number
  /**
   * Porta de entrada de todo estado que vem de fora da sessão: localStorage,
   * arquivo JSON importado, cofre sincronizado de outro aparelho. Recusa o que
   * não dá para usar (com mensagem que diz o quê) e normaliza os primitivos em
   * que o app indexa.
   */
  migrar: (bruto: unknown) => T
}

export interface Persistencia<T extends EstadoVersionado> {
  loadState(): T | null
  saveState(state: T): void
  loadScenarios(): NamedScenario<T>[]
  saveScenarios(list: NamedScenario<T>[]): void
  upsertScenario(list: NamedScenario<T>[], name: string, state: T, now: string): NamedScenario<T>[]
  removeScenario(list: NamedScenario<T>[], name: string): NamedScenario<T>[]
  /** Lê um arquivo escolhido pelo usuário e valida o formato mínimo. */
  readStateFile(file: File): Promise<T>
  /** Migra um objeto qualquer (do cofre, do sync) para o formato atual. */
  migrarEstado(bruto: unknown): T
  readonly versao: number
}

export function criarPersistencia<T extends EstadoVersionado>(o: OpcoesPersistencia<T>): Persistencia<T> {
  const STATE_KEY = () => chaveApp('state:v1')
  const SCEN_KEY = () => chaveApp('scenarios:v1')
  const selar = (s: T): T => ({ ...s, schemaVersion: o.versao })

  return {
    versao: o.versao,
    migrarEstado: o.migrar,

    loadState() {
      try {
        const raw = armazenamentoLocal().getItem(STATE_KEY())
        return raw ? o.migrar(JSON.parse(raw)) : null
      } catch {
        return null
      }
    },

    saveState(state) {
      try {
        armazenamentoLocal().setItem(STATE_KEY(), JSON.stringify(selar(state)))
      } catch {
        /* armazenamento indisponível — ignora silenciosamente */
      }
    },

    loadScenarios() {
      try {
        const raw = armazenamentoLocal().getItem(SCEN_KEY())
        const list = raw ? (JSON.parse(raw) as NamedScenario<T>[]) : []
        if (!Array.isArray(list)) return []
        // Um cenário corrompido não pode levar os outros junto.
        return list.flatMap((s) => {
          try {
            return [{ ...s, state: o.migrar(s?.state) }]
          } catch {
            return []
          }
        })
      } catch {
        return []
      }
    },

    saveScenarios(list) {
      try {
        armazenamentoLocal().setItem(SCEN_KEY(), JSON.stringify(list))
      } catch {
        /* ignora */
      }
    },

    upsertScenario(list, name, state, now) {
      const next = list.filter((s) => s.name !== name)
      next.push({ name, savedAt: now, state: selar(state) })
      next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      return next
    },

    removeScenario(list, name) {
      return list.filter((s) => s.name !== name)
    },

    readStateFile(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          try {
            resolve(o.migrar(JSON.parse(String(reader.result))))
          } catch (e) {
            reject(e instanceof Error ? e : new Error('JSON inválido.'))
          }
        }
        reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
        reader.readAsText(file)
      })
    },
  }
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
