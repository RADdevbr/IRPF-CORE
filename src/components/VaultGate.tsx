import { useState } from 'react'
import { C } from '../theme'
import { criarCofreLocal, destravarLocal, metodos, lembrarDek } from '../lib/vault'
import { gerarCodigoRecuperacao, type Wrap } from '../lib/crypto'
import { criarPasskey, segredoDaPasskey, suportaPasskey, wrapIdDaPasskey } from '../lib/passkey'
import type { PersistedState } from '../lib/storage'

// Telas A1–A3 dos mocks: criar o cofre e destravá-lo. O caminho padrão é a
// passkey (biometria); senha e chave de recuperação são as alternativas.
// Nada aqui decide política — quem impõe a regra dos dois caminhos é o vault.

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 13,
  padding: '9px 14px',
  cursor: 'pointer',
}
const btnPrim: React.CSSProperties = {
  ...btn,
  background: C.orange,
  borderColor: C.orange,
  color: C.bg0,
  fontWeight: 600,
}
const inp: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 15,
  padding: '0 12px',
  height: 38,
  outline: 'none',
}
const painel: React.CSSProperties = {
  background: C.bg1,
  border: `0.5px solid ${C.border}`,
  borderRadius: 10,
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  width: '100%',
  maxWidth: 420,
}

/** Rótulo amigável do aparelho, só para a lista de métodos. */
function rotuloDispositivo(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone · Face ID'
  if (/iPad/.test(ua)) return 'iPad · Face ID'
  if (/Android/.test(ua)) return 'Android · biometria'
  if (/Macintosh/.test(ua)) return 'Mac · Touch ID'
  if (/Windows/.test(ua)) return 'Windows Hello'
  return 'Este dispositivo'
}

function Aviso({ texto, tom }: { texto: string; tom: 'erro' | 'info' | 'alerta' }) {
  const cor = tom === 'erro' ? C.red : tom === 'info' ? C.blue : C.orange
  const fundo = tom === 'erro' ? '#2a1010' : tom === 'info' ? C.blueDim : C.orangeDim
  const borda = tom === 'erro' ? '#5a2020' : tom === 'info' ? C.blueBorder : C.orangeBorder
  return (
    <div style={{ background: fundo, border: `0.5px solid ${borda}`, borderRadius: 6, padding: '10px 12px', fontSize: 12.5, color: cor, lineHeight: 1.5 }}>
      {texto}
    </div>
  )
}

