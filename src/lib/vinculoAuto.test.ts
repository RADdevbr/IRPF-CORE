import { describe, it, expect } from 'vitest'
import { sugerirLigacoes, vinculosAutomaticos, unirVinculos, semelhanca, pontuar, LIMIAR } from './vinculoAuto'
import { montarDeclaracao, upsertDeclaracao, aplicarVinculos, serieDaPosicao, type Historico } from './historico'
import type { DecResult, Posicao } from './decParser'

const pos = (
  descricao: string,
  saldoAtual: number,
  saldoAnterior = 0,
  codigo = '45',
  subcodigo = '01',
): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo,
  subcodigo,
  bruta: `27CPF        ${codigo}${subcodigo}00${descricao}`,
  descricao,
  saldoAnterior,
  saldoAtual,
  tipoCarteira: 'cdb',
})

const dec = (ano: string, posicoes: Posicao[]): DecResult => ({
  ano,
  registros: [],
  lancamentos: [],
  posicoes,
  pagamentos: [],
  ndep: 0,
  linhas: [],
  totalLinhas: 0,
})

/** `exercicio` é o ano da declaração; o ano-base é o anterior. */
const historico = (...anos: { exercicio: string; bens: Posicao[] }[]): Historico => {
  let h: Historico = {}
  for (const a of anos) h = upsertDeclaracao(h, montarDeclaracao(dec(a.exercicio, a.bens), `${a.exercicio}.DEC`, 'agora')!)
  return h
}

const comAno = (p: Posicao, anoBase: number) => ({
  ...p,
  id: 'x',
  classe: 'cdb' as const,
  regime: 'inBase' as const,
  anoBase,
})

describe('semelhança entre descrições', () => {
  it('ignora pontuação, caixa e espaço', () => {
    expect(semelhanca('CDB Banco X - venc. 2027', 'CDB BANCO X VENC 2027')).toBe(1)
  })

  it('não conta palavra genérica como parecença', () => {
    // se "BANCO" e "FUNDO" valessem, dois bens sem nada a ver pareceriam iguais
    expect(semelhanca('BANCO ALFA', 'BANCO BETA')).toBe(0)
    expect(semelhanca('FUNDO DE INVESTIMENTO ALFA', 'FUNDO DE INVESTIMENTO BETA')).toBe(0)
  })

  it('descrição vazia não se parece com nada', () => {
    expect(semelhanca('', 'CDB BANCO X')).toBe(0)
  })
})

describe('pontuação de um par', () => {
  it('o saldo anterior declarado sozinho já basta', () => {
    const velha = comAno(pos('NOME QUE MUDOU COMPLETAMENTE', 100_000), 2024)
    const nova = comAno(pos('OUTRO NOME TOTALMENTE DIFERENTE', 150_000, 100_000), 2025)
    const r = pontuar(velha, nova)
    expect(r.pontos).toBeGreaterThanOrEqual(LIMIAR)
    expect(r.motivos[0]).toMatch(/saldo anterior/)
  })

  it('o saldo só vale entre anos consecutivos — com buraco no meio não afirma nada', () => {
    const velha = comAno(pos('APLICACAO ALFA', 100_000), 2023)
    const nova = comAno(pos('RESERVA BETA', 150_000, 100_000), 2025)
    expect(pontuar(velha, nova).pontos).toBeLessThan(LIMIAR)
  })

  it('descrição parecida com o mesmo código também fecha', () => {
    const velha = comAno(pos('CDB BANCO ALFA VENC 2027', 100_000), 2023)
    const nova = comAno(pos('CDB BANCO ALFA VENCIMENTO 2027', 180_000), 2025)
    expect(pontuar(velha, nova).pontos).toBeGreaterThanOrEqual(LIMIAR)
  })

  it('só o código não basta — metade da renda fixa dividiria o mesmo código', () => {
    const velha = comAno(pos('ALFA', 100_000), 2023)
    const nova = comAno(pos('BETA', 100_000), 2025)
    expect(pontuar(velha, nova).pontos).toBeLessThan(LIMIAR)
  })

  it('descrição só meio parecida com o mesmo código continua sendo palpite', () => {
    // "CDB ALFA 2027" e "CDB ALFA 2031" são dois papéis do mesmo banco, não um
    const velha = comAno(pos('CDB ALFA 2027', 100_000), 2023)
    const nova = comAno(pos('CDB ALFA 2031', 100_000), 2025)
    expect(pontuar(velha, nova).pontos).toBeLessThan(LIMIAR)
  })
})

