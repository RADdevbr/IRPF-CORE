import { useEffect, useState } from 'react'
import { C } from '../theme'
import { remotoSupabase } from '../lib/remoto'
import { supabaseConfigurado } from '../lib/supabaseConfig'
import { sincronizar, resolverComLocal, resolverComRemoto, type ResultadoSync } from '../lib/syncCofre'
import { lerEstadoSync, gravarEstadoSync } from '../lib/vault'
import type { CofreCompleto } from '../lib/crypto'

// Tela A5 dos mocks. O que sobe daqui é sempre o cofre CIFRADO — a chave fica
// neste aparelho. Entrar na conta serve para dizer de quem é a linha do banco,
// não para abrir o cofre: são coisas separadas de propósito.

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 12.5,
  padding: '8px 12px',
  cursor: 'pointer',
}
const btnPrim: React.CSSProperties = { ...btn, background: C.orange, borderColor: C.orange, color: C.bg0, fontWeight: 600 }
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
  minWidth: 160,
}

export function ContaSync({
  cofre,
  onBaixado,
  onFechar,
}: {
  cofre: CofreCompleto | null
  /** `mesmoCofre` diz se dá para reaproveitar a chave desta sessão. */
  onBaixado: (novo: CofreCompleto, mesmoCofre: boolean) => void
  onFechar: () => void
}) {
  const r = supabaseConfigurado() ? remotoSupabase() : null
  const [email, setEmail] = useState('')
  const [codigo, setCodigo] = useState('')
  const [etapa, setEtapa] = useState<'email' | 'codigo' | 'logado'>('email')
  const [quem, setQuem] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [pendencia, setPendencia] = useState<ResultadoSync | null>(null)

  useEffect(() => {
    if (!r) return
    r.usuario()
      .then((u) => {
        if (u) {
          setQuem(u.email)
          setEtapa('logado')
        }
      })
      .catch(() => {})
  }, [])

  const rodar = async (fn: () => Promise<void>) => {
    setErro('')
    setMsg('')
    setOcupado(true)
    try {
      await fn()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Algo deu errado.')
    } finally {
      setOcupado(false)
    }
  }

  const aplicar = (res: ResultadoSync) => {
    if (res.acao === 'conflito' || res.acao === 'cofres-diferentes') {
      setPendencia(res)
      setMsg('')
      return
    }
    setPendencia(null)
    gravarEstadoSync(res.estado)
    if (res.cofre) onBaixado(res.cofre, res.cofre.vaultId === cofre?.vaultId)
    setMsg(res.mensagem)
  }

  if (!r) {
    return (
      <div style={{ background: C.bg1, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: 16, marginBottom: 16, fontSize: 12.5, color: C.textSec }}>
        Sync não configurado neste ambiente (faltam <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>).
        O cofre local segue funcionando normalmente.
        <button style={{ ...btn, marginLeft: 10 }} onClick={onFechar}>Fechar</button>
      </div>
    )
  }

  return (
    <div style={{ background: C.bg1, border: `0.5px solid ${C.border}`, borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Conta e sincronização</p>
          <p style={{ fontSize: 12, color: C.textMut, margin: '2px 0 0' }}>
            {cofre
              ? 'Sobe o cofre cifrado para você abrir no outro aparelho. A chave não vai junto.'
              : 'Este aparelho ainda não tem cofre. Entre com o mesmo e-mail e sincronize para trazer o que está na conta.'}
          </p>
        </div>
        <button style={btn} onClick={onFechar}>Fechar</button>
      </div>

      {etapa === 'email' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" style={inp} />
          <button
            style={btnPrim}
            disabled={ocupado || !email.includes('@')}
            onClick={() => rodar(async () => {
              await r.enviarCodigo(email.trim())
              setEtapa('codigo')
              setMsg('Enviado. Abra o e-mail e clique no link — você volta para cá já conectado.')
            })}
          >
            Enviar link de acesso
          </button>
        </div>
      )}

      {etapa === 'codigo' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: C.textSec, width: '100%', lineHeight: 1.5 }}>
            <strong>Clique no link do e-mail.</strong> Ele traz você de volta para cá já conectado — não precisa digitar nada aqui.
          </span>
          <button
            style={btn}
            disabled={ocupado}
            onClick={() => rodar(async () => {
              const u = await r.usuario()
              if (!u) throw new Error('Ainda não vejo a sessão. Clique no link do e-mail e volte para esta aba.')
              setQuem(u.email)
              setEtapa('logado')
              setMsg('Conectado.')
            })}
          >
            Já cliquei no link
          </button>
          <span style={{ fontSize: 11.5, color: C.textMut, width: '100%', marginTop: 4 }}>
            Alternativa, só se o seu projeto tiver o código no template do e-mail:
          </span>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="código de 6 dígitos (opcional)" style={{ ...inp, fontFamily: 'monospace' }} />
          <button
            style={btnPrim}
            disabled={ocupado || !codigo}
            onClick={() => rodar(async () => {
              await r.conferirCodigo(email.trim(), codigo)
              const u = await r.usuario()
              setQuem(u?.email ?? email)
              setEtapa('logado')
              setMsg('Conectado.')
            })}
          >
            Entrar
          </button>
          <button style={btn} onClick={() => setEtapa('email')}>Trocar e-mail</button>
        </div>
      )}

      {etapa === 'logado' && !cofre && (
        <p style={{ fontSize: 12, color: C.textSec, margin: 0, lineHeight: 1.6 }}>
          Sincronize para baixar o cofre. Ele vem cifrado: a passkey do outro aparelho não vem junto (ela mora lá), então
          destrave aqui com a <strong>senha</strong> ou a <strong>chave de recuperação</strong>. Depois dá para cadastrar
          uma passkey neste aparelho.
        </p>
      )}

      {etapa === 'logado' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: C.textSec, flex: 1, minWidth: 140 }}>{quem}</span>
          <button
            style={btnPrim}
            disabled={ocupado}
            onClick={() => rodar(async () => aplicar(await sincronizar(r, cofre, lerEstadoSync())))}
          >
            {ocupado ? 'Sincronizando…' : cofre ? 'Sincronizar agora' : 'Trazer o cofre da conta'}
          </button>
          <button
            style={btn}
            disabled={ocupado}
            onClick={() => rodar(async () => {
              await r.sair()
              setQuem(null)
              setEtapa('email')
              setMsg('Desconectado deste aparelho.')
            })}
          >
            Sair
          </button>
        </div>
      )}

      {pendencia && (
        <div
          style={{
            background: pendencia.acao === 'cofres-diferentes' ? '#2a1010' : C.orangeDim,
            border: `0.5px solid ${pendencia.acao === 'cofres-diferentes' ? '#5a2020' : C.orangeBorder}`,
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 12.5, color: pendencia.acao === 'cofres-diferentes' ? C.red : C.orangeLight, lineHeight: 1.5 }}>
            {pendencia.mensagem}
          </span>
          <span style={{ fontSize: 11.5, color: C.textMut }}>
            Versão na conta: {pendencia.remoto?.version} ·{' '}
            {pendencia.remoto?.atualizadoEm ? new Date(pendencia.remoto.atualizadoEm).toLocaleString('pt-BR') : '—'}
            {pendencia.acao === 'cofres-diferentes' && ' · o lado descartado não poderá ser recuperado depois'}
          </span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              style={btn}
              disabled={ocupado || !cofre}
              onClick={() => rodar(async () => aplicar(await resolverComLocal(r, cofre!, 'state', pendencia.acao === 'conflito')))}
            >
              Manter o deste aparelho
            </button>
            <button
              style={btn}
              disabled={ocupado}
              onClick={() => rodar(async () => aplicar(await resolverComRemoto(r, cofre, 'state', pendencia.acao === 'conflito')))}
            >
              Trazer o da conta
            </button>
            <button style={{ ...btn, color: C.textMut }} onClick={() => setPendencia(null)}>Decidir depois</button>
          </div>
        </div>
      )}

      {msg && <span style={{ fontSize: 12, color: C.green }}>{msg}</span>}
      {erro && <span style={{ fontSize: 12, color: C.red }}>{erro}</span>}
    </div>
  )
}
