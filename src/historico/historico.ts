// Histórico plurianual das declarações — ver PLAN-CONTA-E-HISTORICO.md §2.
//
// Importar UM .DEC responde "se 2026 repetir 2025, caio no IRPFM?". Importar N
// responde três perguntas que nenhuma calculadora responde: quanto o patrimônio
// cresceu, se a lei nova teria pegado os anos passados, e — o ponto do pedido —
// QUANTO do patrimônio, se resgatado, joga rendimento na base do IRPFM.

import type { DecResult, Lancamento, Pagamento } from '../dec/decParser.js'
import { sugerirCategoria } from '../fiscal/deducoes.js'
import { FIELDS, ehImpostoRetido } from '../fiscal/fontes.js'

/** O que acontece com a base do IRPFM quando este bem vira dinheiro. */
export type Regime = 'inBase' | 'foraBase' | 'depende'

export interface PosicaoAno {
  id: string
  descricao: string
  codigo: string
  subcodigo?: string
  /** Linha original do .DEC. Fica no cofre cifrado, junto do resto. */
  bruta?: string
  classe: ClassePatrimonio
  regime: Regime
  saldoAnterior: number
  saldoAtual: number
}

/** O que o parser conseguiu extrair — mostrado por arquivo, para anos antigos. */
export interface Diagnostico {
  registros: { tipo: string; count: number }[]
  lancamentos: number
  posicoes: number
  totalLinhas: number
  anoDetectado: boolean
}

/**
 * Versão do leitor que produziu a declaração guardada.
 *
 * O .DEC é lido uma vez e o resultado fica no cofre; quando o leitor aprende a
 * extrair um campo novo, o histórico já gravado continua sem ele — e a tela
 * mostra vazio sem dizer por quê. Aconteceu com os pagamentos efetuados e de
 * novo com os rendimentos isentos. Com o carimbo, a tela sabe pedir a
 * reimportação dos anos que ficaram para trás.
 *
 * 1 (ou ausente) — antes dos pagamentos (Registro 26)
 * 2 — pagamentos efetuados
 * 3 — rendimentos isentos e não tributáveis somados como renda
 * 4 — renda por PAGADOR dentro de cada fonte (ver `porPagador`)
 */
export const LEITURA_ATUAL = 4

/**
 * O que cada versão do leitor passou a extrair, em uma frase.
 *
 * Existe porque o aviso de «reimporte este ano» precisa dizer o QUE falta, e a
 * resposta depende de quando o ano foi lido. Enquanto a lista estava escrita na
 * tela, subir `LEITURA_ATUAL` fazia o aviso aparecer com o motivo errado — ele
 * mandava procurar os rendimentos isentos num ano que já os tinha. Um motivo
 * errado é pior do que nenhum: manda a pessoa atrás de um número que está lá.
 */
export const GANHOS_DA_LEITURA: Record<number, string> = {
  2: 'os pagamentos efetuados (plano de saúde, previdência)',
  3: 'os rendimentos isentos e não tributáveis — LCI/LCA, poupança, incentivadas, FII',
  4: 'a renda por fonte pagadora, que separa o que é trabalho do que é capital',
}

/** O que falta a um ano lido pela versão `versao`, da mais antiga para a atual. */
export function oQueFaltaNaLeitura(versao: number | undefined): string[] {
  const lida = versao ?? 1
  return Object.entries(GANHOS_DA_LEITURA)
    .filter(([v]) => Number(v) > lida)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, texto]) => texto)
}

/**
 * Quem pagou. A identidade estável de uma fonte pagadora entre anos e fichas.
 *
 * O CNPJ manda quando existe, porque é ele que não muda: a mesma companhia
 * aparece como «CIA XPTO S/A» num ano e «CIA XPTO SA» no outro, e duas grafias
 * viriam como dois pagadores — cada um pedindo a mesma resposta de novo. Onde
 * não há CNPJ (o Registro 84 nem sempre traz), sobra o nome normalizado, com a
 * mesma receita da identidade dos bens.
 */
export interface Pagador {
  /** `cnpj:<14 dígitos>` ou `nome:<normalizado>`. */
  id: string
  nome: string
  cnpj?: string
}

/** Quanto um pagador pagou dentro de uma fonte, num ano. */
export interface RendaPorPagador {
  /** A chave da ficha, em `fiscal/fontes.ts` — `salario`, `divBR`, `cdb`… */
  alvo: string
  pagador: Pagador
  valor: number
}