export function VaultGate({
  modo,
  estadoAtual,
  onPronto,
  onCancelar,
}: {
  modo: 'criar' | 'destravar'
  estadoAtual: PersistedState
  onPronto: (dek: Uint8Array, dados: PersistedState | null) => void
  onCancelar?: () => void
}) {
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confiar, setConfiar] = useState(false)

  // criação
  const [passo, setPasso] = useState<'metodo' | 'codigo'>('metodo')
  const [principal, setPrincipal] = useState<{ wrapId: string; metodo: Wrap['metodo']; rotulo: string; segredo: Uint8Array | string } | null>(null)
  const [codigo] = useState(() => gerarCodigoRecuperacao())
  const [guardei, setGuardei] = useState(false)
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')

  // desbloqueio
  const wraps = modo === 'destravar' ? metodos() : []
  const wrapPasskey = wraps.find((w) => w.metodo === 'passkey')
  const temSenha = wraps.some((w) => w.metodo === 'senha')
  const [segredoDigitado, setSegredoDigitado] = useState('')
  const [via, setVia] = useState<'senha' | 'recuperacao'>(temSenha ? 'senha' : 'recuperacao')

  const falhar = (e: unknown) => setErro(e instanceof Error ? e.message : 'Algo deu errado.')

  const comOcupado = async (fn: () => Promise<void>) => {
    setErro('')
    setOcupado(true)
    try {
      await fn()
    } catch (e) {
      falhar(e)
    } finally {
      setOcupado(false)
    }
  }

  // ---------------------------------------------------------------- criar

  const escolherPasskey = () =>
    comOcupado(async () => {
      const cred = await criarPasskey({ id: 'irpfm-local', email: 'cofre local' })
      // O PRF costuma vir só no get() seguinte — é dele que sai a chave.
      const { segredo, credentialId } = await segredoDaPasskey(cred.credentialId)
      setPrincipal({ wrapId: wrapIdDaPasskey(credentialId), metodo: 'passkey', rotulo: rotuloDispositivo(), segredo })
      setPasso('codigo')
    })

  const escolherSenha = () => {
    setErro('')
    if (senha.length < 8) return setErro('Use pelo menos 8 caracteres.')
    if (senha !== senha2) return setErro('As duas senhas não batem.')
    setPrincipal({ wrapId: 'senha', metodo: 'senha', rotulo: 'Senha', segredo: senha })
    setPasso('codigo')
  }

  const criar = () =>
    comOcupado(async () => {
      if (!principal) throw new Error('Escolha o método principal antes.')
      const { dek } = await criarCofreLocal(
        estadoAtual,
        principal,
        { wrapId: 'recuperacao', metodo: 'recuperacao', rotulo: 'Chave de recuperação', segredo: codigo },
        new Date().toISOString(),
      )
      if (confiar) lembrarDek(dek)
      onPronto(dek, null)
    })

  // ---------------------------------------------------------------- destravar

  const destravarPorPasskey = () =>
    comOcupado(async () => {
      if (!wrapPasskey) throw new Error('Nenhuma passkey cadastrada neste cofre.')
      const credId = wrapPasskey.wrapId.replace(/^passkey:/, '')
      const { segredo } = await segredoDaPasskey(credId)
      const { dek, dados } = await destravarLocal(wrapPasskey.wrapId, segredo)
      if (confiar) lembrarDek(dek)
      onPronto(dek, dados)
    })

  const destravarPorTexto = () =>
    comOcupado(async () => {
      const wrapId = via === 'senha' ? 'senha' : 'recuperacao'
      const { dek, dados } = await destravarLocal(wrapId, segredoDigitado)
      if (confiar) lembrarDek(dek)
      onPronto(dek, dados)
    })

  // ---------------------------------------------------------------- render

  const moldura = (conteudo: React.ReactNode) => (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,10,10,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 50 }}>
      <div style={painel}>{conteudo}</div>
    </div>
  )

  const caixaConfiar = (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, color: C.textMut, cursor: 'pointer' }}>
      <input type="checkbox" checked={confiar} onChange={(e) => setConfiar(e.target.checked)} style={{ marginTop: 2 }} />
      <span>Confiar neste dispositivo — mantém destravado até fechar a aba.</span>
    </label>
  )

  if (modo === 'destravar') {
    return moldura(
      <>
        <div>
          <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Cofre trancado</p>
          <p style={{ fontSize: 12.5, color: C.textSec, margin: '4px 0 0' }}>
            Seus dados estão cifrados neste navegador. Destrave para continuar.
          </p>
        </div>

        {wrapPasskey && suportaPasskey() && (
          <button style={btnPrim} onClick={destravarPorPasskey} disabled={ocupado}>
            Destravar com {wrapPasskey.rotulo ?? 'passkey'}
          </button>
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {temSenha && (
            <button style={{ ...btn, flex: 1, color: via === 'senha' ? C.orange : C.textSec }} onClick={() => { setVia('senha'); setSegredoDigitado('') }}>
              Senha
            </button>
          )}
          <button style={{ ...btn, flex: 1, color: via === 'recuperacao' ? C.orange : C.textSec }} onClick={() => { setVia('recuperacao'); setSegredoDigitado('') }}>
            Chave de recuperação
          </button>
        </div>

        <input
          type={via === 'senha' ? 'password' : 'text'}
          value={segredoDigitado}
          onChange={(e) => setSegredoDigitado(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && destravarPorTexto()}
          placeholder={via === 'senha' ? 'Sua senha' : 'K7XQ-4M2P-…'}
          style={{ ...inp, fontFamily: via === 'recuperacao' ? 'monospace' : undefined }}
        />
        <button style={btnPrim} onClick={destravarPorTexto} disabled={ocupado || !segredoDigitado}>
          {ocupado ? 'Abrindo…' : 'Destravar'}
        </button>
        {caixaConfiar}
        {erro && <Aviso texto={erro} tom="erro" />}
      </>,
    )
  }

  // modo criar
  return moldura(
    passo === 'metodo' ? (
      <>
        <div>
          <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Proteger seus dados</p>
          <p style={{ fontSize: 12.5, color: C.textSec, margin: '4px 0 0' }}>
            Hoje sua declaração fica em texto puro neste navegador. O cofre cifra tudo com uma chave que só existe aqui.
          </p>
        </div>

        {suportaPasskey() ? (
          <button style={btnPrim} onClick={escolherPasskey} disabled={ocupado}>
            {ocupado ? 'Aguardando o sensor…' : 'Usar biometria (passkey)'}
          </button>
        ) : (
          <Aviso texto="Este navegador não suporta passkey — dá para usar senha." tom="info" />
        )}

        <div style={{ height: 1, background: C.border }} />

        <p style={{ fontSize: 11, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>ou com senha</p>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha (mín. 8 caracteres)" style={inp} />
        <input type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} placeholder="Repita a senha" style={inp} />
        <button style={btn} onClick={escolherSenha} disabled={ocupado || !senha}>Continuar com senha</button>

        {erro && <Aviso texto={erro} tom="erro" />}
        {onCancelar && (
          <button style={{ ...btn, background: 'transparent', border: 'none', color: C.textMut }} onClick={onCancelar}>
            Agora não
          </button>
        )}
      </>
    ) : (
      <>
        <div>
          <p style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Sua chave de recuperação</p>
          <p style={{ fontSize: 12.5, color: C.textSec, margin: '4px 0 0' }}>
            Aparece uma única vez. É o caminho de volta se você perder {principal?.metodo === 'passkey' ? 'este dispositivo' : 'a senha'}.
          </p>
        </div>

        <div style={{ background: C.bg2, border: `0.5px solid ${C.borderStrong}`, borderRadius: 8, padding: 16, textAlign: 'center', fontFamily: 'monospace', fontSize: 15, letterSpacing: '0.12em', color: C.orangeLight, lineHeight: 2 }}>
          {codigo}
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ ...btn, flex: 1 }} onClick={() => navigator.clipboard?.writeText(codigo)}>Copiar</button>
          <button
            style={{ ...btn, flex: 1 }}
            onClick={() => {
              const url = URL.createObjectURL(new Blob([`Chave de recuperação — Calculadora IRPFM 2027\n\n${codigo}\n\nGuarde em local seguro. Sem ela e sem seus dispositivos, os dados não podem ser recuperados.\n`], { type: 'text/plain' }))
              const a = document.createElement('a')
              a.href = url
              a.download = 'irpfm-chave-recuperacao.txt'
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)
            }}
          >
            Baixar .txt
          </button>
        </div>

        <Aviso
          texto="Sem esta chave e sem o método principal, os dados são irrecuperáveis. Não existe 'esqueci a senha' num cofre que ninguém além de você consegue abrir — nem eu."
          tom="alerta"
        />

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, color: C.textSec, cursor: 'pointer' }}>
          <input type="checkbox" checked={guardei} onChange={(e) => setGuardei(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Guardei a chave em local seguro.</span>
        </label>

        {caixaConfiar}
        <button style={btnPrim} onClick={criar} disabled={!guardei || ocupado}>
          {ocupado ? 'Criando…' : 'Criar cofre'}
        </button>
        {erro && <Aviso texto={erro} tom="erro" />}
      </>
    ),
  )
}
