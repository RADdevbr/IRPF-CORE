// Política de sincronização — ver PLAN-CONTA-E-HISTORICO.md §1.8.
//
// Só o cofre CIFRADO viaja: `ciphertext` e os embrulhos. A DEK nunca sai daqui,
// então o servidor guarda algo que nem ele nem eu conseguimos abrir.
//
// Este arquivo é de propósito ignorante quanto a rede: decide o que fazer a
// partir de dois números (versão local de base e versão remota). Quem fala com o
// Supabase é `remoto.ts`, atrás de uma interface — o que deixa a decisão, que é
// onde mora o risco de perder dado, coberta por testes sem servidor nenhum.

import { mesmaChave, type CofreCompleto, type Wrap } from './crypto.js'

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
  // Um lado com id e o outro sem também não prova parentesco — e "baixar" nesse
  // estado monta um cofre com o conteúdo de um lado e os embrulhos do outro.
  // Se as chaves não forem a mesma, cada método abre o próprio embrulho mas a
  // DEK não decifra nada: o cofre trava com "chave errada" mesmo com a chave
  // certa, e só se descobre no próximo bloqueio. A escolha explícita de um dos
  // lados (sem misturar) resolve em um passo e não corrompe nenhum dos dois.
  if (Boolean(remoto.vaultId) !== Boolean(vaultIdLocal)) return { acao: 'cofres-diferentes' }
  const base = estado.baseVersion
  if (base === null) return estado.sujo ? { acao: 'conflito' } : { acao: 'baixar' }
  if (remoto.version === base) return estado.sujo ? { acao: 'enviar', motivo: 'local-novo' } : { acao: 'nada' }
  if (remoto.version > base) return estado.sujo ? { acao: 'conflito' } : { acao: 'baixar' }
  return { acao: 'enviar', motivo: 'servidor-atrasado' }
}

/**
 * Outro aparelho gravou entre a nossa leitura e a nossa escrita.
 *
 * O schema sempre anunciou `version` como "controle de conflito otimista", mas
 * quem gravava fazia `upsert` com a versão calculada aqui e sem condição: duas
 * telas abertas na mesma conta escreviam uma por cima da outra, em silêncio, e
 * a política deste arquivo — cuidadosa — só protegia contra o conflito que ela
 * enxergava na hora de decidir.
 *
 * Com o erro tipado, a corrida vira o mesmo caminho de conflito que já existe e
 * já tem tela: a pessoa escolhe qual versão vale.
 */
export class ConflitoDeVersao extends Error {
  constructor(public readonly docId: string) {
    super('Este cofre foi gravado em outro aparelho enquanto você editava aqui.')
    this.name = 'ConflitoDeVersao'
  }
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

/**
 * Nome do documento do estado, quando o app não diz qual é.
 *
 * Cada app tem o seu (`docEstadoApp()`), porque uma conta guarda os três — a
 * chave primária de `vaults` é (usuário, doc_id). Este padrão existe só para os
 * testes e para quem chama `sincronizar` sem argumento.
 */
export const DOC_ESTADO = 'state'

/**
 * Os dois lados têm chaves diferentes, e juntar os embrulhos corromperia o
 * acesso dos dois.
 *
 * Fail-closed de propósito: em vez de deixar `unirWraps` decidir caso a caso,
 * qualquer tentativa de unir conjuntos de chaves comprovadamente distintas
 * levanta isto. Quem chama traduz para a tela de conflito, onde a pessoa escolhe
 * um dos lados — o que nunca dá é misturar.
 */
export class ChavesDiferentes extends Error {
  constructor() {
    super('Os métodos de desbloqueio dos dois lados abrem chaves diferentes.')
    this.name = 'ChavesDiferentes'
  }
}

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
  // «Wrap é aditivo por natureza» vale enquanto todos embrulham a MESMA chave —
  // era verdade quando havia um app só. Com três apps dividindo uma conta, dois
  // conjuntos podem embrulhar chaves diferentes, e aí unir produz um cofre cujos
  // métodos abrem e cujo conteúdo não decifra. Antes de juntar, conferimos.
  if (mesmaChave(locais, remotos) === false) throw new ChavesDiferentes()
  const porId = new Map<string, Wrap>()
  for (const w of remotos) porId.set(w.wrapId, w)
  for (const w of locais) porId.set(w.wrapId, w) // local vence em empate: é o mais recente que o usuário tocou
  return [...porId.values()].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
}
