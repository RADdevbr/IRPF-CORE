// Aportes e resgates: o que a declaração não diz e o extrato diz.
//
// A declaração traz o saldo de 31/12 e mais nada. Dois anos de saldo não
// separam o que rendeu do que entrou e saiu, e é essa confusão que fazia uma
// LCA resgatada aparecer como «−10% ao ano» no painel. O extrato de operações
// — o da B3 ou o do ReVar — tem exatamente a peça que falta: compra, venda,
// aplicação e resgate, com data.
//
// Duas decisões que mudam o número, e que a versão anterior deste caminho errava:
//
// 1. **O fluxo é LÍQUIDO.** O app lançava como aporte o total COMPRADO no ano e
//    ignorava o vendido. Quem comprou 50 mil e vendeu 60 mil tinha 50 mil de
//    aporte registrado quando o dinheiro, no saldo, tinha DIMINUÍDO 10 mil — e o
//    rendimento saía 60 mil menor do que foi. Aqui entra `comprado − vendido`.
//
// 2. **Ativo que só teve venda também é fluxo.** Ele era pulado inteiro (`if
//    (a.comprado <= 0) continue`), que é justamente o caso do título resgatado:
//    o único ano em que a informação existia era o ano em que ela era descartada.
//
// Subscrição e bonificação continuam de fora: trocam papel por papel e não
// movimentam dinheiro. Quem as separa é o leitor do extrato, que já as marca
// como evento.

import { chaveAporte, type Aportes, type Historico } from '../historico/historico.js'
import { lerFluxo, type Movimento } from './movimentacao.js'
import { respostaGuardada } from './leitura.js'
import { casarAtivo, classificarParaCarteira, papelNoPatrimonio, type PapelNaCarteira } from './papel.js'
import { tickerDoProduto } from './produto.js'

export interface FluxoAtivo {
  ativo: string
  anoBase: number
  /** Dinheiro que entrou no ativo: compra, aplicação. */
  aportado: number
  /** Dinheiro que saiu: venda, resgate, vencimento. */
  resgatado: number
  /** `aportado − resgatado`. Negativo é dinheiro que saiu do ativo no ano. */
  liquido: number
}

/** Bens declarados cuja descrição carrega o ticker do ativo. */
export function bensDoAtivo(h: Historico, ativo: string): { id: string; anoBase: number; descricao: string }[] {
  const achados: { id: string; anoBase: number; descricao: string }[] = []
  for (const d of Object.values(h)) {
    for (const p of d.posicoes) {
      if (casarAtivo(p.descricao, ativo)) achados.push({ id: p.id, anoBase: d.anoBase, descricao: p.descricao })
    }
  }
  return achados
}

export interface Casamento {
  fluxo: FluxoAtivo
  /** Bens daquele ano que carregam o ticker. Vazio = não achou par. */
  bens: { id: string; descricao: string }[]
}

export interface FluxosCasados {
  /** Pronto para virar `Aportes`: chave `id@anoBase`. */
  aportes: Aportes
  casados: Casamento[]
  /** Ativo e ano em que o extrato tem movimento e a declaração não tem bem. */
  semBem: FluxoAtivo[]
  /** Anos do extrato sem declaração importada — nada a preencher ali. */
  semDeclaracao: number[]
  /** Quantos bens receberam fluxo. */
  bensPreenchidos: number
}

/**
 * O que uma linha do extrato faz com o dinheiro: entra (+), sai (−), ou fica de
 * fora — e, se fica, por quê.
 *
 * Uma decisão só para quem soma por ano (`fluxosDeMovimentos`) e para quem data
 * por bem (`movimentosDosBens`): se as duas decidissem cada uma a seu modo, o
 * aporte do ano e as datas do mesmo ano deixariam de somar a mesma coisa.
 *
 *   · `fora` — provento, desdobro, bonificação, linha sem valor: não é dinheiro
 *     entrando nem saindo do bem;
 *   · `indefinida` — movimentação que ninguém classificou. O app não chuta;
 *   · `semFluxo` — a linha não diz se entrou ou saiu.
 */
export type DinheiroDaLinha =
  | { tipo: 'dinheiro'; valor: number }
  | { tipo: 'fora' }
  | { tipo: 'indefinida' }
  | { tipo: 'semFluxo' }

export function dinheiroDaLinha(l: Movimento, papeis: Record<string, PapelNaCarteira> = {}): DinheiroDaLinha {
  // «indefinido» guardado é a AUSÊNCIA de resposta, não uma resposta: tratá-lo
  // como escolha da pessoa faria o palpite do vocabulário nunca rodar, e todo
  // resgate de renda fixa cairia fora — que é onde este caminho mais serve.
  const respondido = respostaGuardada(papeis, l.movimentacao)
  const papel =
    (respondido && respondido !== 'indefinido' ? respondido : null) ??
    papelNoPatrimonio(l.movimentacao) ??
    classificarParaCarteira(l.movimentacao).papel
  // 'quantidade' (desdobro, bonificação) troca papel por papel e não move
  // dinheiro; 'ignorar' é provento, que entra pelo caminho da renda
  if (papel === 'ignorar' || papel === 'quantidade') return { tipo: 'fora' }
  if (papel === 'indefinido') return { tipo: 'indefinida' }
  if (l.valor === null) return { tipo: 'fora' }
  // Sem saber se entrou ou saiu, a linha não tem lado: contá-la como aporte
  // (o padrão silencioso de antes) transformava resgate em dinheiro novo, que
  // é exatamente o erro que este caminho existe para corrigir.
  const fluxo = lerFluxo(l.entradaSaida)
  if (fluxo === 'desconhecido') return { tipo: 'semFluxo' }
  return { tipo: 'dinheiro', valor: fluxo === 'entrada' ? Math.abs(l.valor) : -Math.abs(l.valor) }
}

