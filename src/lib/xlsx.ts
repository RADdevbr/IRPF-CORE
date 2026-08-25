// Leitor de .xlsx no navegador, sem dependência.
//
// Um .xlsx é um zip com XML dentro. O navegador já sabe descompactar
// (`DecompressionStream`) e já sabe ler texto — então o leitor inteiro cabe
// aqui, e nenhum pacote de terceiro precisa tocar na planilha de ninguém. Num
// app que existe para não mandar dado fiscal para lugar nenhum, essa é a
// diferença entre uma promessa e um fato verificável.
//
// Lê o que interessa a uma planilha de extrato: abas na ordem certa, células
// com o valor já resolvido (texto compartilhado, texto inline ou número) e a
// posição real de cada uma. Não lê fórmula, estilo nem formatação — nada disso
// muda o dado.

export interface Celula {
  /** Valor como texto, já resolvido da tabela de strings quando for o caso. */
  valor: string
  /** Tipo declarado na célula: 's' (compartilhada), 'inlineStr', 'n', 'b'… */
  tipo: string
}

export interface Aba {
  nome: string
  /** Matriz [linha][coluna]. Buracos viram `undefined` — a posição é o dado. */
  linhas: (Celula | undefined)[][]
}

// ------------------------------------------------------------------ zip

interface EntradaZip {
  nome: string
  metodo: number
  inicio: number
  tamanho: number
}

/** 0x06054b50, procurado de trás para frente por causa do comentário final. */
function acharFimDoDiretorio(v: DataView): number {
  const limite = Math.max(0, v.byteLength - 66_000)
  for (let i = v.byteLength - 22; i >= limite; i--) {
    if (v.getUint32(i, true) === 0x06054b50) return i
  }
  return -1
}

/**
 * Entradas do zip lidas pelo diretório central — o único lugar onde os
 * tamanhos são confiáveis: o cabeçalho local pode zerá-los e jogar o tamanho
 * real para um descritor depois dos dados.
 */
function entradasDoZip(buf: ArrayBuffer): EntradaZip[] {
  const v = new DataView(buf)
  const fim = acharFimDoDiretorio(v)
  if (fim < 0) throw new Error('Não parece um arquivo .xlsx: o índice do zip não foi encontrado.')

  const total = v.getUint16(fim + 10, true)
  let p = v.getUint32(fim + 16, true)
  const utf8 = new TextDecoder('utf-8')
  const entradas: EntradaZip[] = []

  for (let i = 0; i < total; i++) {
    if (p + 46 > v.byteLength || v.getUint32(p, true) !== 0x02014b50) break
    const metodo = v.getUint16(p + 10, true)
    const tamanho = v.getUint32(p + 20, true)
    const tamNome = v.getUint16(p + 28, true)
    const tamExtra = v.getUint16(p + 30, true)
    const tamComentario = v.getUint16(p + 32, true)
    const local = v.getUint32(p + 42, true)
    const nome = utf8.decode(new Uint8Array(buf, p + 46, tamNome))

    // No cabeçalho local os campos extras têm outro tamanho que no central:
    // os dados só começam depois deles.
    const nomeLocal = v.getUint16(local + 26, true)
    const extraLocal = v.getUint16(local + 28, true)
    entradas.push({ nome, metodo, inicio: local + 30 + nomeLocal + extraLocal, tamanho })

    p += 46 + tamNome + tamExtra + tamComentario
  }
  return entradas
}

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([dados as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const pedacos: Uint8Array[] = []
  const leitor = fluxo.getReader()
  for (;;) {
    const { done, value } = await leitor.read()
    if (done) break
    pedacos.push(value as Uint8Array)
  }
  const total = pedacos.reduce((s, p) => s + p.length, 0)
  const saida = new Uint8Array(total)
  let off = 0
  for (const p of pedacos) {
    saida.set(p, off)
    off += p.length
  }
  return saida
}

/** Só os arquivos internos que interessam — descompactar o resto é desperdício. */
async function conteudoDoZip(buf: ArrayBuffer, querido: (nome: string) => boolean) {
  const utf8 = new TextDecoder('utf-8')
  const saida = new Map<string, string>()
  for (const e of entradasDoZip(buf)) {
    if (!querido(e.nome)) continue
    const cru = new Uint8Array(buf, e.inicio, e.tamanho)
    saida.set(e.nome, utf8.decode(e.metodo === 0 ? cru : await inflar(cru)))
  }
  return saida
}

// ------------------------------------------------------------------ xml

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

export const desescapar = (s: string): string =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : ENTIDADES[e],
  )

