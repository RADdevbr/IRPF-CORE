// Onde está cada bem, e quem deve — a resposta por bem.
//
// A leitura do patrimônio por instituição precisa de duas coisas que o `.DEC`
// não diz com certeza, e que parecem a mesma sem ser:
//
//   · a INSTITUIÇÃO — onde o dinheiro está: o banco ou a corretora da conta. É
//     como a pessoa pensa («tenho tanto no BTG»), e é por ela que se agrupam a
//     composição e a rentabilidade;
//   · o EMISSOR — quem deve o dinheiro. O CDB do Banco X comprado pela XP está
//     NA XP e é DÍVIDA do Banco X. O FGC olha o emissor, e é por isso que o
//     limite se soma entre corretoras diferentes.
//
// Por que é resposta, e não leitura. A linha do bem é texto livre, e o arquivo
// de 2016 conferido não tem campo de CNPJ nenhum no Registro 27 — a própria
// pessoa digitou o CNPJ DENTRO da descrição. Do formato de 2019 em diante ainda
// não se conferiu, contra arquivo real, se o campo existe e o que ele guarda; a
// suspeita é que dê o emissor e não a corretora, e aí a instituição continuaria
// sendo pergunta de qualquer jeito.
//
// Então é o desenho do `origemPagador`: a pessoa responde uma vez por bem, e a
// resposta vale para todos os anos; o app SUGERE, com o motivo à vista, e nunca
// grava a sugestão sozinho. Responder mora no IRPF-calc, porque corrigir o
// histórico é de lá; a resposta viaja no pacote do histórico.

import { nomeParaCasar, resolverCadeias, type ClassePatrimonio, type Historico, type Vinculos } from './historico.js'

/**
 * A resposta sobre um bem. Os dois campos são independentes: dá para saber onde
 * o CDB está e ainda não saber de quem ele é.
 */
export interface InstituicaoDoBem {
  /** Onde está — o banco ou a corretora da conta, como a pessoa escreveu. */
  instituicao?: string
  /**
   * Quem deve. Só é perguntado onde o devedor é um banco (`emissorEhBanco`):
   * nas outras classes ninguém pergunta, e um valor que sobre ali não é lido.
   *
   * Ausente é «ninguém respondeu», e quem lê não pode tratar como coberto: sem
   * saber o banco, não dá para somar ao limite do FGC dele.
   */
  emissor?: string
}

/**
 * A resposta da pessoa: `id do bem → onde está e quem deve`.
 *
 * A chave é o id CANÔNICO do bem — o que ele tem depois dos vínculos entre anos
 * —, e por isso uma resposta cobre a série inteira, como a correção de classe.
 * Ver `respostasCanonicas` para o que acontece quando o vínculo vem depois.
 */
export type InstituicaoPorBem = Record<string, InstituicaoDoBem>

// ------------------------------------------------------------- que bens entram

/**
 * Imóvel, veículo e quota de empresa não estão em instituição nenhuma.
 *
 * Perguntar «em que banco está o seu apartamento?» gastaria a atenção da pessoa
 * numa pergunta sem resposta, e quem lê soma esses bens à parte.
 */
const FORA_DE_INSTITUICAO: ReadonlySet<ClassePatrimonio> = new Set(['imovel', 'veiculo', 'participacao'])

export const estaEmInstituicao = (c: ClassePatrimonio) => !FORA_DE_INSTITUICAO.has(c)

/**
 * Classes em que quem deve é um banco: depósito, poupança, CDB/RDB e as letras.
 *
 * São as mesmas que o FGC cobre, e não por acaso — o FGC existe para o credor de
 * banco. Mas a pergunta aqui é «quem deve», e a regra do FGC é de quem lê a
 * resposta: se ela mudar (uma classe nova coberta, um limite novo), muda lá, e
 * não aqui.
 */
const EMISSOR_BANCARIO: ReadonlySet<ClassePatrimonio> = new Set(['contaCorrente', 'poupanca', 'cdb', 'lci'])

export const emissorEhBanco = (c: ClassePatrimonio) => EMISSOR_BANCARIO.has(c)

/** Está tudo respondido para este bem? O emissor só conta onde ele é pergunta. */
export function respostaCompleta(classe: ClassePatrimonio, r: InstituicaoDoBem | undefined): boolean {
  if (!r?.instituicao) return false
  return !emissorEhBanco(classe) || !!r.emissor
}

// ------------------------------------------------------------------ identidade

