import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { C } from '../theme'

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
}

const chaveDe = (titulo: string, linhas: string[]) => [titulo, ...linhas].join(' ')

export function useDica(): Dica {
  const envRef = useRef<HTMLDivElement>(null)
  const caixaRef = useRef<HTMLDivElement>(null)
  const [conteudo, setConteudo] = useState<Conteudo | null>(null)
  const chave = useRef('')
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

  return { envRef, caixaRef, conteudo, mostrar, esconder }
}

/** Envelope com posição relativa — a legenda se posiciona dentro dele. */
export function ComDica({ dica, children }: { dica: Dica; children: React.ReactNode }) {
  return (
    <div ref={dica.envRef} style={{ position: 'relative' }}>
      {children}
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
