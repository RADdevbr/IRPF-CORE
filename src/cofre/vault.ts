// Cofre local (Fase 0) — ver PLAN-CONTA-E-HISTORICO.md §1.11.
//
// Fica entre `crypto.ts` (que não conhece armazenamento) e o `localStorage`.
// Guarda o cofre CIFRADO e nunca o estado em claro. O modo convidado continua
// existindo: sem cofre criado, o app segue usando `storage.ts` como sempre.
//
// A DEK vive em memória durante a sessão. Só vai para `sessionStorage` se o
// usuário pedir "confiar neste dispositivo" — e mesmo assim morre ao fechar a aba.

import {
  abrirDek,
  criarCofre,
  destravar,
  novoWrap,
  cifrarCofre,
  decifrarCofre,
  podeRemover,
  removerWrap,
  gerarVaultId,
  paraB64,
  deB64,
  type CofreCompleto,
  type Wrap,
} from './crypto.js'
import type { EstadoSync } from './sync.js'
import { armazenamentoLocal, armazenamentoSessao, chaveApp } from '../app/armazenamento.js'

// As chaves nascem do prefixo do app, e por isso são funções: uma constante de
// módulo seria avaliada no `import`, antes de `configurarApp()` rodar. Ver
// `app/config.ts` para o porquê de o prefixo não ser mais uma constante daqui.
const VAULT_KEY = () => chaveApp('vault:v1')
const LEGADO_KEY = () => chaveApp('state:v1')
const SESSAO_KEY = () => chaveApp('dek:v1')
// v2: o diagnóstico da v1 registrava credencial não-descobrível e dava falso
// negativo no Android. Vereditos daquela versão não são comparáveis — trocar a
// chave os descarta em vez de manter a biometria escondida de quem já testou.
const PRF_KEY = () => chaveApp('prf:v2')
const SYNC_KEY = () => chaveApp('sync:v1')

/** Só o que usamos de Storage — permite injetar um falso nos testes. */
export type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// O `null` sumiu daqui: quem decide onde gravar — disco, memória do modo visita
// ou memória por o navegador ter bloqueado o storage — é `armazenamento.ts`.
// Antes, `gravarCofre` escrevia direto no localStorage sem olhar o modo visita,
// e o autosave cifrado rodava a cada 400 ms.
function store(st?: Store): Store {
  return st ?? armazenamentoLocal()
}

function sessao(ss?: Store): Store {
  return ss ?? armazenamentoSessao()
}

// ---------------------------------------------------------------- leitura/escrita

export function lerCofre(st?: Store): CofreCompleto | null {
  const s = store(st)
  try {
    const raw = s.getItem(VAULT_KEY())
    if (!raw) return null
    const c = JSON.parse(raw) as CofreCompleto
    if (!c || !Array.isArray(c.wraps) || !c.cofre) return null
    if (!c.vaultId) {
      // Cofre criado na Fase 0, antes de o sync existir: ganha identidade agora,
      // enquanto ainda não há com o que confundi-lo.
      const comId = { ...c, vaultId: gerarVaultId() }
      try {
        s.setItem(VAULT_KEY(), JSON.stringify(comId))
      } catch {
        /* só em memória, tudo bem */
      }
      return comId
    }
    return c
  } catch {
    return null
  }
}

export function existeCofre(st?: Store): boolean {
  return lerCofre(st) !== null
}

export function gravarCofre(cofre: CofreCompleto, st?: Store): void {
  store(st).setItem(VAULT_KEY(), JSON.stringify(cofre))
}

/** Métodos de desbloqueio cadastrados, para a tela de gerenciamento. */
export function metodos(st?: Store): Wrap[] {
  return lerCofre(st)?.wraps ?? []
}

// ---------------------------------------------------------------- estado legado (em claro)

