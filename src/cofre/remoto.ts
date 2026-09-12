// Implementação Supabase da interface `Remoto` — ver PLAN-CONTA-E-HISTORICO.md §1.5.
//
// O navegador fala DIRETO com o Postgres: quem autoriza é a política de RLS
// (`auth.uid() = user_id`), não um segredo no bundle. Por isso a chave anon pode
// ser pública — e por isso o schema liga RLS antes de qualquer outra coisa.
//
// O que sobe daqui é sempre opaco: texto cifrado e chaves embrulhadas.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { credenciaisSupabase } from './config.js'
import { armazenamentoLocal, chaveApp, modoVisita } from '../app/armazenamento.js'
import type { Wrap } from './crypto.js'
import { ConflitoDeVersao, type DocRemoto, type Remoto } from './sync.js'

/**
 * Onde a sessão da conta fica guardada.
 *
 * O padrão do SDK é `sb-<ref>-auth-token` no `localStorage`, e isso furava as
 * duas promessas do app de uma vez: o token — que inclui o refresh token, e é a
 * credencial que baixa o cofre — ficava gravado mesmo em modo visita, e escapava
 * de «Apagar deste aparelho», que varre só o prefixo do app. Apagava-se o cofre
 * e deixava-se a chave que o traz de volta.
 *
 * Sob o prefixo do app, e passando por `armazenamentoLocal()`, o token entra nas
 * duas regras: some em modo visita e é varrido junto com o resto.
 *
 * É função, e não constante de módulo, porque o prefixo agora vem do app: uma
 * constante seria avaliada no `import`, antes de `configurarApp()` rodar.
 */
const chaveAuth = () => chaveApp('auth:v1')

/**
 * Traz para a chave nova a sessão que o SDK gravou na antiga.
 *
 * Sem isto, atualizar o app deslogaria quem já estava conectado — e, pior,
 * deixaria a chave antiga para trás, fora da varredura, que é justamente o
 * problema que esta mudança existe para resolver.
 */
function migrarChaveAntiga(st: ReturnType<typeof armazenamentoLocal>): void {
  try {
    const antigas: string[] = []
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i)
      if (k && /^sb-.*-auth-token$/.test(k)) antigas.push(k)
    }
    for (const k of antigas) {
      const v = st.getItem(k)
      if (v && !st.getItem(chaveAuth())) st.setItem(chaveAuth(), v)
      st.removeItem(k)
    }
  } catch {
    /* storage bloqueado — não há o que migrar */
  }
}

let cliente: SupabaseClient | null = null
function cli(): SupabaseClient {
  if (!cliente) {
    const { url, chave } = credenciaisSupabase()
    const storage = armazenamentoLocal()
    migrarChaveAntiga(storage)
    cliente = createClient(url, chave, {
      auth: {
        storage,
        storageKey: chaveAuth(),
        // Em modo visita o `storage` já é a memória, então persistir não grava
        // em disco. Desligar aqui também é a segunda tranca: a sessão morre com
        // a aba, sem depender de o `storage` certo ter sido escolhido.
        persistSession: !modoVisita(),
        autoRefreshToken: true,
      },
    })
  }
  return cliente
}

/** Descarta o cliente para que o próximo escolha o armazenamento de novo. */
export function esquecerClienteSupabase(): void {
  cliente = null
}

/** O mesmo cliente que o resto do app usa — a tela de admin fala pelas mesmas
 *  políticas de RLS, sem chave privilegiada nenhuma. */
export function clienteSupabase() {
  return cli()
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
  /** Impressão da chave que este embrulho abre — ver `dekId` em `crypto.ts`. */
  dek_id?: string | null
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
    dekId: l.dek_id ?? undefined,
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
    dek_id: w.dekId ?? null,
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
  if (/convite|não liberada|nao liberada|database error saving new user|signups? not allowed|signup is disabled/.test(m)) {
    return 'Conta nova neste app é por convite. Peça um código a quem administra e digite no campo "código de convite" — se o seu código já foi usado ou venceu, peça outro. Se a conta é sua e já existe, confira se digitou o mesmo e-mail: quem já tem conta entra sem código.'
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

    async enviarCodigo(email, convite) {
      const { error } = await cli().auth.signInWithOtp({
        email,
        options: {
          // Vira raw_user_meta_data na criação do usuário, que é onde o gatilho
          // do banco lê o convite. Conta que já existe ignora isto: quem já
          // entrou não precisa de convite de novo.
          data: convite?.trim() ? { convite: convite.trim().toUpperCase() } : undefined,
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

    /**
     * Grava CONDICIONADO à versão que estava lá quando lemos.
     *
     * O `upsert` que ficava aqui escrevia sem olhar o que havia no servidor: se
     * outro aparelho gravasse no meio, a segunda escrita apagava a primeira sem
     * ninguém saber. Agora a corrida perde, e perder vira `ConflitoDeVersao` —
     * que a orquestração transforma na tela de escolha que já existe.
     */
    async gravarDoc(doc) {
      const user_id = await idDoUsuario()
      const esperada = doc.version - 1
      const campos = {
        ciphertext: doc.ciphertext,
        iv: doc.iv,
        version: doc.version,
        vault_id: doc.vaultId ?? null,
        updated_at: new Date().toISOString(),
      }
      const colunas = 'doc_id, ciphertext, iv, version, updated_at, vault_id'

      // Primeira subida: a linha não pode existir. Se existir, alguém criou
      // enquanto líamos — e a chave primária (user_id, doc_id) recusa.
      const { data, error } =
        esperada <= 0
          ? await cli().from('vaults').insert({ user_id, doc_id: doc.docId, ...campos }).select(colunas).maybeSingle()
          : await cli()
              .from('vaults')
              .update(campos)
              .eq('user_id', user_id)
              .eq('doc_id', doc.docId)
              .eq('version', esperada)
              .select(colunas)
              .maybeSingle()

      // Os dois jeitos de o servidor dizer «alguém chegou antes»:
      // 23505 = unicidade — a linha nasceu entre a nossa leitura e este insert.
      // 40001 = o gatilho `versao_so_avanca`, quando duas escritas passam pela
      //         condição ao mesmo tempo e o banco desempata. Sem traduzir este
      //         aqui, a corrida que o gatilho existe para pegar chegaria à tela
      //         como mensagem crua do Postgres em vez da escolha de versão.
      if (error) {
        if (error.code === '23505' || error.code === '40001') throw new ConflitoDeVersao(doc.docId)
        throw new Error(error.message)
      }
      // Zero linhas afetadas: a versão no servidor já não é a que lemos.
      if (!data) throw new ConflitoDeVersao(doc.docId)
      return docDaLinha(data as LinhaVault)
    },

    async lerWraps() {
      const { data, error } = await cli()
        .from('vault_wraps')
        .select('wrap_id, metodo, rotulo, kdf, kdf_params, salt, wrapped_dek, dek_id, criado_em')
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