/**
 * Os mesmos fluxos, lidos do Extrato de Movimentação como `lerMovimentacao` o entrega.
 *
 * Existe porque a tela de import da B3 lê o arquivo por outro caminho que a de
 * extratos de operações — ela precisa do mês para o gatilho do Art. 6º-A, que o
 * `ExtratoRevar` não guarda. As duas leituras respondem a mesma pergunta aqui, e
 * respondem com a MESMA tabela (`papelNoPatrimonio`): duas listas de sinônimos
 * da B3 no mesmo app divergiriam na primeira vez que a corretora renomeasse um
 * evento, e a divergência apareceria como dinheiro sumido.
 *
 * A resposta guardada pela pessoa (`papeis`) manda sobre o palpite, como em todo
 * o resto do import. Linha que ninguém classificou fica de fora e é contada em
 * `indefinidas` — o app não chuta se um movimento estranho tirou dinheiro do
 * bolso ou não.
 */
export function fluxosDeMovimentos(
  linhas: Movimento[],
  papeis: Record<string, PapelNaCarteira> = {},
): { fluxos: FluxoAtivo[]; indefinidas: number; semFluxo: number } {
  const porChave = new Map<string, FluxoAtivo>()
  let indefinidas = 0
  let semFluxo = 0

  for (const l of linhas) {
    const d = dinheiroDaLinha(l, papeis)
    if (d.tipo === 'indefinida') indefinidas += 1
    if (d.tipo === 'semFluxo') semFluxo += 1
    if (d.tipo !== 'dinheiro') continue
    const ativo = tickerDoProduto(l.produto)
    const chave = `${l.ano}·${ativo}`
    const atual = porChave.get(chave) ?? { ativo, anoBase: l.ano, aportado: 0, resgatado: 0, liquido: 0 }
    // aqui, e só aqui, o fluxo da linha decide: o ativo entrou ou saiu
    if (d.valor > 0) atual.aportado += d.valor
    else atual.resgatado -= d.valor
    atual.liquido = atual.aportado - atual.resgatado
    porChave.set(chave, atual)
  }

  return {
    fluxos: [...porChave.values()].sort((a, b) => a.anoBase - b.anoBase || a.ativo.localeCompare(b.ativo)),
    indefinidas,
    semFluxo,
  }
}

/**
 * Casa os fluxos do extrato com os bens declarados, por ano.
 *
 * O casamento é pelo TICKER dentro da descrição do bem, que é texto livre — o
 * mesmo critério do confronto com a B3, e pelo mesmo motivo: é o que existe.
 * Ativo sem par não vira zero nem some: sai em `semBem`, para a tela mostrar.
 *
 * Um ativo que casa com mais de um bem no mesmo ano põe o fluxo INTEIRO no
 * primeiro e zero nos demais. Somar em todos contaria a mesma compra duas
 * vezes; deixar os outros sem nada os manteria como «fluxo desconhecido», e aí
 * a classe inteira ficaria sem taxa por causa de um bem que o app já explicou.
 * Zero é a resposta certa: o fluxo daquele ativo já está lançado ao lado.
 */
export function casarLista(h: Historico, fluxos: FluxoAtivo[], base: Aportes = {}): FluxosCasados {
  const anosDeclarados = new Set(Object.values(h).map((d) => d.anoBase))
  const aportes: Aportes = { ...base }
  const casados: Casamento[] = []
  const semBem: FluxoAtivo[] = []
  const semDeclaracao = new Set<number>()
  let bensPreenchidos = 0

  for (const fluxo of fluxos) {
    if (!anosDeclarados.has(fluxo.anoBase)) {
      semDeclaracao.add(fluxo.anoBase)
      continue
    }
    const bens = bensDoAtivo(h, fluxo.ativo)
      .filter((b) => b.anoBase === fluxo.anoBase)
      .map(({ id, descricao }) => ({ id, descricao }))
    if (bens.length === 0) {
      semBem.push(fluxo)
      continue
    }
    bens.forEach((b, i) => {
      aportes[chaveAporte(b.id, fluxo.anoBase)] = i === 0 ? fluxo.liquido : 0
      bensPreenchidos += 1
    })
    casados.push({ fluxo, bens })
  }

  return { aportes, casados, semBem, semDeclaracao: [...semDeclaracao].sort((a, b) => a - b), bensPreenchidos }
}