export interface Declaracao {
  diagnostico: Diagnostico
  /** Ver LEITURA_ATUAL. Ausente = leitura anterior aos pagamentos. */
  versaoLeitura?: number
  exercicio: number // ano da DECLARAÇÃO (2026 = ano-base 2025)
  anoBase: number
  arquivo: string
  importadoEm: string
  vals: Record<string, number>
  ndep: number
  posicoes: PosicaoAno[]
  /**
   * Pagamentos e doações efetuados (Registro 26) — plano de saúde, previdência,
   * instrução, e o que mais tiver sido declarado.
   *
   * Opcional porque histórico já gravado não tem: quem importou antes continua
   * abrindo o app, com a lista vazia até reimportar o .DEC.
   */
  pagamentos?: Pagamento[]
  /**
   * Renda por pagador, dentro de cada fonte. Ausente = leitura anterior à 4.
   *
   * `vals` continua sendo o total por fonte e continua sendo o que o resto da
   * família lê; isto entra ao lado, derivado dos mesmos lançamentos.
   *
   * Existe porque a origem da renda — trabalho ou capital — é propriedade do
   * PAGADOR, não da ficha. Dividendo pode ser o lucro da própria empresa ou o
   * provento de um ETF, e a ficha é a mesma nos dois casos: sem saber quem
   * pagou, a separação vira um botão que acerta metade das pessoas.
   *
   * Não cobre a fonte inteira, e não tem como cobrir: o Registro 22 (exterior e
   * carnê-leão) não traz fonte pagadora nenhuma. A soma daqui é sempre MENOR OU
   * IGUAL a `vals[alvo]`, e quem lê atribui a diferença ao padrão da ficha.
   */
  porPagador?: RendaPorPagador[]
  /** Soma das fontes que entram na base do imposto mínimo, naquele ano. */
  base: number
  /**
   * O que teria sido devido sob a Lei 15.270 naquele ano.
   *
   * Opcional, e não preenchido aqui. O número exige o cálculo inteiro do IRPFM —
   * deduções, redutor, imposto devido no ajuste — que é o assunto do app de
   * estimativa, não do modelo do histórico. Quem tem o cálculo em mãos refaz de
   * `vals` e `ndep`, que estão logo acima; quem não tem não precisa dele.
   *
   * Continua no tipo porque históricos gravados antes desta separação o têm, e
   * jogar fora um número que já está em disco seria perder informação de graça.
   */
  irpfm?: number
  patrimonio: number
}

export type Historico = Record<string, Declaracao> // chave: anoBase

export type ClassePatrimonio =
  | 'cdb'
  | 'tesouro'
  | 'fundo'
  | 'debentureComum'
  | 'lci'
  | 'cri'
  | 'debentureInc'
  | 'poupanca'
  | 'fii'
  | 'acoes'
  | 'imovel'
  | 'previdencia'
  | 'veiculo'
  | 'contaCorrente'
  | 'exterior'
  | 'participacao'
  | 'desconhecido'

/**
 * Regime de cada classe. Onde a lei ainda não está clara (ganho de capital em
 * ações, venda de imóvel, resgate de PGBL/VGBL) o valor é 'depende' — aparece na
 * tela como faixa, nunca como número afirmado.
 */
export const REGIME: Record<ClassePatrimonio, Regime> = {
  cdb: 'inBase',
  tesouro: 'inBase',
  fundo: 'inBase',
  debentureComum: 'inBase',
  exterior: 'inBase',
  lci: 'foraBase',
  cri: 'foraBase',
  debentureInc: 'foraBase',
  poupanca: 'foraBase',
  fii: 'foraBase', // o rendimento mensal é isento; a VENDA da cota é 'depende'
  contaCorrente: 'foraBase',
  acoes: 'depende',
  participacao: 'depende',
  imovel: 'depende',
  previdencia: 'depende',
  veiculo: 'depende',
  desconhecido: 'depende',
}

/**
 * O que o valor de «Bens e Direitos» significa em cada classe.
 *
 * O painel somava tudo como se fosse a mesma grandeza, e não é — esta é a
 * origem do achado PAT-01. A declaração pede coisas diferentes por classe:
 *
 * * `mercado` — o valor declarado é o SALDO em 31/12, que já inclui o
 *   rendimento do ano. Renda fixa, fundos, conta corrente. VGBL entra aqui:
 *   a declaração traz o valor em 31/12 do ano anterior e o do atual, sem os
 *   aportes, ou seja, o que se vê é o resultado.
 * * `custo` — o valor declarado é o custo de aquisição do que se possui em
 *   31/12 (para ações, o preço médio × quantidade). Ele se move quando se
 *   compra ou vende, NUNCA por valorização: essa só aparece na venda, na ficha
 *   de renda variável. Medir «crescimento» aqui mede aporte líquido, não
 *   retorno — e foi exatamente isso que a tela vinha chamando de crescimento.
 * * `incerto` — a descrição não diz o bastante. `exterior` pode ser conta
 *   (saldo) ou imóvel (custo); `desconhecido` é o que não foi reconhecido.
 *   Segue a mesma regra do `REGIME`: onde não se sabe, não se afirma.
 *
 * PGBL não aparece nesta tabela porque não aparece em Bens e Direitos — ele
 * mora em «Pagamentos Efetuados» (Registro 26). Ver `pgblAportado()`.
 */
export type ComoValora = 'mercado' | 'custo' | 'incerto'

