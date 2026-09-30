// O «Extrato de Movimentação» é o outro relatório da B3, e o único com DATA:
//
//     Entrada/Saída | Data | Movimentação | Produto | Instituição | Quantidade |
//     Preço unitário | Valor da Operação
//
// É ele que permite montar a grade [mês × pagador], onde mora o gatilho mensal
// do Art. 6º-A. Em compensação vem tudo misturado — compra, venda,
// transferência, provento, bonificação — e três coisas dele exigem cuidado:
//
//   · quatro em cada sete tipos de movimentação NÃO têm valor (a planilha traz
//     um traço). São eventos de custódia, não de dinheiro. Contá-los como zero
//     seria mentir por omissão, então eles são contados e relatados à parte;
//   · não há total impresso, então a trava de somar-contra-o-rodapé que existe
//     no relatório anual NÃO existe aqui. O leitor não finge que conferiu;
//   · «Entrada/Saída» distingue crédito de débito. Um provento que saiu não é
//     renda recebida, e por isso o campo é preservado em vez de descartado.
//
// Que texto de «Movimentação» é provento — e qual é compra, venda ou
// transferência — depende do catálogo da B3, que muda. Em vez de adivinhar, o
// leitor devolve os tipos encontrados com quantidade e total, para a tela
// perguntar uma vez e guardar a resposta.
//
// Saiu do IRPF-calc para o núcleo sem mudar o comportamento: o networthcontrol
// lê o mesmo arquivo para separar aporte de rendimento, e dois leitores do mesmo
// relatório divergiriam na primeira renomeação da B3.

import { type Aba } from '../xlsx/index.js'
import {
  acharColuna,
  acharColunaSem,
  agruparPorTexto,
  linhaVazia,
  paraNumero,
  semAcento,
  textoDaCelula,
} from './leitura.js'

/** O que a coluna «Entrada/Saída» diz sobre a linha. */
export type Fluxo = 'entrada' | 'saida' | 'desconhecido'

/**
 * Entrou, saiu, ou não dá para saber.
 *
 * Mora aqui e não na tela porque quatro lugares dependem de responder isto do
 * mesmo jeito — a grade de dividendos, o provento guardado ano a ano, a
 * conferência entre relatórios e a apuração de bolsa. Se a conferência somasse
 * por um critério e a grade por outro, ela passaria a certificar um total que a
 * conta não usa.
 *
 * E o desconhecido é uma resposta, não um padrão. Antes eram duas funções com
 * padrões OPOSTOS: aqui, tudo que não começava com «débito» era entrada; na
 * apuração de bolsa, tudo que não começava com «crédito» era saída. Nos textos
 * de hoje («Credito», «Debito») as duas concordam; em qualquer outro — célula
 * vazia, coluna renomeada, ou os «Entrada»/«Saída» que o próprio nome da coluna
 * anuncia — o mesmo arquivo produzia provento fantasma de um lado e toda compra
 * virando venda do outro. Agora as duas leem daqui, e o que não dá para
 * classificar fica de fora das duas contas e é CONTADO.
 */
export function lerFluxo(texto: string): Fluxo {
  const t = semAcento(texto)
  if (t.startsWith('credito') || t.startsWith('entrada')) return 'entrada'
  if (t.startsWith('debito') || t.startsWith('saida')) return 'saida'
  return 'desconhecido'
}

/** Crédito, e só crédito: o desconhecido não conta como renda recebida. */
export const ehEntrada = (fluxo: string): boolean => lerFluxo(fluxo) === 'entrada'

export interface Movimento {
  entradaSaida: string
  /** Como veio na planilha, para conferência. */
  data: string
  ano: number
  /** 1 a 12. */
  mes: number
  movimentacao: string
  produto: string
  instituicao: string
  /** `null` quando a planilha não traz valor (evento de custódia). */
  valor: number | null
  /** `null` quando a linha não tem quantidade — nem toda movimentação tem. */
  quantidade: number | null
  /** `null` quando a planilha traz «-» no lugar do preço (bonificação, desdobro). */
  precoUnitario: number | null
}

export interface GrupoMovimento {
  movimentacao: string
  quantos: number
  /** Soma das linhas que têm valor. */
  total: number
  /** Linhas deste tipo que vieram sem valor nenhum. */
  semValor: number
  /** Quantas são crédito e quantas são débito, pelo texto de Entrada/Saída. */
  porFluxo: { fluxo: string; quantos: number }[]
}

export interface Movimentacao {
  aba: string
  linhas: Movimento[]
  tipos: GrupoMovimento[]
  /** Anos presentes no arquivo, em ordem. */
  anos: number[]
  /** Linhas sem valor numérico — relatadas, nunca descartadas em silêncio. */
  semValor: number
  /**
   * Linhas com conteúdo e sem data legível. Sem data não há como situar no ano,
   * e o mês é o eixo do gatilho do Art. 6º-A — mas sumir com elas em silêncio
   * era a mesma perda que o `semValor` ao lado sempre relatou.
   */
  semData: number
  /** Linhas em que "Entrada/Saída" não diz nem entrada nem saída. */
  semFluxo: number
  /** Se a planilha traz a coluna de fluxo. Sem ela, nada dá para classificar. */
  temColunaFluxo: boolean
  /** Linhas idênticas a outras já lidas de OUTRO arquivo, descartadas na união. */
  repetidas: number
  /** Primeira e última data lidas, em aaaa-mm-dd. '' quando não há nenhuma. */
  de: string
  ate: string
}

