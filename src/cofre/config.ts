// Se este app tem conta, e com que credenciais.
//
// Era uma leitura direta de `import.meta.env.VITE_SUPABASE_*`. Dentro de um
// pacote compilado isso não funciona mais, e o modo de falha é traiçoeiro: o
// Vite substitui essas variáveis no build de quem as escreve, então a leitura
// feita AQUI sairia `undefined` no app que importa, e a tela de conta
// simplesmente não apareceria — sem erro, sem aviso.
//
// Então as credenciais entram por `configurarApp()`, onde o app as lê do próprio
// ambiente. O resto do desenho continua igual: o SDK do Supabase só é baixado
// quando a tela de conta abre, e este módulo de propósito não o importa.

import { supabaseDoApp } from '../app/config'

export function supabaseConfigurado(): boolean {
  const s = supabaseDoApp()
  return Boolean(s?.url && s?.chave)
}

export function credenciaisSupabase(): { url: string; chave: string } {
  const s = supabaseDoApp()
  if (!s?.url || !s?.chave) throw new Error('Sync não configurado neste ambiente.')
  return { url: s.url, chave: s.chave }
}
