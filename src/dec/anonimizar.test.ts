import { describe, it, expect } from 'vitest'
import { anonimizarLinha, anonimizar, amostra } from './anonimizar.js'

const LINHA = '27BENS             CDB BANCO X S.A. 12.345.678/0001-99  00000030000000000000040000000'

describe('anonimizador do .DEC', () => {
  it('preserva o tipo do registro — é o que identifica o leiaute', () => {
    expect(anonimizarLinha(LINHA, 'numeros').slice(0, 2)).toBe('27')
    expect(anonimizarLinha(LINHA, 'tudo').slice(0, 2)).toBe('27')
  })

  it('preserva o comprimento exato da linha, que é o que o analisador usa', () => {
    for (const nivel of ['numeros', 'tudo'] as const) {
      expect(anonimizarLinha(LINHA, nivel)).toHaveLength(LINHA.length)
    }
  })

  it('nenhum dígito sobrevive — a permutação não tem ponto fixo', () => {
    const saida = anonimizarLinha(LINHA, 'numeros')
    for (let i = 2; i < LINHA.length; i++) {
      if (/\d/.test(LINHA[i])) expect(saida[i]).not.toBe(LINHA[i])
    }
  })

  it('o CPF/CNPJ não sai reconhecível', () => {
    expect(anonimizarLinha(LINHA, 'numeros')).not.toContain('12.345.678/0001-99')
  })

  it('"numeros" mantém os nomes — ajuda a depurar a classificação', () => {
    expect(anonimizarLinha(LINHA, 'numeros')).toContain('CDB BANCO X')
  })

  it('"tudo" também apaga os nomes', () => {
    const saida = anonimizarLinha(LINHA, 'tudo')
    expect(saida).not.toContain('CDB')
    expect(saida).toContain('XXX XXXXX X')
  })

  it('espaços e pontuação ficam onde estavam', () => {
    const saida = anonimizarLinha(LINHA, 'tudo')
    for (let i = 0; i < LINHA.length; i++) {
      if (/[\s./-]/.test(LINHA[i])) expect(saida[i]).toBe(LINHA[i])
    }
  })

  it('preserva a quantidade de linhas do arquivo', () => {
    const arquivo = [LINHA, LINHA, '', LINHA].join('\n')
    expect(anonimizar(arquivo, 'numeros').split('\n')).toHaveLength(4)
  })

  it('a amostra mostra antes e depois, para conferir o que sai', () => {
    const a = amostra([LINHA, LINHA].join('\n'), 'tudo', 1)
    expect(a).toHaveLength(1)
    expect(a[0].antes).toBe(LINHA)
    expect(a[0].depois).not.toBe(LINHA)
    expect(a[0].depois).toHaveLength(LINHA.length)
  })

  it('linha vazia continua vazia', () => {
    expect(anonimizarLinha('', 'tudo')).toBe('')
  })
})
