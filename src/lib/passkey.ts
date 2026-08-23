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
export async function criarPasskey(usuario: { id: string; email: string }): Promise<CredencialCriada> {
  if (!suportaPasskey()) throw new Error('Este navegador não suporta passkey.')
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: RP_NOME },
      user: {
        id: new TextEncoder().encode(usuario.id),
        name: usuario.email,
        displayName: usuario.email,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: 60_000,
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('Registro da passkey cancelado.')

  // `enabled` diz se o autenticador topa o PRF. Alguns só devolvem o valor no
  // get() seguinte — por isso aqui só verificamos a disponibilidade.
  const ext = cred.getClientExtensionResults() as { prf?: { enabled?: boolean } }
  return { credentialId: paraB64Url(cred.rawId), prfDisponivel: ext.prf?.enabled !== false }
}

/**
 * Pede ao autenticador os 32 bytes do PRF. Mesma credencial + mesmo salt =
 * sempre os mesmos bytes; é isso que faz a KEK ser reproduzível sem guardar nada.
 */
export async function segredoDaPasskey(credentialId?: string): Promise<{ credentialId: string; segredo: Uint8Array }> {
  if (!suportaPasskey()) throw new Error('Este navegador não suporta passkey.')
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: credentialId ? [{ type: 'public-key', id: deB64Url(credentialId) as BufferSource }] : undefined,
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
