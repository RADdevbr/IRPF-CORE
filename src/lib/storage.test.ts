// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  SCHEMA_VERSION,
  migrarEstado,
  upsertScenario,
  removeScenario,
  saveState,
  loadState,
  saveScenarios,
  setModoVisita,
  chavesGravadas,
  apagarTudoDesteAparelho,
  type PersistedState,
} from './storage'

const minimo = { vals: { salario: 100 } }

describe('migrarEstado', () => {
  it('carimba a versão corrente no que vem sem versão (formato 1)', () => {
    expect(migrarEstado(minimo).schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('recusa arquivo de formato futuro dizendo o porquê', () => {
    expect(() => migrarEstado({ ...minimo, schemaVersion: SCHEMA_VERSION + 1 })).toThrow(
      /versão mais nova/i,
    )
  })

  it('recusa o que não é objeto ou não tem as fontes de renda', () => {
    expect(() => migrarEstado(null)).toThrow(/objeto JSON/i)
    expect(() => migrarEstado([1, 2])).toThrow(/objeto JSON/i)
    expect(() => migrarEstado('{}')).toThrow(/objeto JSON/i)
    expect(() => migrarEstado({})).toThrow(/vals/)
    expect(() => migrarEstado({ vals: 'nada' })).toThrow(/vals/)
  })

  it('descarta valor de fonte que não é número finito', () => {
    const r = migrarEstado({
      vals: { salario: 100, lixo: 'x', nan: NaN, inf: Infinity, ok: 0 },
    })
    expect(r.vals).toEqual({ salario: 100, ok: 0 })
  })

  it('traz mesRef para dentro de 1..12 — fora disso a projeção inteira quebra', () => {
    expect(migrarEstado({ ...minimo, mesRef: 0 }).mesRef).toBe(1)
    expect(migrarEstado({ ...minimo, mesRef: 99 }).mesRef).toBe(12)
    expect(migrarEstado({ ...minimo, mesRef: 6.4 }).mesRef).toBe(6)
    expect(migrarEstado({ ...minimo, mesRef: 'junho' }).mesRef).toBe(6)
  })

  it('normaliza os primitivos que o app usa como número', () => {
    const r = migrarEstado({ ...minimo, ndep: -3.7, aliqEmp: 'x', limR: null, cdbA: 'x', red: 1 })
    expect(r.ndep).toBe(0)
    expect(r.aliqEmp).toBe(0)
    expect(r.limR).toBe(0.34)
    expect(r.cdbA).toBeNull()
    expect(r.red).toBe(true)
  })

  it('preserva os blocos grandes e os campos que não conhece', () => {
    const bruto = {
      ...minimo,
      historico: { anos: [{ exercicio: 2024 }] },
      carteira: { positions: [{ id: 1 }] },
      campoDeVersaoFutura: { a: 1 },
    }
    const r = migrarEstado(bruto) as PersistedState & { campoDeVersaoFutura: unknown }
    expect(r.historico).toEqual(bruto.historico)
    expect(r.carteira).toEqual(bruto.carteira)
    expect(r.campoDeVersaoFutura).toEqual({ a: 1 })
  })

  it('é idempotente: migrar de novo não muda nada', () => {
    const uma = migrarEstado({ ...minimo, mesRef: 3, ndep: 2 })
    expect(migrarEstado(uma)).toEqual(uma)
  })
})

describe('cenários', () => {
  const estado = migrarEstado({ vals: { salario: 1 } })

  it('grava a versão do formato junto do cenário', () => {
    const [c] = upsertScenario([], 'A', estado, 'agora')
    expect(c.state.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('substitui pelo nome e mantém a lista ordenada', () => {
    let l = upsertScenario([], 'Zé', estado, 't1')
    l = upsertScenario(l, 'Ana', estado, 't2')
    l = upsertScenario(l, 'Zé', migrarEstado({ vals: { salario: 2 } }), 't3')
    expect(l.map((s) => s.name)).toEqual(['Ana', 'Zé'])
    expect(l[1].state.vals.salario).toBe(2)
    expect(l[1].savedAt).toBe('t3')
  })

  it('remove pelo nome', () => {
    const l = upsertScenario(upsertScenario([], 'A', estado, 't'), 'B', estado, 't')
    expect(removeScenario(l, 'A').map((s) => s.name)).toEqual(['B'])
  })
})

describe('modo visita', () => {
  beforeEach(() => {
    localStorage.clear()
    setModoVisita(false)
  })

  it('desligado, grava normalmente', () => {
    saveState({ vals: { cdb: 1 }, ndep: 0, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 })
    expect(localStorage.getItem('irpfm2027:state:v1')).toBeTruthy()
  })

  it('ligado, não deixa rastro no aparelho', () => {
    setModoVisita(true)
    saveState({ vals: { cdb: 1 }, ndep: 0, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 })
    saveScenarios([{ name: 'x', savedAt: 'agora', state: { vals: {}, ndep: 0, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 } }])
    expect(chavesGravadas()).toEqual([])
    expect(localStorage.length).toBe(0)
  })

  // O modo grava em memória, não no vazio: quem digita precisa ler de volta o
  // que digitou enquanto a aba está aberta. O que ele promete é que nada disso
  // sobrevive ao fechar — e é o disco que responde por isso.
  it('ligado, o que foi digitado continua legível na sessão', () => {
    setModoVisita(true)
    saveState({ vals: { cdb: 7 }, ndep: 0, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 })
    expect(loadState()?.vals.cdb).toBe(7)
    expect(localStorage.getItem('irpfm2027:state:v1')).toBeNull()
  })

  it('não apaga o que já estava gravado — só para de gravar', () => {
    saveState({ vals: { cdb: 1 }, ndep: 0, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 })
    setModoVisita(true)
    saveState({ vals: { cdb: 2 }, ndep: 0, cdbA: null, red: false, aliqEmp: 0, limR: 0.34 })
    // o disco continua com o 1: o 2 só existe nesta sessão
    expect(JSON.parse(localStorage.getItem('irpfm2027:state:v1')!).vals.cdb).toBe(1)
    // e desligar o modo devolve a leitura ao disco
    setModoVisita(false)
    expect(loadState()?.vals.cdb).toBe(1)
  })
})

describe('apagar tudo deste aparelho', () => {
  it('varre a família inteira de chaves, não só estado e cenários', () => {
    localStorage.clear()
    setModoVisita(false)
    localStorage.setItem('irpfm2027:state:v1', '{}')
    localStorage.setItem('irpfm2027:vault:v1', 'x')
    localStorage.setItem('irpfm2027:dek:v1', 'x')
    localStorage.setItem('outro-app:coisa', 'fica')

    expect(apagarTudoDesteAparelho()).toBe(3)
    expect(chavesGravadas()).toEqual([])
    expect(localStorage.getItem('outro-app:coisa')).toBe('fica')
  })
})

// Campo novo tem de atravessar a porta de entrada. Se `migrarEstado` passasse a
// listar campos, o palpite de emissor que a pessoa desfez e o provento guardado
// por ano sumiriam no primeiro reload — sem erro, sem aviso, só o número
// voltando ao que era.
describe('estado novo sobrevive à porta de entrada', () => {
  const base = { schemaVersion: SCHEMA_VERSION, vals: { salario: 100 }, ndep: 0 }

  it('a resposta de quem discordou do agrupamento de pagador não se perde', () => {
    const r = migrarEstado({ ...base, b3Emissor: { 'PETR4 - PETROLEO': 'PETR4 - PETROLEO' } })
    expect(r.b3Emissor).toEqual({ 'PETR4 - PETROLEO': 'PETR4 - PETROLEO' })
  })

  it('o provento guardado ano a ano também não', () => {
    const proventos = { 2024: [{ pagador: 'PETR', meses: [1000, ...Array(11).fill(0)] }] }
    expect(migrarEstado({ ...base, proventosB3: proventos }).proventosB3).toEqual(proventos)
  })

  it('e o que o app não conhece passa igual, em vez de ser descartado', () => {
    const r = migrarEstado({ ...base, campoDeUmaVersaoFutura: { qualquer: 'coisa' } }) as unknown as Record<string, unknown>
    expect(r.campoDeUmaVersaoFutura).toEqual({ qualquer: 'coisa' })
  })
})
