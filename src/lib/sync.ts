// Política de sincronização — ver PLAN-CONTA-E-HISTORICO.md §1.8.
//
// Só o cofre CIFRADO viaja: `ciphertext` e os embrulhos. A DEK nunca sai daqui,
// então o servidor guarda algo que nem ele nem eu conseguimos abrir.
//
// Este arquivo é de propósito ignorante quanto a rede: decide o que fazer a
// partir de dois números (versão local de base e versão remota). Quem fala com o
// Supabase é `remoto.ts`, atrás de uma interface — o que deixa a decisão, que é
// onde mora o risco de perder dado, coberta por testes sem servidor nenhum.

import type { CofreCompleto, Wrap } from './crypto'

export interface EstadoSync {
  /** Versão do servidor de onde saiu o conteúdo que está aqui. */
  baseVersion: number | null
  /** Houve edição local depois dessa base? */
  sujo: boolean
}

export interface ResumoRemoto {
  version: number
  atualizadoEm: string
  vaultId?: string
}

export type Decisao =
  | { acao: 'nada' }
  | { acao: 'enviar'; motivo: 'primeira-subida' | 'local-novo' | 'servidor-atrasado' }
  | { acao: 'baixar' }
  | { acao: 'conflito' }
  /** Cofres distintos, com chaves distintas: juntar quebraria o acesso. */
  | { acao: 'cofres-diferentes' }

/**
 * Decide sem adivinhar. A regra que importa: se os dois lados mudaram desde a
 * última base comum, NINGUÉM ganha automaticamente — vira conflito e a escolha é
 * do usuário. Merge silencioso de número de imposto é bug caro.
 */
export function decidirSync(estado: EstadoSync, remoto: ResumoRemoto | null, vaultIdLocal?: string): Decisao {
  if (!remoto) return { acao: 'enviar', motivo: 'primeira-subida' }
  // Antes de qualquer comparação de versão: é o MESMO cofre? Versões de cofres
  // diferentes não são comparáveis, e unir os métodos deles geraria embrulhos
  // que não abrem nada.
  if (remoto.vaultId && vaultIdLocal && remoto.vaultId !== vaultIdLocal) return { acao: 'cofres-diferentes' }
  const base = estado.baseVersion
  if (base === null) return estado.sujo ? { acao: 'conflito' } : { acao: 'baixar' }
  if (remoto.version === base) return estado.sujo ? { acao: 'enviar', motivo: 'local-novo' } : { acao: 'nada' }
  if (remoto.version > base) return estado.sujo ? { acao: 'conflito' } : { acao: 'baixar' }
  return { acao: 'enviar', motivo: 'servidor-atrasado' }
}

/** Documento como trafega: cofre cifrado + metadados de versão. */
export interface DocRemoto {
  docId: string
  ciphertext: string
  iv: string
  version: number
  atualizadoEm: string
  vaultId?: string
}

/** O que o app precisa de um servidor — Supabase hoje, outro amanhã. */
export interface Remoto {
  usuario(): Promise<{ email: string } | null>
  /**
   * Avisa quando a sessão aparece ou some. Sem isto, a tela conferia a sessão
   * uma vez ao montar: quem voltava do link do e-mail depois disso ficava
   * olhando para o campo de e-mail, sem nada dizendo que já estava conectado.
   * Opcional porque os servidores de mentira dos testes não precisam disso.
   */
  aoMudarSessao?(cb: (email: string | null) => void): () => void
  /** `convite` só é usado quando a conta ainda não existe. */
  enviarCodigo(email: string, convite?: string): Promise<void>
  conferirCodigo(email: string, codigo: string): Promise<void>
  sair(): Promise<void>
  lerDoc(docId: string): Promise<DocRemoto | null>
  gravarDoc(doc: Omit<DocRemoto, 'atualizadoEm'>): Promise<DocRemoto>
  lerWraps(): Promise<Wrap[]>
  gravarWraps(wraps: Wrap[]): Promise<void>
}

export const DOC_ESTADO = 'state'

/** Serializa o cofre local para o formato que vai ao servidor. */
export function paraDoc(cofre: CofreCompleto, docId: string, version: number): Omit<DocRemoto, 'atualizadoEm'> {
  return { docId, ciphertext: cofre.cofre.ciphertext, iv: cofre.cofre.iv, version, vaultId: cofre.vaultId }
}

/** Reconstrói o cofre local a partir do que veio do servidor. */
export function deDoc(doc: DocRemoto, wraps: Wrap[]): CofreCompleto {
  return { schemaVersion: 1, vaultId: doc.vaultId, wraps, cofre: { v: 1, iv: doc.iv, ciphertext: doc.ciphertext } }
}

/**
 * União dos métodos de desbloqueio dos dois lados. Wrap é aditivo por natureza —
 * cada um embrulha a MESMA chave — então juntar é seguro e evita o modo de falha
 * pior do sync: perder o método que só existia num dispositivo.
 */
export function unirWraps(locais: Wrap[], remotos: Wrap[]): Wrap[] {
  const porId = new Map<string, Wrap>()
  for (const w of remotos) porId.set(w.wrapId, w)
  for (const w of locais) porId.set(w.wrapId, w) // local vence em empate: é o mais recente que o usuário tocou
  return [...porId.values()].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
}
