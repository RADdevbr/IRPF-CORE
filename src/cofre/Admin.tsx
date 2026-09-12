import { useEffect, useState } from 'react'
import { C } from '../ui/theme'
import { clienteSupabase } from './remoto'
import {
  admin,
  conviteEsgotado,
  normalizaCodigo,
  validaConvite,
  AVISO_APAGAR,
  type ContaAdmin,
  type Convite,
} from './admin'

// Controle de contas, dentro do app.
//
// Não há chave privilegiada aqui: o que esta tela consegue fazer é exatamente o
// que a RLS deixa quem está em `admins` fazer. Por isso "excluir" apaga os
// dados e bloqueia, em vez de apagar o usuário — e a tela diz isso em vez de
// fingir que apagou.

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.textSec,
  fontSize: 11.5,
  padding: '5px 10px',
  cursor: 'pointer',
}

const inp: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.text,
  fontSize: 13,
  height: 32,
  padding: '0 8px',
  fontFamily: 'monospace',
}

const th: React.CSSProperties = {
  fontSize: 10,
  color: C.textMut,
  fontWeight: 400,
  padding: '4px 8px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
const td: React.CSSProperties = { padding: '6px 8px', fontSize: 12, color: C.textSec, borderTop: `0.5px solid ${C.border}` }

const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—')

export function Admin({ onFechar }: { onFechar: () => void }) {
  const api = admin(clienteSupabase())
  const [contas, setContas] = useState<ContaAdmin[]>([])
  const [convites, setConvites] = useState<Convite[]>([])
  const [liberados, setLiberados] = useState<{ email: string; nota?: string }[]>([])
  const [msg, setMsg] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  const [codigo, setCodigo] = useState('')
  const [usos, setUsos] = useState('1')
  const [dias, setDias] = useState('30')
  const [notaConvite, setNotaConvite] = useState('')
  const [novoEmail, setNovoEmail] = useState('')

  const rodar = async (f: () => Promise<void>) => {
    setOcupado(true)
    setErro('')
    try {
      await f()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  const recarregar = () =>
    rodar(async () => {
      setContas(await api.listarContas())
      setConvites(await api.listarConvites())
      setLiberados(await api.listarLiberados())
    })

  useEffect(() => {
    void recarregar()
    // uma vez ao abrir: a lista é pequena e recarrega sozinha a cada ação
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const secao: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }
  const titulo: React.CSSProperties = { fontSize: 13, fontWeight: 500, margin: 0 }
  const sub: React.CSSProperties = { fontSize: 11.5, color: C.textMut, margin: 0, lineHeight: 1.55 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <p style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Controle de contas</p>
          <p style={{ ...sub, maxWidth: 620 }}>
            Quem entrou, quem pode entrar, e com que chave. Nada aqui abre o cofre de ninguém: o que está no servidor é
            texto cifrado, e a chave nunca esteve lá.
          </p>
        </div>
        <button style={btn} onClick={onFechar}>Fechar</button>
      </div>

      {erro && (
        <div style={{ background: '#2a1010', border: `0.5px solid #5a2020`, borderRadius: 8, padding: 10, fontSize: 12, color: C.red }}>
          {erro}
        </div>
      )}
      {msg && <div style={{ fontSize: 12, color: C.green }}>{msg}</div>}

      <div style={secao}>
        <p style={titulo}>Chaves de cadastro</p>
        <p style={sub}>
          Quem tem o código se cadastra sozinho, até acabarem os usos ou vencer o prazo. Você não precisa abrir o
          Supabase para cada pessoa.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="AMIGOS-2027" aria-label="código do convite" style={{ ...inp, width: 170 }} />
          <label style={{ fontSize: 11.5, color: C.textSec, display: 'flex', gap: 5, alignItems: 'center' }}>
            usos
            <input value={usos} onChange={(e) => setUsos(e.target.value)} aria-label="quantos usos" style={{ ...inp, width: 56 }} />
          </label>
          <label style={{ fontSize: 11.5, color: C.textSec, display: 'flex', gap: 5, alignItems: 'center' }}>
            dias
            <input value={dias} onChange={(e) => setDias(e.target.value)} aria-label="dias de validade" style={{ ...inp, width: 56 }} />
            <span style={{ color: C.textMut }}>(vazio = sem prazo)</span>
          </label>
          <input value={notaConvite} onChange={(e) => setNotaConvite(e.target.value)} placeholder="para quem é" aria-label="nota do convite" style={{ ...inp, width: 160, fontFamily: 'inherit' }} />
          <button
            style={{ ...btn, color: C.orange, borderColor: C.orangeBorder, background: C.orangeDim }}
            disabled={ocupado}
            onClick={() =>
              rodar(async () => {
                const novo = {
                  codigo,
                  usosMax: parseInt(usos, 10),
                  diasDeValidade: dias.trim() ? parseInt(dias, 10) : undefined,
                  nota: notaConvite.trim() || undefined,
                }
                const problema = validaConvite(novo)
                if (problema) throw new Error(problema)
                const criado = await api.criarConvite(novo)
                setCodigo('')
                setNotaConvite('')
                setMsg(`Convite ${criado} criado. Passe o código para quem vai se cadastrar.`)
                await recarregar()
              })
            }
          >
            Criar convite
          </button>
        </div>
        {codigo.trim() && normalizaCodigo(codigo) !== codigo && (
          <span style={sub}>Vai virar <strong>{normalizaCodigo(codigo)}</strong> — maiúsculas, sem acento e sem espaço, para ninguém errar ao digitar.</span>
        )}
        {convites.length === 0 ? (
          <span style={sub}>Nenhum convite criado.</span>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Código', 'Para quem', 'Usos', 'Vence', ''].map((t) => (
                    <th key={t} style={th}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {convites.map((c) => {
                  const morto = conviteEsgotado(c)
                  return (
                    <tr key={c.codigo}>
                      <td style={{ ...td, fontFamily: 'monospace', color: morto ? C.textMut : C.text }}>
                        {c.codigo} {morto && <span style={{ fontSize: 10 }}>(esgotado)</span>}
                      </td>
                      <td style={td}>{c.nota ?? '—'}</td>
                      <td style={{ ...td, fontFamily: 'monospace' }}>{c.usos}/{c.usosMax}</td>
                      <td style={td}>{data(c.expiraEm)}</td>
                      <td style={td}>
                        <button style={btn} disabled={ocupado} onClick={() => rodar(async () => { await api.revogarConvite(c.codigo); setMsg(`Convite ${c.codigo} revogado.`); await recarregar() })}>
                          revogar
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={secao}>
        <p style={titulo}>E-mails autorizados</p>
        <p style={sub}>Entra sem código nenhum. Use para você mesmo e para quem não vai lidar com convite.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
          <input value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} placeholder="pessoa@email.com" aria-label="e-mail a autorizar" style={{ ...inp, width: 220, fontFamily: 'inherit' }} />
          <button
            style={btn}
            disabled={ocupado}
            onClick={() => rodar(async () => { await api.liberarEmail(novoEmail); setNovoEmail(''); setMsg('E-mail autorizado.'); await recarregar() })}
          >
            Autorizar
          </button>
        </div>
        {liberados.length === 0 ? (
          <span style={sub}>Nenhum e-mail autorizado direto.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {liberados.map((l) => (
              <div key={l.email} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                <span style={{ flex: 1, color: C.textSec }}>{l.email}{l.nota ? ` · ${l.nota}` : ''}</span>
                <button style={btn} disabled={ocupado} onClick={() => rodar(async () => { await api.removerLiberado(l.email); setMsg('E-mail removido da lista.'); await recarregar() })}>
                  remover
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={secao}>
        <p style={titulo}>Contas ({contas.length})</p>
        <p style={sub}>
          Bloquear tira o acesso ao cofre na hora — a conta continua existindo, mas não lê nem grava mais nada.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                {['E-mail', 'Entrou em', 'Convite', 'Situação', ''].map((t) => (
                  <th key={t} style={th}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => (
                <tr key={c.userId}>
                  <td style={{ ...td, color: C.text }}>{c.email}</td>
                  <td style={td}>{data(c.criadoEm)}</td>
                  <td style={{ ...td, fontFamily: 'monospace', color: C.textMut }}>{c.conviteUsado ?? '—'}</td>
                  <td style={td}>
                    <span style={{ fontSize: 10.5, color: c.bloqueada ? C.red : C.green, border: `1px solid ${c.bloqueada ? C.red : C.green}`, borderRadius: 999, padding: '1px 7px' }}>
                      {c.bloqueada ? 'bloqueada' : 'ativa'}
                    </span>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button style={btn} disabled={ocupado} onClick={() => rodar(async () => { await api.bloquear(c.userId, !c.bloqueada); setMsg(c.bloqueada ? 'Conta desbloqueada.' : 'Conta bloqueada.'); await recarregar() })}>
                      {c.bloqueada ? 'desbloquear' : 'bloquear'}
                    </button>{' '}
                    {confirmando === c.userId ? (
                      <>
                        <button
                          style={{ ...btn, color: C.red, borderColor: '#5a2020' }}
                          disabled={ocupado}
                          onClick={() =>
                            rodar(async () => {
                              const r = await api.apagarConta(c.userId)
                              setConfirmando(null)
                              setMsg(
                                r.modo === 'conta'
                                  ? `Conta de ${c.email} apagada — login, cofre e métodos de desbloqueio.`
                                  : `Dados de ${c.email} apagados e a conta ficou bloqueada. O login continua existindo: ${r.motivo}.`,
                              )
                              await recarregar()
                            })
                          }
                        >
                          confirmar exclusão
                        </button>{' '}
                        <button style={btn} onClick={() => setConfirmando(null)}>cancelar</button>
                      </>
                    ) : (
                      <button style={{ ...btn, color: C.textMut }} title={AVISO_APAGAR} disabled={ocupado} onClick={() => setConfirmando(c.userId)}>
                        excluir conta
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ ...sub, marginTop: 4 }}>
          {AVISO_APAGAR} A função vive em <code>supabase/functions/apagar-conta</code>; o README de lá tem a linha de
          comando para implantar. Você não consegue apagar a sua própria conta por aqui — isso deixaria o app sem dono.
        </p>
      </div>

      <button style={btn} disabled={ocupado} onClick={() => void recarregar()}>
        {ocupado ? 'Carregando…' : 'Recarregar'}
      </button>
    </div>
  )
}
