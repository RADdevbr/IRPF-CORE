import { useState } from 'react'
import { C } from '../theme'
import { metodos, adicionarMetodoLocal, removerMetodoLocal, motivoParaNaoRemover, apagarCofre } from '../lib/vault'
import type { Wrap } from '../lib/crypto'
import { criarPasskey, segredoDaPasskey, suportaPasskey, wrapIdDaPasskey } from '../lib/passkey'
import { rotuloDispositivo } from '../lib/dispositivo'

// Tela A4 dos mocks: os N embrulhos da mesma chave. Cada linha é um caminho de
// volta independente — e o cofre nunca fica com menos de dois.

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 12.5,
  padding: '7px 12px',
  cursor: 'pointer',
}
const inp: React.CSSProperties = {
  boxSizing: 'border-box',
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 14,
  padding: '0 10px',
  height: 34,
  flex: 1,
}

const NOME: Record<Wrap['metodo'], string> = {
  passkey: 'Passkey',
  senha: 'Senha',
  recuperacao: 'Chave de recuperação',
  certificado: 'Certificado ICP-Brasil',
}

export function UnlockMethods({ dek, onFechar }: { dek: Uint8Array; onFechar: () => void }) {
  const [lista, setLista] = useState<Wrap[]>(() => metodos())
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmaApagar, setConfirmaApagar] = useState(false)

  const rodar = async (fn: () => Promise<void> | void) => {
    setErro('')
    setMsg('')
    setOcupado(true)
    try {
      await fn()
      setLista(metodos())
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Algo deu errado.')
    } finally {
      setOcupado(false)
    }
  }

  const addPasskey = () =>
    rodar(async () => {
      const cred = await criarPasskey({ id: 'irpfm-local', email: 'cofre local' })
      const { segredo, credentialId } = await segredoDaPasskey(cred.credentialId)
      await adicionarMetodoLocal(dek, { wrapId: wrapIdDaPasskey(credentialId), metodo: 'passkey', rotulo: rotuloDispositivo(), segredo }, new Date().toISOString())
      setMsg('Passkey adicionada.')
    })

  const addSenha = () =>
    rodar(async () => {
      if (novaSenha.length < 8) throw new Error('Use pelo menos 8 caracteres.')
      await adicionarMetodoLocal(dek, { wrapId: 'senha', metodo: 'senha', rotulo: 'Senha', segredo: novaSenha }, new Date().toISOString())
      setNovaSenha('')
      setMsg('Senha adicionada como alternativa.')
    })

  const remover = (w: Wrap) =>
    rodar(() => {
      const motivo = motivoParaNaoRemover(w.wrapId)
      if (motivo) throw new Error(motivo)
      removerMetodoLocal(w.wrapId)
      setMsg('Método removido.')
    })

  const temSenha = lista.some((w) => w.metodo === 'senha')

  return (
    <div style={{ background: C.bg1, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Métodos de desbloqueio</p>
          <p style={{ fontSize: 12, color: C.textMut, margin: '2px 0 0' }}>
            Cada um guarda uma cópia embrulhada da mesma chave. Nenhum conhece os outros.
          </p>
        </div>
        <button style={btn} onClick={onFechar}>Fechar</button>
      </div>

      <div style={{ border: `0.5px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {lista.map((w, i) => (
          <div
            key={w.wrapId}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '9px 12px', borderTop: i ? `0.5px solid ${C.border}` : undefined, flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: 13 }}>
              {w.rotulo ?? NOME[w.metodo]}{' '}
              <span style={{ color: C.textMut, fontSize: 11.5 }}>· {NOME[w.metodo].toLowerCase()}</span>
            </span>
            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: C.textMut, fontFamily: 'monospace' }}>
                {new Date(w.criadoEm).toLocaleDateString('pt-BR')}
              </span>
              <button
                style={{ ...btn, padding: '4px 9px', color: motivoParaNaoRemover(w.wrapId) ? C.textMut : C.red }}
                onClick={() => remover(w)}
                disabled={ocupado}
                title={motivoParaNaoRemover(w.wrapId) ?? 'Remover este método'}
              >
                Remover
              </button>
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {suportaPasskey() && (
          <button style={btn} onClick={addPasskey} disabled={ocupado}>
            + Passkey deste dispositivo
          </button>
        )}
        {!temSenha && (
          <>
            <input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="Senha alternativa (mín. 8)" style={{ ...inp, maxWidth: 220 }} />
            <button style={btn} onClick={addSenha} disabled={ocupado || !novaSenha}>+ Senha</button>
          </>
        )}
      </div>

      {lista.length <= 2 && (
        <div style={{ background: C.blueDim, border: `0.5px solid ${C.blueBorder}`, borderRadius: 6, padding: '9px 11px', fontSize: 12, color: C.blue }}>
          Você tem exatamente dois caminhos de volta. Para remover um, adicione outro antes — o cofre não pode ficar com um só.
        </div>
      )}

      {msg && <span style={{ fontSize: 12, color: C.green }}>{msg}</span>}
      {erro && <span style={{ fontSize: 12, color: C.red }}>{erro}</span>}

      <div style={{ height: 1, background: C.border }} />
      {confirmaApagar ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: C.red }}>Apagar o cofre deste navegador? Os dados cifrados aqui somem.</span>
          <button style={{ ...btn, color: C.red }} onClick={() => { apagarCofre(); location.reload() }}>Apagar</button>
          <button style={btn} onClick={() => setConfirmaApagar(false)}>Cancelar</button>
        </div>
      ) : (
        <button style={{ ...btn, alignSelf: 'flex-start', color: C.textMut }} onClick={() => setConfirmaApagar(true)}>
          Esquecer este dispositivo
        </button>
      )}
    </div>
  )
}
