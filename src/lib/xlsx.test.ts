import { describe, it, expect } from 'vitest'
import { lerXlsx, colunaDaRef, elementos, atributo, desescapar } from './xlsx'
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
