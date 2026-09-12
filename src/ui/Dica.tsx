import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { C } from './theme'

// Legenda que segue o mouse nos gráficos. Sem isso, um valor só aparecia como
// rótulo fixo (poucos cabem) ou no title do navegador (lento e feio).
//
// O movimento NÃO passa pelo React. A primeira versão fazia setState a cada
// mousemove: com o mouse andando de verdade são dezenas de eventos por segundo,
// cada um re-renderizando o SVG inteiro, e a legenda chegava a demorar quase um
// segundo em máquina modesta. Agora o React só re-renderiza quando o conteúdo
// muda (uma vez por barra); a posição é escrita direto no style.transform, que
// o navegador resolve no compositor sem refazer layout.

export interface Conteudo {
  titulo: string
  linhas: string[]
}

export interface Dica {
  envRef: React.RefObject<HTMLDivElement>
  caixaRef: React.RefObject<HTMLDivElement>
  conteudo: Conteudo | null
  mostrar: (e: { clientX: number; clientY: number }, titulo: string, linhas: string[]) => void
  esconder: () => void
  /**
   * Props que tornam uma coluna do gráfico legível por mouse, dedo, teclado e
   * leitor de tela — de uma vez.
   *
   * Existe por um motivo estrutural: a legenda dependia de `onMouseMove` colado
   * à mão em cada `<g>`, dez gráficos, e por isso o toque e o teclado ficaram de
   * fora em todos eles ao mesmo tempo. Uma coluna que passa por aqui nasce
   * acessível, e a próxima que alguém desenhar também.
   */
  alvo: (titulo: string, linhas: string[], i?: number) => AlvoProps
}

/** O que `alvo()` devolve — espalhe num `<g>` do SVG. */
export interface AlvoProps {
  tabIndex: number
  role: string
  'aria-label': string
  onPointerMove: (e: React.PointerEvent) => void
  onPointerDown: (e: React.PointerEvent) => void
  onPointerLeave: (e: React.PointerEvent) => void
  onFocus: (e: React.FocusEvent) => void
  onBlur: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

const chaveDe = (titulo: string, linhas: string[]) => [titulo, ...linhas].join(' ')

export function useDica(): Dica {
  const envRef = useRef<HTMLDivElement>(null)
  const caixaRef = useRef<HTMLDivElement>(null)
  const [conteudo, setConteudo] = useState<Conteudo | null>(null)
  const chave = useRef('')
  // Qual coluna deste gráfico está na ordem de tabulação (roving tabindex).
  const [atual, setAtual] = useState(0)
  const ponto = useRef({ x: 0, y: 0 })
  const tamanho = useRef({ w: 0, h: 0 })

  const posicionar = useCallback(() => {
    const env = envRef.current
    const caixa = caixaRef.current
    if (!env || !caixa) return
    const r = env.getBoundingClientRect()
    const { w, h } = tamanho.current
    let x = ponto.current.x - r.left + 14
    const y = ponto.current.y - r.top - 8
    // perto da borda direita a legenda vira para o outro lado do cursor, senão
    // sai cortada justo nos anos mais recentes, que são os que interessam
    if (x + w > r.width) x = ponto.current.x - r.left - w - 14
    const cx = Math.max(2, Math.min(x, Math.max(2, r.width - w - 2)))
    const cy = Math.max(2, Math.min(y, Math.max(2, r.height - h - 2)))
    caixa.style.transform = `translate(${cx}px, ${cy}px)`
  }, [])

  // mede a legenda uma vez por conteúdo: ler offsetWidth a cada movimento
  // forçaria layout no meio do gesto, que é o que estamos evitando
  useLayoutEffect(() => {
    const caixa = caixaRef.current
    if (caixa) tamanho.current = { w: caixa.offsetWidth, h: caixa.offsetHeight }
    posicionar()
  }, [conteudo, posicionar])

  const mostrar = useCallback(
    (e: { clientX: number; clientY: number }, titulo: string, linhas: string[]) => {
      ponto.current = { x: e.clientX, y: e.clientY }
      const k = chaveDe(titulo, linhas)
      if (k !== chave.current) {
        chave.current = k
        setConteudo({ titulo, linhas })
        return // o useLayoutEffect posiciona assim que renderizar
      }
      posicionar()
    },
    [posicionar],
  )

  const esconder = useCallback(() => {
    chave.current = ''
    setConteudo(null)
  }, [])

  /**
   * No toque, a legenda fica: `pointerleave` dispara junto com o `pointerup`, e
   * esconder ali faria o valor piscar e sumir no exato gesto que pedia para
   * lê-lo. Some quando o dedo toca fora — que é como o resto do celular
   * funciona.
   */
  useEffect(() => {
    const fora = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return
      const env = envRef.current
      if (env && e.target instanceof Node && env.contains(e.target)) return
      esconder()
    }
    document.addEventListener('pointerdown', fora)
    return () => document.removeEventListener('pointerdown', fora)
  }, [esconder])

