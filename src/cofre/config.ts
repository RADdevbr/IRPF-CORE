// Só a leitura das variáveis de ambiente — de propósito SEM importar o SDK do
// Supabase, para que quem nunca abre a tela de conta não baixe ~200 kB à toa.

const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL as string | undefined
const CHAVE_SUPABASE = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export function supabaseConfigurado(): boolean {
  return Boolean(URL_SUPABASE && CHAVE_SUPABASE)
}

export function credenciaisSupabase(): { url: string; chave: string } {
  if (!URL_SUPABASE || !CHAVE_SUPABASE) throw new Error('Sync não configurado neste ambiente.')
  return { url: URL_SUPABASE, chave: CHAVE_SUPABASE }
}
