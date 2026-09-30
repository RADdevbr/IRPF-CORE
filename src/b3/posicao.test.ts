import { describe, it, expect } from 'vitest'
import type { Aba, Celula } from '../xlsx/index.js'
import { lerPosicao } from './posicao.js'

const texto = (valor: string): Celula => ({ valor, tipo: 'texto' })
const aba = (nome: string, linhas: string[][]): Aba => ({ nome, linhas: linhas.map((l) => l.map(texto)) })

// O extrato «Posição» da Área do Investidor: uma aba por tipo de papel.
const CAB = ['Produto', 'Instituição', 'Conta', 'Código de Negociação', 'CNPJ da Empresa', 'Código ISIN / Distribuição', 'Tipo', 'Escriturador', 'Quantidade', 'Quantidade Disponível', 'Quantidade Indisponível', 'Motivo', 'Preço de Fechamento', 'Valor Atualizado']

describe('a posição da B3', () => {
  it('lê ações, FII e ETF, com o ticker do código de negociação, e pula total e renda fixa', () => {
    const p = lerPosicao(
      [
        aba('Acoes', [CAB, ['PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS', 'XP INVESTIMENTOS CCTVM S/A', '1', 'PETR4', '', '', 'PN', '', '100', '100', '0', '', '38.5', '3850'], ['Total', '', '', '', '', '', '', '', '', '', '', '', '', '3850']]),
        aba('Fundo de Investimento', [CAB, ['HGLG11 - CSHG LOGISTICA FDO INV IMOB', 'XP INVESTIMENTOS CCTVM S/A', '1', 'HGLG11', '', '', 'Cotas', '', '10', '10', '0', '', '160', '1600']]),
        aba('Renda Fixa', [['Produto', 'Instituição', 'Valor Atualizado'], ['CDB - BANCO X', 'XP', '5000']]),
      ],
      'posicao-2024-12-31.xlsx',
    )
    expect(p?.data).toBe('2024-12-31')
    expect(p?.abas).toEqual(['Acoes', 'Fundo de Investimento'])
    expect(p?.itens.map((i) => [i.ativo, i.quantidade, i.preco, i.valor])).toEqual([
      ['PETR4', 100, 38.5, 3850],
      ['HGLG11', 10, 160, 1600],
    ])
  })

  it('a data também vem do cabeçalho da planilha', () => {
    const p = lerPosicao([aba('Posição', [['Posição em 31/12/2023'], ['Produto', 'Valor Atualizado'], ['ITSA4 - ITAUSA', '1000']])])
    expect(p?.data).toBe('2023-12-31')
    expect(p?.itens[0].ativo).toBe('ITSA4')
  })

  it('planilha com «Produto» e «Valor» mas sem código de negociação não é posição', () => {
    expect(lerPosicao([aba('X', [['Produto', 'Valor'], ['A', '1'], ['Tesouro Selic 2029', '10000']])])).toBeNull()
  })

  it('o extrato de movimentação não passa por posição', () => {
    expect(lerPosicao([aba('Movimentação', [['Entrada/Saída', 'Data', 'Movimentação', 'Produto', 'Instituição', 'Valor da Operação'], ['Credito', '10/03/2024', 'Rendimento', 'HGLG11', 'XP', '10']])])).toBeNull()
  })
})
