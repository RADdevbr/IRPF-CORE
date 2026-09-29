import { describe, it, expect } from 'vitest'
import { parseDec, censo, censoDe, pareceTexto, leituraDe, LEITURA, cnpjValido } from './decParser.js'

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

  it('guarda o código da linha nos Registros 84 e 88: é ele que separa juro de aplicação de JCP e dividendo', () => {
    // 88 com código 06 (aplicação) e 10 (JCP), mesmo leiaute do 84
    const reg88 = (cod: string, cents: number) =>
      '88' + '00000000000' + 'T' + '00000000000' + cod.padStart(4, '0') + '00000000000191' +
      'BANCO EXEMPLO S.A.'.padEnd(60, ' ') + String(cents).padStart(13, '0') + '000000000000000'
    const r = parseDec(['IRPF 2026', reg88('6', 10_000), reg88('10', 2_000), reg84('12', 'BANCO EXEMPLO S.A.', 3_000)].join('\r\n') + '\r\n')
    expect(r.lancamentos.map((l) => [l.tipo, l.codigo, l.valor])).toEqual([
      ['88', '06', 100],
      ['88', '10', 20],
      ['84', '12', 30],
    ])
  })

  it('Registro 84 linha 09 (lucros e dividendos) → Dividendos (base)', () => {
    const r = parseDec('IRPF 2026\r\n' + reg84('9', 'BCO BRASIL S.A.', 6800) + '\r\n') // R$ 68,00
    const lanc = r.lancamentos.find((l) => l.tipo === '84')
    expect(lanc?.valor).toBeCloseTo(68, 2)
    expect(lanc?.fonte).toBe('BCO BRASIL S.A.')
    expect(lanc?.tipoLabel).toBe('Lucros e dividendos')
    expect(lanc?.alvo).toBe('divBR')
  })

  it('Registro 84 outras linhas (LCI/LCA etc.) → isentos, fora da base mas dentro do bolso', () => {
    const r = parseDec('IRPF 2026\r\n' + reg84('12', 'LCI BANCO X', 500000) + '\r\n')
    const lanc = r.lancamentos.find((l) => l.tipo === '84')
    expect(lanc?.valor).toBeCloseTo(5000, 2)
    // `isentos` não é campo do cálculo do IRPFM (nenhum FIELD o lê), então não
    // entra na base — mas é renda recebida, e a análise de consistência precisa
    // dela para não cobrar do patrimônio um dinheiro que a declaração informa
    expect(lanc?.alvo).toBe('isentos')
    expect(lanc?.rotulo).toBe('Isento (cód. 12)')
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

  it('Registro 27 de FII: saldo mesmo com descrição longa e campos extras depois', () => {
    // FII: descrição comprida (não 512), saldos no 1º bloco de 26 díg., e mais
    // campos após (negociado em bolsa, código, CNPJ do fundo…).
    const descr = 'URPR11. 750 COTA COTAS FII . CUSTO MEDIO DE 94.214670 QTDE : 825'
    const linha =
      '27' + '00000000000' + '03' + '0' + '105' + descr.padEnd(200, ' ') +
      '0000007066100' + '0000007481867' + // saldos 70.661,00 e 74.818,67
      '    0000    2    0004600000000    34508872000187    0000000000001URPR11'
    const r = parseDec('IRPF 2026\r\n' + linha + '\r\n')
    const p = r.posicoes[0]
    expect(p.descricao).toContain('URPR11')
    expect(p.saldoAnterior).toBeCloseTo(70661, 2)
    expect(p.saldoAtual).toBeCloseTo(74818.67, 2)
  })

  // O leiaute com grupo, montado nas posições conferidas num arquivo real da
  // declaração 2024 (ver `Posicao`). CPF inventado; CNPJs públicos.
  const CPF = '12345678909'
  const linha27 = (o: { codigo: string; grupo: string; cnpj?: string; cpfDono?: string; descr?: string; exterior?: boolean }) => {
    const l = Array<string>(1195).fill(' ')
    const pos = (ini: number, txt: string) => {
      for (let k = 0; k < txt.length; k++) l[ini - 1 + k] = txt[k]
    }
    pos(1, '27')
    pos(3, CPF)
    pos(14, o.codigo)
    pos(16, o.exterior ? '1249' : '0105')
    pos(20, o.descr ?? 'CONTA CORRENTE AG 1234')
    pos(532, '0000012000000' + '0000015000000')
    if (o.cnpj) pos(1042, o.cnpj)
    pos(1089, 'T')
    pos(1090, o.cpfDono ?? CPF)
    pos(1101, o.grupo)
    return l.join('')
  }
  const ler = (...linhas: string[]) => parseDec(['IRPF 2024', ...linhas].join('\r\n') + '\r\n').posicoes

  it('leiaute com grupo: o grupo vem de 1101–1102, o código de 14–15 e o CNPJ de 1042–1055', () => {
    const [p] = ler(linha27({ codigo: '01', grupo: '06', cnpj: '00000000000191' }))
    expect(p.codigo).toBe('06') // grupo: depósito
    expect(p.subcodigo).toBe('01') // código dentro do grupo
    expect(p.cnpj).toBe('00000000000191')
    expect(p.saldoAtual).toBeCloseTo(150000, 2)
  })

  it('o indicador de exterior e o país não viram código', () => {
    // Era o que acontecia: 16–17 lido como código dava «12» para todo bem no exterior.
    const [p] = ler(linha27({ codigo: '01', grupo: '06', exterior: true }))
    expect(p.codigo).toBe('06')
    expect(p.subcodigo).toBe('01')
  })

  it('CNPJ com verificador errado não é lido — melhor nada que um banco inventado', () => {
    const [p] = ler(linha27({ codigo: '02', grupo: '04', cnpj: '00000000000192' }))
    expect(p.cnpj).toBeUndefined()
    expect(p.codigo).toBe('04')
  })

  it('sem a marca do leiaute novo, a linha fica com o código de 2 dígitos e sem grupo', () => {
    // Dígitos quaisquer em 1101–1102 não bastam: sem o CPF do dono repetido
    // antes deles, o arquivo é tratado como do leiaute antigo.
    const [p] = ler(linha27({ codigo: '61', grupo: '04', cnpj: '00000000000191', cpfDono: '           ' }))
    expect(p.codigo).toBe('61')
    expect(p.subcodigo).toBe('')
    expect(p.cnpj).toBeUndefined()
  })

  it('no arquivo do leiaute novo, a linha sem grupo válido fica sem grupo, e não com o código no lugar dele', () => {
    const [, p] = ler(linha27({ codigo: '01', grupo: '06' }), linha27({ codigo: '02', grupo: '  ', cpfDono: '           ' }))
    expect(p.codigo).toBe('')
    expect(p.subcodigo).toBe('02')
  })

  it('cnpjValido confere os dois dígitos verificadores', () => {
    expect(cnpjValido('00000000000191')).toBe('00000000000191')
    expect(cnpjValido('34.508.872/0001-87')).toBe('34508872000187')
    expect(cnpjValido('34508872000188')).toBeUndefined()
    expect(cnpjValido('00000000000000')).toBeUndefined()
    expect(cnpjValido('123')).toBeUndefined()
  })

  it('ignora campos zerados (não gera lançamento)', () => {
    const semIR = 'IRPF 2025\r\n' + reg21('FONTE X', 10000000, 0) + '\r\n'
    const r = parseDec(semIR)
    expect(r.lancamentos.filter((l) => l.rotulo === 'IR retido')).toHaveLength(0)
    expect(r.lancamentos.filter((l) => l.rotulo === 'Rendimento')).toHaveLength(1)
  })
})

