import { useMemo, useState } from 'react'
import { C } from '../theme'
import { fmt } from '../lib/format'
import { parseDec } from '../lib/decParser'

// Analisador de registro do .DEC.
//
// O leiaute muda entre anos e eu não tenho um arquivo real para calibrar. Em vez
// de pedir uma linha sua, o app mostra o que ele vê: as posições de cada campo,
// os blocos de dígitos candidatos a valor, e o que o leitor atual extraiu. Assim
// dá para descobrir onde o leitor erra sem o arquivo sair do seu computador.

interface Bloco {
  ini: number // 1-indexado, inclusivo
  fim: number
  digitos: string
}

/** Todo bloco de dígitos com 4+ posições — candidatos a valor, data ou código. */
function blocosDeDigitos(linha: string): Bloco[] {
  const out: Bloco[] = []
  const re = /\d{4,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(linha)) !== null) {
    out.push({ ini: m.index + 1, fim: m.index + m[0].length, digitos: m[0] })
  }
  return out
}

function Regua({ linha }: { linha: string }) {
  const dezenas = Array.from({ length: Math.ceil(linha.length / 10) }, (_, i) => (i + 1) * 10)
  return (
    <div style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre', lineHeight: 1.5 }}>
      <div style={{ color: C.textMut }}>
        {dezenas.map((d) => String(d).padStart(10, ' ')).join('')}
      </div>
      <div style={{ color: C.textMut }}>{'·········|'.repeat(dezenas.length)}</div>
      <div style={{ color: C.text }}>{linha}</div>
    </div>
  )
}

export function Analisador({ linhaInicial = '' }: { linhaInicial?: string }) {
  const [linha, setLinha] = useState(linhaInicial)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  const blocos = useMemo(() => blocosDeDigitos(linha), [linha])
  const lido = useMemo(() => {
    if (!linha.trim()) return null
    try {
      return parseDec(linha)
    } catch {
      return null
    }
  }, [linha])

  const recorte = useMemo(() => {
    const a = parseInt(de, 10)
    const b = parseInt(ate, 10)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) return null
    const txt = linha.slice(a - 1, b)
    const digitos = txt.replace(/\D/g, '')
    return {
      txt,
      digitos,
      inteiro: digitos ? parseInt(digitos, 10) : null,
      centavos: digitos ? parseInt(digitos, 10) / 100 : null,
    }
  }, [linha, de, ate])

  const inp: React.CSSProperties = {
    background: C.bg3,
    border: `0.5px solid ${C.border}`,
    borderRadius: 6,
    color: C.text,
    fontSize: 12.5,
    padding: '0 8px',
    height: 32,
    fontFamily: 'monospace',
  }
  const rot: React.CSSProperties = { fontSize: 10.5, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <p style={{ fontSize: 11.5, color: C.textMut, margin: 0, lineHeight: 1.5 }}>
        Cole uma linha do arquivo (ou clique numa linha acima) para ver onde cada campo cai. Nada é enviado a lugar nenhum —
        roda no seu navegador, como o resto do app.
      </p>
      <textarea
        value={linha}
        onChange={(e) => setLinha(e.target.value.replace(/\n/g, ''))}
        placeholder="27...  cole aqui uma linha do .DEC"
        spellCheck={false}
        style={{ ...inp, height: 64, padding: 8, width: '100%', boxSizing: 'border-box', resize: 'vertical', fontSize: 11 }}
      />

      {linha.trim() && (
        <>
          <div style={{ overflowX: 'auto', background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 10 }}>
            <Regua linha={linha} />
          </div>

          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
            <span style={{ color: C.textSec }}>
              <span style={rot}>tipo</span>{' '}
              <span style={{ fontFamily: 'monospace', color: C.orange }}>{linha.slice(0, 2)}</span>
            </span>
            <span style={{ color: C.textSec }}>
              <span style={rot}>tamanho</span> <span style={{ fontFamily: 'monospace' }}>{linha.length}</span>
            </span>
          </div>

          <div>
            <p style={{ ...rot, margin: '4px 0' }}>Blocos de dígitos (candidatos a valor, código ou data)</p>
            <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
              {blocos.length === 0 && <div style={{ padding: 8, fontSize: 11.5, color: C.textMut }}>nenhum bloco com 4+ dígitos</div>}
              {blocos.map((b, i) => (
                <div
                  key={i}
                  onClick={() => {
                    setDe(String(b.ini))
                    setAte(String(b.fim))
                  }}
                  title="clique para recortar este trecho abaixo"
                  style={{
                    display: 'flex',
                    gap: 12,
                    padding: '4px 8px',
                    fontSize: 11.5,
                    fontFamily: 'monospace',
                    color: C.textSec,
                    borderTop: i ? `0.5px solid ${C.bg2}` : undefined,
                    cursor: 'pointer',
                    flexWrap: 'wrap',
                  }}
                >
                  <span style={{ color: C.textMut, minWidth: 88 }}>
                    {b.ini}–{b.fim} ({b.fim - b.ini + 1})
                  </span>
                  <span style={{ minWidth: 120 }}>{b.digitos.length > 26 ? `${b.digitos.slice(0, 26)}…` : b.digitos}</span>
                  <span style={{ color: C.green }}>{fmt(parseInt(b.digitos.slice(0, 15), 10) / 100)}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p style={{ ...rot, margin: '4px 0' }}>Recortar por posição</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input value={de} onChange={(e) => setDe(e.target.value)} placeholder="de" style={{ ...inp, width: 70 }} />
              <input value={ate} onChange={(e) => setAte(e.target.value)} placeholder="até" style={{ ...inp, width: 70 }} />
              {recorte && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, fontFamily: 'monospace' }}>
                  <span style={{ color: C.text }}>"{recorte.txt}"</span>
                  {recorte.inteiro !== null && <span style={{ color: C.textSec }}>inteiro {recorte.inteiro}</span>}
                  {recorte.centavos !== null && <span style={{ color: C.green }}>centavos {fmt(recorte.centavos)}</span>}
                </div>
              )}
            </div>
          </div>

          <div>
            <p style={{ ...rot, margin: '4px 0' }}>O que o leitor atual extraiu desta linha</p>
            <div style={{ background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 10, fontSize: 11.5, lineHeight: 1.7 }}>
              {!lido || (lido.posicoes.length === 0 && lido.lancamentos.length === 0) ? (
                <span style={{ color: C.red }}>nada — este tipo de registro não é lido, ou os campos estão em outras posições</span>
              ) : (
                <>
                  {lido.posicoes.map((pos, i) => (
                    <div key={`p${i}`} style={{ color: C.textSec }}>
                      <span style={{ color: C.orange }}>bem:</span> "{pos.descricao}" · código {pos.codigo || '—'} · saldo
                      anterior {fmt(pos.saldoAnterior)} · saldo atual {fmt(pos.saldoAtual)}
                    </div>
                  ))}
                  {lido.lancamentos.map((l, i) => (
                    <div key={`l${i}`} style={{ color: C.textSec }}>
                      <span style={{ color: C.orange }}>{l.tipoLabel}:</span> "{l.fonte}" · {l.rotulo} {fmt(l.valor)}
                    </div>
                  ))}
                </>
              )}
            </div>
            <p style={{ fontSize: 11, color: C.textMut, margin: '6px 0 0', lineHeight: 1.5 }}>
              Se o saldo ou a descrição saírem errados, me diga <strong>as posições certas</strong> (ex.: "o saldo atual
              está em 120–132") — isso basta para eu ajustar o leitor, e nenhum número seu precisa sair daqui.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
