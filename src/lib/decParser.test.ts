import { describe, it, expect } from 'vitest'
import { parseDec } from './decParser'

describe('parseDec', () => {
  const text =
    'IRPF  2025 DECLARACAO FULANO DE TAL\r\n' +
    '27 EMPRESA ABC LTDA 0000024000000 FIM\r\n' + // bloco 0000024000000 → raw 24000000
    '62 BANCO XYZ SA 0000008400000 FIM\r\n' + // raw 8400000
    '88 00012345678 00099 X\r\n' // curtos → ignorados (00099 < 10000; 00012345678 tem 11 dígitos → raw grande, mantido)

  it('detecta o ano do exercício', () => {
    expect(parseDec(text).ano).toBe('2025')
  })

  it('devolve as linhas brutas para o visor', () => {
    const r = parseDec(text)
    expect(r.linhas.length).toBe(4)
    expect(r.linhas[1]).toContain('EMPRESA ABC')
  })

  it('extrai dígitos brutos sem aplicar escala (÷100 fica na UI)', () => {
    const raws = parseDec(text).candidatos.map((c) => c.raw)
    expect(raws).toContain(24000000) // UI ÷100 → 240.000,00
    expect(raws).toContain(8400000) // UI ÷100 → 84.000,00
  })

  it('mantém os dígitos originais em cada candidato', () => {
    const c = parseDec(text).candidatos.find((x) => x.raw === 24000000)
    expect(c?.digits).toBe('0000024000000')
    expect(c?.contexto).toContain('EMPRESA ABC')
  })

  it('descarta runs longos (campos colados) para não gerar valor errado', () => {
    const colado = 'ZZ ' + '0000024000000' + '0000008400000' + ' FIM\r\n'
    expect(parseDec(colado).candidatos).toHaveLength(0)
  })

  it('ordena candidatos do maior para o menor (raw)', () => {
    const cs = parseDec(text).candidatos
    for (let i = 1; i < cs.length; i++) expect(cs[i - 1].raw).toBeGreaterThanOrEqual(cs[i].raw)
  })
})
