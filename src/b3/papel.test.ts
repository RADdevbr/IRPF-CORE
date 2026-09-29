import { describe, it, expect } from 'vitest'
import { casarAtivo, classificarParaCarteira, papelNoPatrimonio } from './papel.js'

describe('a pergunta da bolsa: isto é negócio?', () => {
  it('liquidação é negócio — o fluxo decide compra ou venda linha a linha', () => {
    expect(classificarParaCarteira('Transferência - Liquidação').papel).toBe('negocio')
    expect(classificarParaCarteira('COMPRA / VENDA').papel).toBe('negocio')
    expect(classificarParaCarteira('Compra/Venda').papel).toBe('negocio')
  })

  it('desdobro, grupamento e bonificação mexem em quantidade', () => {
    expect(classificarParaCarteira('Desdobro').papel).toBe('quantidade')
    expect(classificarParaCarteira('Bonificação em Ativos').papel).toBe('quantidade')
  })

  it('provento não é negócio', () => {
    expect(classificarParaCarteira('Rendimento').papel).toBe('ignorar')
    expect(classificarParaCarteira('PAGAMENTO DE JUROS').papel).toBe('ignorar')
    expect(classificarParaCarteira('Juros Sobre Capital Próprio').papel).toBe('ignorar')
  })

  it('renda fixa fica como pergunta — a apuração de ganho não pode inventar lucro em CDB', () => {
    for (const t of ['APLICAÇÃO', 'VENCIMENTO', 'Resgate']) {
      const r = classificarParaCarteira(t)
      expect(r.papel).toBe('indefinido')
      expect(r.porque).toMatch(/renda fixa/)
    }
  })

  it('transferência e o que não conhece ficam indefinidos, e não são chutados', () => {
    expect(classificarParaCarteira('Transferência').papel).toBe('indefinido')
    expect(classificarParaCarteira('Evento Novo Da B3').papel).toBe('indefinido')
    expect(classificarParaCarteira('').papel).toBe('indefinido')
  })
})

describe('a pergunta do patrimônio: entrou ou saiu dinheiro?', () => {
  it('aplicar e resgatar renda fixa são respostas conhecidas', () => {
    expect(papelNoPatrimonio('APLICAÇÃO')).toBe('negocio')
    expect(papelNoPatrimonio('VENCIMENTO/RESGATE SALDO EM CONTA')).toBe('negocio')
    expect(papelNoPatrimonio('Resgate')).toBe('negocio')
    expect(papelNoPatrimonio('COMPRA / VENDA')).toBe('negocio')
  })

  it('juro de renda fixa é provento', () => {
    expect(papelNoPatrimonio('PAGAMENTO DE JUROS')).toBe('ignorar')
    expect(papelNoPatrimonio('Juros')).toBe('ignorar')
  })

  it('o que ela não conhece fica para a tabela da bolsa', () => {
    expect(papelNoPatrimonio('Dividendo')).toBeNull()
  })
})

describe('casar o ativo com a descrição do bem', () => {
  it('acha o ticker como palavra inteira', () => {
    expect(casarAtivo('VALE ON NM. VALE3. 200 COTAS', 'VALE3')).toBe(true)
    expect(casarAtivo('100 cotas de auro11 - fundo', 'AURO11')).toBe(true)
  })

  it('não casa por pedaço, e ticker curto demais não afirma nada', () => {
    expect(casarAtivo('XPTO VALE33 200 COTAS', 'VALE3')).toBe(false)
    expect(casarAtivo('PETR4X', 'PETR4')).toBe(false)
    expect(casarAtivo('QUALQUER COISA ON', 'ON')).toBe(false)
    expect(casarAtivo('CDB BANCO X', 'CDB')).toBe(false)
  })

  it('produto com parêntese ou sinal de mais é texto, não expressão', () => {
    expect(casarAtivo('TESOURO IPCA+ 2035 - 10 TITULOS', 'TESOURO IPCA+ 2035')).toBe(true)
    expect(casarAtivo('TESOURO IPCAA 2035', 'TESOURO IPCA+ 2035')).toBe(false)
    expect(() => casarAtivo('CDB (PRE) BANCO X', 'CDB (PRE')).not.toThrow()
  })
})
