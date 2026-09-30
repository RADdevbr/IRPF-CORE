// O que cada tipo de «Movimentação» do extrato da B3 faz com o dinheiro do
// papel — a tabela inteira, e não os poucos tipos que um arquivo de exemplo
// trazia.
//
// A coluna «Entrada/Saída» tem DUAS leituras, e é daí que vem o erro de sinal:
//
//   · nos negócios e na custódia (liquidação, compra/venda de renda fixa,
//     aplicação, vencimento, transferência), «Credito» é o PAPEL entrando na
//     conta e «Debito» é o papel saindo. Crédito é aporte; débito, resgate;
//   · nos eventos em dinheiro (dividendo, juros, amortização, resgate pelo
//     emissor, restituição de capital, leilão de fração), «Credito» é o
//     DINHEIRO entrando no bolso. Num provento isso é renda; numa amortização
//     é o dinheiro SAINDO do papel — o crédito ali é resgate, não aporte.
//
// Ler as duas pelo mesmo lado punha cada amortização de FII, cada leilão de
// fração e cada restituição de capital como dinheiro novo no papel, e o
// rendimento do ano saía menor pelo dobro do valor.
//
// De onde veio a tabela: o Manual de Procedimentos da Central Depositária de
// Renda Variável da B3 (out/2021, capítulo 6: eventos em dinheiro, em ativos e
// subscrição), exportações reais do extrato publicadas em projetos abertos, e
// os leitores abertos do mesmo arquivo que dizem ter sido escritos contra
// exportações reais. O que só aparece em leitor, e nunca numa linha real, está
// marcado aqui como tal no `porque`.
//
// Tipo que não está aqui continua sendo pergunta: o app não chuta.

/**
 * O que a linha faz com o dinheiro do papel.
 *
 *   · `fluxo` — dinheiro entrando ou saindo, e o LADO da linha diz qual:
 *     crédito é o papel entrando (aporte), débito é o papel saindo (resgate);
 *   · `devolucao` — dinheiro saindo do papel e indo para o bolso, qualquer que
 *     seja o lado (a B3 escreve «Credito» porque o dinheiro foi creditado);
 *   · `provento` — renda paga pelo papel. Não é aporte nem resgate: entra pela
 *     declaração;
 *   · `semDinheiro` — o papel muda de lugar, de nome ou de quantidade, e o
 *     dinheiro não se move (transferência, desdobro, bonificação, direito…);
 *   · `custo` — sai do seu bolso, mas não do papel (taxa de custódia).
 */
export type EfeitoNoPatrimonio = 'fluxo' | 'devolucao' | 'provento' | 'semDinheiro' | 'custo'

export interface LeituraDoTipo {
  efeito: EfeitoNoPatrimonio
  /** Por que, em uma frase — é o que a tela mostra ao lado do tipo. */
  porque: string
}

/**
 * A forma em que os tipos são comparados. A B3 escreve o mesmo tipo de mais de
 * um jeito: «COMPRA / VENDA» e «COMPRA/VENDA», «RESGATE ANTECIPADO» e «RESGATE
 * ANTECIPADO/», «Amortização» e «AMORTIZAÇÃO».
 */
export const chaveDoTipo = (movimentacao: string): string =>
  movimentacao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\/+$/, '')
    .trim()

const NEGOCIO_EM_BOLSA = 'liquidação de compra ou venda em bolsa: crédito é a compra, débito é a venda'
const RENDA_FIXA = 'compra ou venda de renda fixa: crédito é o título entrando, débito é o título saindo'
const SEM_DINHEIRO_EVENTO = 'evento em ativos: muda a quantidade ou o papel, e o dinheiro não se move'

