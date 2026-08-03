import { describe, it, expect } from 'vitest'
import { parseDec } from './decParser'

// Constrói uma linha de largura fixa por posição (1-indexado inclusivo).
function put(base: string[], ini: number, s: string, len: number): void {
  const v = s.slice(0, len).padEnd(len, ' ')
  for (let k = 0; k < len; k++) base[ini - 1 + k] = v[k]
}
function numField(base: string[], ini: number, cents: number, len = 13): void {
  put(base, ini, String(cents).padStart(len, '0'), len)
}
function blank(n: number): string[] {
  return new Array(n).fill('0')
}

// REGISTRO 21: rend PJ — nome 28-87, rendimento 88-100, IR retido 127-139.
function reg21(nome: string, rendCents: number, irCents: number): string {
  const b = blank(157)
  put(b, 1, '21', 2)
  put(b, 28, nome, 60)
  numField(b, 88, rendCents)
  numField(b, 127, irCents)
  return b.join('')
}
// REGISTRO 33: dividendos — nome 34-93, valor 94-106.
function reg33(nome: string, lucroCents: number): string {
  const b = blank(127)
  put(b, 1, '33', 2)
  put(b, 34, nome, 60)
  numField(b, 94, lucroCents)
  return b.join('')
}
function reg25(): string {
  const b = blank(60)
  put(b, 1, '25', 2)
  return b.join('')
}