/**
 * Data da planilha → ano e mês. `null` para qualquer outra coisa.
 *
 * Aceita o texto `dd/mm/aaaa`, que é como a B3 exporta hoje, E o número de
 * série do Excel, que é como a mesma coluna chega se a planilha marcar a célula
 * como data — aí o XML traz `45000` e o leitor via "45000". Toda linha cairia
 * fora por falta de data, e o arquivo inteiro viraria «não reconheci».
 *
 * A faixa aceita vai de 1970 a 2064: fora dela é número, não data, e converter
 * qualquer inteiro em data acharia data em coluna de valor.
 */
const SERIAL_MIN = 25_569 // 01/01/1970
const SERIAL_MAX = 60_000 // 2064

/**
 * O número de série vira data. O epoch do Excel é 30/12/1899 — o dia 0 do
 * sistema 1900, já com o 29/02/1900 inexistente que a planilha insiste em
 * contar.
 */
function dataDoSerial(bruto: string): Date | null {
  if (!/^\d{4,5}(\.\d+)?$/.test(bruto)) return null
  const serial = Number(bruto)
  if (serial < SERIAL_MIN || serial > SERIAL_MAX) return null
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000)
}

export function lerData(texto: string): { ano: number; mes: number } | null {
  const bruto = texto.trim()
  const m = bruto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) {
    const mes = Number(m[2])
    const ano = Number(m[3])
    if (mes < 1 || mes > 12) return null
    return { ano, mes }
  }
  const d = dataDoSerial(bruto)
  return d ? { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 } : null
}

/**
 * A data como a planilha deveria ter escrito: `dd/mm/aaaa`.
 *
 * O texto da data não é enfeite — ele é parte da chave que identifica linha
 * repetida e do dia que casa as duas pontas de um day trade. Guardar «45000»
 * ali faria duas linhas do mesmo dia parecerem de dias diferentes conforme o
 * arquivo tivesse vindo com data de texto ou de planilha.
 */
