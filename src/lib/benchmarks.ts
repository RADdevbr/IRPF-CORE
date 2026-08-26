// Referências para comparar: CDI, Selic e IPCA, ano a ano.
//
// O app não fala com a internet — nem poderia, com o cofre cifrado no
// navegador. Então a tabela é embutida, e tudo aqui é editável: se um número
// estiver errado ou faltando, a pessoa corrige e o app usa o dela.
//
// Os anos até 2024 são o fechamento anual publicado (B3 para o CDI, Banco
// Central para Selic e IPCA). De 2025 em diante ficam VAZIOS de propósito: um
// número inventado num gráfico de patrimônio vira decisão errada, e "informe
// você" é melhor do que um palpite com cara de fato.

export type Indice = 'cdi' | 'selic' | 'ipca'

export const NOME_INDICE: Record<Indice, string> = {
  cdi: 'CDI',
  selic: 'Selic',
  ipca: 'IPCA',
}

/** Variação acumulada no ano, em fração (0,1088 = 10,88%). */
export const TABELA: Record<Indice, Record<number, number>> = {
  cdi: {
    2016: 0.14,
    2017: 0.0993,
    2018: 0.0642,
    2019: 0.0596,
    2020: 0.0276,
    2021: 0.0442,
    2022: 0.1239,
    2023: 0.1304,
    2024: 0.1088,
  },
  selic: {
    2016: 0.14,
    2017: 0.0995,
    2018: 0.064,
    2019: 0.0597,
    2020: 0.0277,
    2021: 0.0442,
    2022: 0.1239,
    2023: 0.1304,
    2024: 0.1089,
  },
  ipca: {
    2016: 0.0629,
    2017: 0.0295,
    2018: 0.0375,
    2019: 0.0431,
    2020: 0.0452,
    2021: 0.1006,
    2022: 0.0579,
    2023: 0.0462,
    2024: 0.0483,
  },
}

/** O que a pessoa digitou: chave `indice:ano`, valor em fração. */
export type BenchmarksInformados = Record<string, number>

export const chaveBenchmark = (indice: Indice, ano: number) => `${indice}:${ano}`

/** O informado manda sobre a tabela; sem os dois, null (a tela pede o número). */
export function taxaDoAno(indice: Indice, ano: number, informados: BenchmarksInformados = {}): number | null {
  const meu = informados[chaveBenchmark(indice, ano)]
  if (typeof meu === 'number' && Number.isFinite(meu)) return meu
  const t = TABELA[indice][ano]
  return typeof t === 'number' ? t : null
}

/**
 * Anos sem taxa DENTRO do intervalo — inclusive os que não foram importados.
 *
 * Uma barra que cobre 2020 → 2023 é comparada com três anos de índice, então
 * falta o CDI de 2022 mesmo que 2022 não tenha declaração: sem ele aquela barra
 * fica sem referência.
 */
export function anosSemTaxa(indice: Indice, anos: number[], informados: BenchmarksInformados = {}): number[] {
  if (anos.length === 0) return []
  const faltando: number[] = []
  for (let ano = Math.min(...anos); ano <= Math.max(...anos); ano++) {
    if (taxaDoAno(indice, ano, informados) === null) faltando.push(ano)
  }
  return faltando
}

/**
 * Variação acumulada do índice em um período de N anos terminando em `ano`.
 *
 * Existe porque a linha da tabela às vezes mede três anos (falta declaração no
 * meio): comparar "64% em 3 anos" com o CDI de um ano só faria o patrimônio
 * parecer três vezes melhor do que foi.
 */
export function taxaDoPeriodo(
  indice: Indice,
  ano: number,
  anos: number,
  informados: BenchmarksInformados = {},
): number | null {
  let fator = 1
  for (let a = ano - anos + 1; a <= ano; a++) {
    const taxa = taxaDoAno(indice, a, informados)
    if (taxa === null) return null
    fator *= 1 + taxa
  }
  return fator - 1
}
