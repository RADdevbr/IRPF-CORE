import { describe, it, expect } from 'vitest'
import { parseDec } from './decParser'

describe('parseDec', () => {
  const text =
    'IRPF  2025 DECLARACAO FULANO DE TAL\r\n' +
    '27 EMPRESA ABC LTDA 0000024000000 FIM\r\n' + // 24000000 centavos → 240.000,00
    '62 BANCO XYZ SA 0000008400000 FIM\r\n' + // 8400000 → 84.000,00
    '88 00012345678 00099 X\r\n' // valores pequenos/curtos → ignorados

  it('detecta o ano do exercício', () => {
    expect(parseDec(text).ano).toBe('2025')
  })

  it('lista os tipos de registro com contagem', () => {
    const r = parseDec(text)
    const tipos = r.registros.map((x) => x.tipo)
    expect(tipos).toContain('27')
    expect(tipos).toContain('62')
  })

  it('extrai valores isolados como candidatos', () => {
    const vals = parseDec(text).candidatos.map((c) => c.valor)
    expect(vals).toContain(240000)
    expect(vals).toContain(84000)
  })

  it('descarta runs longos (campos colados) para não gerar valor errado', () => {
    // dois campos de 13 dígitos colados = 26 dígitos → nenhum candidato
    const colado = 'ZZ ' + '0000024000000' + '0000008400000' + ' FIM\r\n'
    expect(parseDec(colado).candidatos).toHaveLength(0)
  })

  it('ordena candidatos do maior para o menor', () => {
    const cs = parseDec(text).candidatos
    for (let i = 1; i < cs.length; i++) expect(cs[i - 1].valor).toBeGreaterThanOrEqual(cs[i].valor)
  })
})
