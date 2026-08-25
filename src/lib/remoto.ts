// Implementação Supabase da interface `Remoto` — ver PLAN-CONTA-E-HISTORICO.md §1.5.
//
// O navegador fala DIRETO com o Postgres: quem autoriza é a política de RLS
// (`auth.uid() = user_id`), não um segredo no bundle. Por isso a chave anon pode
// ser pública — e por isso o schema liga RLS antes de qualquer outra coisa.
//
// O que sobe daqui é sempre opaco: texto cifrado e chaves embrulhadas.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { credenciaisSupabase } from './supabaseConfig'
import type { Wrap } from './crypto'
import type { DocRemoto, Remoto } from './sync'

let cliente: SupabaseClient | null = null
function cli(): SupabaseClient {
  if (!cliente) {
    const { url, chave } = credenciaisSupabase()
    cliente = createClient(url, chave)
  }
  return cliente
}

// ---------------------------------------------------------------- mapeamento

export interface LinhaVault {
  doc_id: string
  ciphertext: string
  iv: string
  version: number
  updated_at: string
  vault_id?: string | null
}

export interface LinhaWrap {
  wrap_id: string
  metodo: string
  rotulo: string | null
  kdf: string
  kdf_params: Record<string, number> | null
  salt: string
  wrapped_dek: string
  criado_em: string
}

export function docDaLinha(l: LinhaVault): DocRemoto {
  return {
    docId: l.doc_id,
    ciphertext: l.ciphertext,
    iv: l.iv,
    version: l.version,
    atualizadoEm: l.updated_at,
    vaultId: l.vault_id ?? undefined,
  }
}

export function wrapDaLinha(l: LinhaWrap): Wrap {
  return {
    wrapId: l.wrap_id,
    metodo: l.metodo as Wrap['metodo'],
    rotulo: l.rotulo ?? undefined,
    kdf: l.kdf as Wrap['kdf'],
    kdfParams: l.kdf_params ?? undefined,
    salt: l.salt,
    wrappedDek: l.wrapped_dek,
    criadoEm: l.criado_em,
  }
}

export function linhaDoWrap(w: Wrap, userId: string): LinhaWrap & { user_id: string } {
  return {
    user_id: userId,
    wrap_id: w.wrapId,
    metodo: w.metodo,
    rotulo: w.rotulo ?? null,
    kdf: w.kdf,
    kdf_params: w.kdfParams ?? null,
    salt: w.salt,
    wrapped_dek: w.wrappedDek,
    criado_em: w.criadoEm,
  }
}

/**
 * Traduz o erro de login para o que a pessoa precisa entender.
 *
 * Conta bloqueada pelo gatilho do banco volta como "Database error saving new
 * user" — genérico a ponto de parecer defeito do app. Com o interruptor do
 * painel desligado, volta em inglês. Nos dois casos o que aconteceu é o mesmo:
 * este app não abre conta para qualquer um.
 */
export function mensagemDeLogin(bruta: string): string {
  const m = bruta.toLowerCase()
  if (/não liberada|nao liberada|database error saving new user|signups? not allowed|signup is disabled/.test(m)) {
    return 'Este app não cria contas novas: o e-mail precisa estar liberado no banco. Se a conta é sua e já existe, confira se digitou o mesmo e-mail — quem já tem conta continua entrando normalmente.'
  }
  if (/rate limit|too many requests/.test(m)) {
    return 'Muitas tentativas seguidas. Espere um minuto e peça o link de novo.'
  }
  return bruta
}

// ---------------------------------------------------------------- Remoto

export function remotoSupabase(): Remoto {
  const idDoUsuario = async (): Promise<string> => {
    const { data } = await cli().auth.getUser()
    if (!data.user) throw new Error('Entre na sua conta para sincronizar.')
    return data.user.id
  }

  return {
    async usuario() {
      const { data } = await cli().auth.getUser()
      return data.user?.email ? { email: data.user.email } : null
    },

    aoMudarSessao(cb) {
      const { data } = cli().auth.onAuthStateChange((_evento, sessao) => cb(sessao?.user?.email ?? null))
      return () => data.subscription.unsubscribe()
    },

    async enviarCodigo(email) {
      const { error } = await cli().auth.signInWithOtp({
        email,
        options: {
          // Continua true: quem decide se a conta pode nascer é o banco (ver
          // supabase/schema.sql — lista de contas liberadas). Barrar aqui seria
          // teatro, porque a chave anon está no bundle e dá para chamar o
          // Supabase direto; e barrar aqui impediria você de convidar alguém.
          shouldCreateUser: true,
          // Sem isto o link do e-mail cai no Site URL do projeto, que por padrão
          // é localhost:3000 — ou seja, no nada. Com isto ele volta para onde o
          // app está rodando de fato (produção ou preview).
          emailRedirectTo: typeof window === 'undefined' ? undefined : window.location.origin,
        },
      })
      if (error) throw new Error(mensagemDeLogin(error.message))
    },

    async conferirCodigo(email, codigo) {
      const { error } = await cli().auth.verifyOtp({ email, token: codigo.trim(), type: 'email' })
      if (error) throw new Error(error.message)
    },

    async sair() {
      await cli().auth.signOut()
    },

    async lerDoc(docId) {
      const { data, error } = await cli()
        .from('vaults')
        .select('doc_id, ciphertext, iv, version, updated_at, vault_id')
        .eq('doc_id', docId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data ? docDaLinha(data as LinhaVault) : null
    },

    async gravarDoc(doc) {
      const user_id = await idDoUsuario()
      const { data, error } = await cli()
        .from('vaults')
        .upsert(
          {
            user_id,
            doc_id: doc.docId,
            ciphertext: doc.ciphertext,
            iv: doc.iv,
            version: doc.version,
            vault_id: doc.vaultId ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,doc_id' },
        )
        .select('doc_id, ciphertext, iv, version, updated_at, vault_id')
        .single()
      if (error) throw new Error(error.message)
      return docDaLinha(data as LinhaVault)
    },

    async lerWraps() {
      const { data, error } = await cli()
        .from('vault_wraps')
        .select('wrap_id, metodo, rotulo, kdf, kdf_params, salt, wrapped_dek, criado_em')
      if (error) throw new Error(error.message)
      return (data as LinhaWrap[] | null)?.map(wrapDaLinha) ?? []
    },

    async gravarWraps(wraps) {
      if (wraps.length === 0) return
      const user_id = await idDoUsuario()
      const { error } = await cli()
        .from('vault_wraps')
        .upsert(wraps.map((w) => linhaDoWrap(w, user_id)), { onConflict: 'user_id,wrap_id' })
      if (error) throw new Error(error.message)
    },
  }
}
