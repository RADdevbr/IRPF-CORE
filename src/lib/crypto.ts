// Núcleo criptográfico do cofre — ver PLAN-CONTA-E-HISTORICO.md §1.2.
//
// Desenho: uma DEK aleatória de 32 bytes cifra os dados (AES-256-GCM). Ela é
// EMBRULHADA N vezes, uma por método de desbloqueio (passkey, senha, chave de
// recuperação, futuramente certificado). Consequências:
//   · trocar/adicionar/remover método re-embrulha 32 bytes — não re-cifra o cofre;
//   · nenhum método conhece os outros;
//   · o servidor só recebe blobs opacos (o cofre e os embrulhos).
//
// Este arquivo NÃO fala com o navegador nem com a rede: recebe segredos brutos e
// devolve estruturas serializáveis. A ponte com WebAuthn fica em `passkey.ts`.

const AES = 'AES-GCM'
const IV_BYTES = 12
const DEK_BYTES = 32

/** Um embrulho da DEK por um método de desbloqueio. Serializável (vai para o servidor). */
export interface Wrap {
  wrapId: string // 'passkey:<credId>' | 'senha' | 'recuperacao' | 'cert:<thumbprint>'
  metodo: 'passkey' | 'senha' | 'recuperacao' | 'certificado'
  rotulo?: string // 'iPhone · Face ID'
  kdf: KdfNome
  kdfParams?: Record<string, number>
  salt: string // base64
  wrappedDek: string // base64 — iv || ciphertext
  criadoEm: string // ISO
}

/** O cofre: os dados do usuário cifrados pela DEK. */
export interface Cofre {
  v: 1
  iv: string // base64
  ciphertext: string // base64
}

export type KdfNome = 'argon2id' | 'pbkdf2' | 'hkdf'

/**
 * Este método foi protegido por uma derivação mais fraca do que a pretendida?
 *
 * Só vale para senha: `hkdf` é o certo para segredo já forte (o PRF da passkey,
 * a chave de recuperação sorteada), e ali não há senha fraca a proteger.
 */
export const protecaoFraca = (w: Wrap): boolean => w.metodo === 'senha' && w.kdf === 'pbkdf2'

/** Parâmetros do Argon2id. m em KiB. Defaults de produção; testes usam menores. */
export interface Argon2Params {
  m: number
  t: number
  p: number
}
export const ARGON2_PADRAO: Argon2Params = { m: 65536, t: 3, p: 1 }
export const PBKDF2_ITER = 600_000

// ---------------------------------------------------------------- base64 / bytes

export function paraB64(b: Uint8Array): string {
  let s = ''
  for (const byte of b) s += String.fromCharCode(byte)
  return btoa(s)
}

export function deB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function aleatorio(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

// ---------------------------------------------------------------- DEK

/** Gera a chave que cifra os dados. Nunca sai do navegador em claro. */
export function gerarDek(): Uint8Array {
  return aleatorio(DEK_BYTES)
}

async function chaveAes(bruta: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', bruta as BufferSource, { name: AES }, false, ['encrypt', 'decrypt'])
}

// ---------------------------------------------------------------- KEKs

/**
 * KEK a partir de um segredo já forte (32 bytes do PRF da passkey, ou o código de
 * recuperação já decodificado). HKDF basta — não há senha fraca a proteger.
 */
export async function kekDeSegredo(segredo: Uint8Array, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', segredo as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: new TextEncoder().encode(info) },
    base,
    256,
  )
  return chaveAes(new Uint8Array(bits))
}

/**
 * KEK a partir de senha. Argon2id (hash-wasm) por padrão; se o wasm falhar, cai
 * para PBKDF2 — mais fraco, mas não trava o app. O `kdf` efetivamente usado é
 * gravado no Wrap para que o desbloqueio reproduza exatamente a mesma derivação.
 *
 * A queda é gravada, mas nunca era DITA: o cofre nascia mais fraco e ninguém
 * ficava sabendo, nem depois. `protecaoFraca()` existe para a tela poder contar
 * — o dado sempre esteve ali, faltava alguém olhar.
 */
export async function kekDeSenha(
  senha: string,
  salt: Uint8Array,
  params: Argon2Params = ARGON2_PADRAO,
  forcar?: KdfNome,
): Promise<{ kek: CryptoKey; kdf: KdfNome; kdfParams: Record<string, number> }> {
  if (forcar !== 'pbkdf2') {
    try {
      const { argon2id } = await import('hash-wasm')
      const bruta = (await argon2id({
        password: senha,
        salt,
        parallelism: params.p,
        iterations: params.t,
        memorySize: params.m,
        hashLength: 32,
        outputType: 'binary',
      })) as Uint8Array
      return { kek: await chaveAes(bruta), kdf: 'argon2id', kdfParams: { ...params } }
    } catch {
      /* sem wasm — cai para PBKDF2 abaixo */
    }
  }
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITER },
    base,
    256,
  )
  return { kek: await chaveAes(new Uint8Array(bits)), kdf: 'pbkdf2', kdfParams: { iter: PBKDF2_ITER } }
}

