// A fiação do cofre: destravar, autosalvar, sincronizar, trancar sozinho.
//
// Isto morava dentro do `App.tsx` de um app só — umas duzentas linhas de
// `useEffect` que ninguém queria tocar. Ao virarem três apps, copiá-las três
// vezes seria o pior lugar possível para divergir: cada `if` aqui protege contra
// uma forma específica de perder ou vazar dado, e a terceira cópia é onde um
// deles vira `if` errado.
//
// Os invariantes que este hook existe para manter, cada um pago com um bug:
//
//   · O autosave só liga DEPOIS de o conteúdo do cofre estar carregado. Sem a
//     trava, o estado inicial vazio sobrescreve o cofre no primeiro render.
//   · Ao BAIXAR um cofre da conta, prova-se que a chave desta sessão o abre
//     antes de gravar. Gravar sem conferir planta um cofre cujos embrulhos abrem
//     e cujo conteúdo não decifra — e isso só aparece no bloqueio seguinte, como
//     «chave errada» para quem está com a chave certa na mão.
//   · Conflito e cofres diferentes NÃO se resolvem sozinhos. Merge silencioso de
//     número de imposto é bug caro; a escolha vai para a tela.
//   · A volta do link do e-mail fala ANTES de perguntar ao servidor. A rede
//     pendura, e um aviso que só existe na resposta deixa a pessoa olhando para
//     uma tela que não menciona o login que ela acabou de fazer.
//
// O que o hook NÃO sabe: o formato do estado. Ele recebe o estado atual já
// montado e uma função que espalha um estado lido de fora nos setters do app.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decifrarCofre, type CofreCompleto } from '../cofre/crypto.js'
import {
  dekLembrada,
  esquecerDek,
  existeCofre,
  gravarCofre,
  gravarEstadoSync,
  lerCofre,
  lerDadosCifrados,
  lerEstadoSync,
  marcarSujo,
  salvarCifrado,
} from '../cofre/vault.js'
import { supabaseConfigurado } from '../cofre/config.js'
import { contaLembrada, esquecerConta } from '../cofre/sessaoLembrada.js'
import { docEstadoApp } from './config.js'
import { modoVisita } from './armazenamento.js'
import type { EstadoVersionado, Persistencia } from './persistencia.js'
import { registrarSw } from '../pwa/sw.js'

/** Quanto tempo sem interação até a chave sair da memória. */
const AUTO_LOCK_MS = 15 * 60 * 1000
/** Folga do autosave cifrado — cifrar a cada tecla é caro. */
const AUTOSAVE_MS = 400
/** Folga do sync automático, bem maior: é rede. */
const SYNC_MS = 4000
/** A rede pendura; sem limite, a volta do link do e-mail nunca responde. */
const TIMEOUT_LOGIN_MS = 15000

export type StatusSync = 'ocioso' | 'indo' | 'ok' | 'erro'

export interface CofreDoApp {
  /** Há cofre criado neste navegador? Sem ele o app roda em modo convidado. */
  cofreExiste: boolean
  /** Cofre existe e a chave não está em mãos: a tela de destravar toma a frente. */
  travado: boolean
  dek: Uint8Array | null
  criandoCofre: boolean
  setCriandoCofre: (v: boolean) => void
  contaAberta: boolean
  setContaAberta: (v: boolean) => void
  /** Recado da volta do link do e-mail — sobrevive à tela de destravar. */
  avisoConta: string
  statusSync: StatusSync
  detalheSync: string
  /** Força um ciclo de sync agora. O automático já roda sozinho. */
  sincronizarAgora: () => void
  /** Chame quando o `VaultGate` terminar de criar ou destravar. */
  aoAbrirCofre: (dek: Uint8Array, dados: unknown) => void
  /**
   * Chame com o que a tela de conta trouxe do servidor (`ContaSync.onBaixado`).
   *
   * `mesmoCofre` diz se dá para reaproveitar a chave desta sessão — mas não é
   * palavra final: mesmo com ela `true`, tentamos decifrar antes de aceitar.
   * Seguir com a sessão aberta sobre um conteúdo que a chave não abre deixaria o
   * autosave re-cifrar o estado da TELA por cima do que acabou de ser trazido, e
   * o que veio da conta sumiria sem ninguém ver.
   */
  aoBaixarCofre: (novo: CofreCompleto, mesmoCofre: boolean) => void
  /** Tranca à mão (o botão «trancar»); o auto-lock faz o mesmo sozinho. */
  travar: () => void
  /** Chame depois de apagar ou trocar o cofre por fora. */
  reavaliarCofre: () => void
  msg: string
  flash: (t: string) => void
  visita: boolean
  setVisita: (v: boolean) => void
  /** Versão nova baixada e esperando; a função é o que a aplica. */
  atualizacao: (() => void) | null
}