/** O estado que o app guardava em claro antes do cofre — base da migração. */
export function estadoLegado<T>(st?: Store): T | null {
  const s = store(st)
  try {
    const raw = s.getItem(LEGADO_KEY())
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

/** Só depois de o cofre estar gravado: nada é apagado antes de existir substituto. */
export function apagarEstadoLegado(st?: Store): void {
  store(st).removeItem(LEGADO_KEY())
}

// ---------------------------------------------------------------- ciclo do cofre

export interface MetodoNovo {
  wrapId: string
  metodo: Wrap['metodo']
  rotulo?: string
  segredo: Uint8Array | string
}

/**
 * Cria o cofre já com DOIS métodos — a regra dos dois caminhos vale desde o
 * primeiro segundo, não como aviso posterior. Migra o estado em claro e só então
 * o apaga.
 */
export async function criarCofreLocal<T>(
  dados: T,
  principal: MetodoNovo,
  recuperacao: MetodoNovo,
  agora: string,
  st?: Store,
): Promise<{ cofre: CofreCompleto; dek: Uint8Array }> {
  const { cofre, dek } = await criarCofre(dados, principal, agora)
  const wrapRec = await novoWrap(dek, recuperacao, agora)
  const completo: CofreCompleto = { ...cofre, wraps: [...cofre.wraps, wrapRec] }
  gravarCofre(completo, st)
  apagarEstadoLegado(st)
  return { cofre: completo, dek }
}

/** Lê o conteúdo do cofre com uma DEK já em mãos (sessão lembrada). */
export async function lerDadosCifrados<T>(dek: Uint8Array, st?: Store): Promise<T> {
  const cofre = lerCofre(st)
  if (!cofre) throw new Error('Nenhum cofre neste navegador.')
  return decifrarCofre<T>(dek, cofre.cofre)
}

export async function destravarLocal<T>(
  wrapId: string,
  segredo: Uint8Array | string,
  st?: Store,
): Promise<{ dek: Uint8Array; dados: T }> {
  const cofre = lerCofre(st)
  if (!cofre) throw new Error('Nenhum cofre neste navegador.')
  return destravar<T>(cofre, wrapId, segredo)
}

/**
 * Adota a chave que a conta já tem, em vez de sortear uma nova.
 *
 * É o caminho do SEGUNDO app da família numa conta que já tem cofre. Os
 * embrulhos são um conjunto por conta: um app que sorteasse chave própria subiria
 * embrulhos dela para a mesma conta e, na próxima sincronização do outro app, um
 * método legítimo passaria a devolver a chave errada. O conteúdo não abriria, e
 * a mensagem seria "sua chave está certa, mas o conteúdo não corresponde" —
 * assustadora e verdadeira.
 *
 * Então este app abre a chave da conta com um método dela, e cifra o SEU estado
 * inicial com ela. Cofre separado, chave comum: um desbloqueio serve para todos.
 */
export async function adotarChaveDaConta<T>(
  wraps: Wrap[],
  wrapId: string,
  segredo: Uint8Array | string,
  dadosIniciais: T,
  st?: Store,
): Promise<{ cofre: CofreCompleto; dek: Uint8Array }> {
  const dek = await abrirDek(wraps, wrapId, segredo)
  const cofre: CofreCompleto = {
    schemaVersion: 1,
    // Identidade própria: este documento é comparado só consigo mesmo no sync
    // (a chave primária é usuário + doc_id), e é este app o único que o grava.
    vaultId: gerarVaultId(),
    wraps,
    cofre: await cifrarCofre(dek, dadosIniciais),
  }
  gravarCofre(cofre, st)
  apagarEstadoLegado(st)
  return { cofre, dek }
}

/** Re-cifra e grava. Chamado pelo autosave enquanto a sessão está destravada. */
export async function salvarCifrado<T>(dek: Uint8Array, dados: T, st?: Store): Promise<void> {
  const cofre = lerCofre(st)
  if (!cofre) throw new Error('Nenhum cofre neste navegador.')
  gravarCofre({ ...cofre, cofre: await cifrarCofre(dek, dados) }, st)
}

export async function adicionarMetodoLocal(dek: Uint8Array, m: MetodoNovo, agora: string, st?: Store): Promise<Wrap> {
  const cofre = lerCofre(st)
  if (!cofre) throw new Error('Nenhum cofre neste navegador.')
  if (cofre.wraps.some((w) => w.wrapId === m.wrapId)) throw new Error('Este método já está cadastrado.')
  const wrap = await novoWrap(dek, m, agora)
  gravarCofre({ ...cofre, wraps: [...cofre.wraps, wrap] }, st)
  return wrap
}

/** Devolve o motivo do bloqueio (sem remover) ou null se a remoção é segura. */
export function motivoParaNaoRemover(wrapId: string, st?: Store): string | null {
  const cofre = lerCofre(st)
  if (!cofre) return 'Nenhum cofre neste navegador.'
  return podeRemover(cofre, wrapId)
}

export function removerMetodoLocal(wrapId: string, st?: Store): CofreCompleto {
  const cofre = lerCofre(st)
  if (!cofre) throw new Error('Nenhum cofre neste navegador.')
  const novo = removerWrap(cofre, wrapId)
  gravarCofre(novo, st)
  return novo
}

/** "Esquecer neste dispositivo": apaga o cofre local. Exige confirmação na UI. */
export function apagarCofre(st?: Store, ss?: Store): void {
  store(st).removeItem(VAULT_KEY())
  esquecerDek(ss)
}

// ---------------------------------------------------------------- sessão ("confiar neste dispositivo")

export function lembrarDek(dek: Uint8Array, ss?: Store): void {
  try {
    sessao(ss).setItem(SESSAO_KEY(), paraB64(dek))
  } catch {
    /* sem sessionStorage — segue só em memória */
  }
}

export function dekLembrada(ss?: Store): Uint8Array | null {
  try {
    const raw = sessao(ss).getItem(SESSAO_KEY())
    return raw ? deB64(raw) : null
  } catch {
    return null
  }
}

export function esquecerDek(ss?: Store): void {
  try {
    sessao(ss).removeItem(SESSAO_KEY())
  } catch {
    /* ignora */
  }
}

// ---------------------------------------------------------------- suporte a PRF

/**
 * Guarda o resultado do diagnóstico para o app não insistir num método que já se
 * provou indisponível neste aparelho — e não esconder o que funciona.
 */
export type SuportePrf = 'ok' | 'nao' | 'desconhecido'

export function lembrarSuportePrf(v: SuportePrf, st?: Store): void {
  const s = store(st)
  if (v === 'desconhecido') s.removeItem(PRF_KEY())
  else s.setItem(PRF_KEY(), v)
}

export function suportePrfLembrado(st?: Store): SuportePrf {
  const v = store(st).getItem(PRF_KEY())
  return v === 'ok' || v === 'nao' ? v : 'desconhecido'
}

// ---------------------------------------------------------------- estado do sync

// Só números de versão e uma flag — nada sensível, não precisa de cifra.
const SYNC_ZERO: EstadoSync = { baseVersion: null, sujo: false }

export function lerEstadoSync(st?: Store): EstadoSync {
  try {
    const raw = store(st).getItem(SYNC_KEY())
    if (!raw) return SYNC_ZERO
    const e = JSON.parse(raw) as EstadoSync
    return typeof e?.sujo === 'boolean' ? e : SYNC_ZERO
  } catch {
    return SYNC_ZERO
  }
}

export function gravarEstadoSync(e: EstadoSync, st?: Store): void {
  try {
    store(st).setItem(SYNC_KEY(), JSON.stringify(e))
  } catch {
    /* ignora */
  }
}

/** Marca que houve edição local depois da última base sincronizada. */
export function marcarSujo(st?: Store): void {
  const atual = lerEstadoSync(st)
  if (!atual.sujo) gravarEstadoSync({ ...atual, sujo: true }, st)
}
