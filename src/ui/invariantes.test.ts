// A regra que confere os gráficos também precisa ser conferida.
//
// Ela nasceu grosseira — qualquer `onMouse*` era acusado — e acusou código
// correto na primeira vez que rodou sobre um app inteiro: um botão de ajuda com
// `onMouseEnter` E `onFocus` E `onClick`, que não exclui ninguém. Apertá-la tinha
// um risco óbvio: afrouxar até não pegar mais o caso que ela existe para pegar.
//
// Então os dois lados são afirmados aqui. Sem o primeiro teste, a regra pode
// virar `return []` e ninguém nota.

import { describe, it, expect } from 'vitest'
import { legendasPresasAoMouse, graficosSemFaixaRolavel, graficosSemTabela } from './invariantes'

const GRAFICO_PRESO_AO_MOUSE = `
export function Grafico() {
  return (
    <svg viewBox={\`0 0 \${W} 200\`}>
      <g onMouseMove={(e) => setDica(e)} onMouseLeave={() => setDica(null)}>
        <rect x={0} y={0} width={10} height={10} />
      </g>
    </svg>
  )
}
`

const BOTAO_COM_HOVER_E_TECLADO = `
export function Ajuda({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false)
  return (
    <button
      aria-label={texto}
      onMouseEnter={() => setAberto(true)}
      onMouseLeave={() => setAberto(false)}
      onFocus={() => setAberto(true)}
      onBlur={() => setAberto(false)}
      onClick={() => setAberto((v) => !v)}
    >
      i
    </button>
  )
}
`

const GRAFICO_CERTO = `
export function Grafico() {
  const dica = useDica()
  return (
    <ComDica dica={dica} tabela={{ titulo: 'x', itens: [] }}>
      <Rolavel largura={W}>
        <svg viewBox={\`0 0 \${W} 200\`} role="img" aria-label="x">
          <g {...dica.alvo('t', [], 0)} />
        </svg>
      </Rolavel>
    </ComDica>
  )
}
`

describe('legendasPresasAoMouse', () => {
  it('pega o gráfico que só responde ao ponteiro — é para isto que ela existe', () => {
    expect(legendasPresasAoMouse({ 'Grafico.tsx': GRAFICO_PRESO_AO_MOUSE })).toEqual([
      'Grafico.tsx:5',
    ])
  })

  it('não acusa hover SOMADO ao teclado: onFocus no mesmo elemento cobre todos', () => {
    expect(legendasPresasAoMouse({ 'Ajuda.tsx': BOTAO_COM_HOVER_E_TECLADO })).toEqual([])
  })

  it('não olha arquivo que não desenha SVG — o alvo é o gráfico, não qualquer tooltip', () => {
    const semSvg = BOTAO_COM_HOVER_E_TECLADO.replace(/onFocus[^\n]*\n/, '')
    expect(legendasPresasAoMouse({ 'Ajuda.tsx': semSvg })).toEqual([])
  })

  it('não acusa o gráfico que passa pela porta', () => {
    expect(legendasPresasAoMouse({ 'Grafico.tsx': GRAFICO_CERTO })).toEqual([])
  })

  it('deixa `Dica.tsx` e os testes de fora: um é a porta, os outros citam o padrão', () => {
    expect(legendasPresasAoMouse({ 'ui/Dica.tsx': GRAFICO_PRESO_AO_MOUSE })).toEqual([])
    expect(legendasPresasAoMouse({ 'x.test.tsx': GRAFICO_PRESO_AO_MOUSE })).toEqual([])
  })
})

describe('graficosSemFaixaRolavel', () => {
  it('pega o viewBox que cresce com os dados fora de uma faixa rolável', () => {
    expect(graficosSemFaixaRolavel({ 'Grafico.tsx': GRAFICO_PRESO_AO_MOUSE })).toHaveLength(1)
  })

  it('não acusa o que está dentro de `Rolavel`', () => {
    expect(graficosSemFaixaRolavel({ 'Grafico.tsx': GRAFICO_CERTO })).toEqual([])
  })
})

describe('graficosSemTabela', () => {
  it('pega o ComDica sem a tabela equivalente', () => {
    const semTabela = GRAFICO_CERTO.replace(/ tabela=\{\{[^}]*\}\}/, '')
    expect(graficosSemTabela({ 'Grafico.tsx': semTabela })).toHaveLength(1)
  })

  it('não acusa quem entrega os números em tabela', () => {
    expect(graficosSemTabela({ 'Grafico.tsx': GRAFICO_CERTO })).toEqual([])
  })
})
