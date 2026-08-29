// Referências para comparar: CDI, Selic e IPCA, ano a ano.
//
// O app não fala com a internet — nem poderia, com o cofre cifrado no
// navegador. Então a tabela é embutida, e tudo aqui é editável: se um número
// estiver errado ou faltando, a pessoa corrige e o app usa o dela.
//
// Os anos são o fechamento anual publicado (B3 para o CDI, Banco Central para
// Selic e IPCA). O que ainda não fechou fica VAZIO de propósito: um número
// inventado num gráfico de patrimônio vira decisão errada, e "informe você" é
// melhor do que um palpite com cara de fato.
//
// Onde a fonte diverge por arredondamento — o CDI de 2025 sai como 14,32% ou
// 14,33% dependendo da tabela —, vale o número da fonte primária, e a diferença
// não muda decisão nenhuma neste app: um centésimo de ponto some no primeiro
// arredondamento da tela. Quem tiver o fechamento oficial na mão digita, e o
// digitado manda sobre a tabela.

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
    2025: 0.1432,
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
    // Selic Over acumulada no ano
    2025: 0.1433,
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
    2025: 0.0426,
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
 * Quanto R$ 1 viraria seguindo o índice, a partir do primeiro ano da lista.
 *
 * Serve para comparar ACUMULADO com ACUMULADO: o fator vira percentual
 * (`fator − 1`) e fica ao lado do crescimento acumulado do patrimônio, que
 * também parte de zero. Multiplicar esse fator por um valor em reais e desenhar
 * a linha por cima do patrimônio é o que NÃO se faz aqui — a linha do índice
 * nunca recebe aporte e a do patrimônio recebe, então o índice perderia por
 * construção.
 *
 * Compõe TODOS os anos do intervalo, não só os que a lista traz: com 2020 e
 * 2023 importados, o dinheiro rendeu 2021, 2022 e 2023 — usar só a taxa de 2023
 * faria o CDI parecer três vezes menor do que foi, e a comparação sairia
 * invertida.
 *
 * Ano sem taxa interrompe a série em vez de fingir 0%: uma linha reta num
 * gráfico é uma afirmação, e "não sei" não é uma delas.
 */
export function fatorAcumulado(
  indice: Indice,
  anos: number[],
  informados: BenchmarksInformados = {},
): { anoBase: number; fator: number }[] {
  const saida: { anoBase: number; fator: number }[] = []
  let fator = 1
  for (let i = 0; i < anos.length; i++) {
    if (i === 0) {
      saida.push({ anoBase: anos[i], fator })
      continue
    }
    let completo = true
    for (let ano = anos[i - 1] + 1; ano <= anos[i]; ano++) {
      const taxa = taxaDoAno(indice, ano, informados)
      if (taxa === null) {
        completo = false
        break
      }
      fator *= 1 + taxa
    }
    if (!completo) break
    saida.push({ anoBase: anos[i], fator })
  }
  return saida
}

/**
 * Quanto multiplicar o valor de cada ano para lê-lo em reais do ano-referência.
 *
 * O painel inteiro era nominal (achado PAT-04): entre 2020 e 2025 o IPCA
 * acumulado passa de 30%, então um patrimônio que «cresceu 35%» ficou
 * praticamente parado em poder de compra — e a tela dizia que cresceu.
 *
 * `null` onde falta taxa no caminho, pela mesma regra do resto do módulo: sem o
 * IPCA de um ano do meio não dá para deflacionar, e inventar 0% mentiria menos
 * alto mas mentiria. O ano-referência tem deflator 1 por definição.
 */
export function deflatorPara(
  anoRef: number,
  anos: number[],
  informados: BenchmarksInformados = {},
): { anoBase: number; deflator: number | null }[] {
  return anos.map((anoBase) => {
    if (anoBase === anoRef) return { anoBase, deflator: 1 }
    // só faz sentido trazer o passado para o presente
    if (anoBase > anoRef) return { anoBase, deflator: null }
    let fator = 1
    for (let ano = anoBase + 1; ano <= anoRef; ano++) {
      const taxa = taxaDoAno('ipca', ano, informados)
      if (taxa === null) return { anoBase, deflator: null }
      fator *= 1 + taxa
    }
    return { anoBase, deflator: fator }
  })
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

/**
 * O fechamento mais recente que existe para o índice.
 *
 * A projeção precisa de UMA taxa por referência, e a mais defensável é a do
 * último ano fechado: é um número publicado, não uma média que ninguém viu.
 * O informado entra na disputa — quem digitou o fechamento de um ano que a
 * tabela ainda não tem quer justamente que ele seja o mais recente.
 */
export function ultimoFechamento(
  indice: Indice,
  informados: BenchmarksInformados = {},
): { ano: number; taxa: number } | null {
  const daTabela = Object.keys(TABELA[indice]).map(Number)
  const meus = Object.keys(informados)
    .filter((k) => k.startsWith(`${indice}:`))
    .map((k) => Number(k.slice(indice.length + 1)))
    .filter((n) => Number.isFinite(n))
  const anos = [...new Set([...daTabela, ...meus])].sort((a, b) => b - a)
  for (const ano of anos) {
    const taxa = taxaDoAno(indice, ano, informados)
    if (taxa !== null) return { ano, taxa }
  }
  return null
}
