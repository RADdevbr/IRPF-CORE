// Monta um .xlsx mínimo, para um teste poder largar um arquivo de verdade na tela
// de import em vez de semear o estado por dentro.
//
// Era `scripts/xlsx.mjs`, sem tipos, importado com `@ts-expect-error` de dentro
// de um teste. Veio para o núcleo tipado por dois motivos: dois apps precisam
// dele (quem importa da B3 e quem testa o leitor), e um utilitário que só entra
// no projeto por cima de um `@ts-expect-error` é um utilitário que ninguém
// conserta quando quebra.
//
// Sem dependência, e sem compressão: o leitor do app aceita entrada `stored`
// (método 0), então basta CRC32 e tamanhos. As células saem como `inlineStr`,
// o que dispensa a tabela de strings compartilhadas — três arquivos internos
// bastam, que são exatamente os três que `lerXlsx` procura.

const TABELA = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff
  for (const b of buf) c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escapar = (s: string): string => String(s).replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c)

const letraDaColuna = (i: number): string => {
  let s = ''
  for (let n = i + 1; n > 0; ) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const planilha = (linhas: CelulaMontada[][]): string =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
  linhas
    .map(
      (l, i) =>
        `<row r="${i + 1}">` +
        l
          .map((v, j) =>
            v === '' || v === null || v === undefined
              ? ''
              : `<c r="${letraDaColuna(j)}${i + 1}" t="inlineStr"><is><t>${escapar(String(v))}</t></is></c>`,
          )
          .join('') +
        '</row>',
    )
    .join('') +
  '</sheetData></worksheet>'

/**
 * @param {{nome: string, linhas: (string|number)[][]}[]} abas
 * @returns {Buffer} o .xlsx
 */
/** Uma célula: texto ou número. O leitor aceita os dois. */
export type CelulaMontada = string | number

export interface AbaMontada {
  nome: string
  linhas: CelulaMontada[][]
}

/** Devolve os bytes de um .xlsx com estas abas. */
export function montarXlsx(abas: AbaMontada[]): Uint8Array {
  const arquivos = [
    {
      nome: 'xl/workbook.xml',
      texto:
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        abas.map((a, i) => `<sheet name="${escapar(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      texto:
        '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        abas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        '</Relationships>',
    },
    ...abas.map((a, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, texto: planilha(a.linhas) })),
  ]

  // `Uint8Array` e `DataView` no lugar de `Buffer`: era um script de Node, e no
  // núcleo isto roda também no navegador — onde `Buffer` não existe.
  const bytes = (t: string) => new TextEncoder().encode(t)
  const bloco = (n: number) => {
    const b = new Uint8Array(n)
    return { b, v: new DataView(b.buffer) }
  }

  const locais: Uint8Array[] = []
  const centrais: Uint8Array[] = []
  let deslocamento = 0
  for (const { nome, texto } of arquivos) {
    const dados = bytes(texto)
    const bytesNome = bytes(nome)
    const crc = crc32(dados)

    const { b: local, v: vl } = bloco(30)
    vl.setUint32(0, 0x04034b50, true)
    vl.setUint16(4, 20, true) // versão necessária
    vl.setUint16(6, 0, true) // flags
    vl.setUint16(8, 0, true) // método 0 = stored
    vl.setUint32(14, crc, true)
    vl.setUint32(18, dados.length, true)
    vl.setUint32(22, dados.length, true)
    vl.setUint16(26, bytesNome.length, true)
    locais.push(local, bytesNome, dados)

    const { b: central, v: vc } = bloco(46)
    vc.setUint32(0, 0x02014b50, true)
    vc.setUint16(4, 20, true)
    vc.setUint16(6, 20, true)
    vc.setUint16(8, 0, true)
    vc.setUint16(10, 0, true)
    vc.setUint32(16, crc, true)
    vc.setUint32(20, dados.length, true)
    vc.setUint32(24, dados.length, true)
    vc.setUint16(28, bytesNome.length, true)
    vc.setUint32(42, deslocamento, true)
    centrais.push(central, bytesNome)

    deslocamento += 30 + bytesNome.length + dados.length
  }

  const tamanhoCentral = centrais.reduce((t, x) => t + x.length, 0)
  const { b: fim, v: vf } = bloco(22)
  vf.setUint32(0, 0x06054b50, true)
  vf.setUint16(8, arquivos.length, true)
  vf.setUint16(10, arquivos.length, true)
  vf.setUint32(12, tamanhoCentral, true)
  vf.setUint32(16, deslocamento, true)

  const pedacos = [...locais, ...centrais, fim]
  const total = pedacos.reduce((t, x) => t + x.length, 0)
  const saida = new Uint8Array(total)
  let i = 0
  for (const p of pedacos) {
    saida.set(p, i)
    i += p.length
  }
  return saida
}
