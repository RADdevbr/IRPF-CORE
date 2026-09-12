import { describe, it, expect } from 'vitest'
import { composicaoRenda, sugerirOrigens, type OrigemPorPagador } from './renda.js'
import type { RendaPorPagador } from '../historico/historico.js'

const pag = (alvo: string, id: string, valor: number): RendaPorPagador => ({
  alvo,
  pagador: { id, nome: id },
  valor,
})

// O caso que motivou tudo: uma PJ que distribui lucro e uma corretora que paga
// provento, na MESMA ficha da declaração.
const CLINICA = 'cnpj:11111111000111'
const ITAUSA = 'cnpj:22222222000122'

describe('origem por pagador', () => {
  const vals = { salario: 100_000, divBR: 480_000 }
  const porPagador = [pag('salario', CLINICA, 100_000), pag('divBR', CLINICA, 360_000), pag('divBR', ITAUSA, 120_000)]

  it('a mesma ficha se divide entre as duas origens', () => {
    const origens: OrigemPorPagador = { [CLINICA]: 'trabalho', [ITAUSA]: 'capital' }
    const c = composicaoRenda(vals, { porPagador, origens })
    expect(c.trabalho).toBe(460_000)
    expect(c.capital).toBe(120_000)
    expect(c.total).toBe(580_000)
    expect(c.fracaoCapital).toBeCloseTo(120_000 / 580_000, 6)
  })

  it('a ficha dividida vira duas fatias, com identidade distinta', () => {
    // sem isso a tela desenharia duas fatias com a mesma chave, e quem monta
    // lista precisa de uma chave estável por fatia
    const origens: OrigemPorPagador = { [CLINICA]: 'trabalho', [ITAUSA]: 'capital' }
    const c = composicaoRenda(vals, { porPagador, origens })
    const div = c.fontes.filter((f) => f.chave === 'divBR')
    expect(div).toHaveLength(2)
    expect(new Set(div.map((f) => f.id))).toEqual(new Set(['divBR·trabalho', 'divBR·capital']))
    expect(div.map((f) => f.origem).sort()).toEqual(['capital', 'trabalho'])
  })

  it('a ficha que NÃO se divide mantém a chave como identidade', () => {
    const c = composicaoRenda(vals, { porPagador, origens: { [CLINICA]: 'trabalho', [ITAUSA]: 'trabalho' } })
    expect(c.fontes.find((f) => f.chave === 'divBR')!.id).toBe('divBR')
  })

  it('pagador sem resposta em ficha ambígua fica a classificar, não vira capital', () => {
    // é a diferença entre «45% do que entra é capital» e «45%, metade por
    // suposição» — e a segunda é a verdade enquanto ninguém respondeu
    const c = composicaoRenda(vals, { porPagador })
    expect(c.indefinido).toBe(480_000)
    expect(c.capital).toBe(0)
    expect(c.trabalho).toBe(100_000)
  })

  it('pagador sem resposta em ficha sem ambiguidade segue a ficha', () => {
    const c = composicaoRenda({ cdb: 50_000 }, { porPagador: [pag('cdb', 'nome:BANCO X', 50_000)] })
    expect(c.capital).toBe(50_000)
    expect(c.indefinido).toBe(0)
  })

  it('o booleano antigo ainda responde pelo pagador que ninguém classificou', () => {
    // quem não migrou não pode ver a proporção virar cinza de um dia para o outro
    const c = composicaoRenda(vals, { porPagador, dividendosSaoTrabalho: true })
    expect(c.trabalho).toBe(580_000)
    expect(c.indefinido).toBe(0)
  })

  it('o booleano DESMARCADO também é resposta — ele diz capital, não silêncio', () => {
    // a tela antiga escreve isso com todas as letras: «contando como capital: só
    // faz sentido se os dividendos vêm de ações e fundos». Tratá-lo como
    // ausência de resposta levava junto o yield da carteira, que é medido
    // justamente sobre a renda de capital.
    const c = composicaoRenda(vals, { porPagador, dividendosSaoTrabalho: false })
    expect(c.capital).toBe(480_000)
    expect(c.indefinido).toBe(0)
  })

  it('sem o campo, aí sim é silêncio', () => {
    expect(composicaoRenda(vals, { porPagador }).indefinido).toBe(480_000)
  })

  it('a resposta por pagador vence o booleano antigo', () => {
    const c = composicaoRenda(vals, { porPagador, origens: { [ITAUSA]: 'capital' }, dividendosSaoTrabalho: true })
    expect(c.capital).toBe(120_000)
    expect(c.trabalho).toBe(460_000)
  })

  it('o que nenhum pagador cobre segue o padrão da ficha', () => {
    // o Registro 22 não traz fonte pagadora: os R$ 50 mil de exterior não têm
    // pagador nenhum e continuam indefinidos, sem sumir da conta
    const c = composicaoRenda(
      { divBR: 480_000, exterior: 50_000 },
      { porPagador: [pag('divBR', CLINICA, 360_000)], origens: { [CLINICA]: 'trabalho' } },
    )
    expect(c.trabalho).toBe(360_000)
    expect(c.capital).toBe(120_000) // o resto de divBR, pelo padrão da ficha
    expect(c.indefinido).toBe(50_000)
    expect(c.total).toBe(530_000)
  })

  it('porOrigem bate com os totais, e cobre todas as fatias', () => {
    const c = composicaoRenda(vals, { porPagador, origens: { [CLINICA]: 'trabalho', [ITAUSA]: 'capital' } })
    const soma = (o: 'trabalho' | 'capital' | 'indefinido') =>
      c.porOrigem[o].reduce((s, f) => s + f.valor, 0)
    expect(soma('trabalho')).toBe(c.trabalho)
    expect(soma('capital')).toBe(c.capital)
    expect(soma('indefinido')).toBe(c.indefinido)
    expect(c.porOrigem.trabalho.length + c.porOrigem.capital.length + c.porOrigem.indefinido.length).toBe(c.fontes.length)
  })

  it('sem detalhamento por pagador, nada muda', () => {
    // é o critério de que a fase não mexeu em número nenhum na tela de hoje
    const semNada = composicaoRenda(vals)
    expect(semNada.capital).toBe(480_000)
    expect(semNada.trabalho).toBe(100_000)
    expect(semNada.fontes.map((f) => f.id)).toEqual(['divBR', 'salario'])
  })
})

