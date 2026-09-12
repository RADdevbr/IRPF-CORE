import { describe, it, expect } from 'vitest'
import { plataformaDoUA, plataformaDoRotulo, rotuloDispositivo, deOutroAparelho } from './dispositivo'

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
}

describe('de que aparelho é', () => {
  it('lê a plataforma do user agent', () => {
    expect(plataformaDoUA(UA.android)).toBe('android')
    expect(plataformaDoUA(UA.windows)).toBe('windows')
    expect(plataformaDoUA(UA.iphone)).toBe('ios')
    expect(plataformaDoUA(UA.mac)).toBe('mac')
    expect(plataformaDoUA('curl/8.0')).toBe('desconhecida')
  })

  it('iPhone é iOS, não Mac — o UA dele cita "Mac OS X"', () => {
    expect(plataformaDoUA(UA.iphone)).not.toBe('mac')
  })

  it('o rótulo gravado no cofre diz de onde a passkey saiu', () => {
    expect(plataformaDoRotulo(rotuloDispositivo('android'))).toBe('android')
    expect(plataformaDoRotulo(rotuloDispositivo('windows'))).toBe('windows')
    expect(plataformaDoRotulo(rotuloDispositivo('ios'))).toBe('ios')
    expect(plataformaDoRotulo(rotuloDispositivo('mac'))).toBe('mac')
  })
})

describe('passkey de outro aparelho', () => {
  it('reconhece o caso que motivou isto: cofre do Android aberto no Windows', () => {
    expect(deOutroAparelho('Android · biometria', 'windows')).toBe(true)
  })

  it('no aparelho de origem, segue sendo a passkey de casa', () => {
    expect(deOutroAparelho('Android · biometria', 'android')).toBe(false)
    expect(deOutroAparelho('Windows Hello', 'windows')).toBe(false)
  })

  it('na dúvida não acusa: rótulo genérico ou plataforma que não dá para ler', () => {
    // rótulo antigo, de antes de existir nome de aparelho
    expect(deOutroAparelho('Este dispositivo', 'windows')).toBe(false)
    expect(deOutroAparelho(undefined, 'windows')).toBe(false)
    expect(deOutroAparelho('Android · biometria', 'desconhecida')).toBe(false)
  })
})
