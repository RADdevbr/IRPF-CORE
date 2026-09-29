// Do extrato para os bens: o fluxo do ano, a ligação de cada posição, a data de
// cada movimento e a custódia.
import { describe, it, expect } from 'vitest'
import { montarDeclaracao, upsertDeclaracao, idPosicao, chaveAporte, type Historico } from '../historico/historico.js'
import type { Posicao } from '../dec/decParser.js'
import type { Movimento } from './movimentacao.js'
import { casarLista, dinheiroDaLinha, fluxosDeMovimentos } from './fluxos.js'
import {
  aportesDoExtrato,
  bensParaLigar,
  chaveDaPosicao,
  custodiaDoExtrato,
  ligarPosicoes,
  movimentosDosBens,
  posicoesDoExtrato,
} from './bens.js'

const pos = (descricao: string, anterior: number, atual: number, codigo = '31', cnpj?: string): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo,
  subcodigo: '',
  ...(cnpj ? { cnpj } : {}),
  bruta: '',
  descricao,
  saldoAnterior: anterior,
  saldoAtual: atual,
  tipoCarteira: 'x',
})

function historico(anos: Record<number, Posicao[]>): Historico {
  let h: Historico = {}
  for (const [anoBase, posicoes] of Object.entries(anos)) {
    const d = montarDeclaracao(
      { ano: String(Number(anoBase) + 1), registros: [], lancamentos: [], posicoes, pagamentos: [], ndep: 0, linhas: [], totalLinhas: 0 },
      'x.DEC',
      'agora',
    )!
    h = upsertDeclaracao(h, d)
  }
  return h
}

const mov = (
  entradaSaida: string,
  data: string,
  movimentacao: string,
  produto: string,
  valor: number | null,
  instituicao = 'XP INVESTIMENTOS CCTVM S/A',
): Movimento => {
  const [, m, a] = data.split('/')
  return {
    entradaSaida,
    data,
    ano: Number(a),
    mes: Number(m),
    movimentacao,
    produto,
    instituicao,
    valor,
    quantidade: 1,
    precoUnitario: valor,
  }
}

// Um ano em que o mesmo ativo foi comprado E vendido, e outro em que o título
// só venceu — os dois casos que o caminho antigo errava.
const EXTRATO: Movimento[] = [
  mov('Credito', '10/03/2024', 'COMPRA / VENDA', 'PETR4 - PETROLEO', 3000),
  mov('Debito', '20/09/2024', 'COMPRA / VENDA', 'PETR4 - PETROLEO', 4500),
  mov('Credito', '15/05/2024', 'Dividendo', 'PETR4 - PETROLEO', 100),
  mov('Debito', '15/07/2024', 'RESGATE', 'LCA BANCO X', 30000),
  mov('Credito', '05/02/2024', 'APLICAÇÃO', 'CDB BANCO Y', 20000),
]

const PETR = 'ACOES PETR4 PETROLEO BRASILEIRO'
const LCA = 'LCA BANCO X 2027'
const CDBY = 'CDB BANCO Y'
const h2024 = () =>
  historico({
    2024: [pos(PETR, 13_500, 12_000), pos(LCA, 100_000, 78_000, '45'), pos(CDBY, 4_000, 25_000, '45')],
  })

