// Lembra que ESTE navegador já entrou numa conta alguma vez.
//
// Serve a um propósito só: deixar o app sincronizar sozinho sem cobrar de todo
// mundo o preço de carregar o SDK do Supabase (~200 kB). Quem nunca entrou não
// baixa nada; quem já entrou, o app assume que quer continuar sincronizando.
//
// Não é credencial e não abre nada: é um post-it com o e-mail, ao lado de uma
// sessão que quem guarda é o próprio SDK.

const CHAVE = 'irpfm2027:conta:v1'

export function lembrarConta(email: string, st: Storage | undefined = seguro()): void {
  try {
    st?.setItem(CHAVE, email)
  } catch {
    /* navegador sem storage: só perde a memória do e-mail */
  }
}

export function contaLembrada(st: Storage | undefined = seguro()): string | null {
  try {
    return st?.getItem(CHAVE) ?? null
  } catch {
    return null
  }
}

export function esquecerConta(st: Storage | undefined = seguro()): void {
  try {
    st?.removeItem(CHAVE)
  } catch {
    /* idem */
  }
}

function seguro(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}