  const alvo = useCallback(
    (titulo: string, linhas: string[], i = 0): AlvoProps => {
      // Pelo centro do elemento: no foco por teclado não há cursor de onde tirar
      // uma posição, e ancorar na própria coluna é o que faz a legenda apontar
      // para o dado certo.
      const peloCentro = (el: Element) => {
        const r = el.getBoundingClientRect()
        mostrar({ clientX: r.left + r.width / 2, clientY: r.top }, titulo, linhas)
      }
      return {
        // Uma parada de tabulação por GRÁFICO, não por coluna: com uma coluna
        // focável por ano, um painel de doze gráficos punha mais de cinquenta
        // paradas entre os controles de verdade, e tornar o gráfico acessível
        // acabaria estragando o teclado no resto da página. Dentro do gráfico,
        // quem anda são as setas — que é o padrão de qualquer grade.
        tabIndex: i === atual ? 0 : -1,
        role: 'button',
        'aria-label': [titulo, ...linhas].join('. '),
        onPointerMove: (e) => mostrar(e, titulo, linhas),
        onPointerDown: (e) => mostrar(e, titulo, linhas),
        onPointerLeave: (e) => {
          if (e.pointerType === 'mouse') esconder()
        },
        onFocus: (e) => {
          setAtual(i)
          peloCentro(e.currentTarget)
        },
        onBlur: esconder,
        onKeyDown: (e) => {
          if (e.key === 'Escape') {
            esconder()
            return
          }
          const passo =
            e.key === 'ArrowRight' || e.key === 'ArrowDown'
              ? 1
              : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
                ? -1
                : e.key === 'Home'
                  ? -Infinity
                  : e.key === 'End'
                    ? Infinity
                    : 0
          if (!passo) return
          e.preventDefault()
          const svg = (e.currentTarget as Element).closest('svg')
          if (!svg) return
          const irmaos = [...svg.querySelectorAll<SVGGElement>('g[tabindex]')]
          const aqui = irmaos.indexOf(e.currentTarget as SVGGElement)
          if (aqui < 0) return
          const destino = Math.max(0, Math.min(irmaos.length - 1, passo === Infinity ? irmaos.length - 1 : passo === -Infinity ? 0 : aqui + passo))
          irmaos[destino]?.focus()
        },
      }
    },
    [mostrar, esconder, atual],
  )

  return { envRef, caixaRef, conteudo, mostrar, esconder, alvo }
}

/**
 * Faixa rolável para o gráfico.
 *
 * Os SVGs têm `viewBox` que cresce com o número de anos e `width:100%`, sem
 * contêiner de rolagem: num celular o desenho inteiro encolhia para caber, e a
 * tipografia encolhia junto — um rótulo de `font-size 9` chegava a 4,6 px, que
 * ninguém lê. O piso de largura aqui garante 1 unidade de viewBox = 1 pixel, ou
 * seja, o gráfico nunca renderiza abaixo do tamanho em que foi desenhado; onde
 * sobra tela ele volta a ocupar os 100%.
 */
export function Rolavel({ largura, children }: { largura: number; children: React.ReactNode }) {
  return (
    <div
      style={{ overflowX: 'auto', overflowY: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' }}
    >
      <div style={{ minWidth: Math.round(largura) }}>{children}</div>
    </div>
  )
}

/**
 * Só para leitor de tela: fora da vista, dentro da árvore de acessibilidade.
 *
 * Vai num `<div>`, nunca direto no `<table>`: tabela dimensiona pelo conteúdo e
 * ignora o `width:1px`, então a versão oculta continuava com quase mil pixels de
 * largura e punha a PÁGINA para rolar de lado — o próprio defeito que este
 * trabalho existe para consertar.
 */
const SO_LEITOR: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
}

export interface TabelaDados {
  titulo: string
  itens: { titulo: string; linhas: string[] }[]
}

/**
 * Os mesmos números do gráfico, em tabela, escondida da vista.
 *
 * `<svg role="img" aria-label>` dá ao leitor de tela o título do gráfico e mais
 * nada — os valores, que são o conteúdo, ficavam inacessíveis. A tabela sai da
 * MESMA fonte que alimenta a legenda, então não há uma segunda verdade para
 * divergir.
 */
function TabelaOculta({ tabela }: { tabela: TabelaDados }) {
  return (
    <div style={SO_LEITOR}>
      <table>
        <caption>{tabela.titulo}</caption>
        <tbody>
          {tabela.itens.map((it, i) => (
            <tr key={i}>
              <th scope="row">{it.titulo}</th>
              {it.linhas.map((l, j) => (
                <td key={j}>{l}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Envelope com posição relativa — a legenda se posiciona dentro dele. */
export function ComDica({
  dica,
  tabela,
  children,
}: {
  dica: Dica
  tabela?: TabelaDados
  children: React.ReactNode
}) {
  return (
    <div ref={dica.envRef} style={{ position: 'relative' }}>
      {children}
      {tabela && <TabelaOculta tabela={tabela} />}
      <div
        data-dica
        ref={dica.caixaRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          background: C.bg2,
          border: `0.5px solid ${C.borderStrong}`,
          borderRadius: 6,
          padding: '6px 9px',
          pointerEvents: 'none',
          zIndex: 20,
          maxWidth: 260,
          visibility: dica.conteudo ? 'visible' : 'hidden',
        }}
      >
        <div style={{ fontSize: 11.5, color: C.text, fontWeight: 500 }}>{dica.conteudo?.titulo}</div>
        {(dica.conteudo?.linhas ?? []).map((l, i) => (
          <div key={i} style={{ fontSize: 11, color: C.textSec, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}
