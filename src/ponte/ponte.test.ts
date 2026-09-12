import { describe, it, expect } from 'vitest'
import { lerPacote, novoPacoteHistorico, novoPacoteBaseline, nomeDoArquivo, PACOTE_VERSAO } from './ponte'

const AGORA = '2026-09-12T10:00:00.000Z'

describe('pacote de histórico', () => {
  const p = () =>
    novoPacoteHistorico('IRPF-calc', AGORA, {
      historico: { '2025': { anoBase: 2025 } as never },
      aportes: { '2025': 1000 } as never,
    })

  it('carrega o trabalho manual junto dos números', () => {
    // Sem isto o outro app receberia o histórico e pediria de novo a classe
    // corrigida à mão, o aporte informado e a ligação entre anos.
    const lido = lerPacote(JSON.parse(JSON.stringify(p())), 'historico')
    expect(lido.aportes).toEqual({ '2025': 1000 })
    expect(lido.geradoPor).toBe('IRPF-calc')
  })

  it('recusa pacote de uma versão mais nova, dizendo o porquê', () => {
    expect(() => lerPacote({ ...p(), versao: PACOTE_VERSAO + 1 }, 'historico')).toThrow(/versão mais nova/i)
  })

  it('recusa o pacote do tipo errado, e diz qual é qual', () => {
    const base = novoPacoteBaseline('IRPF-calc', AGORA, { anoBase: 2026, vals: { cdb: 1 }, ndep: 0 })
    expect(() => lerPacote(base, 'historico')).toThrow(/base do ano seguinte.*histórico das declarações/is)
  })

  it('recusa o que não é pacote nenhum', () => {
    expect(() => lerPacote({ qualquer: 1 }, 'historico')).toThrow(/não é um pacote/i)
    expect(() => lerPacote('texto', 'baseline')).toThrow(/não é um objeto/i)
  })

  it('recusa pacote sem o conteúdo que o tipo promete', () => {
    expect(() => lerPacote({ versao: 1, tipo: 'historico', geradoEm: AGORA, geradoPor: 'x' }, 'historico')).toThrow(
      /sem o campo "historico"/,
    )
    expect(() => lerPacote({ versao: 1, tipo: 'baseline', geradoEm: AGORA, geradoPor: 'x' }, 'baseline')).toThrow(
      /sem o campo "vals"/,
    )
  })
})

describe('pacote de base do ano seguinte', () => {
  it('leva rendimento, retenção e a posição de 31/12 — e nenhuma projeção', () => {
    const b = novoPacoteBaseline('IRPF-calc', AGORA, {
      anoBase: 2026,
      vals: { divBR: 800_000, divBR_ir: 80_000 },
      ndep: 2,
      posicaoInicial: [{ ticker: 'PETR4', quantidade: 100, custoMedio: 30 }],
    })
    const lido = lerPacote(JSON.parse(JSON.stringify(b)), 'baseline')
    expect(lido.vals.divBR).toBe(800_000)
    expect(lido.posicaoInicial?.[0].ticker).toBe('PETR4')
    // Projetar é pergunta do app que recebe; mandar projeção daqui seria
    // decidir por ele.
    expect('projecao' in lido).toBe(false)
  })
})

describe('nome do arquivo', () => {
  it('diz o que é e de quando, sem hora', () => {
    expect(nomeDoArquivo('historico', AGORA)).toBe('irpf-historico-2026-09-12.json')
    expect(nomeDoArquivo('baseline', AGORA)).toBe('irpf-base-2026-09-12.json')
  })
})