describe('o dinheiro de cada linha', () => {
  it('o fluxo é líquido: comprou 3 mil e vendeu 4,5 mil, saíram 1,5 mil', () => {
    const { fluxos } = fluxosDeMovimentos(EXTRATO)
    const petr = fluxos.find((f) => f.ativo === 'PETR4')!
    expect(petr.liquido).toBeCloseTo(-1_500, 2)
    // e o dividendo de 100 não é aporte: ele entra pela renda
    expect(petr.aportado).toBeCloseTo(3_000, 2)
    expect(fluxos.find((f) => f.ativo === 'LCA BANCO X')!.liquido).toBeCloseTo(-30_000, 2)
    expect(fluxos.find((f) => f.ativo === 'CDB BANCO Y')!.liquido).toBeCloseTo(20_000, 2)
  })

  it('a resposta guardada manda sobre o palpite, e o que ninguém classificou é contado', () => {
    expect(fluxosDeMovimentos(EXTRATO, { RESGATE: 'ignorar' }).fluxos.some((f) => f.ativo === 'LCA BANCO X')).toBe(false)
    const estranho = [mov('Credito', '10/03/2024', 'EVENTO QUE A B3 INVENTOU', 'XPTO3 - X', 10)]
    expect(fluxosDeMovimentos(estranho)).toMatchObject({ fluxos: [], indefinidas: 1 })
  })

  it('linha que não diz se entrou ou saiu fica de fora, e é contada', () => {
    const l = mov('', '10/03/2024', 'COMPRA / VENDA', 'PETR4', 1000)
    expect(dinheiroDaLinha(l)).toEqual({ tipo: 'semFluxo' })
    expect(fluxosDeMovimentos([l])).toMatchObject({ fluxos: [], semFluxo: 1 })
  })

  it('casa o fluxo do ano com o bem que carrega o ticker, com o resgate negativo', () => {
    const h = h2024()
    const r = casarLista(h, fluxosDeMovimentos(EXTRATO).fluxos)
    expect(r.aportes[chaveAporte(idPosicao(LCA, 'lci'), 2024)]).toBeCloseTo(-30_000, 2)
    expect(r.aportes[chaveAporte(idPosicao(PETR, 'acoes'), 2024)]).toBeCloseTo(-1_500, 2)
    expect(r.bensPreenchidos).toBe(3)
  })
})

describe('as posições do extrato', () => {
  it('uma por papel e instituição, com o dinheiro e a última data de qualquer linha', () => {
    const ps = posicoesDoExtrato([
      ...EXTRATO,
      mov('Credito', '10/03/2024', 'COMPRA / VENDA', 'PETR4 - PETROLEO', 500, 'BTG PACTUAL CTVM S/A'),
    ])
    const petrXp = ps.find((p) => p.chave === chaveDaPosicao({ produto: 'PETR4', instituicao: 'XP INVESTIMENTOS CCTVM S/A' }))!
    expect(petrXp).toMatchObject({ ativo: 'PETR4', aportado: 3000, resgatado: 4500, ultima: '2024-09-20', anos: [2024] })
    expect(ps.filter((p) => p.ativo === 'PETR4')).toHaveLength(2)
  })

  it('a chave não muda com acento, caixa ou pontuação da instituição', () => {
    expect(chaveDaPosicao({ produto: 'PETR4 - X', instituicao: 'XP Investimentos CCTVM S.A.' })).toBe(
      chaveDaPosicao({ produto: 'PETR4', instituicao: 'XP INVESTIMENTOS CCTVM SA' }),
    )
  })
})

