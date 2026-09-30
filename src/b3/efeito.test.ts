import { describe, it, expect } from 'vitest'
import { chaveDoTipo, leituraNoPatrimonio } from './efeito.js'
import { dinheiroDaLinha, efeitoDaLinha, fluxosDeMovimentos } from './fluxos.js'
import type { Movimento } from './movimentacao.js'

const efeito = (t: string) => leituraNoPatrimonio(t)?.efeito ?? null

const linha = (entradaSaida: string, movimentacao: string, valor: number | null, produto = 'HGLG11 - CSHG LOGISTICA', quantidade: number | null = 10): Movimento => ({
  entradaSaida,
  data: '15/05/2024',
  ano: 2024,
  mes: 5,
  movimentacao,
  produto,
  instituicao: 'XP INVESTIMENTOS CCTVM S/A',
  valor,
  quantidade,
  precoUnitario: valor,
})

describe('a tabela da B3: o que cada tipo faz com o dinheiro do papel', () => {
  it('negócio e custódia: o lado da linha diz se entrou ou saiu', () => {
    for (const t of [
      'Transferência - Liquidação',
      'COMPRA / VENDA',
      'COMPRA/VENDA',
      'Compra/Venda',
      'COMPRA/VENDA DEFINITIVA/CESSAO',
      'MDA COMPRA/VENDA DEFINITIVA MERCADO PRIMARIO',
      'APLICAÇÃO',
      'Compra',
      'Venda',
      'RESGATE ANTECIPADO',
      'RESGATE ANTECIPADO/',
      'VENCIMENTO',
    ]) {
      expect(efeito(t), t).toBe('fluxo')
    }
  })

  it('evento em dinheiro que devolve capital: sai do papel, com «Credito» na linha', () => {
    for (const t of ['Amortização', 'AMORTIZAÇÃO', 'Resgate', 'Restituição de Capital', 'Leilão de Fração', 'VENCIMENTO/RESGATE SALDO EM CONTA']) {
      expect(efeito(t), t).toBe('devolucao')
    }
  })

  it('provento é renda: dividendo, JCP, rendimento, juros, cupom e o repasse do aluguel', () => {
    for (const t of [
      'Dividendo',
      'Juros Sobre Capital Próprio',
      'Rendimento',
      'Juros',
      'PAGAMENTO DE JUROS',
      'PAGAMENTO DE PRÊMIO/RENDIMENTOS',
      'Reembolso',
      'Juros Sobre Capital Próprio - Reativado',
    ]) {
      expect(efeito(t), t).toBe('provento')
    }
  })

  it('evento em ativos, custódia e direitos não movem dinheiro', () => {
    for (const t of [
      'Transferência',
      'Atualização',
      'Bonificação em Ativos',
      'Desdobro',
      'Grupamento',
      'Incorporação',
      'Cisão',
      'Conversão de Ativos',
      'Fração em Ativos',
      'Restituição de Capital em Ações',
      'Direito de Subscrição',
      'Direitos de Subscrição - Exercido',
      'Direitos de Subscrição - Não Exercido',
      'Direito Sobras de Subscrição',
      'Direito Sobras de Subscrição - Não Exercido',
      'Solicitação de Subscrição',
      'Recibo de Subscrição',
      'Cessão de Direitos',
      'Cessão de Direitos - Solicitada',
      'Empréstimo',
      'INCORPORAÇÃO DE JUROS',
      'Liquidação Termo',
      'Dividendo - Transferido',
      'Juros Sobre Capital Próprio - Transferido',
      'Rendimento - Transferido',
      'Evento em Dinheiro - Excluído',
    ]) {
      expect(efeito(t), t).toBe('semDinheiro')
    }
  })

  it('a taxa de custódia sai do bolso, não do título', () => {
    expect(efeito('Cobrança de Taxa Semestral')).toBe('custo')
  })

  it('o que a tabela não conhece fica para a pessoa', () => {
    expect(leituraNoPatrimonio('Evento Novo Da B3')).toBeNull()
    expect(leituraNoPatrimonio('Evento Novo - Transferencia Especial')).toBeNull()
    expect(leituraNoPatrimonio('')).toBeNull()
    // o estado só vale sobre um evento que a tabela conhece
    expect(leituraNoPatrimonio('Evento Novo - Reativado')).toBeNull()
  })

  it('«Resgate» não casa com «RESGATE ANTECIPADO», nem o contrário', () => {
    expect(efeito('Resgate')).toBe('devolucao')
    expect(efeito('Resgate Antecipado')).toBe('fluxo')
  })

  it('a chave junta as grafias que a B3 usa para o mesmo tipo', () => {
    expect(chaveDoTipo(' compra /  venda ')).toBe('COMPRA/VENDA')
    expect(chaveDoTipo('RESGATE ANTECIPADO/')).toBe('RESGATE ANTECIPADO')
    expect(chaveDoTipo('Leilão de Fração')).toBe('LEILAO DE FRACAO')
  })
})