export function textoDaData(bruto: string): string {
  const d = dataDoSerial(bruto.trim())
  if (!d) return bruto.trim()
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

/** dd/mm/aaaa → aaaa-mm-dd, para comparar e ordenar data sem parsear de novo. */
export function dataOrdenavel(texto: string): string {
  const m = texto.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  const q = lerData(texto)
  return q ? `${q.ano}-${String(q.mes).padStart(2, '0')}-01` : ''
}

function agruparMovimentos(linhas: Movimento[]): GrupoMovimento[] {
  return agruparPorTexto(linhas, (l) => l.movimentacao)
    .map(([movimentacao, doTipo]) => {
      const fluxos = new Map<string, number>()
      doTipo.forEach((l) => fluxos.set(l.entradaSaida, (fluxos.get(l.entradaSaida) ?? 0) + 1))
      return {
        movimentacao,
        quantos: doTipo.length,
        total: doTipo.reduce((s, l) => s + (l.valor ?? 0), 0),
        semValor: doTipo.filter((l) => l.valor === null).length,
        porFluxo: [...fluxos.entries()]
          .map(([fluxo, quantos]) => ({ fluxo, quantos }))
          .sort((a, b) => b.quantos - a.quantos),
      }
    })
    .sort((a, b) => b.quantos - a.quantos)
}

export function lerMovimentacao(abas: Aba[]): Movimentacao | null {
  for (const aba of abas) {
    const iCab = aba.linhas.findIndex(
      (l) => acharColuna(l, 'movimentacao') >= 0 && acharColuna(l, 'data') >= 0,
    )
    if (iCab < 0) continue

    const cab = aba.linhas[iCab]
    // O de Negociação também tem «Movimentação» e «Data» no cabeçalho, e lido
    // como movimentação dava mil linhas sem produto e sem lado. Ele tem leitor
    // próprio (`lerNegociacao`).
    if (acharColuna(cab, 'data do negocio') >= 0 && acharColuna(cab, 'produto') < 0) continue
    const col = {
      fluxo: acharColuna(cab, 'entrada/saida', 'entrada / saida', 'entrada'),
      data: acharColuna(cab, 'data'),
      movimentacao: acharColuna(cab, 'movimentacao'),
      produto: acharColuna(cab, 'produto'),
      instituicao: acharColuna(cab, 'instituicao'),
      // A ordem aqui é ordem de especificidade, e agora ela vale (ver
      // `acharColuna`). «Valor Unitário» fica vetado: é outra grandeza.
      valor: acharColunaSem(cab, ['unitario'], 'valor da operacao', 'valor liquido', 'valor total', 'valor'),
      // Quantidade e preço unitário são o que permite reconstruir preço médio e
      // apurar ganho na venda. Sem elas, a movimentação só serve para provento.
      quantidade: acharColuna(cab, 'quantidade'),
      precoUnitario: acharColuna(cab, 'preco unitario', 'valor unitario'),
    }
    if (col.valor < 0) continue

    const linhas: Movimento[] = []
    let semData = 0
    // Sem `break` na linha em branco: uma linha separadora no meio da tabela
    // truncava o extrato em silêncio, e este relatório não tem total impresso
    // para acusar a falta. Linha vazia é pulada; linha com conteúdo e sem data
    // legível é contada.
    for (let i = iCab + 1; i < aba.linhas.length; i++) {
      const linha = aba.linhas[i]
      if (linhaVazia(linha)) continue
      const quando = lerData(textoDaCelula(linha[col.data]))
      if (!quando) {
        semData++
        continue // sem data não há como situar no ano
      }
      linhas.push({
        entradaSaida: col.fluxo >= 0 ? textoDaCelula(linha[col.fluxo]) : '',
        data: textoDaData(textoDaCelula(linha[col.data])),
        ano: quando.ano,
        mes: quando.mes,
        movimentacao: textoDaCelula(linha[col.movimentacao]),
        produto: col.produto >= 0 ? textoDaCelula(linha[col.produto]) : '',
        instituicao: col.instituicao >= 0 ? textoDaCelula(linha[col.instituicao]) : '',
        valor: paraNumero(linha[col.valor]),
        quantidade: col.quantidade >= 0 ? paraNumero(linha[col.quantidade]) : null,
        precoUnitario: col.precoUnitario >= 0 ? paraNumero(linha[col.precoUnitario]) : null,
      })
    }

    return { ...resumir(linhas), aba: aba.nome, semData, temColunaFluxo: col.fluxo >= 0, repetidas: 0 }
  }
  return null
}

/** O que se recalcula sempre que o conjunto de linhas muda. */
function resumir(linhas: Movimento[]): Omit<Movimentacao, 'aba' | 'semData' | 'temColunaFluxo' | 'repetidas'> {
  const datas = linhas.map((l) => dataOrdenavel(l.data)).filter(Boolean).sort()
  return {
    linhas,
    tipos: agruparMovimentos(linhas),
    anos: [...new Set(linhas.map((l) => l.ano))].sort(),
    semValor: linhas.filter((l) => l.valor === null).length,
    semFluxo: linhas.filter((l) => lerFluxo(l.entradaSaida) === 'desconhecido').length,
    de: datas[0] ?? '',
    ate: datas[datas.length - 1] ?? '',
  }
}

/**
 * Junta vários extratos de movimentação num só.
 *
 * Cinco anos de bolsa são cinco arquivos, e o leitor tratava um por vez: o
 * seguinte apagava o anterior da tela. Aqui eles viram um extrato com todos os
 * anos, e a apuração passa a poder aplicar tudo de uma vez.
 *
 * Linha repetida entra UMA vez. Reimportar o mesmo arquivo, ou dois arquivos
 * com período sobreposto, dobraria provento e compra — e um provento dobrado
 * cruza o gatilho dos R$ 50 mil que ninguém cruzou.
 */
export function unirMovimentacoes(partes: Movimentacao[]): Movimentacao | null {
  const validas = partes.filter((p): p is Movimentacao => p !== null && p.linhas.length > 0)
  if (validas.length === 0) return null
  if (validas.length === 1) return validas[0]

  // Quantas linhas iguais a esta já entraram, no total.
  const quantas = new Map<string, number>()
  const linhas: Movimento[] = []
  let repetidas = 0
  for (const parte of validas) {
    // A contagem é POR ARQUIVO, e essa é a correção: duas execuções parciais da
    // mesma ordem, no mesmo dia, com a mesma quantidade e o mesmo preço são
    // indistinguíveis de uma linha repetida — mas dentro de um arquivo elas são
    // duas compras de verdade, e o dedup as engolia, baixando o custo médio e
    // inflando o ganho na venda. Repetição só é repetição ENTRE arquivos.
    const naParte = new Map<string, number>()
    for (const l of parte.linhas) {
      const chave = [l.data, l.movimentacao, l.produto, l.instituicao, l.valor, l.quantidade, l.precoUnitario].join('|')
      const nesta = (naParte.get(chave) ?? 0) + 1
      naParte.set(chave, nesta)
      if (nesta > (quantas.get(chave) ?? 0)) {
        quantas.set(chave, nesta)
        linhas.push(l)
      } else {
        repetidas++
      }
    }
  }

  return {
    ...resumir(linhas),
    aba: validas.map((p) => p.aba).join(' + '),
    semData: validas.reduce((s, p) => s + p.semData, 0),
    temColunaFluxo: validas.every((p) => p.temColunaFluxo),
    repetidas,
  }
}

