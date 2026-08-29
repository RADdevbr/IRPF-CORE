// A porta única por onde o app grava neste computador.
//
// Existe por causa do modo visita. A promessa dele — «nada é gravado neste
// computador» — estava implementada campo a campo: `saveState` checava, o
// cofre não; os cenários checavam, o e-mail da conta não; e o token de sessão
// do Supabase, que é a coisa mais sensível que este app põe em disco, não
// passava por checagem nenhuma porque quem o grava é o SDK.
//
// Uma promessa dessas não se cumpre com uma checagem em cada lugar que grava:
// cumpre-se com um lugar por onde tudo passa. Em modo visita, este módulo
// devolve um armazenamento em MEMÓRIA no lugar do `localStorage` — o app
// funciona inteiro, lê de volta o que escreveu, e some ao fechar a aba.
//
// O mesmo desenho resolve a segunda metade do problema: como toda chave nasce
// com o prefixo do app, «Apagar deste aparelho» consegue varrer tudo, inclusive
// o que o SDK do Supabase grava.

/** Prefixo de tudo que este app grava. Uma família só, para poder varrer. */
export const PREFIXO = 'irpfm2027:'

/**
 * Modo visita: o app funciona inteiro, mas não grava nada neste computador.
 *
 * Existe porque o computador onde a planilha está pode não ser o seu — o do
 * trabalho, o de alguém — e ali o `localStorage` fica legível para qualquer
 * extensão do navegador e para o próximo que sentar na cadeira.
 *
 * Não é lembrado entre sessões, de propósito: lembrar seria gravar, que é
 * exatamente o que o modo promete não fazer. Entra pela URL (`?visita`) ou pelo
 * botão, e sai fechando a aba.
 */
let visita = false

export const modoVisita = () => visita

export function setModoVisita(v: boolean): void {
  // Ao LIGAR, o que já está em memória continua servindo a sessão; o que já
  // estava em disco fica em disco (apagar é decisão à parte, com botão próprio).
  // Ao desligar, a memória é descartada: ela era o substituto do disco, e mantê-la
  // faria a sessão ler valores que o disco não tem.
  if (!v) memoria.clear()
  visita = v
}

/** O `Storage` que o app usa. Só o que precisamos — dá para injetar nos testes. */
export interface Armazenamento {
  getItem(chave: string): string | null
  setItem(chave: string, valor: string): void
  removeItem(chave: string): void
  key(i: number): string | null
  readonly length: number
}

/**
 * Armazenamento em memória, compartilhado por toda a sessão.
 *
 * Compartilhado de propósito: em modo visita, o cofre gravado por uma tela
 * precisa ser lido por outra. Um mapa por chamador faria o app parecer quebrado
 * — grava e não lê de volta — em vez de apenas não persistir.
 */
class EmMemoria implements Armazenamento {
  private mapa = new Map<string, string>()
  getItem(chave: string) {
    return this.mapa.get(chave) ?? null
  }
  setItem(chave: string, valor: string) {
    this.mapa.set(chave, String(valor))
  }
  removeItem(chave: string) {
    this.mapa.delete(chave)
  }
  key(i: number) {
    return [...this.mapa.keys()][i] ?? null
  }
  get length() {
    return this.mapa.size
  }
  clear() {
    this.mapa.clear()
  }
}

const memoria = new EmMemoria()
const memoriaSessao = new EmMemoria()

/** `true` quando as escritas estão indo para a memória, não para o disco. */
export const gravandoSoNaMemoria = () => visita

function nativo(qual: 'local' | 'session'): Armazenamento | null {
  try {
    const s = qual === 'local' ? localStorage : sessionStorage
    return typeof s === 'undefined' ? null : s
  } catch {
    // Storage bloqueado (janela anônima com restrição, iframe de terceiro).
    return null
  }
}

/**
 * Onde o app grava o que deve sobreviver a fechar o navegador.
 *
 * Em modo visita — ou com o `localStorage` bloqueado — devolve a memória. Nunca
 * devolve `null`: quem chama não deveria precisar de um caminho «sem gravar»,
 * porque esse caminho é justamente o que se esquece de implementar.
 */
export function armazenamentoLocal(): Armazenamento {
  if (visita) return memoria
  return nativo('local') ?? memoria
}

/** O mesmo, para o que morre ao fechar a aba (a chave da sessão destravada). */
export function armazenamentoSessao(): Armazenamento {
  if (visita) return memoriaSessao
  return nativo('session') ?? memoriaSessao
}

function chavesCom(st: Armazenamento | null): string[] {
  const fora: string[] = []
  if (!st) return fora
  try {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i)
      if (k && k.startsWith(PREFIXO)) fora.push(k)
    }
  } catch {
    /* sem acesso ao storage — devolve o que deu */
  }
  return fora
}

/**
 * As chaves deste app que estão GRAVADAS neste aparelho.
 *
 * Olha o disco, e só o disco — inclusive em modo visita, onde a memória pode
 * estar cheia e o disco vazio. É essa a pergunta que a tela faz: "o que ficou
 * aqui depois que eu fechar?". Contar a memória junto faria o botão de apagar
 * anunciar registros que somem sozinhos, e esconderia os que não somem.
 */
export function chavesGravadas(st?: Armazenamento): string[] {
  return chavesCom(st ?? nativo('local'))
}

/**
 * Apaga tudo o que o app gravou aqui: estado, cenários, cofre, sessão lembrada,
 * vínculo de dispositivo e o token da conta.
 *
 * Varre pelo prefixo em vez de listar as chaves uma a uma, para que a próxima
 * chave que alguém criar já nasça coberta — e é por isso que o token do
 * Supabase passou a ser gravado sob o prefixo do app (ver `remoto.ts`): fora
 * dele, a varredura apagava o cofre e deixava a credencial que o baixa de novo.
 */
export function apagarTudoDesteAparelho(): number {
  let n = 0
  for (const st of [nativo('local'), nativo('session')]) {
    if (!st) continue
    for (const k of chavesCom(st)) {
      try {
        st.removeItem(k)
        n += 1
      } catch {
        /* ignora */
      }
    }
  }
  // A memória também: em modo visita é ela que está guardando a sessão, e quem
  // clica em "apagar" quer as duas coisas fora.
  memoria.clear()
  memoriaSessao.clear()
  return n
}
