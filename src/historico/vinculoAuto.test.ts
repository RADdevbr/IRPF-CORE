import { describe, it, expect } from 'vitest'
import {
  sugerirLigacoes,
  vinculosAutomaticos,
  unirVinculos,
  semelhanca,
  pontuar,
  cnpjNaDescricao,
  candidatosPara,
  LIMIAR,
} from './vinculoAuto.js'
import { montarDeclaracao, upsertDeclaracao, aplicarVinculos, serieDaPosicao, type Historico } from './historico.js'
import type { DecResult, Posicao } from '../dec/decParser.js'

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

  it('cadeia de ligações manuais chega inteira ao ano mais novo', () => {
    // é o bem que mudou de nome três vezes: ligado em dois cliques, 2020→2021 e
    // 2021→2022. Sem resolver a cadeia, o de 2020 parava num id que não existe
    expect(unirVinculos({}, { p2020: 'p2021', p2021: 'p2022' })).toEqual({ p2020: 'p2022', p2021: 'p2022' })
  })

  it('ligação manual em cima de automática também colapsa', () => {
    expect(unirVinculos({ p2020: 'p2021' }, { p2021: 'p2022' })).toEqual({ p2020: 'p2022', p2021: 'p2022' })
  })

  it('ciclo contraditório não trava o app', () => {
    const r = unirVinculos({}, { a: 'b', b: 'a' })
    expect(Object.keys(r).length).toBeLessThanOrEqual(2)
  })

  it('histórico de um ano só não tem o que ligar', () => {
    expect(vinculosAutomaticos(historico({ exercicio: '2026', bens: [pos('CDB', 1)] }))).toEqual({})
  })
})

describe('CNPJ na descrição', () => {
  it('acha o CNPJ pontuado no meio do texto', () => {
    expect(cnpjNaDescricao('FUNDO XPTO FIC FIM CNPJ 36.443.522/0001-05.')).toBe('36443522000105')
  })

  it('não chuta: catorze dígitos soltos tanto são conta ou contrato quanto CNPJ', () => {
    expect(cnpjNaDescricao('CONTA 36443522000105')).toBe(null)
    expect(cnpjNaDescricao('CPF 123.456.789-00')).toBe(null)
    expect(cnpjNaDescricao('APLICACAO SEM DOCUMENTO')).toBe(null)
  })
})

describe('o CNPJ como sinal', () => {
  it('mesmo CNPJ com o mesmo código fecha, mesmo com o nome trocado', () => {
    const velha = comAno(pos('FUNDO ALFA CNPJ 36.443.522/0001-05', 100_000), 2023)
    const nova = comAno(pos('ALFA MULTIMERCADO FIC 36.443.522/0001-05', 130_000), 2025)
    const r = pontuar(velha, nova)
    expect(r.pontos).toBeGreaterThanOrEqual(LIMIAR)
    expect(r.motivos).toContain('mesmo CNPJ na descrição')
  })

  it('CNPJ diferente derruba: são dois fundos, não um que mudou de nome', () => {
    const velha = comAno(pos('FUNDO XP MULTIMERCADO 36.443.522/0001-05', 100_000), 2023)
    const nova = comAno(pos('FUNDO XP MULTIMERCADO 11.222.333/0001-44', 120_000), 2025)
    const r = pontuar(velha, nova)
    expect(r.pontos).toBeLessThan(LIMIAR)
    expect(r.motivos).toContain('CNPJ diferente na descrição')
  })

  it('o saldo declarado manda: CNPJ diferente não derruba o que o arquivo afirma', () => {
    // trocou de administrador no meio do caminho, mas o arquivo diz o saldo
    const velha = comAno(pos('FUNDO ALFA 36.443.522/0001-05', 100_000), 2024)
    const nova = comAno(pos('FUNDO ALFA 11.222.333/0001-44', 120_000, 100_000), 2025)
    expect(pontuar(velha, nova).pontos).toBeGreaterThanOrEqual(LIMIAR)
  })
})

describe('vetar uma ligação automática', () => {
  it('a posição vetada não é ligada de novo — desfazer na tela tem de durar', () => {
    const h = historico(
      { exercicio: '2025', bens: [pos('CDB BCO X 2027', 400_000)] },
      { exercicio: '2026', bens: [pos('CERT DEP BANCARIO BANCO X', 480_000, 400_000)] },
    )
    const mapa = vinculosAutomaticos(h)
    const de = Object.keys(mapa)[0]
    expect(de).toBeTruthy()
    expect(vinculosAutomaticos(h, {}, [de])).toEqual({})
    expect(sugerirLigacoes(h, {}, [de])).toEqual([])
  })
})

describe('candidatos para uma linha do mapa', () => {
  const h = () =>
    historico(
      { exercicio: '2025', bens: [pos('APLIC ALFA', 100_000), pos('IMOVEL PRAIA', 500_000, 0, '11', '01')] },
      { exercicio: '2026', bens: [pos('ALFA RENOMEADA', 130_000, 100_000), pos('OUTRA COISA QUALQUER', 9_000)] },
    )

  it('o bem que o arquivo afirma ser o mesmo vem na frente, com o motivo', () => {
    const hist = h()
    const alvo = hist['2025'].posicoes.find((p) => p.descricao === 'ALFA RENOMEADA')!
    const cs = candidatosPara(hist, alvo, 2025)
    expect(cs[0].descricao).toBe('APLIC ALFA')
    expect(cs[0].motivos[0]).toMatch(/saldo anterior/)
    expect(cs[0].pontos).toBeGreaterThanOrEqual(LIMIAR)
    // e o imóvel, que não tem nada a ver, fica atrás
    expect(cs[cs.length - 1].pontos).toBeLessThan(cs[0].pontos)
  })

  it('quem já está na série aparece marcado, não como sugestão de ligar', () => {
    const hist = aplicarVinculos(h(), vinculosAutomaticos(h()))
    const alvo = hist['2025'].posicoes.find((p) => p.descricao === 'ALFA RENOMEADA')!
    const cs = candidatosPara(hist, alvo, 2025)
    expect(cs[0].naSerie).toBe(true)
    expect(cs[0].anoBase).toBe(2024)
    expect(cs.filter((c) => c.naSerie)).toHaveLength(1)
  })

  it('não devolve o próprio ano — ligar um bem a outro do mesmo ano não é série', () => {
    const hist = h()
    const alvo = hist['2025'].posicoes[0]
    expect(candidatosPara(hist, alvo, 2025).every((c) => c.anoBase !== 2025)).toBe(true)
  })
})