describe('parseDec — leitura posicional', () => {
  const text =
    'IRPF 2025 HEADER\r\n' +
    reg21('CLINICA FICTICIA LTDA', 24000000, 3000000) + '\r\n' + // R$ 240.000 rend, R$ 30.000 IR
    reg33('MINHA PJ HOLDING LTDA', 84000000) + '\r\n' + // R$ 840.000 dividendo
    reg25() + '\r\n' +
    reg25() + '\r\n'

  it('extrai rendimento e IR do registro 21 na escala certa (centavos)', () => {
    const r = parseDec(text)
    const rend = r.lancamentos.find((l) => l.tipo === '21' && l.rotulo === 'Rendimento')
    const ir = r.lancamentos.find((l) => l.tipo === '21' && l.rotulo === 'IR retido')
    expect(rend?.valor).toBeCloseTo(240000, 2)
    expect(rend?.fonte).toBe('CLINICA FICTICIA LTDA')
    expect(rend?.alvo).toBe('salario')
    expect(ir?.valor).toBeCloseTo(30000, 2)
    expect(ir?.alvo).toBe('salario_ir')
  })

  it('NÃO lê dividendos do registro 33 (não usado no arquivo real)', () => {
    const r = parseDec(text)
    expect(r.lancamentos.find((l) => l.tipo === '33')).toBeUndefined()
  })

  it('conta dependentes pelos registros 25', () => {
    expect(parseDec(text).ndep).toBe(2)
  })

  it('detecta o ano e devolve as linhas brutas', () => {
    const r = parseDec(text)
    expect(r.ano).toBe('2025')
    expect(r.linhas.length).toBe(5)
  })

  it('lê Registro 24 por fundo (código + CNPJ + nome + valor) via ancoragem', () => {
    // 24 + benef(0) + código(06) + CNPJ(14) + nome(60) + valor(13)
    const cnpj = '00000000000199'
    const nome = 'FUNDO XP RENDA FIXA FIC'.padEnd(60, ' ')
    const valor = '0000001500000' // 15.000,00
    const linha = '24' + '0' + '06' + cnpj + nome + valor + '0000000000'
    const r = parseDec('IRPF 2025\r\n' + linha + '\r\n')
    const fundo = r.lancamentos.find((l) => l.tipo === '24')
    expect(fundo?.valor).toBeCloseTo(15000, 2)
    expect(fundo?.fonte).toBe('FUNDO XP RENDA FIXA FIC')
    expect(fundo?.alvo).toBe('cdb')
  })

  it('lê Registro 88 (tributação definitiva): nome 44-103, valor 104-116', () => {
    // 88 + CPF(11) + ind(1) + CPFben(11) + cód/CNPJ(18) + nome(60) + valor(13) + resto
    const linha =
      '88' + '00000000000' + 'T' + '00000000000' + '000000000000000000' +
      'BUENA VISTA NEOS GOLD FUNDO DE INDICE'.padEnd(60, ' ') +
      '0000000007795' + '000002904004873' // valor = R$ 77,95
    const r = parseDec('IRPF 2026\r\n' + linha + '\r\n')
    const lanc = r.lancamentos.find((l) => l.tipo === '88')
    expect(lanc?.valor).toBeCloseTo(77.95, 2)
    expect(lanc?.fonte).toBe('BUENA VISTA NEOS GOLD FUNDO DE INDICE')
    expect(lanc?.alvo).toBe('cdb')
  })

  // 84 + CPF(11) + ind(1) + CPFben(11) + código(4) + CNPJ(14) + nome(60) + valor(13) + resto
  const reg84 = (cod: string, nome: string, cents: number) =>
    '84' + '00000000000' + 'T' + '00000000000' + cod.padStart(4, '0') + '00000000000191' +
    nome.padEnd(60, ' ') + String(cents).padStart(13, '0') + '000000000000000'

  it('Registro 84 linha 09 (lucros e dividendos) → Dividendos (base)', () => {
    const r = parseDec('IRPF 2026\r\n' + reg84('9', 'BCO BRASIL S.A.', 6800) + '\r\n') // R$ 68,00
    const lanc = r.lancamentos.find((l) => l.tipo === '84')
    expect(lanc?.valor).toBeCloseTo(68, 2)
    expect(lanc?.fonte).toBe('BCO BRASIL S.A.')
    expect(lanc?.tipoLabel).toBe('Lucros e dividendos')
    expect(lanc?.alvo).toBe('divBR')
  })

  it('Registro 84 outras linhas (LCI/LCA etc.) → ignorar (fora da base)', () => {
    const r = parseDec('IRPF 2026\r\n' + reg84('12', 'LCI BANCO X', 500000) + '\r\n')
    const lanc = r.lancamentos.find((l) => l.tipo === '84')
    expect(lanc?.valor).toBeCloseTo(5000, 2)
    expect(lanc?.alvo).toBe('') // isento → não entra na base
  })

  it('NÃO lê Registro 24 compacto sem nome (evita valores absurdos)', () => {
    // Sem nome/âncora não dá pra localizar o valor com segurança → não importa.
    const linha = '24' + '00000000000' + '00000000000199' + '0762477024495'
    const r = parseDec('IRPF 2026\r\n' + linha + '\r\n')
    expect(r.lancamentos.filter((l) => l.tipo === '24')).toHaveLength(0)
  })

  it('lê Registro 27 (Bens e Direitos): descrição + saldo 31/12 + classe', () => {
    // 27 + CPF(11) + CD_BEM(2) + exterior(1) + país(3=105) + descr(512) + saldoAnt(13) + saldoAtual(13)
    const descr = 'BB RENDA FIXA LP FUNDO DE INVESTIMENTO EM COTAS'.padEnd(512, ' ')
    const linha = '27' + '00000000000' + '01' + '0' + '105' + descr + '0000012000000' + '0000015000000'
    expect(linha.length).toBe(557)
    const r = parseDec('IRPF 2026\r\n' + linha + '\r\n')
    expect(r.posicoes).toHaveLength(1)
    const p = r.posicoes[0]
    expect(p.descricao).toContain('BB RENDA FIXA')
    expect(p.saldoAtual).toBeCloseTo(150000, 2)
    expect(p.saldoAnterior).toBeCloseTo(120000, 2)
    expect(p.tipoCarteira).toBe('fundo')
  })

  it('ignora campos zerados (não gera lançamento)', () => {
    const semIR = 'IRPF 2025\r\n' + reg21('FONTE X', 10000000, 0) + '\r\n'
    const r = parseDec(semIR)
    expect(r.lancamentos.filter((l) => l.rotulo === 'IR retido')).toHaveLength(0)
    expect(r.lancamentos.filter((l) => l.rotulo === 'Rendimento')).toHaveLength(1)
  })
})
