import { describe, it, expect } from 'vitest'
import {
  lerXlsx,
  colunaDaRef,
  elementos,
  atributo,
  desescapar,
  MAX_LINHAS,
  MAX_COLUNAS,
} from './xlsx'
import { xlsxExemplo } from './xlsxExemplo'

describe('leitor de .xlsx', () => {
  it('lê as abas na ordem em que a planilha as declara', async () => {
    const abas = await lerXlsx(xlsxExemplo())
    expect(abas.map((a) => a.nome)).toEqual(['Proventos', 'Renda Fixa'])
  })

  it('resolve texto da tabela de strings compartilhadas', async () => {
    const [proventos] = await lerXlsx(xlsxExemplo())
    // linha 4 é o cabeçalho da tabela; antes dela vêm título e período
    expect(proventos.linhas[3].map((c) => c?.valor)).toEqual([
      'Produto',
      'Pagamento',
      'Tipo de Evento',
      'Instituição',
      'Quantidade',
      'Preço unitário',
      'Valor líquido',
      'CPF/CNPJ',
    ])
  })

  it('resolve string inline, que não passa pela tabela compartilhada', async () => {
    const [, rendaFixa] = await lerXlsx(xlsxExemplo())
    expect(rendaFixa.linhas[0].map((c) => c?.valor)).toEqual(['Posição', 'Valor bruto'])
    expect(rendaFixa.linhas[1][0]?.valor).toBe('CDB BANCO XPTO 110% CDI')
  })

  it('lê célula numérica crua sem mexer no valor', async () => {
    const [, rendaFixa] = await lerXlsx(xlsxExemplo())
    expect(rendaFixa.linhas[1][1]).toEqual({ valor: '523400.55', tipo: 'n' })
  })

  it('preserva a estrutura: linha em branco e linhas antes do cabeçalho', async () => {
    const [proventos] = await lerXlsx(xlsxExemplo())
    expect(proventos.linhas[0][0]?.valor).toBe('Extrato de proventos recebidos')
    expect(proventos.linhas[2].filter(Boolean)).toEqual([]) // a linha vazia continua lá
    expect(proventos.linhas).toHaveLength(8)
  })

  it('recusa arquivo que não é zip, em vez de devolver planilha vazia', async () => {
    const lixo = new TextEncoder().encode('isto aqui é um PDF, não uma planilha').buffer
    await expect(lerXlsx(lixo)).rejects.toThrow(/não parece um arquivo \.xlsx/i)
  })
})

describe('peças do leitor', () => {
  it('converte referência de coluna em índice', () => {
    expect(colunaDaRef('A1')).toBe(0)
    expect(colunaDaRef('C7')).toBe(2)
    expect(colunaDaRef('AA1')).toBe(26)
  })

  it('trata tag vazia como elemento sem conteúdo — e não engole o resto do XML', () => {
    const xml = '<r><a x="1"/><a x="2">dois</a></r>'
    const achados = [...elementos(xml, 'a')]
    expect(achados).toHaveLength(2)
    expect(achados[0].conteudo).toBe('')
    expect(atributo(achados[0].atributos, 'x')).toBe('1')
    expect(achados[1].conteudo).toBe('dois')
  })

  it('não confunde tag com outra de mesmo prefixo', () => {
    expect([...elementos('<sheetData><row r="1"/></sheetData>', 'sheet')]).toHaveLength(0)
  })

  it('desescapa entidades XML, inclusive numéricas', () => {
    expect(desescapar('a &amp; b &lt;c&gt; &#233; &#xe9;')).toBe('a & b <c> é é')
  })
})


/**
 * Um .xlsx mínimo montado no teste, com os arquivos internos GUARDADOS sem
 * compressão (método 0) — que o leitor já sabe abrir.
 *
 * Existe para poder injetar XML de planilha arbitrário: o exemplo em base64 é
 * um arquivo fixo, e o que estes testes precisam exercitar é justamente o que
 * um arquivo bem-comportado não tem.
 */
