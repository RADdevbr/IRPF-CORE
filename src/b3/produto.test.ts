// O corte do texto de produto da B3 — o módulo de que o indício da corretora,
// o agrupamento por CNPJ e a identidade do papel dependem, todos os três.
//
// Ficava dentro do `b3posicao`, e os testes ficaram para trás quando ele mudou
// de casa. Módulo que seis outros importam precisa de teste na própria pasta:
// senão quem for acrescentar um caso ou o escreve num arquivo sobre outro
// assunto, ou não escreve.

import { describe, it, expect } from 'vitest'
import { tickerDoProduto, nomeDoProduto, raizTicker } from './produto.js'

describe('ticker', () => {
  it('pega o código antes do hífen', () => {
    expect(tickerDoProduto('PETR4 - PETROLEO BRASILEIRO S.A.')).toBe('PETR4')
  })

  it('sem hífen, é o produto inteiro', () => {
    expect(tickerDoProduto('  hglg11 ')).toBe('HGLG11')
  })

  it('o sufixo F do fracionário cai fora: é o mesmo papel, em lote menor', () => {
    expect(tickerDoProduto('PETR4F - PETROLEO BRASILEIRO SA')).toBe('PETR4')
  })
})

describe('nome do produto', () => {
  it('pega o que vem DEPOIS do hífen', () => {
    expect(nomeDoProduto('PETR4 - PETROLEO BRASILEIRO S.A.')).toBe('PETROLEO BRASILEIRO S.A.')
  })

  it('nome com hífen não é cortado no meio', () => {
    // «- FII» faz parte do nome, e perdê-lo deixaria produtos diferentes com o
    // mesmo texto para casar
    expect(nomeDoProduto('HGLG11 - CSHG LOGISTICA FDO INV IMOB - FII')).toBe('CSHG LOGISTICA FDO INV IMOB - FII')
  })

  it('sem hífen, não há nome — e devolver o código faria a raiz voltar disfarçada', () => {
    expect(nomeDoProduto('HGLG11')).toBe('')
    expect(nomeDoProduto('')).toBe('')
  })

  it('corta no MESMO lugar que o ticker — e só o código é normalizado', () => {
    // os dois lados do mesmo corte, e é isso que a invariante afirma. Não que
    // as metades remontem o texto original: `tickerDoProduto` põe em maiúscula
    // e o nome vem como veio, então remontar «petr4 - x» não devolve «petr4».
    const p = '  petr4 - petroleo brasileiro sa '
    expect(tickerDoProduto(p)).toBe('PETR4')
    expect(nomeDoProduto(p)).toBe('petroleo brasileiro sa')
  })
})

// PETR3 e PETR4 são a mesma companhia, com o mesmo CNPJ. O gatilho do Art. 6º-A
// conta o total pago pela mesma pessoa jurídica no mês — tratá-los como dois
// pagadores divide os R$ 50 mil em dois e apaga uma retenção que existiu.
describe('raizTicker', () => {
  it('ON, PN e unit da mesma companhia têm a mesma raiz', () => {
    expect(raizTicker('PETR3 - PETROLEO BRASILEIRO')).toBe('PETR')
    expect(raizTicker('PETR4 - PETROLEO BRASILEIRO')).toBe('PETR')
    expect(raizTicker('BPAC11 - BANCO BTG')).toBe('BPAC')
  })

  it('aceita o ticker sozinho, sem o nome do produto', () => {
    expect(raizTicker('VALE3')).toBe('VALE')
  })

  it('empresas diferentes não são agrupadas por parecerem', () => {
    expect(raizTicker('PETR4')).not.toBe(raizTicker('PETZ3'))
  })

  it('o que não tem cara de ticker não recebe palpite', () => {
    // agrupar CDB, fundo ou PJ lançada à mão por um chute juntaria pagadores
    // sem relação nenhuma, que é pior que não agrupar
    expect(raizTicker('CDB BANCO X VENC 2030')).toBeNull()
    expect(raizTicker('CLINICA DO CLAUDE LTDA')).toBeNull()
    expect(raizTicker('')).toBeNull()
    expect(raizTicker('AB3')).toBeNull()
    expect(raizTicker('ABCDE3')).toBeNull()
  })

  it('BDR e ETF, que não são a mesma companhia, ficam de fora do agrupamento por sufixo', () => {
    // 34 é BDR: a raiz existe e agrupa BDRs do mesmo emissor, o que está certo
    expect(raizTicker('AAPL34')).toBe('AAPL')
    // sufixo que não existe na convenção não vira raiz
    expect(raizTicker('XPTO99')).toBeNull()
  })
})
