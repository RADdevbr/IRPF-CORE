// Monta um .xlsx mínimo, para os roteiros poderem largar um arquivo de verdade
// na tela de import em vez de semear o estado por dentro.
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

const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = TABELA[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const escapar = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const letraDaColuna = (i) => {
  let s = ''
  for (let n = i + 1; n > 0; ) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const planilha = (linhas) =>
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
              : `<c r="${letraDaColuna(j)}${i + 1}" t="inlineStr"><is><t>${escapar(v)}</t></is></c>`,
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
export function montarXlsx(abas) {
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

  const locais = []
  const centrais = []
  let deslocamento = 0
  for (const { nome, texto } of arquivos) {
    const dados = Buffer.from(texto, 'utf8')
    const bytesNome = Buffer.from(nome, 'utf8')
    const crc = crc32(dados)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versão necessária
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(0, 8) // método 0 = stored
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(dados.length, 22)
    local.writeUInt16LE(bytesNome.length, 26)
    locais.push(local, bytesNome, dados)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dados.length, 20)
    central.writeUInt32LE(dados.length, 24)
    central.writeUInt16LE(bytesNome.length, 28)
    central.writeUInt32LE(deslocamento, 42)
    centrais.push(central, bytesNome)

    deslocamento += 30 + bytesNome.length + dados.length
  }

  const dirCentral = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(arquivos.length, 8)
  fim.writeUInt16LE(arquivos.length, 10)
  fim.writeUInt32LE(dirCentral.length, 12)
  fim.writeUInt32LE(deslocamento, 16)

  return Buffer.concat([...locais, dirCentral, fim])
}