/** Ocorrências de <tag ...>conteúdo</tag>, inclusive a forma vazia <tag ... />. */
export function* elementos(xml: string, tag: string): Generator<{ atributos: string; conteudo: string }> {
  // atributos preguiçosos: com [^>]* guloso, a barra de <tag ... /> seria comida
  // junto e o elemento vazio passaria por elemento com conteúdo
  const re = new RegExp(`<${tag}(\\s[^>]*?)?\\s*(/)?>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const atributos = m[1] ?? ''
    if (m[2]) {
      yield { atributos, conteudo: '' }
      continue
    }
    const fim = xml.indexOf(`</${tag}>`, re.lastIndex)
    if (fim < 0) return
    yield { atributos, conteudo: xml.slice(re.lastIndex, fim) }
    re.lastIndex = fim
  }
}

export const atributo = (atributos: string, nome: string): string | null => {
  const m = atributos.match(new RegExp(`\\s${nome}="([^"]*)"`))
  return m ? m[1] : null
}

/** Texto de um nó, juntando os <t> (uma string formatada vira vários runs). */
const textoDe = (xml: string): string => {
  let saida = ''
  for (const t of elementos(xml, 't')) saida += desescapar(t.conteudo)
  return saida
}

// ------------------------------------------------------------------ planilha

/** 'C' → 2, 'AA' → 26. A posição da célula é informação, não enfeite. */
export const colunaDaRef = (ref: string): number => {
  const letras = (ref.match(/^[A-Z]+/) ?? ['A'])[0]
  let n = 0
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64)
  return n - 1
}

function abasDeclaradas(workbook: string, rels: string) {
  const alvoPorId = new Map<string, string>()
  for (const r of elementos(rels, 'Relationship')) {
    const id = atributo(r.atributos, 'Id')
    const alvo = atributo(r.atributos, 'Target')
    if (id && alvo) alvoPorId.set(id, alvo.replace(/^\/?xl\//, '').replace(/^\//, ''))
  }

  const abas: { nome: string; caminho: string }[] = []
  for (const s of elementos(workbook, 'sheet')) {
    const nome = desescapar(atributo(s.atributos, 'name') ?? `Planilha ${abas.length + 1}`)
    const id = atributo(s.atributos, 'r:id') ?? atributo(s.atributos, 'id')
    const alvo = id ? alvoPorId.get(id) : null
    abas.push({ nome, caminho: `xl/${alvo ?? `worksheets/sheet${abas.length + 1}.xml`}` })
  }
  return abas
}

function lerLinhas(xml: string, strings: string[]): (Celula | undefined)[][] {
  const linhas: (Celula | undefined)[][] = []

  for (const linha of elementos(xml, 'row')) {
    const n = Number(atributo(linha.atributos, 'r') ?? linhas.length + 1)
    const celulas: (Celula | undefined)[] = []
    for (const c of elementos(linha.conteudo, 'c')) {
      const ref = atributo(c.atributos, 'r') ?? ''
      const tipo = atributo(c.atributos, 't') ?? 'n'
      let valor = ''
      if (tipo === 'inlineStr') {
        valor = textoDe(c.conteudo)
      } else {
        const v = [...elementos(c.conteudo, 'v')][0]
        valor = v ? desescapar(v.conteudo) : ''
        if (tipo === 's' && valor !== '') valor = strings[Number(valor)] ?? ''
      }
      celulas[ref ? colunaDaRef(ref) : celulas.length] = { valor, tipo }
    }
    linhas[n - 1] = celulas
  }

  for (let i = 0; i < linhas.length; i++) if (!linhas[i]) linhas[i] = []
  return linhas
}

/** O arquivo inteiro, aba por aba, na ordem em que a planilha as declara. */
export async function lerXlsx(buf: ArrayBuffer): Promise<Aba[]> {
  const querido = (nome: string) =>
    nome === 'xl/workbook.xml' ||
    nome === 'xl/_rels/workbook.xml.rels' ||
    nome === 'xl/sharedStrings.xml' ||
    nome.startsWith('xl/worksheets/')

  const conteudo = await conteudoDoZip(buf, querido)
  const workbook = conteudo.get('xl/workbook.xml')
  if (!workbook) throw new Error('Arquivo .xlsx sem workbook: não dá para saber quais são as abas.')

  const strings = [...elementos(conteudo.get('xl/sharedStrings.xml') ?? '', 'si')].map((si) =>
    textoDe(si.conteudo),
  )

  const abas = abasDeclaradas(workbook, conteudo.get('xl/_rels/workbook.xml.rels') ?? '')
  if (abas.length === 0) throw new Error('Nenhuma aba encontrada no arquivo.')

  return abas.map((aba) => ({
    nome: aba.nome,
    linhas: lerLinhas(conteudo.get(aba.caminho) ?? '', strings),
  }))
}