/**
 * A identidade de um nome de instituição: «XP», «xp» e «X.P.» são uma só.
 *
 * É a receita de casar nomes do núcleo, e não uma segunda: «Banco do Brasil» e
 * «BANCO DO BRASIL S.A.» só não se juntam pela forma societária, e isso a pessoa
 * vê na lista de nomes já usados e corrige.
 *
 * O que ela NÃO resolve é conglomerado. O FGC conta por conglomerado, e dois
 * bancos do mesmo grupo com nomes diferentes são dois nomes aqui. A resposta à
 * mão é o que corrige: quem sabe que são o mesmo grupo escreve o mesmo nome.
 */
export const idInstituicao = (nome: string) => nomeParaCasar(nome)

/**
 * Os nomes já usados nas respostas — instituições e emissores — na primeira
 * grafia em que cada um apareceu.
 *
 * Para a tela oferecer como lista: responder «XP» num bem e «XP Investimentos»
 * no outro partiria a mesma corretora em duas, e a lista é o que evita.
 */
export function nomesUsados(mapa: InstituicaoPorBem): string[] {
  const vistos = new Map<string, string>()
  for (const r of Object.values(mapa)) {
    for (const nome of [r.instituicao, r.emissor]) {
      if (!nome) continue
      const id = idInstituicao(nome)
      if (id && !vistos.has(id)) vistos.set(id, nome)
    }
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * As respostas reescritas para o id canônico de cada bem.
 *
 * A resposta é gravada no id que o bem tinha quando a pessoa respondeu. Se
 * depois ela liga esse bem a outro — o banco renomeou o produto, e o vínculo
 * juntou as duas séries —, o id do bem passa a ser o canônico, e a resposta
 * ficaria presa num id que não é mais de posição nenhuma. O bem voltaria a
 * aparecer sem instituição, e a resposta dada sumiria sem aviso.
 *
 * Quando o id antigo e o canônico têm resposta os dois, vale a do canônico,
 * campo a campo: é ela que a tela mostra, e é nela que a pessoa mexeu por último.
 */
export function respostasCanonicas(mapa: InstituicaoPorBem, vinculos: Vinculos = {}): InstituicaoPorBem {
  const destino = resolverCadeias(vinculos)
  const saida: InstituicaoPorBem = {}
  // Primeiro as que já estão no canônico, para ganharem de quem chega depois.
  const chaves = Object.keys(mapa).sort((a, b) => Number(a in destino) - Number(b in destino))
  for (const de of chaves) {
    const para = destino[de] ?? de
    const atual = saida[para] ?? {}
    const r = mapa[de]
    saida[para] = {
      ...(atual.instituicao ?? r.instituicao ? { instituicao: atual.instituicao ?? r.instituicao } : {}),
      ...(atual.emissor ?? r.emissor ? { emissor: atual.emissor ?? r.emissor } : {}),
    }
  }
  return saida
}

/**
 * Lê a resposta que veio de fora — pacote ou estado gravado — e descarta o que
 * não tem a forma.
 *
 * O pacote é arquivo que a pessoa solta na tela, e quem lê chama métodos de
 * texto sobre estes campos. Um número no lugar de um nome derrubaria o painel
 * inteiro na hora de agrupar; a linha malformada sai, e o resto entra.
 */
export function lerInstituicaoPorBem(bruto: unknown): InstituicaoPorBem {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return {}
  const texto = (x: unknown) => (typeof x === 'string' && x.trim() !== '' ? x.trim() : undefined)
  const saida: InstituicaoPorBem = {}
  for (const [id, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const instituicao = texto((v as Record<string, unknown>).instituicao)
    const emissor = texto((v as Record<string, unknown>).emissor)
    if (!instituicao && !emissor) continue
    saida[id] = { ...(instituicao ? { instituicao } : {}), ...(emissor ? { emissor } : {}) }
  }
  return saida
}

// ---------------------------------------------------------------- a lista de bens

export interface BemEmInstituicao {
  /** Id canônico — a chave da resposta. */
  id: string
  /** A descrição do último ano em que o bem aparece. */
  descricao: string
  classe: ClassePatrimonio
  /** Anos-base em que o bem aparece com saldo, do mais antigo ao mais recente. */
  anos: number[]
  /** Saldo em 31/12 do último desses anos. */
  saldo: number
}

/**
 * Os bens que têm instituição, um por id canônico, com a descrição e a classe do
 * último ano em que aparecem.
 *
 * Recebe o histórico JÁ PREPARADO (overrides e vínculos aplicados): a pergunta é
 * sobre o bem, e sem os vínculos o CDB renomeado seria perguntado duas vezes.
 *
 * O bem que já saiu da carteira também entra. A rentabilidade dos anos passados
 * precisa dele, e é nos anos em que ele existia que a instituição dele pesava.
 * Vem depois dos atuais: primeiro o ano mais recente, e dentro dele o maior.
 */
export function bensEmInstituicao(h: Historico): BemEmInstituicao[] {
  const porId = new Map<string, BemEmInstituicao>()
  const anos = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  for (const d of anos) {
    for (const p of d.posicoes) {
      if (p.saldoAtual <= 0) continue
      const atual = porId.get(p.id)
      if (atual) {
        // Ano mais recente sobrescreve: a descrição e a classe de hoje são as
        // que a pessoa reconhece. Duas posições do mesmo id no mesmo ano (o
        // vínculo juntou) somam.
        if (atual.anos[atual.anos.length - 1] === d.anoBase) {
          atual.saldo += p.saldoAtual
          continue
        }
        atual.anos.push(d.anoBase)
        atual.saldo = p.saldoAtual
        atual.descricao = p.descricao
        atual.classe = p.classe
      } else {
        porId.set(p.id, { id: p.id, descricao: p.descricao, classe: p.classe, anos: [d.anoBase], saldo: p.saldoAtual })
      }
    }
  }
  return [...porId.values()]
    .filter((b) => estaEmInstituicao(b.classe))
    .sort((a, b) => b.anos[b.anos.length - 1] - a.anos[a.anos.length - 1] || b.saldo - a.saldo)
}

// ------------------------------------------------------------------- a sugestão

type TipoConhecida = 'banco' | 'corretora'

/**
 * Bancos e corretoras cujo nome, quando aparece na descrição, quase sempre quer
 * dizer a instituição mesmo.
 *
 * É lista curta de propósito, e a sugestão que sai dela é SUGESTÃO: a tela
 * mostra o motivo e espera o clique. O tipo existe para uma coisa só — quando a
 * descrição cita uma corretora E um banco, a corretora é onde está e o banco é
 * quem deve.
 *
 * Os padrões pedem fronteira de palavra: «ITAU» não pode casar dentro de
 * «ITAUSA», que é outra companhia, e «INTER» não pode casar dentro de
 * «INTERNACIONAL». Nome que é também palavra comum («Caixa», «Ágora») só casa na
 * forma que não é palavra comum. E casam o nome INTEIRO quando ele tem mais de
 * uma palavra («BTG PACTUAL», «ITAU UNIBANCO»): o que sobra da descrição depois
 * de tirar os nomes conhecidos é lido como outro nome, e um «PACTUAL» sobrando
 * viraria um segundo banco.
 */
const CONHECIDAS: readonly { nome: string; tipo: TipoConhecida; re: RegExp }[] = [
  { nome: 'XP Investimentos', tipo: 'corretora', re: /\bXP( INVESTIMENTOS)?\b/ },
  { nome: 'Rico', tipo: 'corretora', re: /\bRICO (INVEST|CORRETORA|CTVM)/ },
  { nome: 'Clear', tipo: 'corretora', re: /\bCLEAR (CORRETORA|CTVM)/ },
  { nome: 'NuInvest', tipo: 'corretora', re: /\bNU ?INVEST\b|\bEASYNVEST\b/ },
  { nome: 'Genial', tipo: 'corretora', re: /\bGENIAL\b/ },
  { nome: 'Órama', tipo: 'corretora', re: /\bORAMA\b/ },
  { nome: 'Warren', tipo: 'corretora', re: /\bWARREN\b/ },
  { nome: 'Toro', tipo: 'corretora', re: /\bTORO (INVEST|CORRETORA|CTVM)/ },
  { nome: 'Ágora', tipo: 'corretora', re: /\bAGORA (INVEST|CORRETORA|CTVM)/ },
  { nome: 'Avenue', tipo: 'corretora', re: /\bAVENUE\b/ },
  { nome: 'Nomad', tipo: 'corretora', re: /\bNOMAD\b/ },
  { nome: 'Itaú', tipo: 'banco', re: /\bITAU( UNIBANCO)?\b/ },
  { nome: 'Bradesco', tipo: 'banco', re: /\bBRADESCO\b/ },
  { nome: 'Santander', tipo: 'banco', re: /\bSANTANDER( BRASIL)?\b/ },
  { nome: 'Banco do Brasil', tipo: 'banco', re: /\bBANCO DO BRASIL\b|\bBB\b/ },
  { nome: 'Caixa', tipo: 'banco', re: /\bCAIXA ECONOMICA( FEDERAL)?\b|\bCEF\b/ },
  { nome: 'Nubank', tipo: 'banco', re: /\bNUBANK\b|\bNU PAGAMENTOS\b|\bNU FINANCEIRA\b/ },
  { nome: 'Banco Inter', tipo: 'banco', re: /\bBANCO INTER\b|\bINTER (DTVM|INVEST)/ },
  { nome: 'C6 Bank', tipo: 'banco', re: /\bC6( BANK)?\b/ },
  { nome: 'BTG Pactual', tipo: 'banco', re: /\bBTG( PACTUAL)?\b/ },
  { nome: 'Safra', tipo: 'banco', re: /\bSAFRA\b/ },
  { nome: 'Sicoob', tipo: 'banco', re: /\bSICOOB\b/ },
  { nome: 'Sicredi', tipo: 'banco', re: /\bSICREDI\b/ },
  { nome: 'Banrisul', tipo: 'banco', re: /\bBANRISUL\b/ },
  { nome: 'BRB', tipo: 'banco', re: /\bBRB\b/ },
  { nome: 'Banco Pan', tipo: 'banco', re: /\bBANCO PAN\b/ },
  { nome: 'Banco Master', tipo: 'banco', re: /\bBANCO MASTER\b/ },
  { nome: 'Daycoval', tipo: 'banco', re: /\bDAYCOVAL\b/ },
  { nome: 'PagBank', tipo: 'banco', re: /\bPAGBANK\b|\bPAGSEGURO\b/ },
  { nome: 'Mercado Pago', tipo: 'banco', re: /\bMERCADO PAGO\b/ },
  { nome: 'PicPay', tipo: 'banco', re: /\bPICPAY\b/ },
]

/** Os nomes da lista, para a tela oferecer junto dos já usados. */
export const NOMES_DE_INSTITUICAO: readonly string[] = CONHECIDAS.map((c) => c.nome)

/** Maiúsculas, sem acento, pontuação virando espaço — a forma em que os padrões casam. */
const paraCasar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Palpite de emissor a partir do que sobra da descrição, que é texto livre.
 *
 * Tira o que descreve o PAPEL — tipo, vencimento, taxa, índice, agência e conta
 * — e fica com o que sobra, que costuma ser o nome de quem emitiu. Erra, e por
 * isso a sugestão que sai daqui vai marcada como aproximada: a tela não a aceita
 * em bloco. Sem sobra que nomeie alguém, devolve `null` em vez de forçar um nome.
 */
export function emissorDaDescricao(descricao: string): string | null {
  const limpo = paraCasar(descricao)
    // tipo do papel e adjetivos do papel
    .replace(
      /\b(CDB|RDB|LCI|LCA|LC|CRI|CRA|DEBENTURES?|INCENTIVADAS?|COMUM|POUPANCA|CONTA ?CORRENTE|CONTA|DEPOSITO|APLICACAO|INVESTIMENTO|TITULO|PREFIXADO|POS ?FIXADO|SALDO|LIQUIDEZ|DIARIA)\b/g,
      ' ',
    )
    // indexadores, prazos, agência e conta
    .replace(/\b(CDI|IPCA|SELIC|IGPM|IGP M|VENC|VENCIMENTO|AA|A A|AG|AGENCIA|CC|C C|NR|NUMERO|DV)\b/g, ' ')
    // o que liga o nome ao resto da frase, a forma societária e o que é genérico
    .replace(
      /\b(NA|NO|EM|VIA|POR|EMITIDO|EMISSAO|CUSTODIADOS?|CUSTODIADAS?|CUSTODIA|SA|S A|LTDA|CCTVM|CTVM|DTVM|CORRETORA|INVESTIMENTOS|MULTIPLO|PRE|POS|DI|PRAZO|JUROS)\b/g,
      ' ',
    )
    .replace(/\d+/g, ' ') // datas, taxas, percentuais, números de conta
    .replace(/\s+/g, ' ')
    .trim()
  // Uma letra solta não é nome de banco, e «BANCO» sozinho também não.
  if (limpo.length < 2 || /^(BANCO|BCO)$/.test(limpo)) return null
  return limpo
}

export interface SugestaoInstituicao {
  instituicao?: string
  /** Só nas classes em que quem deve é um banco. */
  emissor?: string
  /** Por que o app sugeriu isso — vai para a tela, ao lado da sugestão. */
  motivo: string
  /**
   * A sugestão veio de um palpite sobre o texto, e não de um nome reconhecido.
   *
   * Mesmo arranjo da sugestão de origem: a tela oferece «aceitar tudo», aceitar
   * em bloco é aceitar sem ler o motivo, e o palpite é o que erra. Fica na
   * linha, esperando um clique só dele.
   */
  aproximada?: boolean
}

/**
 * O que o app acha de um bem, e por quê — sugestão, nunca afirmação.
 *
 * Onde o papel é de banco, nesta ordem:
 *
 *   1. Tirados os nomes conhecidos, SOBRA um nome na descrição. Ele é
 *      provavelmente quem deve, e o conhecido citado é onde está — palpite,
 *      aproximado.
 *   2. Não sobra nada, e cita um BANCO: ele é quem deve e, sem corretora citada,
 *      também onde está; com corretora, ela é onde está — o CDB do BTG comprado
 *      pela XP. Dois bancos e nenhuma corretora («CDB BANCO PAN VIA BTG») é o
 *      caso em que a ordem decide, e a ordem é palpite: vai aproximada.
 *   3. Cita só a CORRETORA: é onde está, e quem deve fica sem palpite.
 *
 * Nas outras classes ninguém pergunta quem deve: a corretora citada é onde está,
 * e sem corretora, o primeiro banco citado.
 *
 * Em ação, FII e exterior, só a corretora conta: o banco citado ali é quase
 * sempre a COMPANHIA («AÇÕES ITAÚ UNIBANCO»), e não onde o papel está guardado.
 */
export function sugerirInstituicao(descricao: string, classe: ClassePatrimonio): SugestaoInstituicao | null {
  if (!estaEmInstituicao(classe)) return null
  const texto = paraCasar(descricao)
  const achadas = CONHECIDAS.map((c) => ({ ...c, em: texto.search(c.re) }))
    .filter((c) => c.em >= 0)
    .sort((a, b) => a.em - b.em)
  const corretora = achadas.find((c) => c.tipo === 'corretora')
  const bancos = achadas.filter((c) => c.tipo === 'banco')
  const cita = (xs: { nome: string }[]) => xs.map((x) => `«${x.nome}»`).join(' e ')

  if (emissorEhBanco(classe)) {
    // O que sobra da descrição depois de tirar os nomes conhecidos. Se sobra um
    // nome, é outro banco — e é ele, não o conhecido, que provavelmente emitiu:
    // «CDB BANCO AURORA 2028 BTG» é dívida do Aurora guardada no BTG. Tomar o
    // BTG por emissor poria o FGC na conta do banco errado, com cara de certeza.
    const sobra = emissorDaDescricao(achadas.reduce((t, c) => t.replace(new RegExp(c.re.source, 'g'), ' '), texto))
    const banco = bancos[0]
    const deposito = classe === 'contaCorrente' || classe === 'poupanca'
    if (sobra) {
      const onde = corretora ?? banco
      return {
        // Conta e poupança estão no próprio banco. O CDB sem ninguém mais citado
        // provavelmente também — mas é o mesmo palpite, e vai junto dele.
        instituicao: onde?.nome ?? sobra,
        emissor: sobra,
        motivo: onde
          ? `a descrição cita ${cita([onde])}, e o que sobra dela é «${sobra}» — quem deve, provavelmente`
          : `sem ${deposito ? 'o banco' : 'o emissor'} entre os conhecidos, o que sobra da descrição é «${sobra}»`,
        aproximada: true,
      }
    }
    if (banco) {
      const aproximada = !corretora && bancos.length > 1
      return {
        instituicao: (corretora ?? banco).nome,
        emissor: banco.nome,
        motivo: `a descrição cita ${cita(corretora ? [corretora, banco] : bancos)}`,
        ...(aproximada ? { aproximada } : {}),
      }
    }
    // Só a corretora: onde está é nome reconhecido, e quem deve fica sem palpite.
    if (!corretora) return null
    return { instituicao: corretora.nome, motivo: `a descrição cita ${cita([corretora])}, mas não diz quem deve` }
  }

  const variavel = classe === 'acoes' || classe === 'fii' || classe === 'exterior' || classe === 'desconhecido'
  const onde = corretora ?? (variavel ? undefined : bancos[0])
  if (!onde) return null
  return { instituicao: onde.nome, motivo: `a descrição cita ${cita([onde])}` }
}
