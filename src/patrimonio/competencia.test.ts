import { describe, it, expect } from 'vitest'
import { rendimentoPorCompetencia, sugerirComoDeclara } from './competencia.js'
import { taxaDoAno } from './benchmarks.js'
import { montarDeclaracao, upsertDeclaracao, idPosicao, type Historico } from '../historico/historico.js'
import type { Lancamento, Posicao } from '../dec/decParser.js'

// A história que a conta pelo saldo erra, montada pelo mesmo caminho do leitor:
// um CDB declarado pelo valor aplicado, que entra no meio de 2021, fica parado em
// 2022 e sai no meio de 2023 — e o juro dele só aparece em 2023, no rendimento
// que o banco pagou.

const BANCO = '11222333000181'
const OUTRO = '22333444000106'
const cdi = (ano: number) => taxaDoAno('cdi', ano) as number

const bem = (descricao: string, anterior: number, atual: number, cnpj: string, subcodigo = '02'): Posicao => ({
  linha: 1,
  cdBem: subcodigo,
  codigo: '04',
  subcodigo,
  cnpj,
  bruta: '',
  descricao,
  saldoAnterior: anterior,
  saldoAtual: atual,
  tipoCarteira: 'cdb',
})

const juro = (cnpj: string, valor: number, codigo = '06', tipo = '88'): Lancamento => ({
  linha: 1,
  tipo,
  tipoLabel: 'x',
  fonte: cnpj === BANCO ? 'BANCO EXEMPLO S.A.' : 'OUTRO BANCO S.A.',
  cnpj,
  rotulo: 'Rendimento',
  valor,
  alvo: tipo === '88' ? 'cdb' : 'isentos',
  codigo,
})

/** Declarações por ano-base. */
function historico(anos: Record<number, { posicoes: Posicao[]; juros?: Lancamento[] }>): Historico {
  let h: Historico = {}
  for (const [anoBase, a] of Object.entries(anos)) {
    const d = montarDeclaracao(
      { ano: String(Number(anoBase) + 1), registros: [], lancamentos: a.juros ?? [], posicoes: a.posicoes, pagamentos: [], ndep: 0, linhas: [], totalLinhas: 0 },
      'x.DEC',
      'agora',
    )!
    h = upsertDeclaracao(h, d)
  }
  return h
}

// O juro de verdade: 95% do CDI, do meio de 2021 ao meio de 2023.
const K = 0.95
const pagoEm2023 = 100_000 * ((1 + K * cdi(2021)) ** 0.5 * (1 + K * cdi(2022)) * (1 + K * cdi(2023)) ** 0.5 - 1)

const CDB = 'CDB BANCO EXEMPLO 2023'
const ID_CDB = idPosicao(CDB, 'cdb')

const umResgate = () =>
  historico({
    2021: { posicoes: [bem(CDB, 0, 100_000, BANCO)] },
    2022: { posicoes: [bem(CDB, 100_000, 100_000, BANCO)] },
    2023: { posicoes: [bem(CDB, 100_000, 0, BANCO)], juros: [juro(BANCO, pagoEm2023)] },
  })