describe('que posição é qual bem', () => {
  it('pelo ticker na descrição, sozinho', () => {
    const h = h2024()
    const lig = ligarPosicoes(h, posicoesDoExtrato(EXTRATO))
    const petr = lig[chaveDaPosicao(EXTRATO[0])]
    expect(petr).toEqual({ bem: idPosicao(PETR, 'acoes'), origem: 'ticker' })
    // «LCA BANCO X» tem mais de quatro letras e está inteiro na descrição
    expect(lig[chaveDaPosicao(EXTRATO[3])].bem).toBe(idPosicao(LCA, 'lci'))
  })

  it('a mesma ação em duas corretoras vai para o bem que diz a corretora', () => {
    const XP = 'ACOES PETR4 - CUSTODIA XP'
    const BTG = 'ACOES PETR4 - CUSTODIA BTG'
    const h = historico({ 2024: [pos(XP, 0, 1000), pos(BTG, 0, 2000)] })
    const linhas = [
      mov('Credito', '10/03/2024', 'COMPRA / VENDA', 'PETR4', 1000, 'XP INVESTIMENTOS CCTVM S/A'),
      mov('Credito', '10/03/2024', 'COMPRA / VENDA', 'PETR4', 2000, 'BTG PACTUAL CTVM S/A'),
    ]
    const lig = ligarPosicoes(h, posicoesDoExtrato(linhas))
    expect(lig[chaveDaPosicao(linhas[0])].bem).toBe(idPosicao(XP, 'acoes'))
    expect(lig[chaveDaPosicao(linhas[1])].bem).toBe(idPosicao(BTG, 'acoes'))
  })

  it('a renda fixa sem ticker ganha um palpite pelo nome — que não liga nada sozinho', () => {
    const CDB = 'CDB BANCO INTER 2026 110% CDI'
    const h = historico({ 2024: [pos(CDB, 0, 50_000, '45')] })
    const linha = mov('Credito', '10/03/2024', 'APLICAÇÃO', 'CDB - CDB1234ABCD - BANCO INTER S.A.', 50_000)
    const lig = ligarPosicoes(h, posicoesDoExtrato([linha]))[chaveDaPosicao(linha)]
    expect(lig.bem).toBeNull()
    expect(lig.origem).toBe('nenhuma')
    expect(lig.sugerido?.id).toBe(idPosicao(CDB, 'cdb'))
    expect(movimentosDosBens([linha], {}, { [chaveDaPosicao(linha)]: lig })).toEqual({})
  })

  it('o tipo sozinho não é palpite: «CDB» casaria com todo CDB', () => {
    const h = historico({ 2024: [pos('CDB BANCO ALFA', 0, 1, '45')] })
    const linha = mov('Credito', '10/03/2024', 'APLICAÇÃO', 'CDB - CDB1234 - BANCO BETA S.A.', 1)
    expect(ligarPosicoes(h, posicoesDoExtrato([linha]))[chaveDaPosicao(linha)].sugerido).toBeUndefined()
  })

  it('a resposta manda, inclusive para dizer «nenhum», e segue o vínculo entre anos', () => {
    const h = h2024()
    const ps = posicoesDoExtrato(EXTRATO)
    const k = chaveDaPosicao(EXTRATO[0])
    expect(ligarPosicoes(h, ps, { [k]: '' })[k]).toEqual({ bem: null, origem: 'resposta' })
    const cdb = idPosicao(CDBY, 'cdb')
    expect(ligarPosicoes(h, ps, { [k]: 'ID-ANTIGO' }, { 'ID-ANTIGO': cdb })[k]).toEqual({ bem: cdb, origem: 'resposta' })
    // resposta para um bem que saiu do histórico cai no palpite
    expect(ligarPosicoes(h, ps, { [k]: 'SUMIU' })[k].origem).toBe('ticker')
  })

  it('só oferece bens que podem estar na B3', () => {
    const h = historico({ 2024: [pos('APARTAMENTO RUA X', 1, 1, '11'), pos(PETR, 1, 1)] })
    expect(bensParaLigar(h).map((b) => b.descricao)).toEqual([PETR])
  })
})

describe('o que sai da ligação', () => {
  const h = h2024()
  const ps = posicoesDoExtrato(EXTRATO)
  const lig = ligarPosicoes(h, ps)
  const movimentos = movimentosDosBens(EXTRATO, {}, lig)

  it('cada bem com o dinheiro dele, na data, em ordem', () => {
    expect(movimentos[idPosicao(PETR, 'acoes')].map((m) => [m.data, m.valor])).toEqual([
      ['2024-03-10', 3000],
      ['2024-09-20', -4500],
    ])
    expect(movimentos[idPosicao(LCA, 'lci')]).toEqual([
      { data: '2024-07-15', valor: -30000, instituicao: 'XP INVESTIMENTOS CCTVM S/A', ativo: 'LCA BANCO X' },
    ])
  })

  it('o aporte do ano é o mesmo do casamento por ano', () => {
    const a = aportesDoExtrato(h, movimentos)
    const b = casarLista(h, fluxosDeMovimentos(EXTRATO).fluxos).aportes
    expect(a).toEqual(b)
  })

  it('não inventa aporte em ano sem o bem na declaração', () => {
    const fora = { [idPosicao(PETR, 'acoes')]: [{ data: '2019-05-01', valor: 1000 }] }
    expect(aportesDoExtrato(h, fora)).toEqual({})
  })

  it('a custódia é a instituição da linha mais recente — a carteira transferida está na segunda', () => {
    const linhas = [
      mov('Credito', '10/03/2022', 'COMPRA / VENDA', 'PETR4', 1000, 'XP INVESTIMENTOS CCTVM S/A'),
      mov('Credito', '15/05/2024', 'Dividendo', 'PETR4', 10, 'BTG PACTUAL CTVM S/A'),
    ]
    const hh = historico({ 2024: [pos(PETR, 1000, 1000)] })
    const pp = posicoesDoExtrato(linhas)
    const c = custodiaDoExtrato(pp, ligarPosicoes(hh, pp))
    // e com o nome que a família usa, para ser a mesma linha que o .DEC dá
    expect(c[idPosicao(PETR, 'acoes')]).toEqual({ instituicao: 'BTG Pactual', data: '2024-05-15' })
  })
})
