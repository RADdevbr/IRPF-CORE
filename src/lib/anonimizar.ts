// Anonimizador do .DEC — para depurar leiaute sem expor a declaração.
//
// O que precisa sobreviver: o TIPO de cada registro (2 primeiros dígitos) e as
// POSIÇÕES e TAMANHOS de tudo. O que não pode sobreviver: valores, CPF, CNPJ,
// datas — e, no nível mais forte, também os nomes.
//
// Os dígitos passam por uma permutação sem ponto fixo: todo dígito vira outro,
// então nenhum valor original resta, nem por acaso. Comprimento de linha,
// espaços e pontuação ficam idênticos, que é o que o analisador precisa.

export type Nivel = 'numeros' | 'tudo'

/** 0→7, 1→3, 2→9, 3→1, 4→8, 5→0, 6→4, 7→6, 8→2, 9→5 — nenhum dígito vira ele mesmo. */
const MAPA = '7391804625'

const trocaDigitos = (s: string) => s.replace(/\d/g, (d) => MAPA[Number(d)])

const trocaLetras = (s: string) =>
  s.replace(/[A-Za-zÀ-ÖØ-öø-ÿ]/g, (c) => (c === c.toUpperCase() ? 'X' : 'x'))

/**
 * Anonimiza uma linha preservando o tipo do registro (posições 1–2), que é
 * justamente o que identifica o leiaute.
 */
export function anonimizarLinha(linha: string, nivel: Nivel): string {
  if (linha.length === 0) return linha
  const tipo = linha.slice(0, 2)
  let resto = linha.slice(2)
  resto = trocaDigitos(resto)
  if (nivel === 'tudo') resto = trocaLetras(resto)
  return tipo + resto
}

export function anonimizar(texto: string, nivel: Nivel): string {
  return texto
    .split(/\r\n|\r|\n/)
    .map((l) => anonimizarLinha(l, nivel))
    .join('\n')
}

/** Antes/depois de algumas linhas, para conferir o que sai antes de exportar. */
export function amostra(texto: string, nivel: Nivel, quantas = 3): { antes: string; depois: string }[] {
  return texto
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim())
    .slice(0, quantas)
    .map((l) => ({ antes: l, depois: anonimizarLinha(l, nivel) }))
}
