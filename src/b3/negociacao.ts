// O Extrato de Negociação da B3 — cada ordem executada, com o pregão.
//
//     Data do Negócio | Tipo de Movimentação | Mercado | Prazo/Vencimento
//     | Instituição | Código de Negociação | Quantidade | Preço | Valor
//
// Parece o de Movimentação (tem «Movimentação» e «Data» no cabeçalho) e era lido
// como ele: mil linhas de «Compra» e «Venda» sem produto e sem lado, que não
// casavam com bem nenhum e poluíam a lista. Aqui ele tem leitor próprio.
//
// Para o patrimônio, o que só ele tem é o DAY TRADE: compra e venda do mesmo
// papel no mesmo dia, na mesma corretora, que não passa pela custódia e por isso
// não aparece no extrato de movimentação. O resultado dele já está no
// patrimônio (o dinheiro ficou ou saiu da conta da corretora) — o que este
// leitor dá é o tamanho, para a tela dizer quanto do que o capital fez veio dali.

import { type Aba } from '../xlsx/index.js'
import { acharColuna, acharColunaSem, linhaVazia, paraNumero, semAcento, textoDaCelula } from './leitura.js'
import { lerData, textoDaData } from './movimentacao.js'
import { tickerDoProduto } from './produto.js'

export interface Negocio {
  /** dd/mm/aaaa. */
  data: string
  ano: number
  mes: number
  tipo: 'compra' | 'venda'
  ativo: string
  mercado: string
  instituicao: string
  quantidade: number
  preco: number
  valor: number
}

/** A aba é de negociação: data do negócio e código de negociação no cabeçalho. */
export const ehNegociacao = (cabecalho: Aba['linhas'][number]): boolean =>
  acharColuna(cabecalho, 'data do negocio') >= 0 && acharColuna(cabecalho, 'codigo de negociacao') >= 0

/** As ordens do arquivo, ou `null` se nenhuma aba for de negociação. */
export function lerNegociacao(abas: readonly Aba[]): Negocio[] | null {
  for (const aba of abas) {
    const iCab = aba.linhas.findIndex(ehNegociacao)
    if (iCab < 0) continue
    const cab = aba.linhas[iCab]
    const col = {
      data: acharColuna(cab, 'data do negocio'),
      tipo: acharColuna(cab, 'tipo de movimentacao', 'movimentacao'),
      mercado: acharColuna(cab, 'mercado'),
      instituicao: acharColuna(cab, 'instituicao'),
      codigo: acharColuna(cab, 'codigo de negociacao'),
      quantidade: acharColuna(cab, 'quantidade'),
      preco: acharColunaSem(cab, ['medio'], 'preco'),
      valor: acharColunaSem(cab, ['unitario'], 'valor'),
    }
    const negocios: Negocio[] = []
    for (const linha of aba.linhas.slice(iCab + 1)) {
      if (linhaVazia(linha)) continue
      const quando = lerData(textoDaCelula(linha[col.data]))
      if (!quando) continue
      const tipoTexto = semAcento(textoDaCelula(linha[col.tipo]))
      const tipo = tipoTexto.startsWith('compra') ? 'compra' : tipoTexto.startsWith('venda') ? 'venda' : null
      const ativo = tickerDoProduto(textoDaCelula(linha[col.codigo]))
      const quantidade = paraNumero(linha[col.quantidade])
      const preco = col.preco >= 0 ? paraNumero(linha[col.preco]) : null
      const valor = col.valor >= 0 ? paraNumero(linha[col.valor]) : null
      if (!tipo || !ativo || !quantidade) continue
      const total = valor ?? (preco !== null ? quantidade * preco : null)
      if (total === null) continue
      negocios.push({
        data: textoDaData(textoDaCelula(linha[col.data])),
        ano: quando.ano,
        mes: quando.mes,
        tipo,
        ativo,
        mercado: col.mercado >= 0 ? textoDaCelula(linha[col.mercado]) : '',
        instituicao: col.instituicao >= 0 ? textoDaCelula(linha[col.instituicao]) : '',
        quantidade: Math.abs(quantidade),
        preco: preco ?? Math.abs(total / quantidade),
        valor: Math.abs(total),
      })
    }
    return negocios
  }
  return null
}

export interface DayTradeDoAno {
  anoBase: number
  /** Soma do que as vendas do dia renderam sobre as compras do dia, na quantidade casada. */
  resultado: number
  /** Dias × papel × corretora com compra e venda casadas. */
  operacoes: number
  /** Volume casado (a ponta de compra). */
  volume: number
}

/**
 * O resultado do day trade, por ano: compra e venda do mesmo papel, no mesmo
 * dia, na mesma corretora. A quantidade casada é a menor das duas pontas, e o
 * resultado é ela vezes a diferença entre o preço médio de venda e o de compra
 * do dia. Sem custos: o extrato de negociação não os traz.
 */
export function dayTrade(negocios: readonly Negocio[]): DayTradeDoAno[] {
  const dias = new Map<string, { ano: number; qc: number; vc: number; qv: number; vv: number }>()
  for (const n of negocios) {
    const chave = `${n.data}|${n.ativo}|${semAcento(n.instituicao)}`
    const d = dias.get(chave) ?? { ano: n.ano, qc: 0, vc: 0, qv: 0, vv: 0 }
    if (n.tipo === 'compra') {
      d.qc += n.quantidade
      d.vc += n.valor
    } else {
      d.qv += n.quantidade
      d.vv += n.valor
    }
    dias.set(chave, d)
  }
  const porAno = new Map<number, DayTradeDoAno>()
  for (const d of dias.values()) {
    const q = Math.min(d.qc, d.qv)
    if (q <= 0) continue
    const a = porAno.get(d.ano) ?? { anoBase: d.ano, resultado: 0, operacoes: 0, volume: 0 }
    const pmC = d.vc / d.qc
    const pmV = d.vv / d.qv
    a.resultado += q * (pmV - pmC)
    a.operacoes += 1
    a.volume += q * pmC
    porAno.set(d.ano, a)
  }
  return [...porAno.values()].sort((a, b) => a.anoBase - b.anoBase)
}
