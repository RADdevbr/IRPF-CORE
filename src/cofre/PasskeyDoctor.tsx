import { useState } from 'react'
import { C } from '../ui/theme'
import { diagnosticarPasskey, type Diagnostico } from './passkey'
import { lembrarSuportePrf } from './vault'

// Tabela de compatibilidade não resolve: o suporte à extensão PRF varia por
// navegador, sistema e autenticador. Este painel mede no aparelho de quem está
// usando e guarda o resultado, para o app parar de oferecer o que não funciona.

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 12.5,
  padding: '7px 12px',
  cursor: 'pointer',
}

function Linha({ nome, ok, texto }: { nome: string; ok: boolean | null; texto: string }) {
  const cor = ok === null ? C.textMut : ok ? C.green : C.red
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: C.textSec }}>{nome}</span>
      <span style={{ color: cor, textAlign: 'right' }}>{texto}</span>
    </div>
  )
}

export function PasskeyDoctor({ onResultado }: { onResultado?: (d: Diagnostico) => void }) {
  const [d, setD] = useState<Diagnostico | null>(null)
  const [rodando, setRodando] = useState(false)

  const rodar = async () => {
    setRodando(true)
    try {
      const r = await diagnosticarPasskey()
      lembrarSuportePrf(r.prf === 'ok' ? 'ok' : r.prf === 'sem-prf' ? 'nao' : 'desconhecido')
      setD(r)
      onResultado?.(r)
    } finally {
      setRodando(false)
    }
  }

  const veredito =
    d === null
      ? null
      : d.prf === 'ok'
        ? { cor: C.green, txt: 'Funciona — dá para destravar o cofre com biometria neste aparelho.' }
        : d.prf === 'sem-prf'
          ? { cor: C.orange, txt: 'Passkey existe aqui, mas sem a extensão PRF. Use senha neste aparelho — o cofre continua igual de seguro.' }
          : d.prf === 'cancelado'
            ? { cor: C.textSec, txt: 'Teste cancelado. Rode de novo e aprove no sensor.' }
            : { cor: C.red, txt: 'Não deu para testar neste navegador.' }

  return (
    <div style={{ background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12.5, color: C.textSec }}>Este aparelho aceita biometria?</span>
        <button style={btn} onClick={rodar} disabled={rodando}>
          {rodando ? 'Testando…' : d ? 'Testar de novo' : 'Testar agora'}
        </button>
      </div>

      {d && (
        <>
          <div style={{ borderTop: `0.5px solid ${C.border}`, paddingTop: 6 }}>
            <Linha nome="WebAuthn no navegador" ok={d.webauthn} texto={d.webauthn ? 'disponível' : 'ausente'} />
            <Linha nome="Autenticador do aparelho" ok={d.plataforma} texto={d.plataforma ? 'disponível' : 'nenhum (use chave física)'} />
            <Linha nome="Extensão PRF" ok={d.prf === 'ok'} texto={d.prf === 'ok' ? 'devolveu a chave' : d.prf} />
          </div>
          {veredito && <div style={{ fontSize: 12.5, color: veredito.cor, lineHeight: 1.5 }}>{veredito.txt}</div>}
          {d.detalhe && <div style={{ fontSize: 11, color: C.textMut }}>{d.detalhe}</div>}
          <div style={{ fontSize: 11, color: C.textMut, lineHeight: 1.5 }}>
            O teste registra uma passkey chamada "IRPFM · teste de suporte" e ela fica salva no seu gerenciador —
            é o mesmo tipo de credencial que o cofre usa, e testar com outro tipo daria resposta errada. O WebAuthn
            não permite apagá-la por código: remova pelo gerenciador quando quiser.
          </div>
        </>
      )}
    </div>
  )
}