// A tela responde «o app entendeu o meu arquivo?» comparando o censo de tipos
// com LEITURA. Se alguém passar a ler um registro novo no laço e esquecer da
// tabela de rótulos, a tela mente dizendo que o tipo é ignorado — e mente na
// direção que faz o usuário desconfiar de um número que está certo. Este teste
// lê o próprio fonte do leitor porque é lá que mora a verdade.
describe('LEITURA acompanha o que o leitor de fato lê', () => {
  const fonte = Object.entries(
    import.meta.glob('./decParser.ts', { query: '?raw', import: 'default', eager: true }),
  )[0][1] as string

  const tiposDoLaco = () => {
    const s = new Set<string>()
    for (const m of fonte.matchAll(/tipo === '(\w{2})'/g)) s.add(m[1])
    const tabela = fonte.match(/const REGISTROS: Record<string, RegistroSpec> = \{([\s\S]*?)\n\}/)
    for (const m of (tabela?.[1] ?? '').matchAll(/^ {2}'(\w{2})': \{/gm)) s.add(m[1])
    return s
  }

  it('encontra os tipos no fonte — o teste não passa por não achar nada', () => {
    const t = tiposDoLaco()
    expect(t.size).toBeGreaterThanOrEqual(8)
    expect(t.has('27')).toBe(true) // bens, lido no laço
    expect(t.has('21')).toBe(true) // rendimento PJ, lido pela tabela
  })

  it('não sobra nem falta rótulo', () => {
    expect([...tiposDoLaco()].sort()).toEqual(Object.keys(LEITURA).sort())
  })
})

describe('censo', () => {
  const r = [
    { tipo: '27', count: 135 },
    { tipo: '16', count: 3 },
    { tipo: '84', count: 40 },
  ]

  it('separa o que vira número do que só é contado', () => {
    expect(censo(r)).toEqual({ tipos: 3, lidos: 2, linhas: 178, linhasLidas: 175 })
  })

  it('aguenta ano sem censo gravado', () => {
    expect(censo([])).toEqual({ tipos: 0, lidos: 0, linhas: 0, linhasLidas: 0 })
  })

  it('leituraDe devolve null para o que o leitor ignora', () => {
    expect(leituraDe('27')).toBe('bem ou direito')
    expect(leituraDe('16')).toBeNull()
    expect(leituraDe('T9')).toBeNull()
  })
})

// O .DBK é o backup do programa da Receita e pode ter ficha que o .DEC
// transmitido não tem. Para responder «o que tem aqui dentro?» sem inventar
// layout, o censo do arquivo cru só conta prefixos.
describe('censoDe — olhar um arquivo que o leitor não sabe ler', () => {
  it('conta prefixos de duas letras, sem tocar em campo nenhum', () => {
    const texto = ['27 bem um', '27 bem dois', '28 divida', '', '  ', 'T9fim'].join('\n')
    expect(censoDe(texto)).toEqual([
      { tipo: '27', count: 2 },
      { tipo: '28', count: 1 },
      { tipo: 'T9', count: 1 },
    ])
  })

  it('não confunde linha em branco com registro', () => {
    expect(censoDe('\n\n   \n')).toEqual([])
  })

  it('empata por tipo, para a lista não dançar entre leituras', () => {
    expect(censoDe('BB x\nAA y').map((r) => r.tipo)).toEqual(['AA', 'BB'])
  })

  it('pareceTexto separa arquivo de registro de arquivo binário', () => {
    expect(pareceTexto('27 bem\n28 divida\n')).toBe(true)
    expect(pareceTexto('PK\u0003\u0004' + '\u0000\u0001\u0002'.repeat(200))).toBe(false)
    expect(pareceTexto('')).toBe(false)
    expect(pareceTexto('   \n  ')).toBe(false)
  })

  it('tab e quebra de linha não contam como binário', () => {
    expect(pareceTexto('27\tbem\r\n28\tdivida\r\n')).toBe(true)
  })
})
