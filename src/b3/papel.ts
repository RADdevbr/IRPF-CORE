// O que cada linha do extrato É — para a bolsa e para o patrimônio.
//
// Duas perguntas diferentes sobre o mesmo texto de «Movimentação», e por isso
// duas tabelas:
//
//   · `classificarParaCarteira` — «isto é negócio de bolsa?». Deixa a renda fixa
//     indefinida de propósito: a apuração de ganho não pode inventar lucro em
//     CDB, que a fonte já tributou;
//   · `papelNoPatrimonio` — «entrou ou saiu dinheiro do bolso?». Aplicar num CDB
//     e resgatar uma LCA são respostas conhecidas aqui.
//
// Moram no núcleo porque o IRPF-calc e o networthcontrol fazem as duas
// perguntas sobre o mesmo arquivo, e duas listas de sinônimos da B3 divergiriam
// na primeira renomeação — a divergência apareceria como dinheiro sumido.

import { semAcento } from './leitura.js'

/**
 * O que uma linha de movimentação significa para a carteira.
 *
 * `negocio` e não «compra»/«venda» porque a resposta é guardada por TEXTO da
 * movimentação, e o mesmo texto é as duas coisas: «Transferência - Liquidação»
 * é compra quando o ativo entra e venda quando sai. Quem decide é o fluxo da
 * linha, não o rótulo — guardar «compra» por texto transformaria toda venda em
 * compra e zeraria o ganho do ano sem reclamar.
 */
export type PapelNaCarteira = 'negocio' | 'quantidade' | 'ignorar' | 'indefinido'

export interface SugestaoPapel {
  papel: PapelNaCarteira
  porque: string
}

/**
 * Palpite pelo texto da movimentação. O fluxo NÃO entra aqui: ele decide
 * compra × venda linha a linha, na conversão.
 */
export function classificarParaCarteira(movimentacao: string): SugestaoPapel {
  const t = semAcento(movimentacao)
  if (!t) return { papel: 'indefinido', porque: 'linha sem tipo de movimentação' }

  // «COMPRA / VENDA» é como a B3 chama a liquidação de um negócio no extrato de
  // movimentação, e num arquivo real é dos tipos mais frequentes. Caía em «não
  // sei classificar»: a compra ficava fora do aporte do ano, com aviso, mas
  // fora. O espaçamento em volta da barra varia, então normaliza antes.
  const semEspaco = t.replace(/\s*\/\s*/g, '/')
  if (t.includes('liquidacao') || t === 'compra' || t === 'venda' || semEspaco === 'compra/venda') {
    return {
      papel: 'negocio',
      porque: 'liquidação de negócio: crédito é compra, débito é venda — linha a linha',
    }
  }
  if (t.includes('desdobro') || t.includes('grupamento') || t.includes('bonificacao')) {
    return {
      papel: 'quantidade',
      porque: 'muda a quantidade sem mudar o custo total — o preço médio se ajusta sozinho',
    }
  }
  // «juros» solto cobre «PAGAMENTO DE JUROS» (debênture, CRI, CRA) e «Juros»,
  // além do JCP que já estava aqui. Num arquivo real esses são dezenas de
  // linhas, e cair em «não sei se é compra ou venda» é resposta errada: não é
  // negócio nenhum, é renda entrando.
  if (
    t.includes('dividendo') || t.includes('juros') || t.includes('rendimento') ||
    t.includes('amortizacao')
  ) {
    return { papel: 'ignorar', porque: 'é provento, e provento entra pelo outro caminho' }
  }
  // Renda fixa: continua «indefinido» de propósito. Uma aplicação em CDB é
  // dinheiro seu saindo do bolso, mas não é negócio de bolsa, e chutar num
  // sentido ou no outro estraga uma das duas contas. Fica a pergunta — mas com
  // a pergunta certa, em vez de «não sei o que é isto».
  if (t.includes('aplicacao') || t.includes('vencimento') || t.includes('resgate')) {
    return {
      papel: 'indefinido',
      porque: 'renda fixa entrando ou saindo (CDB, Tesouro, debênture) — não é negócio de bolsa; diga se conta como aporte',
    }
  }
  if (t.includes('transferencia')) {
    return {
      papel: 'indefinido',
      porque: 'transferência entre contas não é negócio, mas carrega o custo junto — confirme',
    }
  }
  return { papel: 'indefinido', porque: 'movimentação que não sei classificar sozinha' }
}


/** Maiúscula e sem acento: a forma em que o vocabulário e o casamento comparam. */
const normal = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()

/**
 * O que cada movimento da B3 significa PARA O PATRIMÔNIO — que não é a mesma
 * pergunta que a apuração de ganho faz.
 *
 * `classificarParaCarteira` responde "isto é negócio de bolsa?", e por isso
 * deixa indefinido tudo o que é renda fixa. Aqui a pergunta é outra: "saiu ou
 * entrou dinheiro do bolso?". Aplicar num CDB é dinheiro saindo do bolso do
 * mesmo jeito que comprar uma ação, e o vencimento do título é dinheiro
 * voltando — mas nenhum dos dois pode virar operação de bolsa, senão a
 * apuração de ganho inventaria lucro em papel que a fonte já tributou. Por
 * isso as duas tabelas são separadas, e não uma só «melhorada».
 *
 * Os textos vieram de um extrato de movimentação real. Quem não estiver aqui
 * continua indo para o classificador da bolsa e, se ele também não souber, a
 * tela pergunta — o app não chuta.
 */
const VOCABULARIO_B3: { casa: (t: string) => boolean; papel: PapelNaCarteira }[] = [
  // provento: é renda recebida, não compra. Entra pelo outro caminho.
  { casa: (t) => t.includes('JUROS SOBRE CAPITAL'), papel: 'ignorar' },
  { casa: (t) => t.includes('PAGAMENTO DE JUROS') || t === 'JUROS', papel: 'ignorar' },
  // dinheiro entrando ou saindo do ativo — o fluxo da linha diz qual dos dois
  { casa: (t) => t.includes('COMPRA / VENDA') || t.includes('COMPRA/VENDA'), papel: 'negocio' },
  { casa: (t) => t.includes('APLICACAO'), papel: 'negocio' },
  { casa: (t) => t.includes('VENCIMENTO') || t.includes('RESGATE'), papel: 'negocio' },
]

/** null = não sei; quem responde então é o classificador da bolsa. */
export function papelNoPatrimonio(descricao: string): PapelNaCarteira | null {
  const t = normal(descricao)
  return VOCABULARIO_B3.find((v) => v.casa(t))?.papel ?? null
}

/**
 * Acha, no histórico, a posição de cada ativo do extrato.
 *
 * O extrato fala em ticker (VALE3) e a declaração em texto livre ("VALE ON
 * NM ... 200 COTAS"). O ticker quase sempre está lá dentro, e é o único
 * casamento que dá para afirmar: exigimos a palavra inteira, senão "ON" casaria
 * com meio mundo.
 *
 * O texto do ativo entra ESCAPADO na expressão: produto de renda fixa traz
 * parêntese e sinal de mais («TESOURO IPCA+ 2035»), e cru ele virava outra
 * expressão — ou derrubava a leitura inteira com um parêntese sem par.
 */
export function casarAtivo(descricao: string, ativo: string): boolean {
  const alvo = normal(ativo)
  if (alvo.length < 4) return false
  const escapado = alvo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^A-Z0-9])${escapado}([^A-Z0-9]|$)`).test(normal(descricao))
}
