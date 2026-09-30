// A posição da B3 numa data — o que a carteira VALIA, e não o que custou.
//
// A declaração guarda ação, FII e ETF pelo custo de aquisição: o saldo só anda
// quando se compra ou se vende. A valorização da bolsa fica de fora da conta do
// patrimônio até o dia da venda, e o rendimento do capital sai menor do que foi
// — ou maior, no ano em que a venda realiza o ganho de vários anos de uma vez.
//
// O relatório de posição da Área do Investidor tem a peça que falta: o preço de
// fechamento e o valor atualizado de cada papel. Com o de 31/12 de dois anos
// seguidos, a diferença entre valor e custo de um ano para o outro é o que a
// bolsa rendeu e a declaração não conta.
//
// A B3 exporta a posição em mais de um formato (o extrato «Posição», uma aba por
// tipo de papel; a «Posição Detalhada», por seção) e renomeia colunas de tempos
// em tempos. O leitor procura as colunas pelo NOME em qualquer aba — produto ou
// código de negociação, e o valor —, e ignora as linhas de total.

import { type Aba } from '../xlsx/index.js'
import { acharColuna, acharColunaSem, linhaVazia, paraNumero, semAcento, textoDaCelula } from './leitura.js'
import { tickerDoProduto } from './produto.js'

export interface ItemDaPosicao {
  /** O produto como veio, ou o código de negociação quando não há produto. */
  produto: string
  /** O ticker: do código de negociação, ou do começo do produto. */
  ativo: string
  instituicao: string
  quantidade: number | null
  /** Preço de fechamento. */
  preco: number | null
  /** Valor atualizado: quantidade × preço de fechamento, como a B3 calcula. */
  valor: number
  /** A aba de onde veio — «Acoes», «Fundo de Investimento», «ETF»… */
  aba: string
}

export interface PosicaoB3 {
  itens: ItemDaPosicao[]
  /** A data da posição, quando o arquivo diz (aaaa-mm-dd). */
  data: string | null
  /** As abas que tinham posição. */
  abas: string[]
}

/** Abas que o leitor não usa: a renda fixa e o Tesouro entram pela declaração, pelo saldo. */
const FORA_DA_RENDA_VARIAVEL = /renda fixa|tesouro|emprestimo|provento|aluguel|custodia remunerada|resumo/

/** «Posição em 31/12/2024», «posicao-2024-12-31.xlsx», «Data: 31/12/2024». */
function dataDoTexto(texto: string): string | null {
  const iso = texto.match(/(20\d{2})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const br = texto.match(/(\d{2})\/(\d{2})\/(20\d{2})/)
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null
}

/**
 * Lê a posição, de todas as abas de renda variável que tiverem produto (ou
 * código de negociação) e valor. `null` se nenhuma tiver.
 *
 * `nome` é o nome do arquivo: é onde a B3 costuma pôr a data da posição.
 */
export function lerPosicao(abas: readonly Aba[], nome = ''): PosicaoB3 | null {
  const itens: ItemDaPosicao[] = []
  const comPosicao: string[] = []
  let data = dataDoTexto(nome)

  for (const aba of abas) {
    if (FORA_DA_RENDA_VARIAVEL.test(semAcento(aba.nome))) continue
    const iCab = aba.linhas.findIndex(
      (l) => (acharColuna(l, 'produto') >= 0 || acharColuna(l, 'codigo de negociacao') >= 0) && acharColuna(l, 'valor atualizado', 'valor') >= 0,
    )
    if (iCab < 0) continue
    // o extrato de movimentação e o de negociação também têm produto e valor —
    // mas têm data por linha, e posição não tem
    const cab = aba.linhas[iCab]
    if (acharColuna(cab, 'movimentacao') >= 0 || acharColuna(cab, 'data do negocio') >= 0) continue
    if (!data) {
      for (const l of aba.linhas.slice(0, iCab)) {
        const d = dataDoTexto(Array.from(l, (c) => textoDaCelula(c)).join(' '))
        if (d) {
          data = d
          break
        }
      }
    }
    const col = {
      produto: acharColuna(cab, 'produto'),
      codigo: acharColuna(cab, 'codigo de negociacao'),
      instituicao: acharColuna(cab, 'instituicao'),
      quantidade: acharColunaSem(cab, ['disponivel', 'indisponivel'], 'quantidade'),
      preco: acharColuna(cab, 'preco de fechamento', 'preco'),
      valor: acharColunaSem(cab, ['unitario'], 'valor atualizado', 'valor'),
    }
    let achou = false
    for (const linha of aba.linhas.slice(iCab + 1)) {
      if (linhaVazia(linha)) continue
      const produto = col.produto >= 0 ? textoDaCelula(linha[col.produto]) : ''
      const codigo = col.codigo >= 0 ? textoDaCelula(linha[col.codigo]) : ''
      if (!produto && !codigo) continue
      if (/^total/.test(semAcento(produto || codigo))) continue
      const valor = paraNumero(linha[col.valor])
      if (valor === null || valor <= 0) continue
      const ativo = tickerDoProduto(codigo || produto)
      if (!ativo) continue
      itens.push({
        produto: produto || codigo,
        ativo,
        instituicao: col.instituicao >= 0 ? textoDaCelula(linha[col.instituicao]) : '',
        quantidade: col.quantidade >= 0 ? paraNumero(linha[col.quantidade]) : null,
        preco: col.preco >= 0 ? paraNumero(linha[col.preco]) : null,
        valor,
        aba: aba.nome,
      })
      achou = true
    }
    if (achou) comPosicao.push(aba.nome)
  }
  return itens.length > 0 ? { itens, data, abas: comPosicao } : null
}
