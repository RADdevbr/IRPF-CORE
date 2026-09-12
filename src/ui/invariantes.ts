// Invariantes de forma dos gráficos — para serem exercidos por CADA app.
//
// A forma, não o comportamento. UI-02 não foi um descuido num gráfico: foi o
// mesmo descuido em doze, porque cada `<g>` recebia `onMouseMove` colado à mão e
// o toque, o teclado e o leitor de tela ficavam de fora em todos ao mesmo tempo.
// Consertar os doze não impede o décimo terceiro — estas checagens impedem.
//
// Moram no núcleo, e não num teste, porque os gráficos se espalharam: o painel de
// patrimônio está num app, o confronto com a B3 em outro, a sensibilidade num
// terceiro. `Dica.tsx` — a porta única da legenda — continua aqui. A regra tinha
// de vir com ela, senão cada app reescreve a sua e uma delas fica mais frouxa.
//
// Uso, no teste de cada app:
//
//     const fontes = import.meta.glob('../**/*.tsx', { query: '?raw', import: 'default', eager: true })
//     expect(legendasPresasAoMouse(fontes as Record<string, string>)).toEqual([])

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

const semAPorta = (fontes: Record<string, string>) =>
  Object.entries(fontes).filter(([caminho]) => !caminho.endsWith('Dica.tsx') && !/\.test\.tsx?$/.test(caminho))

/** Quantas linhas em volta contam como «o mesmo elemento» num JSX formatado. */
const JANELA = 8

/**
 * Componentes que prendem a legenda ao mouse em vez de passar por `ComDica`.
 *
 * Devolve `arquivo:linha` de cada ocorrência. Vazio é o que se espera.
 *
 * Duas restrições, e as duas existem porque a primeira versão desta regra
 * acusava código correto — e regra que acusa código correto é regra que alguém
 * desliga:
 *
 *   · só arquivos que desenham SVG. O alvo é o gráfico que prende a legenda ao
 *     ponteiro, não um botão de ajuda com tooltip;
 *   · só quando o MESMO elemento não tem `onFocus`. `onMouseEnter` ao lado de
 *     `onFocus` e `onClick` não exclui ninguém: é hover somado ao teclado, que é
 *     exatamente o que se quer. O que a regra persegue é o mouse SOZINHO.
 */
export function legendasPresasAoMouse(fontes: Record<string, string>): string[] {
  const fora: string[] = []
  for (const [caminho, texto] of semAPorta(fontes)) {
    if (!/<svg[\s>]/.test(texto)) continue
    const linhas = codigo(texto)
    for (const { n, linha } of linhas) {
      if (!/\bonMouse(Move|Enter|Over|Leave)\b/.test(linha)) continue
      const perto = linhas
        .slice(Math.max(0, n - 1 - JANELA), n + JANELA)
        .map((l) => l.linha)
        .join('\n')
      if (/\bonFocus\b/.test(perto)) continue
      fora.push(`${caminho}:${n}`)
    }
  }
  return fora
}

/**
 * SVG com `viewBox` que cresce com os dados e fica fora de uma faixa rolável.
 *
 * O `viewBox` largo com `width:100%` é o que encolhia a tipografia junto com o
 * desenho. `Rolavel` põe o piso de 1 unidade = 1 pixel.
 */
export function graficosSemFaixaRolavel(fontes: Record<string, string>): string[] {
  const fora: string[] = []
  for (const [caminho, texto] of semAPorta(fontes)) {
    if (!/<svg\s/.test(texto)) continue
    const svgs = texto.match(/<svg[\s\S]{0,400}?>/g) ?? []
    const comViewBox = svgs.filter((t) => /viewBox=\{/.test(t)).length
    const rolaveis = (texto.match(/<Rolavel\s/g) ?? []).length
    if (comViewBox > rolaveis) fora.push(`${caminho}: ${comViewBox} gráficos, ${rolaveis} roláveis`)
  }
  return fora
}

/**
 * Gráfico que não entrega os números também em tabela.
 *
 * `<svg role="img" aria-label>` dá ao leitor de tela o título e nada mais.
 */
export function graficosSemTabela(fontes: Record<string, string>): string[] {
  const fora: string[] = []
  for (const [caminho, texto] of semAPorta(fontes)) {
    const comDica = (texto.match(/<ComDica[\s>]/g) ?? []).length
    if (comDica === 0) continue
    const comTabela = (texto.match(/tabela=\{/g) ?? []).length
    if (comTabela < comDica) fora.push(`${caminho}: ${comDica} gráficos, ${comTabela} com tabela`)
  }
  return fora
}
