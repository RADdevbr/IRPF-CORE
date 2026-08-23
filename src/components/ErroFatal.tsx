import { Component, type ReactNode } from 'react'
import { C } from '../theme'

// Um erro em qualquer canto derrubava a árvore inteira e deixava a tela preta —
// num app que guarda declaração de imposto, isso parece perda de dados mesmo
// quando não é. Aqui o erro vira mensagem, com os dados ainda ao alcance.

interface Estado {
  erro: Error | null
}

function baixarDados() {
  const dump: Record<string, string | null> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('irpfm2027:')) dump[k] = localStorage.getItem(k)
    }
  } catch {
    /* sem acesso ao storage — segue com o que der */
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = 'irpfm-dados-brutos.json'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export class ErroFatal extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { erro: null }

  static getDerivedStateFromError(erro: Error): Estado {
    return { erro }
  }

  render() {
    const { erro } = this.state
    if (!erro) return this.props.children

    const btn: React.CSSProperties = {
      background: C.bg3,
      border: `0.5px solid ${C.border}`,
      borderRadius: 6,
      color: C.text,
      fontSize: 13,
      padding: '9px 14px',
      cursor: 'pointer',
    }

    return (
      <div style={{ background: C.bg0, minHeight: '100vh', color: C.text, padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 560, margin: '10vh auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>O app travou ao abrir</p>
          <p style={{ fontSize: 13.5, color: C.textSec, margin: 0, lineHeight: 1.6 }}>
            Seus dados continuam gravados neste navegador — o que quebrou foi a tela, não o armazenamento. Baixe uma cópia
            antes de mexer em qualquer coisa; se houver cofre, o arquivo sai cifrado do mesmo jeito que está guardado.
          </p>
          <div style={{ background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: 12, fontFamily: 'monospace', fontSize: 12, color: C.red, overflowX: 'auto' }}>
            {erro.message || String(erro)}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button style={{ ...btn, background: C.orange, borderColor: C.orange, color: C.bg0, fontWeight: 600 }} onClick={baixarDados}>
              Baixar meus dados
            </button>
            <button style={btn} onClick={() => location.reload()}>Tentar de novo</button>
          </div>
          <p style={{ fontSize: 12, color: C.textMut, margin: 0, lineHeight: 1.6 }}>
            Se voltar a travar, me mande a mensagem em vermelho acima: ela diz exatamente onde quebrou.
          </p>
        </div>
      </div>
    )
  }
}
