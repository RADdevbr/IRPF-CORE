import { describe, it, expect, beforeEach } from 'vitest'
import { sincronizar, resolverComLocal, resolverComRemoto } from './syncCofre.js'
import { ConflitoDeVersao, type DocRemoto, type Remoto, type EstadoSync } from './sync.js'
import type { CofreCompleto, Wrap } from './crypto.js'

// Servidor falso, em memória: deixa exercitar o fluxo inteiro — inclusive os
// caminhos que dão medo (conflito, cofres diferentes) — sem rede nenhuma.
function servidorFalso(inicial?: { doc?: DocRemoto; wraps?: Wrap[] }) {
  let doc = inicial?.doc ?? null
  let wraps = inicial?.wraps ?? []
  const r: Remoto = {
    usuario: async () => ({ email: 'eu@exemplo.com' }),
    enviarCodigo: async () => {},
    conferirCodigo: async () => {},
    sair: async () => {},
    lerDoc: async () => doc,
    // Como o servidor de verdade: a escrita só passa se a versão que estava lá
    // ainda for a que o cliente leu.
    gravarDoc: async (d) => {
      const esperada = d.version - 1
      const atual = doc?.version ?? 0
      if (atual !== esperada) throw new ConflitoDeVersao(d.docId)
      doc = { ...d, atualizadoEm: '2026-08-23T21:00:00.000Z' }
      return doc
    },
    lerWraps: async () => wraps,
    gravarWraps: async (w) => {
      wraps = w
    },
  }
  return { r, estado: () => ({ doc, wraps }) }
}

const wrap = (id: string, criadoEm = '2026-01-01T00:00:00.000Z'): Wrap => ({
  wrapId: id,
  metodo: id.startsWith('passkey') ? 'passkey' : 'senha',
  kdf: 'hkdf',
  salt: 'c2FsdA==',
  wrappedDek: 'ZW1icnVsaG8=',
  criadoEm,
})

const cofre = (vaultId: string, wraps: Wrap[], ciphertext = 'Y2lmcmFkbw=='): CofreCompleto => ({
  schemaVersion: 1,
  vaultId,
  wraps,
  cofre: { v: 1, iv: 'aXY=', ciphertext },
})

const LIMPO: EstadoSync = { baseVersion: null, sujo: false }

describe('primeira sincronização', () => {
  it('sobe o cofre local quando a conta está vazia', async () => {
    const { r, estado } = servidorFalso()
    const local = cofre('V1', [wrap('senha'), wrap('recuperacao')])
    const res = await sincronizar(r, local, { baseVersion: null, sujo: true })
    expect(res.acao).toBe('enviar')
    expect(res.estado).toEqual({ baseVersion: 1, sujo: false })
    expect(estado().doc?.ciphertext).toBe('Y2lmcmFkbw==')
    expect(estado().doc?.vaultId).toBe('V1')
    expect(estado().wraps.map((w) => w.wrapId).sort()).toEqual(['recuperacao', 'senha'])
  })

  it('traz o cofre num aparelho que ainda não tem nada', async () => {
    const { r } = servidorFalso({
      doc: { docId: 'state', ciphertext: 'ZG9zZXJ2aWRvcg==', iv: 'aXY=', version: 5, atualizadoEm: 'x', vaultId: 'V1' },
      wraps: [wrap('senha'), wrap('recuperacao')],
    })
    const res = await sincronizar(r, null, LIMPO)
    expect(res.acao).toBe('baixar')
    expect(res.cofre?.cofre.ciphertext).toBe('ZG9zZXJ2aWRvcg==')
    expect(res.cofre?.wraps).toHaveLength(2)
    expect(res.estado).toEqual({ baseVersion: 5, sujo: false })
    expect(res.mensagem).toMatch(/destrave/i)
  })
})

describe('métodos de desbloqueio entre aparelhos', () => {
  it('ao enviar, preserva a passkey que só existia no servidor', async () => {
    const { r, estado } = servidorFalso({
      doc: { docId: 'state', ciphertext: 'YQ==', iv: 'aXY=', version: 2, atualizadoEm: 'x', vaultId: 'V1' },
      wraps: [wrap('passkey:android', '2026-01-01T00:00:00.000Z'), wrap('recuperacao')],
    })
    const local = cofre('V1', [wrap('passkey:windows', '2026-02-01T00:00:00.000Z'), wrap('recuperacao')], 'bm92bw==')
    const res = await sincronizar(r, local, { baseVersion: 2, sujo: true })
    expect(res.acao).toBe('enviar')
    const ids = estado().wraps.map((w) => w.wrapId).sort()
    expect(ids).toEqual(['passkey:android', 'passkey:windows', 'recuperacao'])
    expect(res.cofre?.wraps).toHaveLength(3)
  })

  it('ao baixar, mantém a passkey local — ela abre a mesma chave', async () => {
    const { r } = servidorFalso({
      doc: { docId: 'state', ciphertext: 'ZG9zZXJ2aWRvcg==', iv: 'aXY=', version: 8, atualizadoEm: 'x', vaultId: 'V1' },
      wraps: [wrap('passkey:android'), wrap('recuperacao')],
    })
    const local = cofre('V1', [wrap('passkey:windows'), wrap('recuperacao')])
    const res = await sincronizar(r, local, { baseVersion: 4, sujo: false })
    expect(res.acao).toBe('baixar')
    expect(res.cofre?.wraps.map((w) => w.wrapId).sort()).toEqual(['passkey:android', 'passkey:windows', 'recuperacao'])
  })
})