/** Refaz a KEK de um Wrap já existente, usando os parâmetros gravados nele. */
export async function kekDoWrap(wrap: Wrap, segredo: Uint8Array | string): Promise<CryptoKey> {
  const salt = deB64(wrap.salt)
  if (wrap.kdf === 'hkdf') {
    const bruto = typeof segredo === 'string' ? codigoParaBytes(segredo) : segredo
    return kekDeSegredo(bruto, salt, `irpfm-vault-${wrap.metodo}`)
  }
  if (typeof segredo !== 'string') throw new Error('Este método exige senha (texto).')
  const p = wrap.kdfParams ?? {}
  const { kek } = await kekDeSenha(
    segredo,
    salt,
    { m: p.m ?? ARGON2_PADRAO.m, t: p.t ?? ARGON2_PADRAO.t, p: p.p ?? ARGON2_PADRAO.p },
    wrap.kdf,
  )
  return kek
}

// ---------------------------------------------------------------- embrulho da DEK

export async function embrulhar(
  dek: Uint8Array,
  kek: CryptoKey,
  meta: { wrapId: string; metodo: Wrap['metodo']; rotulo?: string; kdf: KdfNome; kdfParams?: Record<string, number>; salt: Uint8Array },
  agora: string,
): Promise<Wrap> {
  const iv = aleatorio(IV_BYTES)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: AES, iv: iv as BufferSource }, kek, dek as BufferSource))
  return {
    wrapId: meta.wrapId,
    metodo: meta.metodo,
    rotulo: meta.rotulo,
    kdf: meta.kdf,
    kdfParams: meta.kdfParams,
    salt: paraB64(meta.salt),
    wrappedDek: paraB64(concat(iv, ct)),
    criadoEm: agora,
  }
}

/** Abre um embrulho. Lança se a chave estiver errada ou o blob tiver sido alterado. */
export async function desembrulhar(wrap: Wrap, kek: CryptoKey): Promise<Uint8Array> {
  const blob = deB64(wrap.wrappedDek)
  const iv = blob.slice(0, IV_BYTES)
  const ct = blob.slice(IV_BYTES)
  try {
    const bruta = await crypto.subtle.decrypt({ name: AES, iv: iv as BufferSource }, kek, ct as BufferSource)
    return new Uint8Array(bruta)
  } catch {
    throw new Error('Não foi possível abrir o cofre com este método.')
  }
}

// ---------------------------------------------------------------- cofre

export async function cifrarCofre(dek: Uint8Array, dados: unknown): Promise<Cofre> {
  const chave = await chaveAes(dek)
  const iv = aleatorio(IV_BYTES)
  const claro = new TextEncoder().encode(JSON.stringify(dados))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: AES, iv: iv as BufferSource }, chave, claro as BufferSource))
  return { v: 1, iv: paraB64(iv), ciphertext: paraB64(ct) }
}

export async function decifrarCofre<T = unknown>(dek: Uint8Array, cofre: Cofre): Promise<T> {
  const chave = await chaveAes(dek)
  try {
    const claro = await crypto.subtle.decrypt(
      { name: AES, iv: deB64(cofre.iv) as BufferSource },
      chave,
      deB64(cofre.ciphertext) as BufferSource,
    )
    return JSON.parse(new TextDecoder().decode(claro)) as T
  } catch {
    throw new Error('Cofre ilegível: chave errada ou conteúdo adulterado.')
  }
}

// ---------------------------------------------------------------- chave de recuperação

// Base32 de Crockford: sem I, L, O, U — evita confusão ao transcrever do papel.
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODIGO_CHARS = 24 // 24 × 5 bits = 120 bits de entropia

/** Gera o código impresso, agrupado de 4 em 4 (K7XQ-4M2P-…). */
export function gerarCodigoRecuperacao(): string {
  const bytes = aleatorio(CODIGO_CHARS)
  let s = ''
  for (let i = 0; i < CODIGO_CHARS; i++) s += ALFABETO[bytes[i] % 32]
  return (s.match(/.{4}/g) ?? []).join('-')
}

