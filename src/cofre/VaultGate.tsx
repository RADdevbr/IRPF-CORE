import { useState } from 'react'
import { C } from '../ui/theme.js'
import { criarCofreLocal, destravarLocal, metodos, lembrarDek, suportePrfLembrado, lerCofre } from './vault.js'
import { apagarTudoDesteAparelho } from '../app/persistencia.js'
import { prefixoApp } from '../app/config.js'
import { PasskeyDoctor } from './PasskeyDoctor.js'
import { gerarCodigoRecuperacao, type Wrap } from './crypto.js'
import { criarPasskey, segredoDaPasskey, suportaPasskey, wrapIdDaPasskey, dominioDaPasskey } from './passkey.js'
import { rotuloDispositivo, deOutroAparelho } from './dispositivo.js'

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

/**
 * Genérico no estado de propósito: esta tela nunca olha DENTRO do que cifra.
 *
 * Era tipada em `PersistedState` — o estado do app de IRPFM, com os campos do
 * histórico e da B3 dentro. Isso obrigava qualquer app que quisesse o cofre a
 * herdar o formato de estado de outro. O cofre só precisa de um valor
 * serializável; quem sabe o que ele significa é quem o passou.
 */
export function VaultGate<T>({
  modo,
  estadoAtual,
  onPronto,
  onCancelar,
  aviso,
}: {
  modo: 'criar' | 'destravar'
  estadoAtual: T
  onPronto: (dek: Uint8Array, dados: T | null) => void
  onCancelar?: () => void
  /** Recado que precisa ser visto ANTES de destravar — ex.: voltou do link do e-mail. */
  aviso?: string
}) {
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confiar, setConfiar] = useState(false)
  // Saída de emergência da tela trancada. Sem ela, um cofre que não abre mais
  // (corrompido, chave perdida) prendia a pessoa aqui para sempre: o botão de
  // apagar tudo só existia DENTRO do app — que não montava sem destravar.
  const [socorroAberto, setSocorroAberto] = useState(false)

  const baixarCopiaDoCofre = () => {
    const cofre = lerCofre()
    if (!cofre) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(cofre, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    // O nome carrega o prefixo do app: quem usa os três da família e baixa
    // cópia de cada um não fica com três arquivos de nome igual na pasta.
    a.download = `${prefixoApp().replace(/:$/, '')}-cofre-cifrado-backup.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const recomecarDoZero = () => {
    if (
      !confirm(
        'Apagar TUDO deste aparelho — cofre, cenários e estado — e recomeçar do zero?\n\n' +
          'Não dá para desfazer. Se você usa a conta, os dados sincronizados continuam no servidor e podem ser trazidos de novo em "Já tenho conta".',
      )
    )
      return
    apagarTudoDesteAparelho()
    window.location.reload()
  }

  // criação
  const [passo, setPasso] = useState<'metodo' | 'codigo'>('metodo')
  const [principal, setPrincipal] = useState<{ wrapId: string; metodo: Wrap['metodo']; rotulo: string; segredo: Uint8Array | string } | null>(null)
  const [codigo] = useState(() => gerarCodigoRecuperacao())
  const [guardei, setGuardei] = useState(false)
  const [senha, setSenha] = useState('')
  const [senha2, setSenha2] = useState('')
  // Se o diagnóstico já reprovou o PRF neste aparelho, a senha sobe para o topo:
  // insistir em oferecer biometria que não funciona só gera erro na cara do usuário.
  const [prfSuportado, setPrfSuportado] = useState(() => suportePrfLembrado())

  // desbloqueio
  const wraps = modo === 'destravar' ? metodos() : []
  // TODAS as passkeys, não a primeira: depois de sincronizar o cofre tem a de
  // cada aparelho, e olhar só para uma fazia o app insistir na credencial errada.
  const wrapsPasskey = wraps.filter((w) => w.metodo === 'passkey')
  const wrapPasskey = wrapsPasskey[0]
  // Só avisa "é de outro aparelho" quando NENHUMA delas parece ser daqui.
  const passkeyDeOutro = wrapsPasskey.length > 0 && wrapsPasskey.every((w) => deOutroAparelho(w.rotulo))
  const outras = wrapsPasskey.filter((w) => deOutroAparelho(w.rotulo)).map((w) => w.rotulo ?? 'outro aparelho')
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
      if (wrapsPasskey.length === 0) throw new Error('Nenhuma passkey cadastrada neste cofre.')
      const ids = wrapsPasskey.map((w) => w.wrapId.replace(/^passkey:/, ''))
      let credentialId: string
      let segredo: Uint8Array
      try {
        ;({ credentialId, segredo } = await segredoDaPasskey(ids))
      } catch (e) {
        // O navegador diz a mesma coisa para "cancelei" e para "não tenho
        // nenhuma dessas credenciais". Como a segunda é a que confunde quem
        // acabou de sincronizar, ela precisa aparecer na resposta.
        const msg = e instanceof Error ? e.message : ''
        if (/PRF/.test(msg)) throw e
        throw new Error(
          'Não deu para usar a biometria: ou você cancelou, ou nenhuma passkey deste cofre está neste aparelho. ' +
            'Destrave com senha ou chave de recuperação e depois cadastre uma passkey daqui, em "Cofre".',
        )
      }
      // Quem responde diz qual credencial usou — é por ela que se acha o wrap.
      const wrap = wrapsPasskey.find((w) => w.wrapId === wrapIdDaPasskey(credentialId)) ?? wrapPasskey
      const { dek, dados } = await destravarLocal<T>(wrap.wrapId, segredo)
      if (confiar) lembrarDek(dek)
      onPronto(dek, dados)
    })

  const destravarPorTexto = () =>
    comOcupado(async () => {
      const wrapId = via === 'senha' ? 'senha' : 'recuperacao'
      const { dek, dados } = await destravarLocal<T>(wrapId, segredoDigitado)
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

        {/* Voltar do link do e-mail e cair numa tela que não menciona a conta faz
            parecer que o login não funcionou. Ele funcionou — falta destravar. */}
        {aviso && (
          <div style={{ background: C.blueDim, border: `0.5px solid ${C.blueBorder}`, borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: C.blue, lineHeight: 1.5 }}>
            {aviso}
          </div>
        )}

        {/* Passkey de outro aparelho não pode ser o botão principal: ela mora
            lá, e oferecê-la aqui como caminho de entrada empurra a senha —
            a única que funciona neste aparelho — para o rodapé. */}
        {wrapPasskey && suportaPasskey() && !passkeyDeOutro && (
          <button style={btnPrim} onClick={destravarPorPasskey} disabled={ocupado}>
            {wrapsPasskey.length > 1
              ? 'Destravar com a passkey deste aparelho'
              : `Destravar com ${wrapPasskey.rotulo ?? 'passkey'}`}
          </button>
        )}
        {/* Preview da Vercel: a passkey nasceria presa àquele host e sumiria com
            ele. Dizer isso antes vale mais que deixar o navegador recusar
            depois — o erro sai como "cancelado", que não explica nada. */}
        {dominioDaPasskey().descartavel && suportaPasskey() && (
          <div style={{ background: C.bg2, border: `0.5px solid ${C.orangeBorder}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: C.orangeLight, lineHeight: 1.55 }}>
            Este endereço não é o domínio oficial do app. Passkey cadastrada aqui vale só aqui e some quando este
            preview sair do ar — use senha ou chave de recuperação.
          </div>
        )}
        {wrapPasskey && passkeyDeOutro && (
          <div style={{ background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', fontSize: 12, color: C.textSec, lineHeight: 1.55 }}>
            Este cofre tem passkey cadastrada em <strong>{outras.join(', ')}</strong> — ela não vem junto, mora
            naquele aparelho. Aqui, destrave com senha ou chave de recuperação; depois dá para cadastrar uma passkey
            deste aparelho, em "Cofre".
            {suportaPasskey() && (
              <button
                onClick={destravarPorPasskey}
                disabled={ocupado}
                style={{ background: 'none', border: 'none', color: C.textMut, cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', padding: '4px 0 0' }}
              >
                tentar mesmo assim
              </button>
            )}
          </div>
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

        <button
          onClick={() => setSocorroAberto((v) => !v)}
          aria-expanded={socorroAberto}
          style={{ background: 'none', border: 'none', color: C.textMut, cursor: 'pointer', fontSize: 12, textDecoration: 'underline', padding: 0, alignSelf: 'flex-start' }}
        >
          Não consegue destravar?
        </button>
        {socorroAberto && (
          <div style={{ background: C.bg2, border: `0.5px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 12, color: C.textSec, lineHeight: 1.6 }}>
              Se nenhum método abre o cofre, o que está gravado neste navegador não serve mais — insistir não vai
              destravá-lo. Dá para recomeçar do zero: guarde antes uma cópia do cofre (ela sai cifrada, como está;
              pode ser útil numa recuperação futura) e apague tudo deste aparelho. Se você usa a conta, os dados
              sincronizados continuam no servidor e voltam pelo botão "Já tenho conta".
            </span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={{ ...btn, flex: 1 }} onClick={baixarCopiaDoCofre}>
                Baixar cópia do cofre (cifrada)
              </button>
              <button style={{ ...btn, flex: 1, color: C.red }} onClick={recomecarDoZero}>
                Apagar tudo e recomeçar
              </button>
            </div>
          </div>
        )}
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

        {prfSuportado === 'nao' ? (
          <Aviso texto="O teste indicou que a biometria deste aparelho não entrega a chave (sem extensão PRF). Use senha aqui — o cofre é o mesmo, só muda como você o abre." tom="info" />
        ) : (
          suportaPasskey() && (
            <button style={btnPrim} onClick={escolherPasskey} disabled={ocupado}>
              {ocupado ? 'Aguardando o sensor…' : 'Usar biometria (passkey)'}
            </button>
          )
        )}

        <PasskeyDoctor onResultado={(d) => setPrfSuportado(d.prf === 'ok' ? 'ok' : d.prf === 'sem-prf' ? 'nao' : 'desconhecido')} />

        <div style={{ height: 1, background: C.border }} />

        <p style={{ fontSize: 11, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
          {prfSuportado === 'nao' ? 'com senha' : 'ou com senha'}
        </p>
        <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha (mín. 8 caracteres)" style={inp} />
        <input type="password" value={senha2} onChange={(e) => setSenha2(e.target.value)} placeholder="Repita a senha" style={inp} />
        <button style={prfSuportado === 'nao' ? btnPrim : btn} onClick={escolherSenha} disabled={ocupado || !senha}>Continuar com senha</button>

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
