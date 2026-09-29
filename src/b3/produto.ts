// O texto de produto da B3, cortado — e só isso.
//
// «PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS» é uma string com duas
// informações grudadas, e módulos diferentes precisam de metades diferentes: o
// código para identificar o papel, o nome para casar o pagador com o que a
// declaração informa.
//
// Mora sozinho, sem import nenhum, porque quem pergunta pelo NOME é tela que
// carrega sempre (a principal do IRPF-calc). Deixar o corte junto do leitor
// obrigava essa tela a importar o leitor da B3 inteiro, e com ele o de .xlsx,
// para usar três linhas de `split`. O bundle de quem nunca abre a importação
// não deve pagar por ela.
//
// Uma receita só para os dois lados: `tickerDoProduto` e `nomeDoProduto`
// cortam no MESMO separador, e receitas separadas divergiriam no primeiro
// produto com hífen no nome.

/** O separador que a B3 usa entre o código e o nome. */
const SEPARADOR = ' - '

/**
 * «PETR4 - PETROLEO BRASILEIRO SA» → «PETR4». Sem hífen, o produto inteiro.
 *
 * O sufixo `F` do mercado FRACIONÁRIO cai fora: `PETR4F` é o mesmo papel que
 * `PETR4`, comprado em lote menor. Mantê-lo separado partia o custo médio em
 * dois (a venda no lote cheio não achava a compra do fracionário), dava ao
 * fracionário um pagador próprio — dividindo os R$ 50 mil do gatilho — e
 * duplicava o papel na posição de 31/12.
 */
export function tickerDoProduto(produto: string): string {
  const [codigo] = produto.split(SEPARADOR)
  const t = codigo.trim().toUpperCase()
  const fracionario = /^([A-Z]{4}\d{1,2})F$/.exec(t)
  return fracionario ? fracionario[1] : t
}

/**
 * O outro lado do mesmo corte: «PETR4 - PETROLEO BRASILEIRO SA» → o nome.
 *
 * Existe porque a raiz do ticker NÃO é o nome da companhia, e há uma pergunta
 * que precisa do nome: casar o pagador do extrato com o pagador do `.DEC`, que
 * escreve por extenso e nunca escreve «PETR». Ver `sugerirOrigens`, no núcleo.
 *
 * Junta de volta o que sobrou dos hifens porque o nome pode ter um: «HGLG11 -
 * CSHG LOGISTICA FDO INV IMOB - FII» é um produto só, e cortar no primeiro
 * hífen jogaria o «FII» fora.
 *
 * Vazio quando o produto não tem nome — aí não há o que casar, e devolver o
 * código faria a raiz do ticker voltar disfarçada de nome.
 */
export function nomeDoProduto(produto: string): string {
  const [, ...resto] = produto.split(SEPARADOR)
  return resto.join(SEPARADOR).trim()
}

/**
 * Raiz do ticker — o que separa a EMPRESA do papel.
 *
 * PETR3, PETR4 e PETR11 são três papéis da mesma companhia, com o mesmo CNPJ.
 * O gatilho do Art. 6º-A conta o total pago pela mesma pessoa jurídica no mês,
 * então tratá-los como três pagadores divide os R$ 50 mil em três e apaga uma
 * retenção que existiu:
 *
 *     PETR3  R$ 30.000  → IRRF R$ 0
 *     PETR4  R$ 30.000  → IRRF R$ 0
 *     mesmo CNPJ, R$ 60.000 → IRRF R$ 6.000
 *
 * A convenção da B3 é de quatro letras: as quatro primeiras são a companhia e o
 * resto é o tipo do papel (3 ON, 4 PN, 11 unit ou fundo). É SUGESTÃO, não
 * verdade: nada garante que duas empresas não compartilhem a raiz, e o ticker
 * também não prova CNPJ. Quem confirma é quem está olhando a tela.
 *
 * `null` quando o texto não tem cara de ticker — aí não há palpite a dar, e
 * inventar um agruparia pagadores que não têm relação nenhuma.
 */
export function raizTicker(produto: string): string | null {
  const t = tickerDoProduto(produto)
  const m = t.match(/^([A-Z]{4})(3|4|5|6|11B?|31|32|33|34|35|39)$/)
  return m ? m[1] : null
}
