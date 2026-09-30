// A classe que o código da Receita sugere — para o bem que a descrição não diz.
//
// `classificaPosicao` lê a descrição primeiro e só usa o código do leiaute
// antigo, porque no leiaute com grupo não havia como conferir um par só. Com a
// tabela de Bens e Direitos da Receita (a partir da declaração 2023), os pares
// abaixo são inequívocos para a pergunta que o app faz — como o bem é declarado
// e o que o resgate faz com a base do IRPFM —, e o resto fica de fora.
//
// Sai como SUGESTÃO, e aplicada como correção de classe (`Overrides`). Mudar a
// classificação automática mudaria a identidade do bem (classe + descrição), e
// soltaria em silêncio a custódia, o aporte e a ligação que a pessoa já deu a
// ele. A correção de classe muda a classe e deixa a identidade onde está.

import { chaveCodigo, NOME_CLASSE, type ClassePatrimonio, type Historico, type PosicaoAno } from './historico.js'

interface Regra {
  classe: ClassePatrimonio
  porque: string
}

/**
 * Grupo·código do leiaute novo → classe. Só o que a tabela da Receita separa
 * sem ambiguidade para esta conta:
 *
 *   01·*  bens imóveis                      02·01 veículo automotor terrestre
 *   03·01 ações                             03·02 quotas ou quinhões de capital
 *   04·01 poupança                          04·02 títulos tributáveis (CDB, RDB, Tesouro)
 *   04·03 títulos isentos (LCI, LCA, CRI, CRA, incentivadas)
 *   04·04 ativos negociados em bolsa (BDR)  06·01 conta corrente ou conta pagamento
 *   07·01 fundos com come-cotas             07·02 FIAgro   07·03 FII
 *
 * Os dois grupos de renda fixa (04·02 e 04·03) juntam classes que o app separa —
 * CDB e Tesouro, LCI e CRI —, mas a de cada par tem o mesmo regime e é declarada
 * do mesmo jeito; a sugestão diz isso, e a pessoa refina se quiser.
 */
const POR_GRUPO_CODIGO: Record<string, Regra> = {
  '02·01': { classe: 'veiculo', porque: 'código 02·01 da Receita: veículo automotor' },
  '03·01': { classe: 'acoes', porque: 'código 03·01 da Receita: ações' },
  '03·02': { classe: 'participacao', porque: 'código 03·02 da Receita: quotas ou quinhões de capital' },
  '03·99': { classe: 'participacao', porque: 'código 03·99 da Receita: outras participações societárias' },
  '04·01': { classe: 'poupanca', porque: 'código 04·01 da Receita: poupança' },
  '04·02': { classe: 'cdb', porque: 'código 04·02 da Receita: título tributável (CDB, RDB, Tesouro) — se for Tesouro, troque' },
  '04·03': { classe: 'lci', porque: 'código 04·03 da Receita: título isento (LCI, LCA, CRI, CRA) — se for CRI ou CRA, troque' },
  '04·04': { classe: 'acoes', porque: 'código 04·04 da Receita: ativo negociado em bolsa (BDR, opção)' },
  '06·01': { classe: 'contaCorrente', porque: 'código 06·01 da Receita: conta corrente ou conta pagamento' },
  '07·01': { classe: 'fundo', porque: 'código 07·01 da Receita: fundo com come-cotas' },
  '07·02': { classe: 'fii', porque: 'código 07·02 da Receita: FIAgro' },
  '07·03': { classe: 'fii', porque: 'código 07·03 da Receita: fundo imobiliário' },
}

