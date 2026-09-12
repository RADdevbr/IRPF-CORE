// @vitest-environment jsdom
//
// O que este arquivo testa mudou de escopo junto com o módulo. Antes ele provava
// que `migrarEstado` tratava certo cada campo do estado do app de IRPFM — o
// `b3Emissor`, o `proventosB3`, o acervo de arquivos. Esses campos continuam
// existindo, e os testes deles continuam existindo: no app que é dono deles.
//
// Aqui fica o que vale para QUALQUER app da família: onde grava, o que faz com
// arquivo de uma versão futura, a lista de cenários, e a promessa do modo visita.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  criarPersistencia,
  conferirEnvelope,
  somenteNumeros,
  num,
  setModoVisita,
  chavesGravadas,
  apagarTudoDesteAparelho,
  type EstadoVersionado,
} from './persistencia'

const VERSAO = 2

interface Estado extends EstadoVersionado {
  vals: Record<string, number>
  mesRef?: number
  /** Bloco grande e desconhecido daqui — tem de atravessar inteiro. */
  qualquer?: unknown
}

/** Um app de mentira, com a migração que um app de verdade escreveria. */
function migrar(bruto: unknown): Estado {
  const o = conferirEnvelope(bruto, VERSAO)
  if (!o.vals || typeof o.vals !== 'object' || Array.isArray(o.vals)) {
    throw new Error('Arquivo inválido: falta o campo "vals" com as fontes de renda.')
  }
  return {
    ...(o as unknown as Estado),
    schemaVersion: VERSAO,
    vals: somenteNumeros(o.vals),
    mesRef: Math.min(12, Math.max(1, Math.round(num(o.mesRef, 6)))),
  }
}

const P = criarPersistencia<Estado>({ versao: VERSAO, migrar })
const est = (cdb: number): Estado => ({ vals: { cdb } })

describe('a porta de entrada do estado', () => {
  it('carimba a versão corrente no que vem sem versão', () => {
    expect(P.migrarEstado({ vals: { salario: 100 } }).schemaVersion).toBe(VERSAO)
  })

  it('recusa arquivo de formato futuro dizendo o porquê', () => {
    expect(() => P.migrarEstado({ vals: {}, schemaVersion: VERSAO + 1 })).toThrow(/versão mais nova/i)
  })

  it('recusa o que não é objeto', () => {
    expect(() => P.migrarEstado('nada')).toThrow(/não é um objeto/i)
    expect(() => P.migrarEstado([1, 2])).toThrow(/não é um objeto/i)
  })

  it('descarta valor de fonte que não é número finito', () => {
    const e = P.migrarEstado({ vals: { a: 10, b: 'x', c: NaN, d: Infinity } })
    expect(e.vals).toEqual({ a: 10 })
  })

  // O que o núcleo não conhece precisa passar: cada app tem campos que este
  // módulo nunca vai listar, e listar seria a forma de perdê-los no reload.
  it('preserva os campos que não conhece', () => {
    const e = P.migrarEstado({ vals: {}, qualquer: { fundo: [1, 2, 3] } })
    expect(e.qualquer).toEqual({ fundo: [1, 2, 3] })
  })

  it('é idempotente: migrar de novo não muda nada', () => {
    const uma = P.migrarEstado({ vals: { a: 1 }, mesRef: 99 })
    expect(P.migrarEstado(uma)).toEqual(uma)
  })
})

describe('cenários', () => {
  const vazio: ReturnType<typeof P.loadScenarios> = []

  it('grava a versão do formato junto do cenário', () => {
    const l = P.upsertScenario(vazio, 'x', est(1), 'agora')
    expect(l[0].state.schemaVersion).toBe(VERSAO)
  })

  it('substitui pelo nome e mantém a lista ordenada', () => {
    let l = P.upsertScenario(vazio, 'beta', est(1), 'a')
    l = P.upsertScenario(l, 'alfa', est(2), 'b')
    l = P.upsertScenario(l, 'beta', est(3), 'c')
    expect(l.map((s) => s.name)).toEqual(['alfa', 'beta'])
    expect(l.find((s) => s.name === 'beta')!.state.vals.cdb).toBe(3)
  })

  it('remove pelo nome', () => {
    const l = P.upsertScenario(vazio, 'x', est(1), 'a')
    expect(P.removeScenario(l, 'x')).toEqual([])
  })

  it('um cenário corrompido não leva os outros junto', () => {
    localStorage.setItem(
      'teste:scenarios:v1',
      JSON.stringify([{ name: 'bom', savedAt: 'a', state: { vals: { cdb: 1 } } }, { name: 'ruim', savedAt: 'a', state: 7 }]),
    )
    expect(P.loadScenarios().map((s) => s.name)).toEqual(['bom'])
  })
})

describe('modo visita', () => {
  beforeEach(() => {
    localStorage.clear()
    setModoVisita(false)
  })

  it('desligado, grava normalmente', () => {
    P.saveState(est(1))
    expect(localStorage.getItem('teste:state:v1')).toBeTruthy()
  })

  it('ligado, não deixa rastro no aparelho', () => {
    setModoVisita(true)
    P.saveState(est(1))
    P.saveScenarios([{ name: 'x', savedAt: 'agora', state: est(0) }])
    expect(chavesGravadas()).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  // O modo grava em memória, não no vazio: quem digita precisa ler de volta o
  // que digitou enquanto a aba está aberta. O que ele promete é que nada disso
  // sobrevive ao fechar — e é o disco que responde por isso.
  it('ligado, o que foi digitado continua legível na sessão', () => {
    setModoVisita(true)
    P.saveState(est(7))
    expect(P.loadState()?.vals.cdb).toBe(7)
    expect(localStorage.getItem('teste:state:v1')).toBeNull()
  })

  it('não apaga o que já estava gravado — só para de gravar', () => {
    P.saveState(est(1))
    setModoVisita(true)
    P.saveState(est(2))
    // o disco continua com o 1: o 2 só existe nesta sessão
    expect(JSON.parse(localStorage.getItem('teste:state:v1')!).vals.cdb).toBe(1)
    // e desligar o modo devolve a leitura ao disco
    setModoVisita(false)
    expect(P.loadState()?.vals.cdb).toBe(1)
  })
})

describe('apagar tudo deste aparelho', () => {
  it('varre a família inteira de chaves, não só estado e cenários', () => {
    localStorage.clear()
    setModoVisita(false)
    localStorage.setItem('teste:state:v1', '{}')
    localStorage.setItem('teste:vault:v1', 'x')
    localStorage.setItem('teste:dek:v1', 'x')
    localStorage.setItem('outro-app:coisa', 'fica')

    expect(apagarTudoDesteAparelho()).toBe(3)
    expect(chavesGravadas()).toEqual([])
    expect(localStorage.getItem('outro-app:coisa')).toBe('fica')
  })

  // A separação por prefixo é o que deixa os três apps da família dividirem um
  // navegador. Sem ela, «apagar deste aparelho» num deles levaria os outros dois.
  it('não alcança as chaves de outro app da mesma família', () => {
    localStorage.clear()
    setModoVisita(false)
    localStorage.setItem('teste:state:v1', '{}')
    localStorage.setItem('outroapp:state:v1', 'fica')
    localStorage.setItem('outroapp:vault:v1', 'fica')

    expect(apagarTudoDesteAparelho()).toBe(1)
    expect(localStorage.getItem('outroapp:state:v1')).toBe('fica')
    expect(localStorage.getItem('outroapp:vault:v1')).toBe('fica')
  })
})