/** Aceita o código como o usuário digitar: minúsculas, espaços, O/0 e I/L/1 trocados. */
export function normalizarCodigo(codigo: string): string {
  const limpo = codigo
    .toUpperCase()
    .replace(/[\s·.-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (limpo.length !== CODIGO_CHARS) throw new Error(`A chave de recuperação tem ${CODIGO_CHARS} caracteres.`)
  for (const c of limpo) if (!ALFABETO.includes(c)) throw new Error(`Caractere inválido na chave: "${c}".`)
  return limpo
}

/** Converte o código normalizado nos bytes que alimentam o HKDF. */
export function codigoParaBytes(codigo: string): Uint8Array {
  const norm = normalizarCodigo(codigo)
  const out = new Uint8Array(norm.length)
  for (let i = 0; i < norm.length; i++) out[i] = ALFABETO.indexOf(norm[i])
  return out
}

// ---------------------------------------------------------------- fachada do cofre

export interface CofreCompleto {
  schemaVersion: 1
  /**
   * Identidade do cofre. Dois aparelhos que criaram cofres separados têm DEKs
   * diferentes: juntar os métodos de desbloqueio deles produziria embrulhos que
   * não abrem nada. O id é o que permite detectar isso no sync em vez de
   * corromper o acesso em silêncio. Opcional porque cofres da Fase 0 nasceram
   * sem ele — `garantirVaultId` preenche na primeira leitura.
   */
  vaultId?: string
  wraps: Wrap[]
  cofre: Cofre
}

export function gerarVaultId(): string {
  return paraB64(aleatorio(12)).replace(/[+/=]/g, '').slice(0, 16)
}

/** Cria um cofre novo já com o primeiro método de desbloqueio. */
export async function criarCofre(
  dados: unknown,
  primeiro: { wrapId: string; metodo: Wrap['metodo']; rotulo?: string; segredo: Uint8Array | string },
  agora: string,
  params?: Argon2Params,
): Promise<{ cofre: CofreCompleto; dek: Uint8Array }> {
  const dek = gerarDek()
  const wrap = await novoWrap(dek, primeiro, agora, params)
  return { cofre: { schemaVersion: 1, vaultId: gerarVaultId(), wraps: [wrap], cofre: await cifrarCofre(dek, dados) }, dek }
}

/** Embrulha a DEK para mais um método. A DEK precisa estar aberta (sessão destravada). */
export async function novoWrap(
  dek: Uint8Array,
  m: { wrapId: string; metodo: Wrap['metodo']; rotulo?: string; segredo: Uint8Array | string },
  agora: string,
  params: Argon2Params = ARGON2_PADRAO,
): Promise<Wrap> {
  const salt = aleatorio(16)
  if (typeof m.segredo === 'string' && m.metodo === 'senha') {
    const { kek, kdf, kdfParams } = await kekDeSenha(m.segredo, salt, params)
    return embrulhar(dek, kek, { ...m, kdf, kdfParams, salt }, agora)
  }
  const bruto = typeof m.segredo === 'string' ? codigoParaBytes(m.segredo) : m.segredo
  const kek = await kekDeSegredo(bruto, salt, `irpfm-vault-${m.metodo}`)
  return embrulhar(dek, kek, { ...m, kdf: 'hkdf', salt }, agora)
}

/** Destrava o cofre por um método específico. Devolve a DEK e os dados. */
export async function destravar<T = unknown>(
  cofre: CofreCompleto,
  wrapId: string,
  segredo: Uint8Array | string,
): Promise<{ dek: Uint8Array; dados: T }> {
  const wrap = cofre.wraps.find((w) => w.wrapId === wrapId)
  if (!wrap) throw new Error('Método de desbloqueio não encontrado neste cofre.')
  const kek = await kekDoWrap(wrap, segredo)
  const dek = await desembrulhar(wrap, kek)
  try {
    return { dek, dados: await decifrarCofre<T>(dek, cofre.cofre) }
  } catch {
    // Chegar aqui prova que o segredo estava CERTO: o embrulho abriu. O que não
    // bate é o conteúdo — este cofre ficou com embrulhos de uma chave e dados
    // de outra (uma sincronização misturou dois cofres criados separadamente).
    // Dizer "chave errada" mandaria a pessoa tentar de novo para sempre.
    throw new Error(
      'Sua chave está certa, mas o conteúdo gravado neste navegador não corresponde a ela — ' +
        'provavelmente uma sincronização misturou dois cofres diferentes. ' +
        'Nenhuma senha vai abrir este conteúdo. Use "Não consegue destravar?" abaixo para ' +
        'guardar uma cópia e recomeçar; se você usa a conta, dá para trazer o cofre dela de novo.',
    )
  }
}

/**
 * Regra dos dois caminhos (§1.2): o cofre nunca fica com um único método ativo.
 * Devolve o motivo do bloqueio, ou null se a remoção é segura.
 */
export function podeRemover(cofre: CofreCompleto, wrapId: string): string | null {
  if (!cofre.wraps.some((w) => w.wrapId === wrapId)) return 'Este método não existe no cofre.'
  if (cofre.wraps.length <= 2) return 'Adicione outro método antes: o cofre precisa de pelo menos dois caminhos de volta.'
  return null
}

export function removerWrap(cofre: CofreCompleto, wrapId: string): CofreCompleto {
  const erro = podeRemover(cofre, wrapId)
  if (erro) throw new Error(erro)
  return { ...cofre, wraps: cofre.wraps.filter((w) => w.wrapId !== wrapId) }
}
