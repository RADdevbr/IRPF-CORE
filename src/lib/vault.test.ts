import { describe, it, expect, beforeEach } from 'vitest'
import {
  criarCofreLocal,
  destravarLocal,
  salvarCifrado,
  adicionarMetodoLocal,
  removerMetodoLocal,
  motivoParaNaoRemover,
  existeCofre,
  metodos,
  estadoLegado,
  apagarCofre,
  lembrarDek,
  dekLembrada,
  esquecerDek,
  type Store,
} from './vault'
import { gerarCodigoRecuperacao } from './crypto'
import type { PersistedState } from './storage'

// Storage falso — o vault recebe o adaptador, então roda em Node sem DOM.
function fakeStore(): Store & { dump: () => Record<string, string> } {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  }
}

const AGORA = '2026-08-23T20:00:00.000Z'
const ESTADO = {
  vals: { salario: 180000, divBR: 840000, cdb: 60000 },
  ndep: 2,
  cdbA: null,
  red: false,
  aliqEmp: 0,
  limR: 0.34,
} as unknown as PersistedState

const passkey = () => new Uint8Array(32).fill(3)

describe('cofre local', () => {
  let st: ReturnType<typeof fakeStore>
  let codigo: string

  const montar = () =>
    criarCofreLocal(
      ESTADO,
      { wrapId: 'passkey:abc', metodo: 'passkey', rotulo: 'iPhone · Face ID', segredo: passkey() },
      { wrapId: 'recuperacao', metodo: 'recuperacao', segredo: codigo },
      AGORA,
      st,
    )

  beforeEach(() => {
    st = fakeStore()
    codigo = gerarCodigoRecuperacao()
  })

  it('nasce com dois métodos — a regra dos dois caminhos vale desde o início', async () => {
    await montar()
    expect(existeCofre(st)).toBe(true)
    expect(metodos(st).map((w) => w.wrapId)).toEqual(['passkey:abc', 'recuperacao'])
  })

  it('não deixa rastro do estado em claro no armazenamento', async () => {
    st.setItem('irpfm2027:state:v1', JSON.stringify(ESTADO))
    await montar()
    const tudo = JSON.stringify(st.dump())
    expect(tudo).not.toContain('840000')
    expect(tudo).not.toContain('salario')
    expect(estadoLegado(st)).toBeNull() // migrado e só então apagado
  })

  it('destrava pelos dois métodos e devolve o mesmo estado', async () => {
    await montar()
    const a = await destravarLocal('passkey:abc', passkey(), st)
    const b = await destravarLocal('recuperacao', codigo, st)
    expect(a.dados).toEqual(ESTADO)
    expect(b.dados).toEqual(ESTADO)
    expect(a.dek).toEqual(b.dek)
  })

  it('autosave re-cifra sem mexer nos métodos', async () => {
    const { dek } = await montar()
    const novo = { ...ESTADO, ndep: 5 }
    await salvarCifrado(dek, novo, st)
    const { dados } = await destravarLocal('recuperacao', codigo, st)
    expect(dados.ndep).toBe(5)
    expect(metodos(st)).toHaveLength(2)
  })

  it('recusa segredo errado', async () => {
    await montar()
    await expect(destravarLocal('passkey:abc', new Uint8Array(32).fill(9), st)).rejects.toThrow()
    await expect(destravarLocal('recuperacao', gerarCodigoRecuperacao(), st)).rejects.toThrow()
  })

  it('adiciona um terceiro método que abre o mesmo cofre', async () => {
    const { dek } = await montar()
    await adicionarMetodoLocal(dek, { wrapId: 'senha', metodo: 'senha', segredo: 'alternativa-77' }, AGORA, st)
    const { dados } = await destravarLocal('senha', 'alternativa-77', st)
    expect(dados).toEqual(ESTADO)
    expect(metodos(st)).toHaveLength(3)
  })

  it('recusa cadastrar o mesmo método duas vezes', async () => {
    const { dek } = await montar()
    await expect(adicionarMetodoLocal(dek, { wrapId: 'passkey:abc', metodo: 'passkey', segredo: passkey() }, AGORA, st)).rejects.toThrow(/já está cadastrado/i)
  })

  it('não deixa cair para um único método', async () => {
    await montar()
    expect(motivoParaNaoRemover('passkey:abc', st)).toMatch(/pelo menos dois/i)
    expect(() => removerMetodoLocal('passkey:abc', st)).toThrow(/pelo menos dois/i)
    expect(metodos(st)).toHaveLength(2)
  })

  it('permite remover quando há três, e o cofre continua abrindo', async () => {
    const { dek } = await montar()
    await adicionarMetodoLocal(dek, { wrapId: 'senha', metodo: 'senha', segredo: 'alternativa-77' }, AGORA, st)
    expect(motivoParaNaoRemover('senha', st)).toBeNull()
    removerMetodoLocal('senha', st)
    expect(metodos(st)).toHaveLength(2)
    const { dados } = await destravarLocal('passkey:abc', passkey(), st)
    expect(dados).toEqual(ESTADO)
  })

  it('esquecer o dispositivo apaga o cofre local', async () => {
    await montar()
    apagarCofre(st, fakeStore())
    expect(existeCofre(st)).toBe(false)
  })
})

describe('sessão "confiar neste dispositivo"', () => {
  it('guarda e devolve a DEK, e some ao esquecer', () => {
    const ss = fakeStore()
    const dek = new Uint8Array(32).fill(11)
    expect(dekLembrada(ss)).toBeNull()
    lembrarDek(dek, ss)
    expect(dekLembrada(ss)).toEqual(dek)
    esquecerDek(ss)
    expect(dekLembrada(ss)).toBeNull()
  })
})

describe('sessão lembrada', () => {
  it('lê o cofre direto com a DEK, sem pedir segredo de novo', async () => {
    const st = fakeStore()
    const codigo = gerarCodigoRecuperacao()
    const { dek } = await criarCofreLocal(
      ESTADO,
      { wrapId: 'passkey:abc', metodo: 'passkey', segredo: passkey() },
      { wrapId: 'recuperacao', metodo: 'recuperacao', segredo: codigo },
      AGORA,
      st,
    )
    const { lerDadosCifrados } = await import('./vault')
    expect(await lerDadosCifrados(dek, st)).toEqual(ESTADO)
    await expect(lerDadosCifrados(new Uint8Array(32).fill(1), st)).rejects.toThrow()
  })
})

describe('memória do suporte a PRF', () => {
  it('guarda, devolve e esquece o resultado do diagnóstico', async () => {
    const { lembrarSuportePrf, suportePrfLembrado } = await import('./vault')
    const st = fakeStore()
    expect(suportePrfLembrado(st)).toBe('desconhecido')
    lembrarSuportePrf('nao', st)
    expect(suportePrfLembrado(st)).toBe('nao')
    lembrarSuportePrf('ok', st)
    expect(suportePrfLembrado(st)).toBe('ok')
    lembrarSuportePrf('desconhecido', st)
    expect(suportePrfLembrado(st)).toBe('desconhecido')
  })

  it('trata valor corrompido como desconhecido', async () => {
    const { suportePrfLembrado } = await import('./vault')
    const st = fakeStore()
    st.setItem('irpfm2027:prf:v1', 'talvez')
    expect(suportePrfLembrado(st)).toBe('desconhecido')
  })
})