describe('o juro por competência, no valor aplicado', () => {
  it('acha a fração do CDI que o banco pagou, pelo resgate', () => {
    const r = rendimentoPorCompetencia(umResgate())
    const [pote] = r.potes
    expect(pote).toMatchObject({ cnpj: BANCO, nome: 'BANCO EXEMPLO S.A.', comoDeclara: 'aplicado', origemDaTaxa: 'resgates' })
    expect(pote.taxa).toBeCloseTo(K, 3)
    expect(pote.pago).toEqual({ 2021: 0, 2022: 0, 2023: pagoEm2023 })
  })

  it('espalha o juro pago em 2023 pelos anos em que o dinheiro ficou, e a soma bate', () => {
    const anos = rendimentoPorCompetencia(umResgate()).porBem[ID_CDB]
    const juroDe = (a: number) => anos.find((x) => x.anoBase === a)!
    // 2022 é o ano inteiro parado: o saldo não andou, e mesmo assim rendeu
    expect(juroDe(2022).medido).toBeGreaterThan(100_000 * K * cdi(2022) * 0.99)
    expect(juroDe(2022).fluxo).toBe(0)
    // meio ano em 2021, e nada de aporte vestido de rendimento
    expect(juroDe(2021).fluxo).toBe(100_000)
    expect(juroDe(2021).medido).toBeCloseTo(100_000 * ((1 + K * cdi(2021)) ** 0.5 - 1), 0)
    const soma = anos.reduce((t, a) => t + a.medido + a.estimado, 0)
    expect(soma).toBeCloseTo(pagoEm2023, 2)
    // resgatado e pago: nada é estimado
    expect(anos.every((a) => a.estimado === 0)).toBe(true)
  })

  it('o dinheiro que continua aplicado rende à mesma taxa, e sai como estimado', () => {
    const OUTRO_CDB = 'CDB BANCO EXEMPLO 2026'
    const h = historico({
      2021: { posicoes: [bem(CDB, 0, 100_000, BANCO)] },
      2022: { posicoes: [bem(CDB, 100_000, 100_000, BANCO), bem(OUTRO_CDB, 0, 50_000, BANCO)] },
      2023: { posicoes: [bem(CDB, 100_000, 0, BANCO), bem(OUTRO_CDB, 50_000, 50_000, BANCO)], juros: [juro(BANCO, pagoEm2023)] },
    })
    const r = rendimentoPorCompetencia(h)
    expect(r.potes[0].taxa).toBeCloseTo(K, 3)
    const aberto = r.porBem[idPosicao(OUTRO_CDB, 'cdb')]
    const em2023 = aberto.find((a) => a.anoBase === 2023)!
    expect(em2023.medido).toBe(0)
    expect(em2023.estimado).toBeGreaterThan(50_000 * K * cdi(2023) * 0.99)
  })

  it('ano lido antes de o leitor separar o juro não conta como zero', () => {
    const h = umResgate()
    const { rendimentoDeAplicacao: _, ...semJuro } = h['2022']
    const r = rendimentoPorCompetencia({ ...h, 2022: semJuro })
    expect(r.potes[0].pago[2022]).toBeNull()
    expect(r.potes[0].taxa).toBeCloseTo(K, 3)
  })

  it('juro pago em ano de vencimento não vira taxa: mede o vencimento, e não o rendimento', () => {
    // A LCA de 60 mil venceu e pagou 3 anos de juro; a de 200 mil segue. Juro
    // pago ÷ saldo daria uma taxa de nada — o caso visto num arquivo real.
    const h = historico({
      2023: {
        posicoes: [bem('LCA QUE VENCEU', 60_000, 0, BANCO), bem('LCA QUE SEGUE', 200_000, 200_000, BANCO)],
        juros: [juro(BANCO, 20_000)],
      },
    })
    expect(rendimentoPorCompetencia(h).potes[0]).toMatchObject({ taxa: 1, origemDaTaxa: 'cdi' })
  })

  it('pote que cresceu muito no ano não mede a taxa pelo juro pago', () => {
    // a linha que soma LCAs: o saldo só cresce, os vencimentos ficam escondidos
    const h = historico({ 2023: { posicoes: [bem('LCAS BANCO EXEMPLO', 200_000, 400_000, BANCO)], juros: [juro(BANCO, 9_000)] } })
    expect(rendimentoPorCompetencia(h).potes[0]).toMatchObject({ taxa: 1, origemDaTaxa: 'cdi' })
  })

  it('fundo parado pelo custo, sem juro pago nenhum, fica sem medida — e não a 100% do CDI', () => {
    const FUNDO = 'FUNDO QUALQUER FIC'
    const h = historico({ 2023: { posicoes: [{ ...bem(FUNDO, 35_000, 35_000, OUTRO), codigo: '07', subcodigo: '03', tipoCarteira: 'fundo' }] } })
    const r = rendimentoPorCompetencia(h)
    expect(r.potes[0]).toMatchObject({ taxa: null, origemDaTaxa: 'nenhuma' })
    expect(Object.keys(r.porBem)).toEqual([])
  })

  it('juro pago em ano sem resgate (cupom) mede a taxa sobre o saldo', () => {
    const h = historico({
      2022: { posicoes: [bem(CDB, 100_000, 100_000, BANCO)], juros: [juro(BANCO, 100_000 * 0.9 * cdi(2022))] },
    })
    const [pote] = rendimentoPorCompetencia(h).potes
    expect(pote.origemDaTaxa).toBe('pagamentos')
    expect(pote.taxa).toBeCloseTo(0.9, 3)
  })

  it('sem juro nenhum lido, supõe o CDI e diz isso', () => {
    const h = historico({ 2022: { posicoes: [bem(CDB, 100_000, 100_000, BANCO)] } })
    expect(rendimentoPorCompetencia(h).potes[0]).toMatchObject({ taxa: 1, origemDaTaxa: 'cdi' })
  })

  it('o juro da poupança do mesmo banco sai do código 12 antes de medir a LCA', () => {
    const LCA = 'LCA BANCO EXEMPLO'
    const selic2022 = taxaDoAno('selic', 2022) as number
    const poupanca = 20_000 * (selic2022 > 0.085 ? 0.0617 : 0.7 * selic2022)
    const h = historico({
      2022: {
        posicoes: [
          { ...bem(LCA, 100_000, 100_000, BANCO), tipoCarteira: 'lci' },
          bem('POUPANCA BANCO EXEMPLO', 20_000, 20_000, BANCO, '01'),
        ],
        juros: [juro(BANCO, 10_000 + poupanca, '12', '84')],
      },
    })
    const [pote] = rendimentoPorCompetencia(h).potes
    expect(pote.pago[2022]).toBeCloseTo(10_000, 2)
  })

  it('juro pago por quem não guarda bem nenhum fica listado, e não some', () => {
    const h = historico({ 2022: { posicoes: [bem(CDB, 100_000, 100_000, BANCO)], juros: [juro(OUTRO, 800)] } })
    expect(rendimentoPorCompetencia(h).semBem).toEqual([{ cnpj: OUTRO, nome: 'OUTRO BANCO S.A.', anoBase: 2022, valor: 800 }])
  })

  it('o CNPJ escrito na descrição liga o bem de ano antigo, sem o campo', () => {
    const antigo: Posicao = { ...bem('CDB BANCO EXEMPLO CNPJ 11.222.333/0001-81', 100_000, 100_000, ''), cnpj: undefined, codigo: '45', subcodigo: '' }
    const h = historico({ 2016: { posicoes: [antigo] } })
    expect(rendimentoPorCompetencia(h).potes.map((p) => p.cnpj)).toEqual([BANCO])
  })
})