/** Os códigos do leiaute antigo que a tabela de `classificaPosicao` já usa, com o porquê à vista. */
const POR_CODIGO_ANTIGO: Record<string, Regra> = {
  '21': { classe: 'veiculo', porque: 'código 21 da Receita: veículo' },
  '31': { classe: 'acoes', porque: 'código 31 da Receita: ações' },
  '32': { classe: 'participacao', porque: 'código 32 da Receita: quotas de capital' },
  '41': { classe: 'poupanca', porque: 'código 41 da Receita: poupança' },
  '45': { classe: 'cdb', porque: 'código 45 da Receita: aplicação de renda fixa' },
  '61': { classe: 'contaCorrente', porque: 'código 61 da Receita: depósito em conta corrente' },
}

/** A regra do código do bem, ou `null` se a tabela não afirma nada sobre ele. */
export function regraDoCodigo(p: Pick<PosicaoAno, 'codigo' | 'subcodigo'>): Regra | null {
  const grupo = (p.codigo ?? '').trim()
  const cod = (p.subcodigo ?? '').trim()
  if (grupo === '01' && cod) return { classe: 'imovel', porque: `código 01·${cod} da Receita: bem imóvel` }
  if (cod) return POR_GRUPO_CODIGO[`${grupo}·${cod}`] ?? null
  return POR_CODIGO_ANTIGO[grupo] ?? null
}

export interface SugestaoDeClasse {
  /** O par grupo·código, como `chaveCodigo`. */
  chave: string
  classe: ClassePatrimonio
  porque: string
  /** O que muda: «Não classificado → Ações», «Fundos tributáveis → Participação». */
  de: ClassePatrimonio
  /** Os bens (ids) a corrigir — todos os anos. */
  ids: string[]
  /** Saldo somado no ano mais recente em que eles aparecem. */
  saldo: number
  /** Até três descrições, para a pessoa reconhecer o grupo. */
  exemplos: string[]
}

/**
 * Os grupos de bens cuja classe o código da Receita corrige.
 *
 * Dois casos, e só dois:
 *
 *   · o bem que ficou «não classificado» e tem um código que a tabela resolve;
 *   · a quota de empresa que virou «fundo» porque a descrição fala em COTAS —
 *     o código diz participação societária, e fundo, que é declarado pelo
 *     saldo, faria a quota da sua empresa parecer um investimento parado.
 *
 * `h` é o histórico com as correções já aplicadas: o que a pessoa já corrigiu
 * não volta como sugestão.
 */
export function sugerirClassesPorCodigo(h: Historico): SugestaoDeClasse[] {
  const grupos = new Map<string, SugestaoDeClasse & { ano: number }>()
  const decs = Object.values(h).sort((a, b) => a.anoBase - b.anoBase)
  for (const d of decs) {
    for (const p of d.posicoes) {
      const regra = regraDoCodigo(p)
      if (!regra || regra.classe === p.classe) continue
      const quotaComoFundo = p.classe === 'fundo' && regra.classe === 'participacao'
      if (p.classe !== 'desconhecido' && !quotaComoFundo) continue
      const chave = `${chaveCodigo(p)}>${p.classe}`
      const g = grupos.get(chave) ?? {
        chave: chaveCodigo(p),
        classe: regra.classe,
        porque: regra.porque,
        de: p.classe,
        ids: [],
        saldo: 0,
        exemplos: [],
        ano: d.anoBase,
      }
      if (!g.ids.includes(p.id)) g.ids.push(p.id)
      if (d.anoBase > g.ano) {
        g.ano = d.anoBase
        g.saldo = 0
      }
      if (d.anoBase === g.ano) g.saldo += p.saldoAtual
      if (g.exemplos.length < 3 && p.descricao && !g.exemplos.includes(p.descricao)) g.exemplos.push(p.descricao)
      grupos.set(chave, g)
    }
  }
  return [...grupos.values()].map(({ ano: _ano, ...g }) => g).sort((a, b) => b.saldo - a.saldo)
}

/** «Não classificado → Ações». */
export const rotuloDaSugestao = (s: Pick<SugestaoDeClasse, 'de' | 'classe'>) => `${NOME_CLASSE[s.de]} → ${NOME_CLASSE[s.classe]}`