export const COMO_VALORA: Record<ClassePatrimonio, ComoValora> = {
  cdb: 'mercado',
  tesouro: 'mercado',
  fundo: 'mercado',
  debentureComum: 'mercado',
  lci: 'mercado',
  cri: 'mercado',
  debentureInc: 'mercado',
  poupanca: 'mercado',
  contaCorrente: 'mercado',
  previdencia: 'mercado', // VGBL: 31/12 anterior e 31/12 atual
  acoes: 'custo', // preço médio × quantidade em 31/12
  fii: 'custo',
  participacao: 'custo',
  imovel: 'custo',
  veiculo: 'custo',
  exterior: 'incerto',
  desconhecido: 'incerto',
}

/** `true` só onde o valor declarado acompanha o mercado de verdade. */
export const segueMercado = (c: ClassePatrimonio) => COMO_VALORA[c] === 'mercado'

/**
 * Classes cujo valor declarado SÓ SOBE enquanto o dinheiro está lá.
 *
 * É a distinção que faltava para o app parar de chamar resgate de prejuízo. A
 * declaração pede, para renda fixa de acumulação, o valor aplicado mais os
 * rendimentos creditados até 31/12 — um número que anda para frente todo ano,
 * porque juro creditado não é devolvido. Se o saldo de uma LCA caiu de um ano
 * para o outro, **não foi o papel que rendeu negativo: saiu dinheiro dali**.
 * Era exatamente isso que a tela vinha reportando como retorno de −10%.
 *
 * `false` onde a queda é ambígua de verdade, e aí o app não escolhe por conta
 * própria:
 *
 * * `tesouro` — marcado a mercado. Um IPCA+ longo cai de valor sem ninguém
 *   resgatar nada, e chamar isso de saque seria o erro simétrico;
 * * `fundo` e `previdencia` (VGBL) — cota que oscila, pelo mesmo motivo;
 * * as classes declaradas ao custo (`COMO_VALORA === 'custo'`), onde a variação
 *   já não é retorno em primeiro lugar;
 * * `exterior` e `desconhecido`, pela regra do resto do módulo: onde não se
 *   sabe o que o valor é, não se afirma o que a queda significa.
 *
 * A leitura vale para o VALOR DECLARADO, não para o mercado: um CDB pós-fixado
 * pode até ter marcação negativa no extrato da corretora, e ainda assim entra na
 * declaração pela curva. É o número da declaração que estes gráficos leem.
 */
export const ACUMULA_JUROS: Record<ClassePatrimonio, boolean> = {
  cdb: true,
  lci: true,
  cri: true,
  debentureComum: true,
  debentureInc: true,
  poupanca: true,
  contaCorrente: false, // saldo de conta cai o tempo todo, e não é resgate de nada
  tesouro: false,
  fundo: false,
  previdencia: false,
  acoes: false,
  fii: false,
  participacao: false,
  imovel: false,
  veiculo: false,
  exterior: false,
  desconhecido: false,
}

/**
 * A queda de saldo desta classe só pode ser dinheiro que saiu.
 *
 * Quem pergunta isto está decidindo entre "esta classe rendeu −10%" e "houve um
 * resgate de pelo menos R$ X". A segunda é a resposta certa onde o valor
 * declarado acumula juros, e é a única que não inventa prejuízo.
 */
export const quedaEhSaida = (c: ClassePatrimonio) => ACUMULA_JUROS[c]

export const NOME_CLASSE: Record<ClassePatrimonio, string> = {
  cdb: 'CDB / RDB',
  tesouro: 'Tesouro Direto',
  fundo: 'Fundos tributáveis',
  debentureComum: 'Debêntures comuns',
  lci: 'LCI / LCA',
  cri: 'CRI / CRA',
  debentureInc: 'Debêntures incentivadas',
  poupanca: 'Poupança',
  fii: 'FII',
  acoes: 'Ações',
  imovel: 'Imóveis',
  previdencia: 'Previdência (PGBL/VGBL)',
  veiculo: 'Veículos',
  contaCorrente: 'Conta corrente',
  exterior: 'Exterior',
  participacao: 'Participação societária (quotas)',
  desconhecido: 'Não classificado',
}

/**
 * Código antigo do bem (até o exercício 2018) → classe. Conferido contra um
 * arquivo real de 2020, cada código batendo com a descrição da própria linha:
 * 21 com placa de veículo, 31 com ticker e quantidade, 32 com "participação de
 * X% no capital social", 61 com agência e conta.
 *
 * De 2019 em diante o campo passou a ser o GRUPO, e os valores dos dois
 * esquemas não colidem (antigos 21–79, novos 01–10 e 99), então esta tabela
 * pode ser consultada sem saber o ano.
 *
 * Os códigos de FUNDOS (71, 72, 73, 74, 79) ficam DE FORA de propósito: a
 * família é clara, o subtipo não, e errar entre "fundo tributável" e "FII"
 * trocaria isento por tributável — inventaria imposto. E o esquema novo não
 * entra aqui de jeito nenhum: com as descrições anonimizadas não deu para
 * confirmar nenhum par grupo/código, e chutar seria pior que deixar em aberto.
 * Para esses, a tela classifica uma vez e aplica a todos com o mesmo código.
 */
