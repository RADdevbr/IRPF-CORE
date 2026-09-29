// O leitor do Extrato de Movimentação, conferido do jeito que o IRPF-calc
// conferia antes de ele vir para o núcleo — os mesmos casos, para a mudança de
// endereço não mudar nenhum número.
import { describe, it, expect } from 'vitest'
import type { Aba, Celula } from '../xlsx/index.js'
import { numeroDeTexto, paraNumero, respostaGuardada } from './leitura.js'
import {
  ehEntrada,
  lerData,
  lerFluxo,
  lerMovimentacao,
  textoDaData,
  dataOrdenavel,
  unirMovimentacoes,
  type Movimentacao,
  type Movimento,
} from './movimentacao.js'

const texto = (v: string): Celula => ({ valor: v, tipo: 's' })
const numerica = (v: string): Celula => ({ valor: v, tipo: 'n' })
const aba = (nome: string, linhas: string[][]): Aba => ({ nome, linhas: linhas.map((l) => l.map(texto)) })

const linha = (p: Partial<Movimento> = {}): Movimento => ({
  entradaSaida: 'Credito',
  data: '10/03/2025',
  ano: 2025,
  mes: 3,
  movimentacao: 'Dividendo',
  produto: 'PETR4 - PETROLEO BRASILEIRO SA',
  instituicao: 'XP',
  valor: 1000,
  quantidade: null,
  precoUnitario: null,
  ...p,
})

const extrato = (linhas: Movimento[]): Movimentacao => ({
  aba: 'Movimentação',
  linhas,
  tipos: [],
  anos: [...new Set(linhas.map((l) => l.ano))].sort(),
  semValor: 0,
  semData: 0,
  semFluxo: 0,
  temColunaFluxo: true,
  repetidas: 0,
  de: '',
  ate: '',
})

/**
 * A estrutura real do Extrato de Movimentação, conferida contra um arquivo de
 * verdade (anonimizado): oito colunas, com data, misturando negócio e provento,
 * com tipos que não têm valor nenhum e SEM linha de total.
 */
const movimentacaoReal = (): Aba[] => [
  aba('Movimentação', [
    ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Quantidade', 'Preço unitário', 'Valor da Operação'],
    ['Credito', '11/12/2020', 'Dividendo', 'ACAO A', 'CORRETORA', '452', '3.77', '64.65'],
    ['Credito', '07/12/2020', 'Dividendo', 'ACAO B', 'CORRETORA', '524', '8.45', '7.26'],
    ['Credito', '06/12/2020', 'Transferência - Liquidação', 'ACAO C', 'OUTRA', '25', '911.2', '4607'],
    ['Debito', '05/12/2020', 'Bonificação em Ativos', 'ACAO D', 'CORRETORA', '8', '-', '-'],
    ['Credito', '23/11/2020', 'Dividendo', 'ACAO A', 'CORRETORA', '97', '20.68', '2769.6'],
    ['Debito', '22/06/2020', 'Dividendo', 'ACAO A', 'CORRETORA', '886', '29.39', '3171'],
  ]),
]

describe('extrato de movimentação', () => {
  it('acha a aba pelo cabeçalho e lê data, tipo, produto, instituição e valor', () => {
    const m = lerMovimentacao(movimentacaoReal())!
    expect(m.aba).toBe('Movimentação')
    expect(m.linhas).toHaveLength(6)
    expect(m.linhas[0]).toMatchObject({
      entradaSaida: 'Credito',
      data: '11/12/2020',
      ano: 2020,
      mes: 12,
      movimentacao: 'Dividendo',
      produto: 'ACAO A',
      instituicao: 'CORRETORA',
      valor: 64.65,
    })
  })

  it('linha sem valor vira null e é CONTADA — nunca descartada em silêncio', () => {
    const m = lerMovimentacao(movimentacaoReal())!
    expect(m.semValor).toBe(1)
    expect(m.tipos.find((t) => t.movimentacao === 'Bonificação em Ativos')!.semValor).toBe(1)
  })

  it('agrupa por tipo com contagem e quebra entre crédito e débito', () => {
    const dividendo = lerMovimentacao(movimentacaoReal())!.tipos.find((t) => t.movimentacao === 'Dividendo')!
    expect(dividendo.quantos).toBe(4)
    expect(dividendo.porFluxo).toEqual([
      { fluxo: 'Credito', quantos: 3 },
      { fluxo: 'Debito', quantos: 1 },
    ])
  })

  it('diz o período lido, da primeira à última data', () => {
    const m = lerMovimentacao(movimentacaoReal())!
    expect([m.de, m.ate]).toEqual(['2020-06-22', '2020-12-11'])
  })

  it('devolve null quando a aba não é de movimentação', () => {
    expect(lerMovimentacao([aba('X', [['Produto', 'Quantidade'], ['A', '1']])])).toBeNull()
  })

  it('«Valor da Operação» ganha de «Valor Unitário», mesmo vindo depois', () => {
    const m = lerMovimentacao([
      aba('mov', [
        ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Quantidade', 'Valor Unitário', 'Valor da Operação'],
        ['Credito', '10/03/2025', 'Dividendo', 'PETR4', '100', '2,50', '250,00'],
      ]),
    ])
    expect(m?.linhas[0].valor).toBe(250)
    expect(m?.linhas[0].precoUnitario).toBe(2.5)
  })

  it('a linha em branco no meio não trunca, e a linha sem data é contada', () => {
    const m = lerMovimentacao([
      aba('mov', [
        ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Valor da Operação'],
        ['Credito', '10/03/2025', 'Dividendo', 'PETR4', '250,00'],
        [],
        ['Credito', '11/03/2025', 'Dividendo', 'VALE3', '900,00'],
        ['Credito', 'sem data', 'Dividendo', 'VALE3', '900,00'],
      ]),
    ])
    expect(m?.linhas).toHaveLength(2)
    expect(m?.semData).toBe(1)
  })

  it('caixa e acento não criam um segundo tipo', () => {
    const m = lerMovimentacao([
      aba('mov', [
        ['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Valor da Operação'],
        ['Credito', '10/03/2025', 'Dividendo', 'PETR4', '100,00'],
        ['Credito', '11/03/2025', 'DIVIDENDO', 'PETR4', '200,00'],
      ]),
    ])
    expect(m?.tipos).toHaveLength(1)
    expect(m?.tipos[0]).toMatchObject({ movimentacao: 'Dividendo', quantos: 2, total: 300 })
  })
})