describe('conflito', () => {
  let servidor: ReturnType<typeof servidorFalso>
  const local = cofre('V1', [wrap('senha'), wrap('recuperacao')], 'bG9jYWw=')

  beforeEach(() => {
    servidor = servidorFalso({
      doc: { docId: 'state', ciphertext: 'cmVtb3Rv', iv: 'aXY=', version: 9, atualizadoEm: 'x', vaultId: 'V1' },
      wraps: [wrap('senha'), wrap('recuperacao')],
    })
  })

  it('não escolhe sozinho quando os dois lados mudaram', async () => {
    const res = await sincronizar(servidor.r, local, { baseVersion: 4, sujo: true })
    expect(res.acao).toBe('conflito')
    expect(res.remoto?.version).toBe(9)
    expect(servidor.estado().doc?.ciphertext).toBe('cmVtb3Rv') // nada foi gravado
  })

  it('resolve mantendo o local, com versão acima da do servidor', async () => {
    const res = await resolverComLocal(servidor.r, local)
    expect(res.estado.baseVersion).toBe(10)
    expect(servidor.estado().doc?.ciphertext).toBe('bG9jYWw=')
  })

  it('resolve trazendo o remoto', async () => {
    const res = await resolverComRemoto(servidor.r, local)
    expect(res.cofre?.cofre.ciphertext).toBe('cmVtb3Rv')
    expect(res.estado.baseVersion).toBe(9)
  })
})

describe('cofres criados separadamente', () => {
  const servidor = () =>
    servidorFalso({
      doc: { docId: 'state', ciphertext: 'b3V0cm8=', iv: 'aXY=', version: 3, atualizadoEm: 'x', vaultId: 'OUTRO' },
      wraps: [wrap('senha')],
    })

  it('recusa unir chaves diferentes e explica por quê', async () => {
    const { r, estado } = servidor()
    const res = await sincronizar(r, cofre('MEU', [wrap('passkey:windows')]), { baseVersion: null, sujo: true })
    expect(res.acao).toBe('cofres-diferentes')
    expect(res.mensagem).toMatch(/juntar não é possível/i)
    expect(estado().doc?.vaultId).toBe('OUTRO') // nada tocado
  })

  it('ao escolher um lado, NÃO mistura os métodos dos dois cofres', async () => {
    const { r, estado } = servidor()
    const meu = cofre('MEU', [wrap('passkey:windows'), wrap('recuperacao')])
    await resolverComLocal(r, meu, 'state', false)
    expect(estado().wraps.map((w) => w.wrapId).sort()).toEqual(['passkey:windows', 'recuperacao'])
    expect(estado().doc?.vaultId).toBe('MEU')
  })

  it('conta vazia diz o que fazer, não só que não há nada', async () => {
    const r = servidorFalso().r
    const res = await sincronizar(r, null, LIMPO)
    expect(res.acao).toBe('nada')
    // quem lê isto é alguém no aparelho novo esperando os dados do outro
    expect(res.mensagem).toMatch(/aparelho onde estão os dados/)
    expect(res.mensagem).toMatch(/Sincronizar agora/)
  })
})


describe('corrida entre dois aparelhos', () => {
  // O caso que o `upsert` sem condição perdia em silêncio: dois aparelhos leem
  // a versão 1, os dois gravam a 2, e o segundo apagava o primeiro.
  it('quem chega depois vira conflito em vez de sobrescrever', async () => {
    const doc: DocRemoto = {
      docId: 'state',
      ciphertext: 'do-servidor',
      iv: 'iv',
      version: 1,
      atualizadoEm: '2026-08-23T20:00:00.000Z',
      vaultId: 'v1',
    }
    const { r, estado } = servidorFalso({ doc })
    const local = cofre('v1', [wrap('senha'), wrap('recuperacao')], 'do-aparelho-B')

    // o aparelho A grava primeiro, direto no servidor falso
    await r.gravarDoc({ docId: 'state', ciphertext: 'do-aparelho-A', iv: 'iv', version: 2, vaultId: 'v1' })

    // o aparelho B ainda pensa que a base é a 1 e tenta enviar a 2
    const res = await sincronizar(r, local, { baseVersion: 1, sujo: true })

    expect(res.acao).toBe('conflito')
    expect(res.mensagem).toContain('outro aparelho')
    // e o que o A gravou continua lá, inteiro
    expect(estado().doc?.ciphertext).toBe('do-aparelho-A')
  })

  it('sem corrida, o envio passa e a base avança', async () => {
    const doc: DocRemoto = {
      docId: 'state',
      ciphertext: 'antigo',
      iv: 'iv',
      version: 1,
      atualizadoEm: '2026-08-23T20:00:00.000Z',
      vaultId: 'v1',
    }
    const { r, estado } = servidorFalso({ doc })
    const res = await sincronizar(r, cofre('v1', [wrap('senha'), wrap('recuperacao')], 'novo'), { baseVersion: 1, sujo: true })
    expect(res.acao).toBe('enviar')
    expect(res.estado.baseVersion).toBe(2)
    expect(estado().doc?.ciphertext).toBe('novo')
  })
})
