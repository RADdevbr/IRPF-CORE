import { rpIdDoApp } from '../app/config'
// Ponte com o WebAuthn — ver PLAN-CONTA-E-HISTORICO.md §1.3.
//
// A extensão PRF ("pseudo-random function", hmac-secret no nível CTAP) faz o
// autenticador devolver 32 bytes DETERMINÍSTICOS para um mesmo par
// (credencial, salt). É exatamente o que a KEK precisa — e é o que permite
// destravar o cofre com Face ID / Touch ID / Windows Hello sem senha nenhuma.
//
// ⚠️ Nada aqui roda em Node: é API de navegador e depende do autenticador do
// usuário. A lógica testável (embrulho/desembrulho) fica em `crypto.ts`, que
// recebe os 32 bytes já prontos. Cobertura da extensão varia por navegador —
// por isso `suportaPasskey()` existe e a senha continua como alternativa.

const SALT_PRF = new TextEncoder().encode('irpfm-vault-v1')
const RP_NOME = 'Calculadora IRPFM 2027'

/**
 * O domínio a que a passkey fica presa.
 *
 * Sem `rp.id`, o navegador usa o host efetivo — e na Vercel cada preview tem o
 * seu. Uma passkey cadastrada em `…-git-branch.vercel.app` não abre em produção,
 * e vice-versa; pior, o cofre sincronizado passa a oferecer, como botão
 * principal, um método condenado a falhar naquele domínio. O código já sabe
 * dizer "esta passkey é de outro APARELHO" (`dispositivo.ts`); faltava o caso
 * "de outro DOMÍNIO", que não tem como ser detectado depois.
 *
 * `rpId` em `configurarApp()` fixa o domínio de produção. Sem ele, mantém-se o
 * comportamento anterior (host efetivo), que é o certo para quem roda em
 * localhost ou abre o arquivo direto.
 */
/**
 * O domínio atual serve para a passkey que este app cadastraria?
 *
 * `rp.id` precisa ser o host ou um sufixo registrável dele — em qualquer outro
 * lugar o navegador recusa. Em vez de deixar o erro aparecer como "cancelado", a
 * tela pode dizer que ali a passkey é descartável.
 */
export function dominioDaPasskey(host = typeof location === 'undefined' ? '' : location.hostname): {
  rpId?: string
  descartavel: boolean
} {
  const fixado = rpIdDoApp()
  if (!fixado) return { rpId: undefined, descartavel: false }
  const vale = host === fixado || host.endsWith(`.${fixado}`)
  // Fora do domínio fixado (um preview, por exemplo), não force o rp.id: o
  // navegador recusaria. A passkey nasce presa àquele host e some com ele — e é
  // por isso que a tela avisa.
  return vale ? { rpId: fixado, descartavel: false } : { rpId: undefined, descartavel: true }
}

export interface CredencialCriada {
  credentialId: string // base64url
  prfDisponivel: boolean
}

