// Quem é o app que está usando o núcleo.
//
// Antes de existirem três apps, isto era uma constante: `PREFIXO = 'irpfm2027:'`
// espalhada por armazenamento, cofre e token da conta. Com três apps no mesmo
// navegador e na mesma conta, uma constante compartilhada juntaria o que precisa
// ficar separado — o estado de um sobrescreveria o do outro, e «Apagar deste
// aparelho» num deles varreria os três.
//
// Então a identidade passa a ser declarada uma vez, no `main.tsx` de cada app, e
// tudo o que grava pergunta aqui. Duas identidades por app:
//
//   · `prefixo`   — a família de chaves deste app NESTE aparelho.
//   · `docEstado` — o nome do documento deste app NA CONTA (a coluna `doc_id`).
//
// Os métodos de desbloqueio (`vault_wraps`) continuam sendo UM conjunto por
// conta, de propósito: eles embrulham a mesma chave, e pedir para cadastrar a
// passkey três vezes seria cobrar pela separação um preço que ela não precisa
// cobrar. Um login, um destravar, três documentos cifrados.

export interface ConfigApp {
  /**
   * Prefixo de tudo que este app grava neste aparelho. Termine com `:` — a
   * varredura de «Apagar deste aparelho» casa por prefixo, e sem o separador
   * `irpf:` alcançaria as chaves de `irpfm2027:`.
   */
  prefixo: string
  /**
   * Nome do documento deste app na conta (`vaults.doc_id`). Precisa ser
   * diferente por app: é a chave primária, junto do usuário.
   */
  docEstado: string
  /** Nome do app para a tela — aparece na conta e nas mensagens de erro. */
  nome: string
  /**
   * Domínio que fixa o `rp.id` das passkeys, quando o app tem um endereço de
   * produção estável.
   *
   * Vinha de `VITE_RP_ID`, lido aqui dentro. Não dá mais: o núcleo é compilado
   * antes do app, e a substituição de variável de ambiente do Vite acontece no
   * build de quem escreve a leitura. A leitura sairia vazia, o `rp.id` cairia
   * para o host efetivo, e passkeys cadastradas numa preview não abririam em
   * produção — exatamente o problema que a variável existe para evitar.
   *
   * Ausente = usa o host efetivo, que é o certo em localhost.
   */
  rpId?: string
  /**
   * Credenciais do Supabase. Ficam aqui, e não numa leitura de
   * `import.meta.env` dentro do núcleo, porque o núcleo é compilado antes de o
   * app existir: a substituição de variável de ambiente do Vite acontece no
   * build de QUEM IMPORTA, e uma leitura feita aqui dentro chegaria vazia.
   *
   * Ausente = app sem sync; a tela de conta não aparece.
   */
  supabase?: { url: string; chave: string }
}

let atual: ConfigApp | null = null

/**
 * Declara quem é o app. Chame uma vez, antes de renderizar — quem grava sem
 * isto recebe erro, e não um prefixo padrão: um padrão silencioso faria dois
 * apps mal configurados compartilharem o mesmo estado, que é o bug que este
 * módulo existe para tornar impossível.
 */
export function configurarApp(c: ConfigApp): void {
  if (!c.prefixo.endsWith(':')) throw new Error(`prefixo do app precisa terminar em ':' (recebi "${c.prefixo}")`)
  if (!c.docEstado) throw new Error('docEstado do app não pode ser vazio.')
  atual = c
}

function config(): ConfigApp {
  if (!atual) {
    throw new Error(
      'configurarApp() não foi chamado. O núcleo não sabe sob que prefixo gravar — ' +
        'chame-o no main.tsx antes de renderizar.',
    )
  }
  return atual
}

/** Prefixo deste app. Tudo o que grava neste aparelho passa por aqui. */
export const prefixoApp = (): string => config().prefixo

/** Nome do documento deste app na conta. */
export const docEstadoApp = (): string => config().docEstado

export const nomeApp = (): string => config().nome

export const supabaseDoApp = (): ConfigApp['supabase'] => config().supabase

export const rpIdDoApp = (): string | undefined => atual?.rpId?.trim() || undefined

/** Já configurado? Para o que roda antes do app montar (o service worker). */
export const appConfigurado = (): boolean => atual !== null

/** Só para os testes: volta ao estado de "ninguém configurou". */
export function esquecerConfigApp(): void {
  atual = null
}
