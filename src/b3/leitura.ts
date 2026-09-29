// O que todo leitor de relatório da B3 precisa: texto sem acento, número escrito
// por gente, célula de planilha e coluna achada pelo cabeçalho.
//
// Mora no núcleo porque dois apps leem os mesmos relatórios — o IRPF-calc, para o
// imposto, e o networthcontrol, para o patrimônio. Duas cópias destas funções
// divergiriam na primeira vez que a B3 mudasse um cabeçalho, e a divergência
// apareceria como um número diferente para o mesmo arquivo em cada app.

import { type Celula } from '../xlsx/index.js'

export const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()

/**
 * Número escrito por gente: "1.234,56", "R$ 1.234,56", "(1.234,56)" para
 * negativo, "1.234" com o ponto separando milhar.
 *
 * O ponto é ambíguo e essa ambiguidade custava mil vezes: `"1.234"` virava
 * 1,234 — e como a mesma função lê a coluna de QUANTIDADE, 1.500 ações viravam
 * 1,5. Aqui o ponto só é milhar quando separa grupos de exatamente três dígitos
 * e não há vírgula na frente; "64.65", que é como a B3 exporta decimal em
 * arquivo de texto, continua sendo 64,65.
 *
 * O símbolo de moeda e o parêntese contábil eram descartados junto com a linha
 * inteira: `Number("R$ 1.234,56")` é `NaN`, e quem chama tratava `null` como
 * "linha sem valor".
 */
export function numeroDeTexto(texto: string | undefined): number | null {
  const bruto = (texto ?? '').trim()
  if (!bruto) return null
  // (1.234,56) é como planilha contábil escreve −1.234,56
  const contabil = /^\((.*)\)$/.exec(bruto)
  const semParenteses = contabil ? `-${contabil[1]}` : bruto
  const limpo = semParenteses
    .replace(/R\$/gi, '')
    .replace(/\s| /g, '')
    .trim()
  if (!limpo || limpo === '-') return null
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : /^-?\d{1,3}(\.\d{3})+$/.test(limpo)
      ? limpo.replace(/\./g, '')
      : limpo
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Número de célula de planilha.
 *
 * Célula NUMÉRICA vem crua do XML ("47.5"), e nela o ponto é sempre decimal —
 * 1234 nunca aparece como "1.234". Por isso o palpite de milhar vale só para
 * célula de TEXTO: é o tipo da célula, e não o formato do número, que desfaz a
 * ambiguidade do ponto.
 */
export function paraNumero(celula: Celula | undefined): number | null {
  const bruto = celula?.valor?.trim()
  if (!bruto) return null
  if (celula?.tipo === 'n' && !bruto.includes(',')) {
    const n = Number(bruto)
    return Number.isFinite(n) ? n : numeroDeTexto(bruto)
  }
  return numeroDeTexto(bruto)
}

/**
 * A resposta que a pessoa guardou para um texto de evento ou de movimentação,
 * aceitando variação de caixa e de acento.
 *
 * «Dividendo» e «DIVIDENDO» são o mesmo evento e viravam duas perguntas na tela
 * e duas chaves no cofre — enquanto a conferência entre relatórios, que
 * normaliza, tratava as duas como uma. Aqui o mapa é consultado pelo texto como
 * veio e, se não achar, pelo texto normalizado: quem já respondeu não é
 * perguntado de novo só porque o relatório mudou a caixa.
 */
export function respostaGuardada<T>(mapa: Record<string, T>, tipo: string): T | undefined {
  const direta = mapa[tipo]
  if (direta !== undefined) return direta
  const k = semAcento(tipo)
  const chave = Object.keys(mapa).find((c) => semAcento(c) === k)
  return chave === undefined ? undefined : mapa[chave]
}

/**
 * Agrupa por texto normalizado, mostrando o primeiro texto como veio.
 *
 * A chave é `semAcento` pelo mesmo motivo de `respostaGuardada`; o rótulo é o
 * original porque é o que a pessoa vê no arquivo.
 */
export function agruparPorTexto<T>(itens: T[], texto: (i: T) => string): [string, T[]][] {
  const grupos = new Map<string, { rotulo: string; itens: T[] }>()
  itens.forEach((i) => {
    const bruto = texto(i)
    const chave = semAcento(bruto)
    const atual = grupos.get(chave)
    if (atual) atual.itens.push(i)
    else grupos.set(chave, { rotulo: bruto, itens: [i] })
  })
  return [...grupos.values()].map((g) => [g.rotulo, g.itens])
}

export const textoDaCelula = (c: Celula | undefined) => (c?.valor ?? '').trim()
export const linhaVazia = (l: (Celula | undefined)[]) => l.every((c) => !textoDaCelula(c))

/**
 * Índice da coluna cujo cabeçalho casa com uma das palavras, NA ORDEM DADA.
 *
 * A ordem das alternativas é ordem de especificidade, e antes ela não valia
 * nada: o `findIndex` varria as COLUNAS por fora e as alternativas por dentro,
 * então vencia a primeira coluna que casasse com qualquer apelido. Num
 * cabeçalho com «Valor Unitário» antes de «Valor da Operação», o `'valor'`
 * solto do fim da lista casava com a primeira e o extrato inteiro era lido cem
 * vezes menor — sem rodapé para travar, porque o Extrato de Movimentação não
 * tem total impresso. Agora cada alternativa é procurada em todas as colunas
 * antes de a próxima ser tentada.
 */
export function acharColuna(cabecalho: (Celula | undefined)[], ...alternativas: string[]): number {
  return acharColunaSem(cabecalho, [], ...alternativas)
}

/**
 * O mesmo, ignorando colunas cujo cabeçalho traga alguma das palavras vetadas.
 *
 * Existe para o apelido genérico: `'valor'` precisa achar «Valor», «Valor
 * Total» e «Valor (R$)», e precisa NÃO achar «Valor Unitário» — que é outra
 * grandeza, não uma escrita diferente da mesma.
 */
export function acharColunaSem(
  cabecalho: (Celula | undefined)[],
  vetadas: string[],
  ...alternativas: string[]
): number {
  // `Array.from` e não `map`: a linha da planilha é ESPARSA (a coluna vazia
  // vira buraco, não `undefined`), e `map` preserva o buraco — que o
  // `findIndex` logo abaixo visita como `undefined` e quebra.
  const textos = Array.from(cabecalho, (c) => semAcento(textoDaCelula(c)))
  for (const alternativa of alternativas) {
    const alvo = semAcento(alternativa)
    const i = textos.findIndex(
      (t) => t !== '' && t.includes(alvo) && !vetadas.some((v) => t.includes(semAcento(v))),
    )
    if (i >= 0) return i
  }
  return -1
}

