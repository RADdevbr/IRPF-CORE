import { describe, it, expect } from 'vitest'
import type { Aba, Celula } from '../xlsx/index.js'
import { dayTrade, lerNegociacao } from './negociacao.js'
import { lerMovimentacao } from './movimentacao.js'

const texto = (valor: string): Celula => ({ valor, tipo: 's' })
const aba = (nome: string, linhas: string[][]): Aba => ({ nome, linhas: linhas.map((l) => l.map(texto)) })

const CAB = ['Data do Negócio', 'Tipo de Movimentação', 'Mercado', 'Prazo/Vencimento', 'Instituição', 'Código de Negociação', 'Quantidade', 'Preço', 'Valor']
const ARQUIVO = [
  aba('Negociação', [
    CAB,
    ['02/03/2024', 'Compra', 'Mercado à Vista', '-', 'XP INVESTIMENTOS', 'PETR4', '100', '38,00', '3.800,00'],
    ['02/03/2024', 'Venda', 'Mercado à Vista', '-', 'XP INVESTIMENTOS', 'PETR4', '100', '38,50', '3.850,00'],
    ['05/03/2024', 'Compra', 'Mercado à Vista', '-', 'XP INVESTIMENTOS', 'VALE3', '10', '60,00', '600,00'],
    ['10/01/2025', 'Compra', 'Mercado Fracionário', '-', 'XP INVESTIMENTOS', 'ITSA4F', '50', '10,00', '500,00'],
    ['10/01/2025', 'Venda', 'Mercado Fracionário', '-', 'XP INVESTIMENTOS', 'ITSA4F', '30', '9,50', '285,00'],
  ]),
]

describe('o extrato de negociação', () => {
  it('lê cada ordem, com o ticker sem o F do fracionário', () => {
    const n = lerNegociacao(ARQUIVO)
    expect(n).toHaveLength(5)
    expect(n?.[3]).toMatchObject({ ativo: 'ITSA4', tipo: 'compra', quantidade: 50, preco: 10, valor: 500, ano: 2025 })
  })

  it('não é mais lido como movimentação', () => {
    expect(lerMovimentacao(ARQUIVO)).toBeNull()
  })

  it('o day trade é a quantidade casada no mesmo dia, papel e corretora', () => {
    const d = dayTrade(lerNegociacao(ARQUIVO) ?? [])
    expect(d).toEqual([
      { anoBase: 2024, resultado: 50, operacoes: 1, volume: 3_800 },
      // 30 casadas: compra média 10, venda 9,50 → −15
      { anoBase: 2025, resultado: -15, operacoes: 1, volume: 300 },
    ])
  })
})