const TIPOS: Record<string, LeituraDoTipo> = {
  // --- dinheiro entrando ou saindo; o lado da linha diz qual
  'TRANSFERENCIA - LIQUIDACAO': { efeito: 'fluxo', porque: NEGOCIO_EM_BOLSA },
  'COMPRA/VENDA': { efeito: 'fluxo', porque: RENDA_FIXA },
  'COMPRA/VENDA DEFINITIVA/CESSAO': { efeito: 'fluxo', porque: RENDA_FIXA },
  'MDA COMPRA/VENDA DEFINITIVA MERCADO PRIMARIO': {
    efeito: 'fluxo',
    porque: 'compra de debênture, CRI ou CRA na emissão (visto só em leitores do arquivo)',
  },
  APLICACAO: { efeito: 'fluxo', porque: 'aplicação em renda fixa: o título entra' },
  COMPRA: { efeito: 'fluxo', porque: 'compra de Tesouro Direto: o título entra' },
  VENDA: { efeito: 'fluxo', porque: 'venda de Tesouro Direto: o título sai' },
  'RESGATE ANTECIPADO': { efeito: 'fluxo', porque: 'resgate antes do vencimento: o título sai' },
  VENCIMENTO: {
    efeito: 'fluxo',
    porque: 'o título venceu e saiu; algumas instituições mandam a linha sem valor, e aí o dinheiro não está no extrato',
  },

  // --- dinheiro saindo do papel para o bolso, com «Credito» na linha
  AMORTIZACAO: { efeito: 'devolucao', porque: 'devolução de parte do principal: o dinheiro sai do papel' },
  RESGATE: {
    efeito: 'devolucao',
    porque: 'resgate pago pelo emissor: o crédito é o dinheiro saindo do papel (sem valor, é conversão, e fica de fora)',
  },
  'RESTITUICAO DE CAPITAL': { efeito: 'devolucao', porque: 'redução de capital paga em dinheiro: sai do papel' },
  'LEILAO DE FRACAO': {
    efeito: 'devolucao',
    porque: 'a fração que sobrou de um evento foi vendida em leilão, e o dinheiro saiu do papel',
  },
  'VENCIMENTO/RESGATE SALDO EM CONTA': {
    efeito: 'devolucao',
    porque: 'resgate ou vencimento creditado no saldo em conta (visto só em leitores do arquivo)',
  },

  // --- renda: entra pela declaração
  DIVIDENDO: { efeito: 'provento', porque: 'provento: é renda do papel, e não aporte' },
  'JUROS SOBRE CAPITAL PROPRIO': { efeito: 'provento', porque: 'provento (JCP), com o valor já líquido do IR' },
  RENDIMENTO: { efeito: 'provento', porque: 'provento de FII, Fiagro ou ETF: é renda do papel' },
  JUROS: { efeito: 'provento', porque: 'cupom de juros do Tesouro: é renda do título' },
  'PAGAMENTO DE JUROS': { efeito: 'provento', porque: 'juros ou cupom de renda fixa: é renda do título' },
  'PAGAMENTO DE PREMIO/RENDIMENTOS': {
    efeito: 'provento',
    porque: 'prêmio ou rendimento de título de balcão (visto só em leitores do arquivo)',
  },
  REEMBOLSO: {
    efeito: 'provento',
    porque: 'o provento da ação que você emprestou (BTC), repassado por quem tomou: é renda',
  },

  // --- sem dinheiro
  TRANSFERENCIA: {
    efeito: 'semDinheiro',
    porque: 'o papel mudou de instituição ou de carteira: muda o lugar, não o dinheiro',
  },
  ATUALIZACAO: {
    efeito: 'semDinheiro',
    porque: 'troca do papel «com» pelo «ex» num evento, ou de código numa conversão: nenhum dinheiro',
  },
  'BONIFICACAO EM ATIVOS': { efeito: 'semDinheiro', porque: SEM_DINHEIRO_EVENTO },
  DESDOBRO: { efeito: 'semDinheiro', porque: SEM_DINHEIRO_EVENTO },
  GRUPAMENTO: { efeito: 'semDinheiro', porque: SEM_DINHEIRO_EVENTO },
  INCORPORACAO: { efeito: 'semDinheiro', porque: 'papel recebido numa incorporação: troca de papel, sem dinheiro' },
  CISAO: { efeito: 'semDinheiro', porque: 'papel recebido numa cisão: troca de papel, sem dinheiro' },
  'CONVERSAO DE ATIVOS': { efeito: 'semDinheiro', porque: 'conversão entre papéis: troca de papel, sem dinheiro' },
  'FRACAO EM ATIVOS': {
    efeito: 'semDinheiro',
    porque: 'a fração saindo para o leilão; o dinheiro vem depois, no «Leilão de Fração»',
  },
  'RESTITUICAO DE CAPITAL EM ACOES': { efeito: 'semDinheiro', porque: 'restituição paga em ações, não em dinheiro' },
  'DIREITO DE SUBSCRICAO': { efeito: 'semDinheiro', porque: 'direitos de subscrição creditados: ainda não é dinheiro' },
  'DIREITOS DE SUBSCRICAO': { efeito: 'semDinheiro', porque: 'direitos de subscrição creditados: ainda não é dinheiro' },
  'DIREITO SOBRAS DE SUBSCRICAO': { efeito: 'semDinheiro', porque: 'direito às sobras da subscrição' },
  'SOLICITACAO DE SUBSCRICAO': {
    efeito: 'semDinheiro',
    porque: 'pedido de exercício da subscrição: o valor pago não vem no extrato',
  },
  'RECIBO DE SUBSCRICAO': {
    efeito: 'semDinheiro',
    porque: 'recibo da subscrição, que depois vira o papel: o valor pago não vem no extrato',
  },
  'CESSAO DE DIREITOS': {
    efeito: 'semDinheiro',
    porque: 'direito de preferência passado ao escriturador para exercer — não é venda do direito',
  },
  EMPRESTIMO: {
    efeito: 'semDinheiro',
    porque: 'aluguel de ações (BTC): a perna em ações não move dinheiro, e a taxa recebida é renda',
  },
  'INCORPORACAO DE JUROS': {
    efeito: 'semDinheiro',
    porque: 'juros somados ao principal, sem pagamento (visto só em leitores do arquivo)',
  },
  'LIQUIDACAO TERMO': {
    efeito: 'semDinheiro',
    porque: 'o papel do termo chegando: o dinheiro já está na linha de compra do termo',
  },

  // --- sai do bolso, não do papel
  'COBRANCA DE TAXA SEMESTRAL': {
    efeito: 'custo',
    porque: 'taxa de custódia do Tesouro: sai do seu bolso, mas não do título',
  },
}

