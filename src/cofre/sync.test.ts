import { describe, it, expect } from 'vitest'
import { decidirSync, unirWraps, paraDoc, deDoc } from './sync.js'
import type { Wrap, CofreCompleto } from './crypto.js'

const wrap = (id: string, criadoEm = '2026-01-01T00:00:00.000Z'): Wrap => ({
  wrapId: id,
  metodo: 'passkey',
  kdf: 'hkdf',
  salt: 'c2FsdA==',
  wrappedDek: 'ZW1icnVsaG8=',
  criadoEm,
})

describe('decidirSync', () => {
  it('sobe pela primeira vez quando o servidor não tem nada', () => {
    expect(decidirSync({ baseVersion: null, sujo: true }, null)).toEqual({ acao: 'enviar', motivo: 'primeira-subida' })
  })

  it('não faz nada quando os dois lados estão na mesma versão e nada mudou', () => {
    expect(decidirSync({ baseVersion: 4, sujo: false }, { version: 4, atualizadoEm: 'x' })).toEqual({ acao: 'nada' })
  })

  it('envia quando só o lado local mudou', () => {
    expect(decidirSync({ baseVersion: 4, sujo: true }, { version: 4, atualizadoEm: 'x' })).toEqual({ acao: 'enviar', motivo: 'local-novo' })
  })

  it('baixa quando só o servidor avançou', () => {
    expect(decidirSync({ baseVersion: 4, sujo: false }, { version: 7, atualizadoEm: 'x' })).toEqual({ acao: 'baixar' })
  })

  it('dá conflito quando os DOIS avançaram — ninguém ganha sozinho', () => {
    expect(decidirSync({ baseVersion: 4, sujo: true }, { version: 7, atualizadoEm: 'x' })).toEqual({ acao: 'conflito' })
  })

  it('trata dispositivo novo sem base: baixa se limpo, conflita se já tem edição', () => {
    expect(decidirSync({ baseVersion: null, sujo: false }, { version: 2, atualizadoEm: 'x' })).toEqual({ acao: 'baixar' })
    expect(decidirSync({ baseVersion: null, sujo: true }, { version: 2, atualizadoEm: 'x' })).toEqual({ acao: 'conflito' })
  })

  it('reenvia se o servidor de algum modo voltou atrás', () => {
    expect(decidirSync({ baseVersion: 9, sujo: false }, { version: 3, atualizadoEm: 'x' })).toEqual({ acao: 'enviar', motivo: 'servidor-atrasado' })
  })
})

describe('união de métodos de desbloqueio', () => {
  it('mantém os dois lados — nunca perde o método que só existe num aparelho', () => {
    const juntos = unirWraps([wrap('passkey:windows', '2026-01-02T00:00:00.000Z')], [wrap('passkey:android', '2026-01-01T00:00:00.000Z')])
    expect(juntos.map((w) => w.wrapId)).toEqual(['passkey:android', 'passkey:windows'])
  })

  it('não duplica o mesmo método', () => {
    const juntos = unirWraps([wrap('recuperacao')], [wrap('recuperacao')])
    expect(juntos).toHaveLength(1)
  })

  it('em empate de id, vale o local', () => {
    const local = { ...wrap('senha'), rotulo: 'local' }
    const remoto = { ...wrap('senha'), rotulo: 'remoto' }
    expect(unirWraps([local], [remoto])[0].rotulo).toBe('local')
  })
})

describe('ida e volta do documento', () => {
  it('leva só o texto cifrado, e reconstrói o cofre com os wraps', () => {
    const cofre: CofreCompleto = {
      schemaVersion: 1,
      wraps: [wrap('senha')],
      cofre: { v: 1, iv: 'aXY=', ciphertext: 'Y2lmcmFkbw==' },
    }
    const doc = paraDoc(cofre, 'state', 3)
    expect(doc).toEqual({ docId: 'state', ciphertext: 'Y2lmcmFkbw==', iv: 'aXY=', version: 3 })
    expect(JSON.stringify(doc)).not.toContain('wrappedDek')

    const volta = deDoc({ ...doc, atualizadoEm: 'x' }, cofre.wraps)
    expect(volta).toEqual(cofre)
  })
})

describe('cofres com identidades diferentes', () => {
  it('não compara versões de cofres distintos — isso viraria embrulho que não abre', () => {
    const d = decidirSync({ baseVersion: 4, sujo: false }, { version: 9, atualizadoEm: 'x', vaultId: 'REMOTO' }, 'LOCAL')
    expect(d).toEqual({ acao: 'cofres-diferentes' })
  })

  it('segue normal quando é o mesmo cofre', () => {
    const d = decidirSync({ baseVersion: 4, sujo: false }, { version: 9, atualizadoEm: 'x', vaultId: 'IGUAL' }, 'IGUAL')
    expect(d).toEqual({ acao: 'baixar' })
  })

  it('um lado com id e o outro sem também exige escolha — parentesco não provado', () => {
    // Era aqui que o cofre corrompia: "baixar" com o servidor anterior ao id
    // montava um cofre com o conteúdo do servidor e os embrulhos locais. Se as
    // chaves fossem diferentes, todo método passava a abrir o embrulho e falhar
    // no conteúdo — "chave errada" com a chave certa na mão, sem volta.
    expect(decidirSync({ baseVersion: 4, sujo: false }, { version: 9, atualizadoEm: 'x' }, 'LOCAL')).toEqual({ acao: 'cofres-diferentes' })
    expect(decidirSync({ baseVersion: 4, sujo: false }, { version: 9, atualizadoEm: 'x', vaultId: 'R' }, undefined)).toEqual({ acao: 'cofres-diferentes' })
  })

  it('dois lados sem id (era pré-id dos dois) seguem pelas versões — não há o que comparar', () => {
    expect(decidirSync({ baseVersion: 4, sujo: false }, { version: 9, atualizadoEm: 'x' }, undefined)).toEqual({ acao: 'baixar' })
  })
})
