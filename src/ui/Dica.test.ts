// A forma, não o comportamento — ver `invariantes.ts` para o porquê.
//
// Aqui as checagens rodam sobre as telas do PRÓPRIO núcleo. Os gráficos que
// motivaram a regra foram para os apps, e é lá que ela pega mais; o teste de cada
// app chama as mesmas funções sobre as suas fontes. A regra é uma só, em um lugar
// só, exercida três vezes.

import { describe, it, expect } from 'vitest'
import { legendasPresasAoMouse, graficosSemFaixaRolavel, graficosSemTabela } from './invariantes'

const fontes = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

describe('a legenda dos gráficos passa por uma porta só', () => {
  // Se a varredura ficar vazia por engano, tudo passa por vácuo.
  it('leu as fontes de tela do núcleo', () => {
    expect(Object.keys(fontes).length).toBeGreaterThan(8)
  })

  it('nenhuma tela prende a legenda ao mouse', () => {
    expect(legendasPresasAoMouse(fontes)).toEqual([])
  })

  it('todo SVG com viewBox que cresce com os dados fica numa faixa rolável', () => {
    expect(graficosSemFaixaRolavel(fontes)).toEqual([])
  })

  it('todo gráfico entrega os números também em tabela', () => {
    expect(graficosSemTabela(fontes)).toEqual([])
  })
})