function zipGuardado(arquivos: { nome: string; texto: string }[]): ArrayBuffer {
  const enc = new TextEncoder()
  const partes: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  const u16 = (v: DataView, p: number, n: number) => v.setUint16(p, n, true)
  const u32 = (v: DataView, p: number, n: number) => v.setUint32(p, n, true)

  for (const a of arquivos) {
    const nome = enc.encode(a.nome)
    const dados = enc.encode(a.texto)

    const local = new Uint8Array(30 + nome.length)
    const lv = new DataView(local.buffer)
    u32(lv, 0, 0x04034b50)
    u16(lv, 4, 20)
    u16(lv, 8, 0) // método 0 = guardado
    u32(lv, 18, dados.length)
    u32(lv, 22, dados.length)
    u16(lv, 26, nome.length)
    local.set(nome, 30)

    const cd = new Uint8Array(46 + nome.length)
    const cv = new DataView(cd.buffer)
    u32(cv, 0, 0x02014b50)
    u16(cv, 4, 20)
    u16(cv, 6, 20)
    u16(cv, 10, 0)
    u32(cv, 20, dados.length)
    u32(cv, 24, dados.length)
    u16(cv, 28, nome.length)
    u32(cv, 42, offset)
    cd.set(nome, 46)

    partes.push(local, dados)
    central.push(cd)
    offset += local.length + dados.length
  }

  const tamCentral = central.reduce((s, c) => s + c.length, 0)
  const fim = new Uint8Array(22)
  const fv = new DataView(fim.buffer)
  u32(fv, 0, 0x06054b50)
  u16(fv, 8, arquivos.length)
  u16(fv, 10, arquivos.length)
  u32(fv, 12, tamCentral)
  u32(fv, 16, offset)

  const todas = [...partes, ...central, fim]
  const total = todas.reduce((s, p) => s + p.length, 0)
  const saida = new Uint8Array(total)
  let p = 0
  for (const b of todas) {
    saida.set(b, p)
    p += b.length
  }
  return saida.buffer
}

/** As linhas da única aba de uma planilha feita a partir deste `<sheetData>`. */
async function linhasDe(sheetData: string) {
  const buf = zipGuardado([
    {
      nome: 'xl/workbook.xml',
      texto: '<workbook><sheets><sheet name="Teste" r:id="rId1"/></sheets></workbook>',
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      texto:
        '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    },
    {
      nome: 'xl/worksheets/sheet1.xml',
      texto: `<worksheet><sheetData>${sheetData}</sheetData></worksheet>`,
    },
  ])
  const [aba] = await lerXlsx(buf)
  return aba.linhas
}

// O leitor abre planilha que veio de fora. Um arquivo malformado — ou feito de
// propósito — não pode custar a aba de quem clicou. Estes testes travam os
// tetos que impedem isso.
describe('planilha hostil', () => {
  it('linha com índice fora da faixa do formato é descartada, não plantada', async () => {
    const linhas = await linhasDe(`
      <row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row>
      <row r="${MAX_LINHAS + 1}"><c r="A2" t="inlineStr"><is><t>longe</t></is></c></row>
      <row r="500000000"><c r="A3" t="inlineStr"><is><t>absurdo</t></is></c></row>
    `)
    expect(linhas.length).toBe(1)
    expect(linhas[0][0]?.valor).toBe('ok')
  })

  it('índice não numérico ou zero também não entra', async () => {
    const linhas = await linhasDe(`
      <row r="0"><c r="A1" t="inlineStr"><is><t>zero</t></is></c></row>
      <row r="abc"><c r="A1" t="inlineStr"><is><t>texto</t></is></c></row>
      <row r="2.5"><c r="A1" t="inlineStr"><is><t>fracao</t></is></c></row>
    `)
    expect(linhas.length).toBe(0)
  })

  it('a linha legítima no fim do formato continua sendo lida', async () => {
    const linhas = await linhasDe(
      `<row r="${MAX_LINHAS}"><c r="A1" t="inlineStr"><is><t>ultima</t></is></c></row>`,
    )
    expect(linhas.length).toBe(MAX_LINHAS)
    expect(linhas[MAX_LINHAS - 1][0]?.valor).toBe('ultima')
  })

  it('referência de coluna absurda para no teto do formato', () => {
    expect(colunaDaRef('A')).toBe(0)
    expect(colunaDaRef('XFD')).toBe(16383) // a última coluna real
    expect(colunaDaRef('ZZZZZZZZ')).toBe(MAX_COLUNAS - 1)
  })

  it('entidade XML impossível não derruba o import', () => {
    expect(() => desescapar('&#x110000;')).not.toThrow()
    expect(desescapar('&#x110000;')).toBe('&#x110000;')
    expect(desescapar('&#99999999999;')).toBe('&#99999999999;')
    // e a entidade válida continua funcionando
    expect(desescapar('&#65;&amp;&#x42;')).toBe('A&B')
  })
})
