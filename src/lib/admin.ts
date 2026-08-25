// Controle de contas — o que o dono do app faz sem abrir o painel do Supabase.
//
// Tudo aqui passa pela chave anon e pela RLS: quem não estiver em `admins` não
// lê nem escreve nada destas tabelas, e o navegador nunca vê a service_role.
// A consequência honesta disso está em `podeApagarUsuario`: dá para apagar os
// DADOS de uma conta e deixá-la inerte, não para apagar a linha de auth.
//
// A parte pura (validar um convite antes de mandar, decidir se a tela aparece)
// fica fora da rede de propósito: é o que dá para testar sem servidor.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface ContaAdmin {
  userId: string
  email: string
  criadoEm: string
  bloqueada: boolean
  bloqueadaEm?: string
  conviteUsado?: string
  nota?: string
}

export interface Convite {
  codigo: string
  nota?: string
  usos: number
  usosMax: number
  expiraEm?: string
  criadoEm: string
}

/** O que a linha do formulário precisa ter para virar um convite. */
export interface NovoConvite {
  codigo: string
  usosMax: number
  diasDeValidade?: number
  nota?: string
}

export type Erro = string | null

/**
 * Código legível de convite: maiúsculas, sem espaço, sem acento.
 *
 * O código é ditado por telefone e digitado no celular. "amigos 2027" e
 * "AMIGOS-2027" têm de ser o mesmo código, senão a pessoa erra e culpa o app.
 */
export function normalizaCodigo(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // as marcas de acento que o NFD soltou
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function validaConvite(n: NovoConvite): Erro {
  const codigo = normalizaCodigo(n.codigo)
  if (codigo.length < 4) return 'O código precisa de pelo menos 4 caracteres.'
  if (!Number.isFinite(n.usosMax) || n.usosMax < 1) return 'O convite precisa valer para pelo menos uma conta.'
  if (n.diasDeValidade !== undefined && (!Number.isFinite(n.diasDeValidade) || n.diasDeValidade < 1)) {
    return 'A validade, se houver, é de pelo menos um dia.'
  }
  return null
}

/** Convite que não serve mais para ninguém — a tela mostra apagado. */
export function conviteEsgotado(c: Convite, agora = new Date()): boolean {
  if (c.usos >= c.usosMax) return true
  return c.expiraEm !== undefined && new Date(c.expiraEm) <= agora
}

/**
 * Apagar usuário de verdade não dá — e a tela precisa dizer isso, não sumir com
 * o botão e deixar a pessoa procurando.
 */
export const podeApagarUsuario = false

export const AVISO_APAGAR =
  'Apaga o cofre e os métodos de desbloqueio desta conta, e a deixa bloqueada. A linha de login continua existindo no Supabase (só o painel de lá apaga), mas sem dados e sem acesso ela não serve para nada.'

// ---------------------------------------------------------------- rede

const conta = (l: Record<string, unknown>): ContaAdmin => ({
  userId: String(l.user_id),
  email: String(l.email),
  criadoEm: String(l.criado_em),
  bloqueada: Boolean(l.bloqueada),
  bloqueadaEm: (l.bloqueada_em as string) ?? undefined,
  conviteUsado: (l.convite_usado as string) ?? undefined,
  nota: (l.nota as string) ?? undefined,
})

const convite = (l: Record<string, unknown>): Convite => ({
  codigo: String(l.codigo),
  nota: (l.nota as string) ?? undefined,
  usos: Number(l.usos),
  usosMax: Number(l.usos_max),
  expiraEm: (l.expira_em as string) ?? undefined,
  criadoEm: String(l.criado_em),
})

export function admin(cliente: SupabaseClient) {
  const cli = () => cliente

  const erro = (e: { message: string } | null) => {
    if (e) throw new Error(e.message)
  }

  return {
    /** Você é admin? A RLS de `admins` só deixa ver a própria linha. */
    async souAdmin(): Promise<boolean> {
      const { data } = await cli().auth.getUser()
      if (!data.user) return false
      const r = await cli().from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle()
      return !!r.data
    },

    async listarContas(): Promise<ContaAdmin[]> {
      const { data, error } = await cli().from('contas').select('*').order('criado_em', { ascending: false })
      erro(error)
      return (data ?? []).map(conta)
    },

    async bloquear(userId: string, bloquear: boolean): Promise<void> {
      const { error } = await cli()
        .from('contas')
        .update({ bloqueada: bloquear, bloqueada_em: bloquear ? new Date().toISOString() : null })
        .eq('user_id', userId)
      erro(error)
    },

    /** Apaga os dados e bloqueia: sem o bloqueio, a conta voltaria a sincronizar. */
    async apagarDados(userId: string): Promise<void> {
      erro((await cli().from('vaults').delete().eq('user_id', userId)).error)
      erro((await cli().from('vault_wraps').delete().eq('user_id', userId)).error)
      erro(
        (
          await cli()
            .from('contas')
            .update({ bloqueada: true, bloqueada_em: new Date().toISOString() })
            .eq('user_id', userId)
        ).error,
      )
    },

    async listarConvites(): Promise<Convite[]> {
      const { data, error } = await cli().from('convites').select('*').order('criado_em', { ascending: false })
      erro(error)
      return (data ?? []).map(convite)
    },

    async criarConvite(n: NovoConvite): Promise<string> {
      const problema = validaConvite(n)
      if (problema) throw new Error(problema)
      const codigo = normalizaCodigo(n.codigo)
      const expira =
        n.diasDeValidade === undefined
          ? null
          : new Date(Date.now() + n.diasDeValidade * 86_400_000).toISOString()
      const { error } = await cli()
        .from('convites')
        .insert({ codigo, nota: n.nota ?? null, usos_max: n.usosMax, expira_em: expira })
      erro(error)
      return codigo
    },

    async revogarConvite(codigo: string): Promise<void> {
      erro((await cli().from('convites').delete().eq('codigo', codigo)).error)
    },

    async listarLiberados(): Promise<{ email: string; nota?: string }[]> {
      const { data, error } = await cli().from('contas_liberadas').select('email, nota').order('email')
      erro(error)
      return (data ?? []).map((l) => ({ email: String(l.email), nota: (l.nota as string) ?? undefined }))
    },

    async liberarEmail(email: string, nota?: string): Promise<void> {
      const limpo = email.trim().toLowerCase()
      if (!limpo.includes('@')) throw new Error('E-mail inválido.')
      erro((await cli().from('contas_liberadas').insert({ email: limpo, nota: nota ?? null })).error)
    },

    async removerLiberado(email: string): Promise<void> {
      erro((await cli().from('contas_liberadas').delete().eq('email', email)).error)
    },
  }
}