function paraB64Url(b: ArrayBuffer | Uint8Array): string {
  const bytes = b instanceof Uint8Array ? b : new Uint8Array(b)
  let s = ''
  for (const x of bytes) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deB64Url(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function suportaPasskey(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials
}

/** Há autenticador de plataforma (Face ID, Touch ID, Windows Hello) neste aparelho? */
export async function temAutenticadorLocal(): Promise<boolean> {
  if (!suportaPasskey()) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/**
 * Registra a passkey. O `challenge` NÃO é barreira de segurança aqui: no
 * desbloqueio local a garantia vem da verificação do usuário pelo autenticador e
 * do segredo do PRF. Quando a passkey virar também fator de LOGIN no provedor, o
 * challenge tem de vir do servidor.
 */
async function registrar(usuario: { id: Uint8Array; nome: string }): Promise<{ cred: PublicKeyCredential; prfAnunciado: boolean }> {
  if (!suportaPasskey()) throw new Error('Este navegador não suporta passkey.')
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NOME, ...(dominioDaPasskey().rpId ? { id: dominioDaPasskey().rpId } : {}) },
      user: { id: usuario.id as BufferSource, name: usuario.nome, displayName: usuario.nome },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      // 'required' (credencial descobrível) NÃO é detalhe: no Android o
      // gerenciador do Google só oferece PRF para credencial descobrível. Testar
      // com 'discouraged' dava falso negativo — por isso o diagnóstico usa este
      // mesmo caminho, e não uma variante "mais limpa".
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Registro da passkey cancelado.')
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }
  return { cred, prfAnunciado: ext.prf?.enabled !== false }
}

export async function criarPasskey(usuario: { id: string; email: string }): Promise<CredencialCriada> {
  const { cred, prfAnunciado } = await registrar({ id: new TextEncoder().encode(usuario.id), nome: usuario.email })
  return { credentialId: paraB64Url(cred.rawId), prfDisponivel: prfAnunciado }
}

/**
 * Pede ao autenticador os 32 bytes do PRF. Mesma credencial + mesmo salt =
 * sempre os mesmos bytes; é isso que faz a KEK ser reproduzível sem guardar nada.
 */
/**
 * Segredo PRF de UMA das credenciais oferecidas.
 *
 * Aceita a lista inteira de propósito: depois de sincronizar, o cofre tem as
 * passkeys de todos os aparelhos, e cada aparelho só tem a sua. Oferecendo
 * todas, o autenticador escolhe a que ele possui e devolve QUAL foi — que é a
 * única fonte confiável disso. Enquanto só a primeira era oferecida, quem
 * cadastrou no Windows e depois foi destravar no Android via o app insistir na
 * credencial errada, com a certa parada dentro do mesmo cofre.
 */
export async function segredoDaPasskey(
  credentialId?: string | string[],
): Promise<{ credentialId: string; segredo: Uint8Array }> {
  if (!suportaPasskey()) throw new Error('Este navegador não suporta passkey.')
  const ids = credentialId === undefined ? [] : Array.isArray(credentialId) ? credentialId : [credentialId]
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      ...(dominioDaPasskey().rpId ? { rpId: dominioDaPasskey().rpId } : {}),
      allowCredentials: ids.length
        ? ids.map((id) => ({ type: 'public-key' as const, id: deB64Url(id) as BufferSource }))
        : undefined,
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: SALT_PRF } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!assertion) throw new Error('Desbloqueio cancelado.')

  const ext = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } }
  const bruto = ext.prf?.results?.first
  if (!bruto) {
    throw new Error('Esta passkey não fornece a extensão PRF — use a senha ou a chave de recuperação.')
  }
  return { credentialId: paraB64Url(assertion.rawId), segredo: new Uint8Array(bruto) }
}

/** Identificador do wrap desta credencial, no formato usado por `crypto.ts`. */
export const wrapIdDaPasskey = (credentialId: string) => `passkey:${credentialId}`

// ---------------------------------------------------------------- diagnóstico

/**
 * Descobre, no aparelho de quem está usando, se a passkey serve para destravar o
 * cofre. Não adianta consultar tabela de compatibilidade: o suporte a PRF varia
 * por navegador, por sistema E pelo autenticador — Windows Hello, em especial,
 * demorou a expor a hmac-secret. Então o app mede em vez de supor.
 *
 * O teste roda o MESMO caminho da criação real — mesmo registro, mesmo pedido de
 * PRF. Uma versão "mais limpa", com credencial não-descobrível, dava falso
 * negativo no Android, onde o gerenciador do Google só oferece PRF para
 * credencial descobrível. Como resultado, a credencial de teste fica salva no
 * gerenciador; o WebAuthn não tem API para apagá-la.
 */
export interface Diagnostico {
  webauthn: boolean
  plataforma: boolean
  prf: 'ok' | 'sem-prf' | 'cancelado' | 'indisponivel' | 'erro'
  detalhe: string
  ua: string
}

export async function diagnosticarPasskey(): Promise<Diagnostico> {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const base: Diagnostico = { webauthn: false, plataforma: false, prf: 'indisponivel', detalhe: '', ua }

  if (!suportaPasskey()) {
    return { ...base, detalhe: 'Este navegador não expõe a API WebAuthn.' }
  }
  base.webauthn = true
  base.plataforma = await temAutenticadorLocal()

  try {
    // Roda exatamente o caminho real (mesmo registrar + mesmo segredoDaPasskey).
    // Se divergir daqui, o diagnóstico volta a poder mentir.
    const { cred, prfAnunciado } = await registrar({
      id: crypto.getRandomValues(new Uint8Array(16)),
      nome: 'IRPFM · teste de suporte',
    })
    const { segredo } = await segredoDaPasskey(paraB64Url(cred.rawId))
    if (segredo.length >= 32) {
      return { ...base, prf: 'ok', detalhe: `PRF devolveu ${segredo.length} bytes.` }
    }
    return { ...base, prf: 'sem-prf', detalhe: 'O PRF devolveu menos bytes que o necessário.' }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/não fornece a extensão PRF/i.test(msg)) {
      return { ...base, prf: 'sem-prf', detalhe: 'Este autenticador não implementa a extensão PRF.' }
    }
    if (/NotAllowed/i.test(msg)) return { ...base, prf: 'cancelado', detalhe: 'Cancelado ou tempo esgotado.' }
    return { ...base, prf: 'erro', detalhe: msg }
  }
}