describe('a sugestão de origem', () => {
  it('quem também paga o seu pró-labore é trabalho', () => {
    const s = sugerirOrigens([pag('salario', CLINICA, 100_000), pag('divBR', CLINICA, 360_000)])
    expect(s[CLINICA].origem).toBe('trabalho')
    expect(s[CLINICA].motivo).toMatch(/pró-labore/)
  })

  it('quem veio do extrato da corretora é capital', () => {
    const s = sugerirOrigens([pag('divBR', ITAUSA, 120_000)], { pagadoresDaCorretora: [ITAUSA] })
    expect(s[ITAUSA].origem).toBe('capital')
    expect(s[ITAUSA].motivo).toMatch(/corretora/)
  })

  it('ficha sem outra leitura responde sozinha', () => {
    const s = sugerirOrigens([pag('cdb', 'nome:BANCO X', 50_000), pag('isentos', 'nome:BANCO X', 5_000)])
    expect(s['nome:BANCO X'].origem).toBe('capital')
  })

  it('a PJ que distribui lucro sem pagar pró-labore fica a classificar', () => {
    // é o caso comum, e chutá-lo para um lado erraria metade das pessoas em
    // silêncio: só quem tem o contrato social sabe
    const s = sugerirOrigens([pag('divBR', CLINICA, 360_000)])
    expect(s[CLINICA].origem).toBe('indefinido')
    expect(s[CLINICA].motivo).toMatch(/só você sabe/)
  })

  it('o pró-labore vence a corretora quando os dois apontam para o mesmo pagador', () => {
    const s = sugerirOrigens([pag('salario', CLINICA, 100_000), pag('divBR', CLINICA, 360_000)], {
      pagadoresDaCorretora: [CLINICA],
    })
    expect(s[CLINICA].origem).toBe('trabalho')
  })
})
