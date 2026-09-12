import { describe, it, expect } from 'vitest'
import { docDaLinha, wrapDaLinha, linhaDoWrap, mensagemDeLogin, type LinhaVault, type LinhaWrap } from './remoto.js'
import type { Wrap } from './crypto.js'

// A conversa com a rede não dá para testar aqui; a tradução entre as colunas do
// Postgres e os tipos do app dá — e é onde um campo trocado passaria despercebido.

const linhaVault: LinhaVault = {
  doc_id: 'state',
  ciphertext: 'Y2lmcmFkbw==',
  iv: 'aXY=',
  version: 3,
  updated_at: '2026-08-23T20:00:00.000Z',
}

const linhaWrap: LinhaWrap = {
  wrap_id: 'passkey:abc',
  metodo: 'passkey',
  rotulo: 'Windows Hello',
  kdf: 'hkdf',
  kdf_params: null,
  salt: 'c2FsdA==',
  wrapped_dek: 'ZW1icnVsaG8=',
  criado_em: '2026-08-23T19:00:00.000Z',
}

describe('tradução das linhas do banco', () => {
  it('converte a linha do cofre', () => {
    expect(docDaLinha(linhaVault)).toEqual({
      docId: 'state',
      ciphertext: 'Y2lmcmFkbw==',
      iv: 'aXY=',
      version: 3,
      atualizadoEm: '2026-08-23T20:00:00.000Z',
    })
  })

  it('converte a linha do embrulho, trocando null por undefined', () => {
    const w = wrapDaLinha(linhaWrap)
    expect(w.wrapId).toBe('passkey:abc')
    expect(w.rotulo).toBe('Windows Hello')
    expect(w.kdfParams).toBeUndefined()
    expect(wrapDaLinha({ ...linhaWrap, rotulo: null }).rotulo).toBeUndefined()
  })

  it('volta ao formato do banco sem perder campo', () => {
    const w: Wrap = {
      wrapId: 'senha',
      metodo: 'senha',
      rotulo: 'Senha',
      kdf: 'argon2id',
      kdfParams: { m: 65536, t: 3, p: 1 },
      salt: 'c2FsdA==',
      wrappedDek: 'ZW1icnVsaG8=',
      criadoEm: '2026-08-23T19:30:00.000Z',
    }
    const linha = linhaDoWrap(w, 'user-1')
    expect(linha).toEqual({
      user_id: 'user-1',
      wrap_id: 'senha',
      metodo: 'senha',
      rotulo: 'Senha',
      kdf: 'argon2id',
      kdf_params: { m: 65536, t: 3, p: 1 },
      salt: 'c2FsdA==',
      wrapped_dek: 'ZW1icnVsaG8=',
      dek_id: null,
      criado_em: '2026-08-23T19:30:00.000Z',
    })
    expect(wrapDaLinha(linha)).toEqual(w)
  })
})

describe('erro de login vira frase que explica', () => {
  it('conta barrada pelo banco não pode parecer defeito do app', () => {
    // é isso que o Supabase devolve quando o gatilho recusa a conta
    const m = mensagemDeLogin('Database error saving new user')
    expect(m).toMatch(/por convite/)
    expect(m).toMatch(/código/)
    // e diz o que fazer quem já tem conta e só errou o e-mail
    expect(m).toMatch(/entra sem código/)
  })

  it('cadastro desligado no painel dá a mesma explicação', () => {
    expect(mensagemDeLogin('Signups not allowed for otp')).toMatch(/por convite/)
  })

  it('excesso de tentativas é outro problema, e outra frase', () => {
    expect(mensagemDeLogin('Email rate limit exceeded')).toMatch(/Espere um minuto/)
  })

  it('o que não sabe traduzir, repassa inteiro em vez de engolir', () => {
    expect(mensagemDeLogin('Falha esquisita do servidor')).toBe('Falha esquisita do servidor')
  })
})
