// As fontes de renda: como o app nomeia cada uma e o que a lei faz com ela.
//
// É vocabulário compartilhado, e é por isso que mora no núcleo em vez de dentro
// do cálculo. Três caminhos escrevem nestas mesmas chaves:
//
//   · o leitor do `.DEC`, que mapeia cada lançamento da declaração para um alvo;
//   · o importador da B3, que joga provento e ganho de bolsa nos alvos certos;
//   · a tela de estimativa, onde a pessoa digita.
//
// E dois caminhos LEEM: o cálculo do IRPFM (quais somam na base, qual IR é
// antecipação e qual é definitivo) e o histórico plurianual (a base de cada ano
// importado). Com a lista em um dos apps, os outros teriam de repeti-la — e uma
// cópia que esquece de marcar `base: false` num rendimento isento não avisa: só
// devolve imposto a mais.
//
// `calc/irpfm.ts`, no app de estimativa, reexporta as duas, então quem já
// importava de lá continua igual.

export interface Field {
  key: string
  label: string
  ir: string | null
  base: boolean
  autoSal: boolean
  autoCdb: boolean
  /**
   * O rendimento é tributado na DECLARAÇÃO de ajuste anual?
   *
   * Decide o que fazer com o IR da fonte, e é a diferença entre as duas contas.
   * `true` → a retenção é ANTECIPAÇÃO: quem fecha o ano é o ajuste, e é o
   * imposto devido nele que a Lei 15.270/2025 manda abater do IRPFM.
   * `false` → tributação exclusiva ou definitiva: a retenção é o imposto final,
   * e ela abate o IRPFM diretamente.
   */
  naDeclaracao: boolean
  info: string
}

export const FIELDS: Field[] = [
  { key: 'salario', label: 'Salário / pró-labore', ir: 'salario_ir', base: true, autoSal: true, autoCdb: false, naDeclaracao: true, info: 'Total anual bruto incluindo 13º e adicional de férias. O IRRF retido é antecipação: quem abate o IRPFM é o imposto devido na declaração.' },
  { key: 'divBR', label: 'Dividendos de ações BR', ir: 'divBR_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'IRRF de 10% sobre distribuições acima de R$50k/mês por CNPJ.' },
  { key: 'divFII', label: 'Dividendos de FIIs', ir: null, base: false, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'ISENTOS do IRPFM por lei.' },
  { key: 'exterior', label: 'Rendimentos no exterior', ir: 'exterior_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: true, info: 'Tributado na declaração; o IR pago no exterior é compensado contra o imposto devido aqui.' },
  { key: 'aluguel', label: 'Aluguéis', ir: 'aluguel_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: true, info: 'Tributado na declaração. O carnê-leão recolhido no mês é antecipação, não imposto final.' },
  { key: 'cdb', label: 'CDB, fundos e invest. tributáveis', ir: 'cdb_ir', base: true, autoSal: false, autoCdb: true, naDeclaracao: false, info: 'IR retido exclusivamente na fonte é deduzido.' },
  { key: 'bolsa', label: 'Ganho em bolsa (renda variável)', ir: 'bolsa_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'Ganho líquido na venda de ações, ETF e FII. A entrada na base do IRPFM é leitura da lei, não texto expresso — veja o painel da apuração.' },
  { key: 'outros', label: 'Outros rendimentos tributáveis', ir: 'outros_ir', base: true, autoSal: false, autoCdb: false, naDeclaracao: false, info: 'Qualquer outro rendimento não isento por lei, tributado só na fonte.' },
]
