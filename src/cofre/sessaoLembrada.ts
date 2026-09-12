// Lembra que ESTE navegador já entrou numa conta alguma vez.
//
// Serve a um propósito só: deixar o app sincronizar sozinho sem cobrar de todo
// mundo o preço de carregar o SDK do Supabase (~200 kB). Quem nunca entrou não
// baixa nada; quem já entrou, o app assume que quer continuar sincronizando.
//
// Não é credencial e não abre nada: é um post-it com o e-mail, ao lado de uma
// sessão que quem guarda é o próprio SDK. Mesmo assim passa por
// `armazenamento.ts` como todo o resto — em modo visita, o e-mail da conta é
// exatamente o tipo de rastro que não deve ficar no computador de outra pessoa.

import { armazenamentoLocal, chaveApp, type Armazenamento } from '../app/armazenamento.js'

// Escrita à mão, esta chave escapava do prefixo do app: com três apps na mesma
// família, o e-mail lembrado por um apareceria para os outros, e «apagar deste
// aparelho» num deles não o levaria. `chaveApp` é a porta — ver `config.ts`.
const CHAVE = () => chaveApp('conta:v1')

export function lembrarConta(email: string, st: Armazenamento = armazenamentoLocal()): void {
  try {
    st.setItem(CHAVE(), email)
  } catch {
    /* navegador sem storage: só perde a memória do e-mail */
  }
}

export function contaLembrada(st: Armazenamento = armazenamentoLocal()): string | null {
  try {
    return st.getItem(CHAVE())
  } catch {
    return null
  }
}

export function esquecerConta(st: Armazenamento = armazenamentoLocal()): void {
  try {
    st.removeItem(CHAVE())
  } catch {
    /* idem */
  }
}