describe('fluxo da linha', () => {
  it('«Entrada» e «Crédito» são a mesma leitura, e o desconhecido é desconhecido', () => {
    expect(lerFluxo('Credito')).toBe('entrada')
    expect(lerFluxo('Entrada')).toBe('entrada')
    expect(lerFluxo('Debito')).toBe('saida')
    expect(lerFluxo('Saída')).toBe('saida')
    expect(lerFluxo('')).toBe('desconhecido')
    expect(ehEntrada('qualquer coisa')).toBe(false)
  })
})

describe('data', () => {
  it('lê o texto da planilha e o número de série', () => {
    expect(lerData('11/12/2020')).toEqual({ ano: 2020, mes: 12 })
    // 45000 = 15/03/2023
    expect(lerData('45000')).toEqual({ ano: 2023, mes: 3 })
    expect(textoDaData('45000')).toBe('15/03/2023')
    expect(dataOrdenavel('15/03/2023')).toBe('2023-03-15')
  })

  it('recusa o que não é data, em vez de inventar mês', () => {
    expect(lerData('dezembro')).toBeNull()
    expect(lerData('11/13/2020')).toBeNull()
    expect(lerData('250')).toBeNull()
  })
})

describe('número', () => {
  it('em texto, o ponto de milhar é milhar e o decimal da B3 é decimal', () => {
    expect(numeroDeTexto('1.234')).toBe(1234)
    expect(numeroDeTexto('64.65')).toBe(64.65)
    expect(numeroDeTexto('1.234,56')).toBe(1234.56)
    expect(numeroDeTexto('R$ 1.234,56')).toBe(1234.56)
    expect(numeroDeTexto('(1.234,56)')).toBe(-1234.56)
    expect(numeroDeTexto('-')).toBeNull()
  })

  it('célula NUMÉRICA nunca tem milhar com ponto', () => {
    expect(paraNumero(numerica('1.234'))).toBe(1.234)
    expect(paraNumero(texto('1.500'))).toBe(1500)
  })

  it('a resposta guardada vale para a mesma palavra escrita de outro jeito', () => {
    expect(respostaGuardada({ Dividendo: 'base' }, 'DIVIDENDO')).toBe('base')
    expect(respostaGuardada({ Dividendo: 'base' }, 'Rendimento')).toBeUndefined()
  })
})

describe('vários arquivos, um extrato', () => {
  const compra = () => linha({ movimentacao: 'Compra / Venda', valor: 1000, quantidade: 100, precoUnitario: 10 })

  it('soma os anos, e nenhum arquivo apaga o outro', () => {
    const u = unirMovimentacoes([extrato([linha({ data: '05/03/2024', ano: 2024 })]), extrato([linha()])])!
    expect(u.anos).toEqual([2024, 2025])
    expect(u.linhas).toHaveLength(2)
  })

  it('repetição é entre arquivos, não dentro de um', () => {
    expect(unirMovimentacoes([extrato([compra(), compra()]), extrato([linha({ valor: 7 })])])!.linhas).toHaveLength(3)
    const parte = extrato([compra(), compra()])
    const u = unirMovimentacoes([parte, parte])!
    expect(u.linhas).toHaveLength(2)
    expect(u.repetidas).toBe(2)
  })

  it('nada para juntar devolve null', () => {
    expect(unirMovimentacoes([])).toBeNull()
  })
})