describe('o juro por competência, no valor atualizado', () => {
  it('o saldo que andou sozinho mede o juro, e dá a taxa', () => {
    const h = historico({
      2022: { posicoes: [bem(CDB, 100_000, 100_000 * (1 + 0.9 * cdi(2022)), BANCO)] },
      2023: { posicoes: [bem(CDB, 100_000 * (1 + 0.9 * cdi(2022)), 150_000, BANCO)] },
    })
    const r = rendimentoPorCompetencia(h, { comoDeclara: { [BANCO]: 'atualizado' } })
    expect(r.potes[0]).toMatchObject({ comoDeclara: 'atualizado', respondido: true, origemDaTaxa: 'saldo' })
    expect(r.potes[0].taxa).toBeCloseTo(0.9, 3)
    const [a2022, a2023] = r.porBem[ID_CDB]
    expect(a2022.medido).toBeCloseTo(100_000 * 0.9 * cdi(2022), 2)
    // 2023 teve aplicação: o juro é estimado, e o resto do saldo é movimento
    expect(a2023.medido).toBe(0)
    expect(a2023.estimado + a2023.fluxo).toBeCloseTo(150_000 - 100_000 * (1 + 0.9 * cdi(2022)), 2)
  })
})

describe('como a instituição declara o saldo', () => {
  it('saldo parado ou em valor redondo é valor aplicado', () => {
    const h = historico({ 2022: { posicoes: [bem(CDB, 100_000, 100_000, BANCO)] } })
    expect(sugerirComoDeclara(h, [ID_CDB]).sugerido).toBe('aplicado')
  })

  it('saldo que anda pouco, sem ser redondo, é valor atualizado', () => {
    const h = historico({ 2022: { posicoes: [bem(CDB, 100_000, 111_234.56, BANCO)] } })
    expect(sugerirComoDeclara(h, [ID_CDB])).toMatchObject({ sugerido: 'atualizado' })
  })

  it('sem ano para comparar, supõe valor aplicado e pede para conferir', () => {
    const h = historico({ 2022: { posicoes: [bem(CDB, 0, 100_000, BANCO)] } })
    expect(sugerirComoDeclara(h, [ID_CDB]).porque).toMatch(/confira/)
  })
})