describe('o dinheiro de cada linha', () => {
  it('amortização, restituição e leilão de fração tiram dinheiro do papel, mesmo como «Credito»', () => {
    expect(dinheiroDaLinha(linha('Credito', 'Amortização', 120))).toEqual({ tipo: 'dinheiro', valor: -120 })
    expect(dinheiroDaLinha(linha('Credito', 'Restituição de Capital', 80))).toEqual({ tipo: 'dinheiro', valor: -80 })
    expect(dinheiroDaLinha(linha('Credito', 'Leilão de Fração', 3.5))).toEqual({ tipo: 'dinheiro', valor: -3.5 })
    // o lado nem precisa estar legível: a devolução não depende dele
    expect(dinheiroDaLinha(linha('', 'Amortização', 120))).toEqual({ tipo: 'dinheiro', valor: -120 })
  })

  it('o resgate pelo emissor sai do papel; sem valor, é conversão e fica de fora', () => {
    expect(dinheiroDaLinha(linha('Credito', 'Resgate', 135.63, 'CPLE7 - COPEL'))).toEqual({ tipo: 'dinheiro', valor: -135.63 })
    expect(dinheiroDaLinha(linha('Credito', 'Resgate', null, 'IRDM11 - IRIDIUM'))).toEqual({ tipo: 'fora' })
  })

  it('negócio e renda fixa seguem o lado: crédito entra, débito sai', () => {
    expect(dinheiroDaLinha(linha('Credito', 'Transferência - Liquidação', 3000))).toEqual({ tipo: 'dinheiro', valor: 3000 })
    expect(dinheiroDaLinha(linha('Debito', 'RESGATE ANTECIPADO', 5000))).toEqual({ tipo: 'dinheiro', valor: -5000 })
    expect(dinheiroDaLinha(linha('Debito', 'VENCIMENTO', 10_000))).toEqual({ tipo: 'dinheiro', valor: -10_000 })
  })

  it('vencimento sem valor fica de fora: o dinheiro não está no extrato', () => {
    expect(dinheiroDaLinha(linha('Debito', 'VENCIMENTO', null))).toEqual({ tipo: 'fora' })
  })

  it('transferência, provisão transferida e taxa não são aporte nem resgate — e não são pergunta', () => {
    for (const t of ['Transferência', 'Dividendo - Transferido', 'Atualização', 'Cobrança de Taxa Semestral', 'Dividendo']) {
      expect(dinheiroDaLinha(linha('Credito', t, 100)), t).toEqual({ tipo: 'fora' })
      expect(dinheiroDaLinha(linha('Debito', t, 100)), t).toEqual({ tipo: 'fora' })
    }
  })

  it('a resposta da pessoa manda sobre a tabela', () => {
    expect(efeitoDaLinha('Transferência', { Transferência: 'negocio' })).toBe('fluxo')
    expect(dinheiroDaLinha(linha('Credito', 'Transferência', 500), { transferencia: 'negocio' })).toEqual({ tipo: 'dinheiro', valor: 500 })
    // «indefinido» guardado é falta de resposta, não resposta
    expect(efeitoDaLinha('Amortização', { Amortização: 'indefinido' })).toBe('devolucao')
  })

  it('o tipo desconhecido continua sendo pergunta', () => {
    expect(dinheiroDaLinha(linha('Credito', 'Evento Esquisito', 100))).toEqual({ tipo: 'indefinida' })
  })

  it('no ano, a amortização do FII desconta do que foi comprado', () => {
    const r = fluxosDeMovimentos([
      linha('Credito', 'Transferência - Liquidação', 10_000, 'HGLG11 - CSHG LOGISTICA'),
      linha('Credito', 'Amortização', 400, 'HGLG11 - CSHG LOGISTICA'),
      linha('Credito', 'Rendimento', 90, 'HGLG11 - CSHG LOGISTICA'),
      linha('Credito', 'Transferência', null, 'HGLG11 - CSHG LOGISTICA'),
    ])
    expect(r.indefinidas).toBe(0)
    expect(r.fluxos).toEqual([{ ativo: 'HGLG11', anoBase: 2024, aportado: 10_000, resgatado: 400, liquido: 9_600 }])
  })
})