/**
 * O que vem depois de « - » no fim do tipo é o ESTADO do evento («Dividendo -
 * Transferido», «Direitos de Subscrição - Exercido») — o mesmo padrão dos
 * códigos de custódia da B3. O estado decide mais que o evento: um dividendo
 * «transferido» é a provisão que acompanhou o papel de uma corretora para a
 * outra, e o pagamento vem depois, na linha sem sufixo.
 */
const ESTADOS: Record<string, LeituraDoTipo | 'comoOEvento'> = {
  TRANSFERIDO: {
    efeito: 'semDinheiro',
    porque: 'provento a receber que acompanhou o papel transferido; o pagamento vem na linha sem sufixo',
  },
  EXCLUIDO: { efeito: 'semDinheiro', porque: 'evento cancelado, sem pagamento' },
  CANCELADO: { efeito: 'semDinheiro', porque: 'evento cancelado, sem pagamento' },
  'NAO EXERCIDO': { efeito: 'semDinheiro', porque: 'direito que expirou sem ser exercido' },
  EXERCIDO: {
    efeito: 'semDinheiro',
    porque: 'direito exercido: o que você pagou pela subscrição não vem nesta linha',
  },
  SOLICITADA: { efeito: 'semDinheiro', porque: 'pedido registrado na central depositária, sem dinheiro' },
  REATIVADO: 'comoOEvento',
}

/**
 * O que a linha faz com o dinheiro do papel, pelo texto da «Movimentação».
 *
 * `null` = tipo que a tabela não conhece. Quem chama pergunta à pessoa.
 */
export function leituraNoPatrimonio(movimentacao: string): LeituraDoTipo | null {
  const chave = chaveDoTipo(movimentacao)
  if (!chave) return null
  const exata = TIPOS[chave]
  if (exata) return exata
  const corte = chave.lastIndexOf(' - ')
  if (corte < 0) return null
  const estado = ESTADOS[chave.slice(corte + 3)]
  if (estado === undefined) return null
  if (estado !== 'comoOEvento') return estado
  return TIPOS[chave.slice(0, corte)] ?? null
}
