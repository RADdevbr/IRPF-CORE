// A forma, não o comportamento.
//
// UI-02 não foi um descuido num gráfico: foi o mesmo descuido em doze, porque
// cada `<g>` recebia `onMouseMove` colado à mão e o toque, o teclado e o leitor
// de tela ficavam de fora em todos ao mesmo tempo. Consertar os doze não impede
// o décimo terceiro — este teste impede.

import { describe, it, expect } from 'vitest'

const fontes = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** Linhas de código, sem comentário de linha, de bloco, ou continuação. */
function codigo(texto: string): { n: number; linha: string }[] {
  return texto.split('\n').map((linha, i) => ({
    n: i + 1,
    linha: linha
      .replace(/\/\*.*?\*\//g, '')
      .replace(/\/\/.*$/, '')
      .replace(/^\s*[*/].*$/, ''),
  }))
}

describe('a legenda dos gráficos passa por uma porta só', () => {
  it('nenhum gráfico prende a legenda ao mouse', () => {
    const fora: string[] = []
    for (const [caminho, texto] of Object.entries(fontes)) {
      if (caminho.endsWith('Dica.tsx')) continue // a porta
      for (const { n, linha } of codigo(texto)) {
        if (/\bonMouse(Move|Enter|Over|Leave)\b/.test(linha)) fora.push(`${caminho}:${n}`)
      }
    }
    // se este teste ficar sem fontes por engano, ele passa por vácuo
    expect(Object.keys(fontes).length).toBeGreaterThan(10)
    expect(fora).toEqual([])
  })

  it('todo SVG com viewBox que cresce com os dados fica numa faixa rolável', () => {
    // O `viewBox` largo com `width:100%` é o que encolhia a tipografia junto com
    // o desenho. `Rolavel` põe o piso de 1 unidade = 1 pixel.
    const fora: string[] = []
    for (const [caminho, texto] of Object.entries(fontes)) {
      if (caminho.endsWith('Dica.tsx')) continue
      if (!/<svg\s/.test(texto)) continue
      const svgs = texto.match(/<svg[\s\S]{0,400}?>/g) ?? []
      const comViewBox = svgs.filter((t) => /viewBox=\{/.test(t)).length
      const rolaveis = (texto.match(/<Rolavel\s/g) ?? []).length
      if (comViewBox > rolaveis) fora.push(`${caminho}: ${comViewBox} gráficos, ${rolaveis} roláveis`)
    }
    expect(fora).toEqual([])
  })

  it('todo gráfico entrega os números também em tabela', () => {
    // `<svg role="img" aria-label>` dá ao leitor de tela o título e nada mais.
    const fora: string[] = []
    for (const [caminho, texto] of Object.entries(fontes)) {
      if (caminho.endsWith('Dica.tsx')) continue
      const comDica = (texto.match(/<ComDica[\s>]/g) ?? []).length
      if (comDica === 0) continue
      const comTabela = (texto.match(/tabela=\{/g) ?? []).length
      if (comTabela < comDica) fora.push(`${caminho}: ${comDica} gráficos, ${comTabela} com tabela`)
    }
    expect(fora).toEqual([])
  })
})
