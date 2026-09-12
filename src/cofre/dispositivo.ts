// De que aparelho é a passkey.
//
// A passkey não viaja: ela mora no aparelho onde foi cadastrada. O cofre, sim,
// viaja — vem inteiro pela sincronização, com a lista de métodos junto. O
// resultado é que o Windows abria o cofre trazido do celular oferecendo, como
// botão principal, "Destravar com Android · biometria": um botão que não tem
// como funcionar ali, e que empurra a senha para o rodapé.
//
// Não dá para saber com certeza se uma credencial existe neste aparelho sem
// tentar usá-la. Dá para saber quando ela CLARAMENTE é de outro: o rótulo
// guarda a plataforma de onde saiu.

export type Plataforma = 'ios' | 'android' | 'mac' | 'windows' | 'desconhecida'

export function plataformaDoUA(ua: string): Plataforma {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'windows'
  return 'desconhecida'
}

export function plataformaAtual(): Plataforma {
  return plataformaDoUA(typeof navigator === 'undefined' ? '' : navigator.userAgent)
}

/** Rótulo amigável do aparelho, usado ao cadastrar uma passkey. */
export function rotuloDispositivo(p: Plataforma = plataformaAtual()): string {
  if (p === 'ios') return 'iPhone · Face ID'
  if (p === 'android') return 'Android · biometria'
  if (p === 'mac') return 'Mac · Touch ID'
  if (p === 'windows') return 'Windows Hello'
  return 'Este dispositivo'
}

/** De qual plataforma fala um rótulo já gravado no cofre. */
export function plataformaDoRotulo(rotulo?: string): Plataforma {
  const r = rotulo ?? ''
  if (/iPhone|iPad/i.test(r)) return 'ios'
  if (/Android/i.test(r)) return 'android'
  if (/\bMac\b/i.test(r)) return 'mac'
  if (/Windows/i.test(r)) return 'windows'
  return 'desconhecida'
}

/**
 * A passkey é declaradamente de OUTRO aparelho?
 *
 * Só afirma quando as duas plataformas são conhecidas e diferentes. Rótulo
 * antigo ou genérico ("Este dispositivo") não vira acusação: na dúvida, deixa
 * tentar.
 */
export function deOutroAparelho(rotulo?: string, atual: Plataforma = plataformaAtual()): boolean {
  const dela = plataformaDoRotulo(rotulo)
  return dela !== 'desconhecida' && atual !== 'desconhecida' && dela !== atual
}