export const CLASSE_POR_CODIGO: Record<string, ClassePatrimonio> = {
  '21': 'veiculo',
  '31': 'acoes',
  '32': 'participacao',
  '41': 'poupanca',
  '45': 'cdb',
  '61': 'contaCorrente',
}

/** Como o código aparece na tela: "45" no esquema antigo, "03·01" no novo. */
export function rotuloCodigo(codigo?: string, subcodigo?: string): string {
  const c = (codigo ?? '').trim()
  if (!c) return ''
  const s = (subcodigo ?? '').trim()
  return s && s !== '01' ? `${c}·${s}` : c
}

/** Chave de agrupamento: bens com o mesmo par recebem a mesma classificação. */
export const chaveCodigo = (p: { codigo?: string; subcodigo?: string }) =>
  `${(p.codigo ?? '').trim()}·${(p.subcodigo ?? '').trim()}`

/**
 * Ids de todas as posições, em todos os anos, que compartilham o código.
 *
 * Sem código não há grupo: arquivo antigo (ou linha que o layout cortou) chega
 * com o campo em branco, e agrupar por "vazio" juntaria bens que não têm nada a
 * ver — o imóvel viraria renda fixa junto com o resto.
 */
export function idsPorCodigo(h: Historico, chave: string): string[] {
  if (!chave.replace(/[·\s]/g, '')) return []
  const ids = new Set<string>()
  for (const d of Object.values(h)) {
    for (const p of d.posicoes) if (chaveCodigo(p) === chave) ids.add(p.id)
  }
  return [...ids]
}

/**
 * Classifica pela descrição do Bens e Direitos, que é texto livre.
 * O default é 'desconhecido' — e 'desconhecido' é 'depende', NÃO 'inBase':
 * chutar que um bem não identificado solta base do IRPFM inventaria imposto.
 */
export function classificaPatrimonio(descricao: string): ClassePatrimonio {
  const d = descricao.toUpperCase()
  if (/POUPAN/.test(d)) return 'poupanca'
  if (/\bLC[IA]\b|LETRA DE CR[ÉE]DITO/.test(d)) return 'lci'
  if (/\bCR[IA]\b|CERTIFICAD[OA] DE RECEB/.test(d)) return 'cri'
  if (/INCENTIVAD/.test(d)) return 'debentureInc'
  if (/DEB[ÊE]NTURE/.test(d)) return 'debentureComum'
  if (/\bFII\b|FUNDO DE INVEST.*IMOBILI|IMOBILI[ÁA]RIO/.test(d)) return 'fii'
  if (/TESOURO|NTN-|\bLFT\b|\bLTN\b|SELIC/.test(d)) return 'tesouro'
  if (/\bCDB\b|\bRDB\b|\bLC\b/.test(d)) return 'cdb'
  if (/PGBL|VGBL|PREVID/.test(d)) return 'previdencia'
  if (/A[ÇC][ÕO]ES|\bON\b|\bPN\b|B3|BOLSA/.test(d)) return 'acoes'
  if (/APARTAMENTO|CASA|TERRENO|IM[ÓO]VEL|SALA COMERCIAL|CHACARA|CH[ÁA]CARA|FAZENDA/.test(d)) return 'imovel'
  if (/VE[ÍI]CULO|AUTOM[ÓO]VEL|CARRO|MOTOCICLETA/.test(d)) return 'veiculo'
  if (/CONTA CORRENTE|CONTA-CORRENTE|DEP[ÓO]SITO/.test(d)) return 'contaCorrente'
  if (/EXTERIOR|OFFSHORE|\bUSD\b/.test(d)) return 'exterior'
  if (/FUNDO|\bFIC\b|COTAS/.test(d)) return 'fundo'
  return 'desconhecido'
}

/**
 * Classe da posição: a descrição manda quando reconhece algo, porque distingue
 * o que o código não distingue (LCI/LCA e incentivadas têm o mesmo código de
 * renda fixa e regime oposto). O código entra quando a descrição não diz nada.
 */
export function classificaPosicao(descricao: string, codigo?: string): ClassePatrimonio {
  const pelaDescricao = classificaPatrimonio(descricao)
  if (pelaDescricao !== 'desconhecido') return pelaDescricao
  return (codigo && CLASSE_POR_CODIGO[codigo.trim()]) || 'desconhecido'
}

/** Soma os lançamentos por campo de destino, ignorando os sem destino. */
export function somaPorAlvo(lancamentos: Lancamento[]): Record<string, number> {
  const vals: Record<string, number> = {}
  for (const l of lancamentos) {
    if (!l.alvo) continue
    vals[l.alvo] = (vals[l.alvo] ?? 0) + l.valor
  }
  return vals
}

/**
 * Texto virando chave: maiúsculas, só letras e dígitos, espaço único, 60 chars.
 *
 * Um lugar só porque duas identidades dependem dela — a do bem e a do pagador —
 * e receitas que divergem quebram o casamento entre anos justamente onde ele
 * mais importa: o produto que o banco renomeou.
 */