export interface OpcoesCofre<T extends EstadoVersionado> {
  persistencia: Persistencia<T>
  /** O estado atual do app, memoizado. É o que é gravado. */
  estado: T
  /** Espalha um estado vindo de fora (cofre, conta, arquivo) nos setters do app. */
  aplicar: (s: T) => void
  /** `false` em dev: o service worker serviria o bundle velho enquanto se edita. */
  registrarServiceWorker?: boolean
}

export function useCofreDoApp<T extends EstadoVersionado>(o: OpcoesCofre<T>): CofreDoApp {
  const { persistencia, estado, aplicar } = o

  const [cofreExiste, setCofreExiste] = useState(() => existeCofre())
  const [dek, setDek] = useState<Uint8Array | null>(() => (existeCofre() ? dekLembrada() : null))
  const [travado, setTravado] = useState(() => existeCofre() && !dekLembrada())
  const [criandoCofre, setCriandoCofre] = useState(false)
  const [contaAberta, setContaAberta] = useState(false)
  const [avisoConta, setAvisoConta] = useState('')
  const [statusSync, setStatusSync] = useState<StatusSync>('ocioso')
  const [detalheSync, setDetalheSync] = useState('')
  const [msg, setMsg] = useState('')
  const [visita, setVisitaState] = useState(() => modoVisita())
  const [atualizacao, setAtualizacao] = useState<(() => void) | null>(null)

  // Trava o autosave até o conteúdo do cofre estar carregado — ver o cabeçalho.
  const prontoParaSalvar = useRef(!existeCofre())
  const sincronizando = useRef(false)

  // `aplicar` muda a cada render (é uma closure sobre os setters do app). Os
  // efeitos precisam da versão mais nova sem ganhar uma dependência que se
  // recria sempre — que os faria rodar em laço.
  const aplicarRef = useRef(aplicar)
  aplicarRef.current = aplicar

  const flash = useCallback((t: string) => {
    setMsg(t)
    window.setTimeout(() => setMsg(''), 2500)
  }, [])

  const travar = useCallback(() => {
    esquecerDek()
    setDek(null)
    setTravado(true)
    prontoParaSalvar.current = false
  }, [])

  const reavaliarCofre = useCallback(() => {
    const tem = existeCofre()
    setCofreExiste(tem)
    if (!tem) {
      setDek(null)
      setTravado(false)
      prontoParaSalvar.current = true
    }
  }, [])

  const aoAbrirCofre = useCallback((novaDek: Uint8Array, dados: unknown) => {
    setDek(novaDek)
    setCofreExiste(true)
    setTravado(false)
    setCriandoCofre(false)
    // `null` = cofre recém-criado a partir do que já está na tela: não há o que
    // aplicar, e aplicar `null` limparia o que a pessoa acabou de digitar.
    if (dados !== null && dados !== undefined) aplicarRef.current(dados as T)
    prontoParaSalvar.current = true
  }, [])

  const aoBaixarCofre = useCallback(
    (novo: CofreCompleto, mesmoCofre: boolean) => {
      gravarCofre(novo)
      if (mesmoCofre && dek) {
        decifrarCofre<T>(dek, novo.cofre)
          .then((d) => {
            aplicarRef.current(d)
            flash('Cofre atualizado com a versão da conta.')
          })
          .catch(travar)
        return
      }
      // Cofre diferente: a chave desta sessão não serve. Trancar deixa o
      // destravar — que confere de verdade — dizer o que está errado, em vez de
      // o app seguir gravando com uma chave que não abre o que está em disco.
      travar()
    },
    [dek, flash, travar],
  )

  const setVisita = useCallback((v: boolean) => {
    setVisitaState(v)
  }, [])

  // ------------------------------------------------------------ service worker
  useEffect(() => {
    registrarSw((funcao) => setAtualizacao(() => funcao), o.registrarServiceWorker ?? true)
    // uma vez só: registrar de novo a cada render duplicaria o aviso
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ------------------------------------------------------------ autosave
  useEffect(() => {
    if (!prontoParaSalvar.current) return
    if (dek) {
      const t = window.setTimeout(() => {
        salvarCifrado(dek, estado)
          .then(() => marcarSujo())
          .catch(() => setMsg('Não consegui gravar no cofre.'))
      }, AUTOSAVE_MS)
      return () => window.clearTimeout(t)
    }
    // Com cofre criado e sem chave em mãos, gravar em claro desfaria o cofre.
    if (!cofreExiste) persistencia.saveState(estado)
  }, [estado, dek, cofreExiste, persistencia])

  // ------------------------------------------------------------ sessão lembrada
  //
  // «Confiar neste dispositivo»: a chave está no sessionStorage, então o cofre
  // abre sem pedir nada. Se ela não abrir o conteúdo, some — é chave velha de um
  // cofre que foi trocado, e insistir travaria o app.
  useEffect(() => {
    if (!dek || prontoParaSalvar.current) return
    let vivo = true
    lerDadosCifrados<T>(dek)
      .then((d) => {
        if (!vivo) return
        aplicarRef.current(d)
        prontoParaSalvar.current = true
      })
      .catch(() => {
        if (!vivo) return
        travar()
      })
    return () => {
      vivo = false
    }
  }, [dek, travar])

  // ------------------------------------------------------------ auto-lock
  useEffect(() => {
    if (!dek) return
    let t = 0
    const rearmar = () => {
      window.clearTimeout(t)
      t = window.setTimeout(travar, AUTO_LOCK_MS)
    }
    const eventos: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'focus']
    eventos.forEach((e) => window.addEventListener(e, rearmar))
    rearmar()
    return () => {
      window.clearTimeout(t)
      eventos.forEach((e) => window.removeEventListener(e, rearmar))
    }
  }, [dek, travar])

  // ------------------------------------------------------------ sync automático
  //
  // O botão manual continua existindo para forçar, mas ninguém deveria precisar
  // dele: quem entrou uma vez na conta quer o cofre atualizado, não um ritual.
  // Só entra em ação para quem JÁ entrou alguma vez neste navegador — assim quem
  // usa o app só localmente continua sem baixar o SDK do Supabase.
  const sincronizarAgora = useCallback(async () => {
    if (sincronizando.current || !dek || !supabaseConfigurado() || !contaLembrada()) return
    sincronizando.current = true
    setStatusSync('indo')
    const paraATela = (detalhe: string) => {
      setStatusSync('erro')
      setDetalheSync(detalhe)
      setContaAberta(true)
    }
    try {
      const [{ remotoSupabase }, { sincronizar }] = await Promise.all([
        import('../cofre/conta.js'),
        import('../cofre/syncCofre.js'),
      ])
      const r = remotoSupabase()
      if (!(await r.usuario())) {
        // A sessão do servidor expirou: para de tentar sozinho e devolve a
        // decisão para a pessoa, em vez de piscar erro a cada mudança.
        esquecerConta()
        setStatusSync('ocioso')
        return
      }
      const res = await sincronizar(r, lerCofre(), lerEstadoSync(), docEstadoApp())

      if (res.acao === 'conflito' || res.acao === 'cofres-diferentes' || res.acao === 'adotar-chave') {
        paraATela('Precisa da sua decisão')
        return
      }

      if (res.acao === 'baixar' && res.cofre) {
        let dados: T
        try {
          dados = await decifrarCofre<T>(dek, res.cofre.cofre)
        } catch {
          paraATela('Precisa da sua decisão')
          return
        }
        gravarCofre(res.cofre)
        gravarEstadoSync(res.estado)
        aplicarRef.current(dados)
      } else {
        gravarEstadoSync(res.estado)
        if (res.cofre) gravarCofre(res.cofre)
      }
      setStatusSync('ok')
      setDetalheSync(new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setStatusSync('erro')
      setDetalheSync(e instanceof Error ? e.message : 'falhou')
    } finally {
      sincronizando.current = false
    }
  }, [dek])

  // Ao destravar, e depois de cada mudança (com folga). O cofre é lido fresco lá
  // dentro, então sobe sempre a última versão.
  useEffect(() => {
    if (!dek || !prontoParaSalvar.current) return
    const t = window.setTimeout(sincronizarAgora, SYNC_MS)
    return () => window.clearTimeout(t)
  }, [dek, sincronizarAgora, estado])

  // ------------------------------------------------------------ volta do e-mail
  useEffect(() => {
    if (!supabaseConfigurado()) return
    if (!/access_token=|error_description=/.test(window.location.hash)) return
    let vivo = true
    setAvisoConta('Confirmando o acesso…')
    const comLimite = <R,>(pr: Promise<R>) =>
      Promise.race([
        pr,
        new Promise<never>((_, rej) =>
          window.setTimeout(
            () => rej(new Error('O servidor não respondeu. Abra "Conta" e tente de novo.')),
            TIMEOUT_LOGIN_MS,
          ),
        ),
      ])
    import('../cofre/conta.js')
      .then(({ remotoSupabase }) => comLimite(remotoSupabase().usuario()))
      .then((u) => {
        if (!vivo) return
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        if (u) {
          setContaAberta(true)
          setAvisoConta(`Conectado como ${u.email}. Destrave o cofre para sincronizar.`)
          flash(`Conectado como ${u.email}.`)
        } else {
          setAvisoConta('O link do e-mail não abriu uma sessão. Peça outro link — eles expiram rápido.')
          flash('O link do e-mail não abriu uma sessão. Peça outro.')
        }
      })
      .catch((e) => {
        // Engolir isto era o pior dos mundos: a pessoa volta do e-mail, não vê
        // nada acontecer e conclui que o app está quebrado.
        if (!vivo) return
        const m = e instanceof Error ? e.message : 'Não consegui confirmar o login.'
        setAvisoConta(m)
        flash(m)
      })
    return () => {
      vivo = false
    }
  }, [flash])

  return useMemo(
    () => ({
      cofreExiste,
      travado,
      dek,
      criandoCofre,
      setCriandoCofre,
      contaAberta,
      setContaAberta,
      avisoConta,
      statusSync,
      detalheSync,
      sincronizarAgora: () => void sincronizarAgora(),
      aoAbrirCofre,
      aoBaixarCofre,
      travar,
      reavaliarCofre,
      msg,
      flash,
      visita,
      setVisita,
      atualizacao,
    }),
    [
      cofreExiste,
      travado,
      dek,
      criandoCofre,
      contaAberta,
      avisoConta,
      statusSync,
      detalheSync,
      sincronizarAgora,
      aoAbrirCofre,
      aoBaixarCofre,
      travar,
      reavaliarCofre,
      msg,
      flash,
      visita,
      setVisita,
      atualizacao,
    ],
  )
}
