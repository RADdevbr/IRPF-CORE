import { useRef, useState } from 'react'
import { C } from '../theme'
import { anonimizar, amostra, type Nivel } from '../lib/anonimizar'

// Exporta um .DEC com os dados trocados, preservando posições e tamanhos — o
// suficiente para depurar leiaute sem que valores, CPF ou CNPJ saiam de casa.
// A conversão roda aqui no navegador; o arquivo só sai se você baixar e mandar.

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 12.5,
  padding: '7px 12px',
  cursor: 'pointer',
}

export function Anonimizador() {
  const [nivel, setNivel] = useState<Nivel>('numeros')
  const [arquivo, setArquivo] = useState<{ nome: string; texto: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const ler = (f: File | undefined) => {
    if (!f) return
    const fr = new FileReader()
    fr.onload = () => setArquivo({ nome: f.name, texto: String(fr.result) })
    fr.readAsText(f, 'ISO-8859-1')
    if (fileRef.current) fileRef.current.value = ''
  }

  const baixar = () => {
    if (!arquivo) return
    const url = URL.createObjectURL(new Blob([anonimizar(arquivo.texto, nivel)], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = arquivo.nome.replace(/\.dec$/i, '') + `-anonimizado-${nivel}.DEC`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const linhas = arquivo ? amostra(arquivo.texto, nivel, 3) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 11, color: C.textMut, margin: 0, lineHeight: 1.5 }}>
        Troca os dados mantendo posição e tamanho de cada campo. Serve para eu depurar o leiaute sem ver nada seu: todo
        dígito vira outro dígito (valores, CPF, CNPJ e datas não sobrevivem), e só o tipo do registro fica intacto.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={btn} onClick={() => fileRef.current?.click()}>
          {arquivo ? 'trocar arquivo' : 'escolher .DEC'}
        </button>
        <input ref={fileRef} type="file" accept=".DEC,.dec" aria-label="Arquivo .DEC para anonimizar" style={{ display: 'none' }} onChange={(e) => ler(e.target.files?.[0])} />
        {arquivo && <span style={{ fontSize: 12, color: C.textSec }}>{arquivo.nome}</span>}
      </div>

      {arquivo && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(
              [
                { v: 'numeros' as Nivel, l: 'Só números', d: 'mantém os nomes dos bens — ajuda a depurar a classificação' },
                { v: 'tudo' as Nivel, l: 'Números e nomes', d: 'apaga também as descrições; só a estrutura sobra' },
              ]
            ).map((o) => (
              <button
                key={o.v}
                onClick={() => setNivel(o.v)}
                title={o.d}
                style={{
                  ...btn,
                  borderColor: nivel === o.v ? C.orange : C.border,
                  background: nivel === o.v ? C.orangeDim : C.bg3,
                  color: nivel === o.v ? C.orange : C.textSec,
                }}
              >
                {o.l}
              </button>
            ))}
          </div>

          <div>
            <p style={{ fontSize: 10.5, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>
              o que sai (primeiras linhas)
            </p>
            <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 6, overflow: 'auto', maxHeight: 200 }}>
              {linhas.map((l, i) => (
                <div key={i} style={{ padding: '6px 8px', borderTop: i ? `0.5px solid ${C.bg2}` : undefined, fontFamily: 'monospace', fontSize: 10, whiteSpace: 'pre', overflowX: 'auto' }}>
                  <div data-role="antes" style={{ color: C.textMut }}>{l.antes}</div>
                  <div data-role="depois" style={{ color: C.green }}>{l.depois}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={{ ...btn, background: C.orange, borderColor: C.orange, color: C.bg0, fontWeight: 600 }} onClick={baixar}>
              Baixar anonimizado
            </button>
            <span style={{ fontSize: 11, color: C.textMut }}>
              confira as linhas acima antes de mandar — o que você vê em verde é exatamente o que sai
            </span>
          </div>
        </>
      )}
    </div>
  )
}