function normalizar(texto: string): string {
  return texto
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/** Identidade estável da posição entre anos: classe + descrição normalizada. */
export function idPosicao(descricao: string, classe: ClassePatrimonio): string {
  return `${classe}:${normalizar(descricao)}`
}

/**
 * Identidade estável do pagador. Vazio quando o registro não identifica ninguém.
 *
 * Zeros não são CNPJ: o campo vem preenchido com `00000000000000` em registro
 * que não tem fonte, e aceitá-lo juntaria num pagador só todo mundo que não tem
 * pagador — que é o pior desfecho possível aqui, porque uma resposta erraria
 * várias fichas de uma vez. Os zeros à ESQUERDA, esses ficam: fazem parte do
 * número.
 */
export function idPagador(nome: string, cnpj?: string): string {
  const digitos = (cnpj ?? '').replace(/\D/g, '')
  if (digitos.length === 14 && !/^0+$/.test(digitos)) return `cnpj:${digitos}`
  const norm = normalizar(nome ?? '')
  return norm ? `nome:${norm}` : ''
}

/**
 * Os lançamentos agrupados por ficha e pagador — a segunda saída do import.
 *
 * Três coisas ficam de fora, e cada uma por um motivo diferente:
 *
 *   · as chaves `*_ir`, que são imposto retido e não renda (`ehImpostoRetido`);
 *   · o lançamento sem fonte identificada — o Registro 22 não traz nenhuma, e
 *     inventar um pagador «não identificado» daria à pessoa uma linha para
 *     responder sobre algo que ela não tem como reconhecer. Ele continua inteiro
 *     em `vals`, e quem lê atribui a diferença ao padrão da ficha;
 *   · o valor zero ou negativo, que não é renda recebida.
 *
 * O mesmo pagador em duas fichas vira duas linhas, e isso é de propósito: o
 * banco que paga CDB e LCI aparece nas duas, e a resposta sobre ele vale para as
 * duas porque a chave da resposta é o pagador, não a linha.
 */
export function rendaPorPagador(lancamentos: Lancamento[]): RendaPorPagador[] {
  const acc = new Map<string, RendaPorPagador>()
  for (const l of lancamentos) {
    if (!l.alvo || ehImpostoRetido(l.alvo) || l.valor <= 0) continue
    const id = idPagador(l.fonte, l.cnpj)
    if (!id) continue
    const chave = `${l.alvo}\u0000${id}`
    const atual = acc.get(chave)
    if (atual) {
      atual.valor += l.valor
      // o nome vazio de um lançamento não apaga o que outro trouxe
      if (!atual.pagador.nome && l.fonte.trim()) atual.pagador.nome = l.fonte.trim()
      continue
    }
    acc.set(chave, {
      alvo: l.alvo,
      pagador: { id, nome: l.fonte.trim(), ...(id.startsWith('cnpj:') ? { cnpj: id.slice(5) } : {}) },
      valor: l.valor,
    })
  }
  return [...acc.values()].sort((a, b) => b.valor - a.valor)
}

/**
 * Converte o resultado do parser numa declaração do histórico, já com a base do
 * imposto mínimo daquele ano.
 *
 * A base sai da lista de fontes (`FIELDS`): soma o que a lei manda somar. O
 * imposto em si não sai daqui — ver `Declaracao.irpfm`.
 */
export function montarDeclaracao(dec: DecResult, arquivo: string, agora: string, exercicioManual?: number): Declaracao | null {
  const exercicio = exercicioManual ?? (dec.ano ? parseInt(dec.ano, 10) : NaN)
  if (!Number.isFinite(exercicio)) return null

  const vals = somaPorAlvo(dec.lancamentos)
  const porPagador = rendaPorPagador(dec.lancamentos)
  const base = FIELDS.filter((f) => f.base).reduce((s, f) => s + (vals[f.key] || 0), 0)

  const posicoes: PosicaoAno[] = dec.posicoes
    .filter((p) => p.saldoAtual > 0 || p.saldoAnterior > 0)
    .map((p) => {
      const classe = classificaPosicao(p.descricao, p.codigo)
      return {
        id: idPosicao(p.descricao, classe),
        descricao: p.descricao,
        codigo: p.codigo,
        subcodigo: p.subcodigo,
        bruta: p.bruta,
        classe,
        regime: REGIME[classe],
        saldoAnterior: p.saldoAnterior,
        saldoAtual: p.saldoAtual,
      }
    })

  return {
    versaoLeitura: LEITURA_ATUAL,
    pagamentos: dec.pagamentos ?? [],
    diagnostico: {
      registros: dec.registros.map((r) => ({ tipo: r.tipo, count: r.count })),
      lancamentos: dec.lancamentos.length,
      posicoes: dec.posicoes.length,
      totalLinhas: dec.totalLinhas,
      anoDetectado: dec.ano !== null,
    },
    exercicio,
    anoBase: exercicio - 1,
    arquivo,
    importadoEm: agora,
    vals,
    porPagador,
    ndep: dec.ndep,
    posicoes,
    base,
    patrimonio: posicoes.reduce((s, p) => s + p.saldoAtual, 0),
  }
}

// ---------------------------------------------------------------- séries

export interface PontoPatrimonio {
  anoBase: number
  inBase: number
  foraBase: number
  depende: number
  /** Bruto: a soma de tudo que está em Bens e Direitos. */
  total: number
  /** Parte cujo valor declarado acompanha o mercado (ver `COMO_VALORA`). */
  aMercado: number
  /** Parte declarada pelo custo de aquisição — não se move por valorização. */
  aoCusto: number
  /** Parte que não dá para dizer em qual dos dois cai. */
  incerto: number
  /** Dívidas informadas para o ano. `null` = ninguém informou (≠ zero). */
  dividas: number | null
  /** `total − dividas`. Sem dívida informada, é o próprio bruto. */
  liquido: number
}

/**
 * Dívidas por ano-base, como a tela de consistência as guarda.
 *
 * Vem por parâmetro em vez de sair do `Historico` porque o `.DEC` que o app lê
 * hoje não traz dívidas — quem informa é a pessoa. O dia em que o leitor
 * aprender o registro delas, só muda quem preenche este mapa.
 */
export type DividasPorAno = Record<string | number, number | undefined>

export function seriePatrimonio(h: Historico, dividas: DividasPorAno = {}): PontoPatrimonio[] {
  return Object.values(h)
    .map((d) => {
      const p = { anoBase: d.anoBase, inBase: 0, foraBase: 0, depende: 0, total: 0, aMercado: 0, aoCusto: 0, incerto: 0 }
      for (const pos of d.posicoes) {
        p[pos.regime] += pos.saldoAtual
        p.total += pos.saldoAtual
        const como = COMO_VALORA[pos.classe]
        if (como === 'mercado') p.aMercado += pos.saldoAtual
        else if (como === 'custo') p.aoCusto += pos.saldoAtual
        else p.incerto += pos.saldoAtual
      }
      // Ausente é diferente de zero: «não informou» não pode virar «não deve».
      const div = dividas[d.anoBase]
      const divida = typeof div === 'number' ? div : null
      return { ...p, dividas: divida, liquido: p.total - (divida ?? 0) }
    })
    .sort((a, b) => a.anoBase - b.anoBase)
}

export interface PontoPgbl {
  anoBase: number
  /** Aportado NAQUELE ano, pelo Registro 26. */
  noAno: number
  /** Soma do que foi aportado até aquele ano, nos anos importados. */
  acumulado: number
}

/**
 * O PGBL, que o painel de patrimônio não enxerga.
 *
 * Ele não está em «Bens e Direitos» — mora em «Pagamentos Efetuados», porque foi
 * deduzido na declaração. O efeito é que quem acumula PGBL tem patrimônio que a
 * tela não mostra, e é justamente o ativo mais caro de resgatar: no resgate o
 * valor INTEIRO é tributável, principal e rendimento, não só o ganho.
 *
 * O que dá para reconstruir daqui é o APORTADO, não o saldo: o Registro 26 traz
 * o que se pagou no ano, e o rendimento do plano não aparece em lugar nenhum da
 * declaração. Então este número é um PISO, e a tela precisa dizer isso — somar
 * como se fosse saldo repetiria, do outro lado, o erro que o PAT-01 corrige.
 *
 * Só conta os anos importados: quem começou o plano antes do .DEC mais antigo
 * tem uma parte que ninguém aqui pode saber.
 */
export function pgblAportado(h: Historico): PontoPgbl[] {
  let acumulado = 0
  return Object.values(h)
    .sort((a, b) => a.anoBase - b.anoBase)
    .map((d) => {
      const noAno = (d.pagamentos ?? [])
        .filter((pg) => sugerirCategoria(pg).categoria === 'previdenciaPrivada')
        .reduce((t, pg) => t + Math.max(0, pg.valor - (pg.naoDedutivel || 0)), 0)
      acumulado += noAno
      return { anoBase: d.anoBase, noAno, acumulado }
    })
}

/** Crescimento anual composto entre o primeiro e o último ano com patrimônio. */
export function cagr(serie: PontoPatrimonio[]): number | null {
  const comValor = serie.filter((p) => p.total > 0)
  if (comValor.length < 2) return null
  const ini = comValor[0]
  const fim = comValor[comValor.length - 1]
  const anos = fim.anoBase - ini.anoBase
  if (anos <= 0 || ini.total <= 0) return null
  return Math.pow(fim.total / ini.total, 1 / anos) - 1
}

/** Total por classe no ano mais recente — alimenta o mapa de resgate. */
export function porClasse(h: Historico): { classe: ClassePatrimonio; regime: Regime; total: number }[] {
  const anos = Object.values(h).sort((a, b) => b.anoBase - a.anoBase)
  if (anos.length === 0) return []
  const soma = new Map<ClassePatrimonio, number>()
  for (const p of anos[0].posicoes) soma.set(p.classe, (soma.get(p.classe) ?? 0) + p.saldoAtual)
  return [...soma.entries()]
    .map(([classe, total]) => ({ classe, regime: REGIME[classe], total }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
}

const DIAGNOSTICO_VAZIO: Diagnostico = { registros: [], lancamentos: 0, posicoes: 0, totalLinhas: 0, anoDetectado: true }

/**
 * Migra histórico gravado por versões anteriores. Declarações da fase A não têm
 * `diagnostico` nem `codigo` nas posições — ler esses campos sem checar derrubava
 * o app inteiro na tela preta. Estado velho encontrando código novo é a classe de
 * bug mais provável num app que guarda dados por anos; então a leitura conserta.
 */
export function normalizaHistorico(h: Historico | undefined | null): Historico {
  if (!h || typeof h !== 'object') return {}
  const saida: Historico = {}
  for (const [ano, d] of Object.entries(h)) {
    if (!d || typeof d !== 'object') continue
    const posicoes = (Array.isArray(d.posicoes) ? d.posicoes : []).map((p) => ({ ...p, codigo: p.codigo ?? '' }))
    saida[ano] = {
      ...d,
      posicoes,
      // undefined de propósito quando não existe: distingue "declaração sem
      // pagamentos" de "importada antes de o app saber ler pagamentos" — só
      // assim a tela pode pedir a reimportação em vez de mostrar um vazio mudo
      pagamentos: Array.isArray(d.pagamentos) ? d.pagamentos : undefined,
      // sem carimbo é leitura antiga: quem não tem pagamentos gravados veio da
      // versão 1, quem tem veio da 2
      versaoLeitura: typeof d.versaoLeitura === 'number' ? d.versaoLeitura : Array.isArray(d.pagamentos) ? 2 : 1,
      diagnostico: d.diagnostico ?? { ...DIAGNOSTICO_VAZIO, posicoes: posicoes.length },
    }
  }
  return saida
}

export function upsertDeclaracao(h: Historico, d: Declaracao): Historico {
  return { ...h, [String(d.anoBase)]: d }
}

/**
 * Corrige o ano de uma declaração já importada. O ano vem de uma busca por
 * "20xx" no começo do arquivo, o que acerta na maioria dos casos e erra em
 * alguns — dígitos de valores podem parecer ano. Em vez de tornar a heurística
 * mais esperta e quebrar o que já funciona, a tela deixa consertar.
 */
export function reatribuirAno(h: Historico, anoBaseAtual: number, novoExercicio: number): Historico {
  const d = h[String(anoBaseAtual)]
  if (!d) return h
  const { [String(anoBaseAtual)]: _, ...resto } = h
  return { ...resto, [String(novoExercicio - 1)]: { ...d, exercicio: novoExercicio, anoBase: novoExercicio - 1 } }
}

export function removerAno(h: Historico, anoBase: number): Historico {
  const { [String(anoBase)]: _, ...resto } = h
  return resto
}

// ---------------------------------------------------------------- correções manuais

/**
 * A descrição do Bens e Direitos é texto livre; nenhum reconhecimento automático
 * acerta sempre. Em vez de esconder isso, a tela deixa corrigir a classe — e a
 * correção vale para TODOS os anos, porque o id da posição é estável. Uma
 * correção, a série inteira arrumada.
 */
export type Overrides = Record<string, ClassePatrimonio>

export function aplicarOverrides(h: Historico, ov: Overrides): Historico {
  if (Object.keys(ov).length === 0) return h
  const saida: Historico = {}
  for (const [ano, d] of Object.entries(h)) {
    const posicoes = d.posicoes.map((p) => {
      const classe = ov[p.id]
      return classe ? { ...p, classe, regime: REGIME[classe] } : p
    })
    saida[ano] = { ...d, posicoes }
  }
  return saida
}

// ---------------------------------------------------------------- vínculos entre anos

/**
 * Ligação manual entre posições de anos diferentes: `id de origem → id canônico`.
 *
 * O casamento automático usa classe + descrição normalizada, o que quebra quando
 * o banco muda o nome do produto entre um ano e outro ("CDB BCO X" vira "CDB
 * BANCO X S.A."). Sem isso a mesma aplicação vira duas séries curtas e o
 * rendimento embutido some. Aqui o usuário diz que são a mesma coisa.
 */
export type Vinculos = Record<string, string>

/**
 * Colapsa cadeias: A→B e B→C viram A→C e B→C.
 *
 * `aplicarVinculos` reescreve o id de cada posição UMA vez, então uma cadeia
 * não resolvida parte a série no meio — o bem de 2020 ia parar num id que não
 * é de posição nenhuma, e sumia da série. É o que acontecia quando a pessoa
 * ligava um bem que tem quatro variações de nome: cada ligação cobria um salto,
 * e o histórico continuava partido.
 *
 * Ciclo (A→B e B→A, que só nasce de ligação manual contraditória) para no
 * primeiro id repetido: cadeia curta é melhor que laço infinito.
 */
export function resolverCadeias(v: Vinculos): Vinculos {
  const saida: Vinculos = {}
  for (const de of Object.keys(v)) {
    const vistos = new Set<string>([de])
    let atual = v[de]
    while (v[atual] && !vistos.has(atual)) {
      vistos.add(atual)
      atual = v[atual]
    }
    if (atual !== de) saida[de] = atual
  }
  return saida
}

export function aplicarVinculos(h: Historico, v: Vinculos): Historico {
  if (Object.keys(v).length === 0) return h
  const mapa = resolverCadeias(v)
  const saida: Historico = {}
  for (const [ano, d] of Object.entries(h)) {
    saida[ano] = { ...d, posicoes: d.posicoes.map((p) => (mapa[p.id] ? { ...p, id: mapa[p.id] } : p)) }
  }
  return saida
}

/** Overrides e vínculos sempre juntos: as duas correções valem para tudo. */
export function prepararHistorico(h: Historico, overrides: Overrides, vinculos: Vinculos): Historico {
  return aplicarVinculos(aplicarOverrides(h, overrides), vinculos)
}

/** Posições de um ano específico — o mapa deixou de ser só do ano mais recente. */
export function posicoesDoAno(h: Historico, anoBase: number): PosicaoAno[] {
  const d = h[String(anoBase)]
  return d ? [...d.posicoes].sort((a, b) => b.saldoAtual - a.saldoAtual) : []
}

/** Anos disponíveis, do mais recente para o mais antigo. */
export function anosDisponiveis(h: Historico): number[] {
  return Object.values(h)
    .map((d) => d.anoBase)
    .sort((a, b) => b - a)
}

// ---------------------------------------------------------------- base estocada

/** Saldo de uma mesma posição ao longo dos anos — o casamento entre declarações. */
export function serieDaPosicao(h: Historico, id: string): { anoBase: number; saldo: number; anterior: number }[] {
  return Object.values(h)
    .map((d) => {
      const p = d.posicoes.find((x) => x.id === id)
      return p ? { anoBase: d.anoBase, saldo: p.saldoAtual, anterior: p.saldoAnterior } : null
    })
    .filter((x): x is { anoBase: number; saldo: number; anterior: number } => x !== null)
    .sort((a, b) => a.anoBase - b.anoBase)
}

/** Aportes informados pelo usuário, por posição e ano: chave `id@anoBase`. */
export type Aportes = Record<string, number>

export const chaveAporte = (id: string, anoBase: number) => `${id}@${anoBase}`

export interface Embutido {
  id: string
  descricao: string
  classe: ClassePatrimonio
  saldoAtual: number
  embutido: number
  /** true quando algum ano entrou sem aporte informado — então é estimativa alta. */
  estimado: boolean
  porAno: { anoBase: number; crescimento: number; aporte: number; embutido: number; informado: boolean }[]
}

/**
 * "Base estocada": quanto de rendimento está embutido nas posições cujo resgate
 * cai na base do IRPFM.
 *
 * LIMITE HONESTO: o .DEC mostra saldo, não separa aporte de rendimento. Sem o
 * aporte informado, o crescimento inteiro do ano é tratado como rendimento — o
 * que SUPERESTIMA. Por isso cada linha diz se é número informado ou estimativa.
 */
export function baseEstocada(h: Historico, aportes: Aportes = {}): { total: number; itens: Embutido[]; algumEstimado: boolean } {
  const anos = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  const recente = anos[anos.length - 1]
  if (!recente) return { total: 0, itens: [], algumEstimado: false }

  const itens: Embutido[] = recente.posicoes
    .filter((p) => p.regime === 'inBase')
    .map((p) => {
      const porAno = serieDaPosicao(h, p.id).map((ponto) => {
        const chave = chaveAporte(p.id, ponto.anoBase)
        const informado = chave in aportes
        const aporte = informado ? aportes[chave] : 0
        const crescimento = ponto.saldo - ponto.anterior
        return { anoBase: ponto.anoBase, crescimento, aporte, embutido: Math.max(0, crescimento - aporte), informado }
      })
      return {
        id: p.id,
        descricao: p.descricao,
        classe: p.classe,
        saldoAtual: p.saldoAtual,
        embutido: porAno.reduce((s, a) => s + a.embutido, 0),
        estimado: porAno.some((a) => !a.informado && a.crescimento > 0),
        porAno,
      }
    })
    .filter((x) => x.saldoAtual > 0)
    .sort((a, b) => b.embutido - a.embutido)

  return {
    total: itens.reduce((s, i) => s + i.embutido, 0),
    itens,
    algumEstimado: itens.some((i) => i.estimado),
  }
}

/** Posições do ano mais recente, para a tela de correção e de aportes. */
export function posicoesRecentes(h: Historico): PosicaoAno[] {
  const anos = Object.values(h).sort((a, b) => b.anoBase - a.anoBase)
  return anos[0] ? [...anos[0].posicoes].sort((a, b) => b.saldoAtual - a.saldoAtual) : []
}
