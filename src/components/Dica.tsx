import { useState } from 'react'
import { C } from '../theme'

// Legenda que segue o mouse nos gráficos. Sem isso, um valor só aparecia como
// rótulo fixo (poucos cabem) ou no title do navegador (lento e feio).

export interface EstadoDica {
  x: number
  y: number
  titulo: string
  linhas: string[]
}

export function useDica() {
  const [dica, setDica] = useState<EstadoDica | null>(null)
  const mostrar = (e: React.MouseEvent, titulo: string, linhas: string[]) => {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement
    if (!svg) return
    const r = svg.getBoundingClientRect()
    setDica({ x: e.clientX - r.left, y: e.clientY - r.top, titulo, linhas })
  }
  return { dica, mostrar, esconder: () => setDica(null) }
}

export function Dica({ dica }: { dica: EstadoDica | null }) {
  if (!dica) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: Math.max(4, dica.x + 12),
        top: Math.max(4, dica.y - 10),
        background: C.bg2,
        border: `0.5px solid ${C.borderStrong}`,
        borderRadius: 6,
        padding: '6px 9px',
        pointerEvents: 'none',
        zIndex: 20,
        maxWidth: 260,
      }}
    >
      <div style={{ fontSize: 11.5, color: C.text, fontWeight: 500 }}>{dica.titulo}</div>
      {dica.linhas.map((l, i) => (
        <div key={i} style={{ fontSize: 11, color: C.textSec, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {l}
        </div>
      ))}
    </div>
  )
}

/** Envelope com posição relativa — a legenda se posiciona dentro dele. */
export function ComDica({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'relative' }}>{children}</div>
}