describe('ligações sugeridas', () => {
  it('liga o bem que mudou de nome, pelo saldo que o arquivo declara', () => {
    const h = historico(
      { exercicio: '2025', bens: [pos('CDB BCO X 2027', 400_000)] },
      { exercicio: '2026', bens: [pos('CERT DEP BANCARIO BANCO X S.A.', 480_000, 400_000)] },
    )
    const ls = sugerirLigacoes(h)
    expect(ls).toHaveLength(1)
    expect(ls[0].anoDe).toBe(2024)
    expect(ls[0].anoPara).toBe(2025)
    expect(ls[0].motivos[0]).toMatch(/saldo anterior/)
  })

  it('não liga nada quando o casamento por identidade já resolveu', () => {
    const h = historico(
      { exercicio: '2025', bens: [pos('CDB BANCO X', 400_000)] },
      { exercicio: '2026', bens: [pos('CDB BANCO X', 480_000, 400_000)] },
    )
    expect(sugerirLigacoes(h)).toEqual([])
  })

  it('um bem de um ano não vira dois no outro', () => {
    // dois bens com o MESMO saldo anterior: só um pode ficar com o par
    const h = historico(
      { exercicio: '2025', bens: [pos('APLICACAO ALFA', 100_000)] },
      {
        exercicio: '2026',
        bens: [pos('APLICACAO ALFA RENOMEADA', 120_000, 100_000), pos('APLICACAO GAMA', 130_000, 100_000)],
      },
    )
    const ls = sugerirLigacoes(h)
    expect(ls).toHaveLength(1)
    // ganha quem tem mais sinais: a descrição parecida desempata
    expect(ls[0].descricaoPara).toMatch(/RENOMEADA/)
  })

  it('não mexe no que foi ligado na mão', () => {
    const h = historico(
      { exercicio: '2025', bens: [pos('CDB BCO X 2027', 400_000)] },
      { exercicio: '2026', bens: [pos('CERT DEP BANCARIO BANCO X', 480_000, 400_000)] },
    )
    const idVelho = sugerirLigacoes(h)[0].de
    expect(sugerirLigacoes(h, { [idVelho]: 'outro-destino' })).toEqual([])
  })

  it('bem que sumiu (foi resgatado) não inventa par', () => {
    const h = historico(
      { exercicio: '2025', bens: [pos('APLICACAO QUE FOI RESGATADA', 100_000)] },
      { exercicio: '2026', bens: [pos('IMOVEL NOVO NA PRAIA', 500_000, 0, '11', '01')] },
    )
    expect(sugerirLigacoes(h)).toEqual([])
  })
})

describe('mapa de vínculos', () => {
  it('a cadeia de três anos aponta toda para o ano mais novo', () => {
    const h = historico(
      { exercicio: '2024', bens: [pos('APLIC ALFA', 100_000)] },
      { exercicio: '2025', bens: [pos('APLICACAO ALFA RENOMEADA', 200_000, 100_000)] },
      { exercicio: '2026', bens: [pos('ALFA FUNDO XP', 300_000, 200_000)] },
    )
    const mapa = vinculosAutomaticos(h)
    const destinos = new Set(Object.values(mapa))
    // dois saltos, um destino só: o do ano mais novo
    expect(Object.keys(mapa)).toHaveLength(2)
    expect(destinos.size).toBe(1)

    // e a série do bem sai inteira, com os três anos
    const pronto = aplicarVinculos(h, mapa)
    const idFinal = [...destinos][0]
    expect(serieDaPosicao(pronto, idFinal).map((x) => x.anoBase)).toEqual([2023, 2024, 2025])
  })

  it('nada aponta para si mesmo', () => {
    const h = historico(
      { exercicio: '2025', bens: [pos('CDB BCO X', 400_000)] },
      { exercicio: '2026', bens: [pos('CDB BANCO X S A', 480_000, 400_000)] },
    )
    const mapa = vinculosAutomaticos(h)
    for (const [de, para] of Object.entries(mapa)) expect(de).not.toBe(para)
  })

  it('manual sobrescreve o automático', () => {
    expect(unirVinculos({ a: 'auto' }, { a: 'manual' })).toEqual({ a: 'manual' })
    expect(unirVinculos({ a: 'auto' }, { b: 'manual' })).toEqual({ a: 'auto', b: 'manual' })
  })

  it('histórico de um ano só não tem o que ligar', () => {
    expect(vinculosAutomaticos(historico({ exercicio: '2026', bens: [pos('CDB', 1)] }))).toEqual({})
  })
})
