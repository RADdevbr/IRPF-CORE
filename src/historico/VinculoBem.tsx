import { useMemo, useState } from 'react'
import { C } from '../ui/theme'
import { fmt } from '../ui/format'
import { candidatosPara, LIMIAR, type Candidato } from './vinculoAuto'
import { resolverCadeias, serieDaPosicao, type Historico as Hist, type PosicaoAno, type Vinculos } from './historico'

// Ligar o mesmo bem entre anos, do lado de quem tem de conferir.
//
// A versão anterior era um <select> com TODOS os bens de TODOS os outros anos —
// dezenas de linhas corridas, sem ordem útil — e não dizia nada sobre o que já
// estava ligado. Quem ligou automático não via ligação nenhuma: a linha
// continuava oferecendo "vincular…" como se nada tivesse acontecido.
//
// Aqui a linha diz o que ela é (série de N anos, ou só deste ano), e o painel
// mostra três coisas na ordem em que se decide: a série que já existe (com
// desfazer), o pré-ajuste — os bens de outros anos que o app ranqueou por saldo
// de 31/12, CNPJ, código e nome — e, só se pedir, a lista inteira com busca.

const PRE_AJUSTE = 3 // abaixo disto não vale nem mostrar como sugestão

export interface EstadoVinculo {
  vinculos: Vinculos
  vinculosAuto: Vinculos
  vetados: string[]
  onVinculos: (v: Vinculos) => void
  onVetados: (v: string[]) => void
}

/** De onde veio cada ano da série: ligação da pessoa, do app, ou o próprio id. */
export interface Origem {
  id: string
  anoBase: number
  descricao: string
  saldoAtual: number
  manual: boolean
}

/** Posições do histórico cru indexadas por id — o id que o vínculo reescreveu. */
export function indicePorId(bruto: Hist): Record<string, { anoBase: number; descricao: string; saldoAtual: number }> {
  const mapa: Record<string, { anoBase: number; descricao: string; saldoAtual: number }> = {}
  for (const d of Object.values(bruto)) {
    for (const p of d.posicoes) mapa[p.id] = { anoBase: d.anoBase, descricao: p.descricao, saldoAtual: p.saldoAtual }
  }
  return mapa
}

export function origensDe(
  id: string,
  vinculos: Vinculos,
  vinculosAuto: Vinculos,
  indice: ReturnType<typeof indicePorId>,
): Origem[] {
  // resolvido: o bem ligado em dois saltos (2020→2021→2022) pertence à série de
  // 2022, e é ali que ele tem de aparecer
  const efetivos = resolverCadeias({ ...vinculosAuto, ...vinculos })
  return Object.entries(efetivos)
    .filter(([, para]) => para === id)
    .map(([de]) => {
      const info = indice[de]
      return {
        id: de,
        anoBase: info?.anoBase ?? 0,
        descricao: info?.descricao ?? '(bem de outro ano)',
        saldoAtual: info?.saldoAtual ?? 0,
        // quem ligou foi a pessoa, mesmo que a cadeia tenha mudado o destino
        manual: vinculos[de] !== undefined,
      }
    })
    .sort((a, b) => a.anoBase - b.anoBase)
}

const chip = (cor: string, fundo: string): React.CSSProperties => ({
  fontSize: 10.5,
  color: cor,
  border: `0.5px solid ${cor}`,
  background: fundo,
  borderRadius: 999,
  padding: '1px 7px',
  whiteSpace: 'nowrap',
})

const btn: React.CSSProperties = {
  background: C.bg3,
  border: `0.5px solid ${C.border}`,
  borderRadius: 6,
  color: C.textSec,
  fontSize: 11.5,
  padding: '4px 9px',
  cursor: 'pointer',
}

/** O que a linha do mapa mostra: já é uma série, ou está sozinha neste ano. */
export function BotaoVinculo({
  h,
  pos,
  aberto,
  onToggle,
}: {
  h: Hist
  pos: PosicaoAno
  aberto: boolean
  onToggle: () => void
}) {
  const serie = serieDaPosicao(h, pos.id)
  const ligado = serie.length > 1
  return (
    <button
      onClick={onToggle}
      aria-expanded={aberto}
      title={
        ligado
          ? `este bem aparece em ${serie.length} anos: ${serie.map((s) => s.anoBase).join(', ')}`
          : 'este bem só aparece neste ano — ligar ao mesmo bem de outro ano'
      }
      style={{
        ...btn,
        color: ligado ? C.blue : C.textMut,
        borderColor: ligado ? C.blueBorder : C.border,
        background: ligado ? C.blueDim : C.bg3,
        whiteSpace: 'nowrap',
      }}
    >
      {ligado
        ? `↔ ${serie[0].anoBase}–${serie[serie.length - 1].anoBase} · ${serie.length} anos`
        : '↔ só este ano'}
    </button>
  )
}

function LinhaCandidato({
  c,
  preAjuste,
  marcado,
  onMarcar,
  onLigar,
}: {
  c: Candidato
  preAjuste: boolean
  marcado: boolean
  onMarcar: () => void
  onLigar: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5 }}>
      <input
        type="checkbox"
        checked={marcado}
        onChange={onMarcar}
        aria-label={`marcar ${c.descricao || 'bem sem descrição'} de ${c.anoBase}`}
        style={{ cursor: 'pointer' }}
      />
      <span style={{ fontFamily: 'monospace', color: C.textMut, width: 38 }}>{c.anoBase}</span>
      <span style={{ flex: 1, minWidth: 150, color: C.textSec }}>
        {c.descricao || '(sem descrição)'}
        {c.motivos.length > 0 && (
          <span style={{ color: C.textMut }}> · {c.motivos.slice(0, 2).join(' · ')}</span>
        )}
      </span>
      {preAjuste && <span style={chip(C.green, C.greenDim)}>o app ligaria</span>}
      <span style={{ fontFamily: 'monospace', color: C.textMut, minWidth: 90, textAlign: 'right' }}>{fmt(c.saldoAtual)}</span>
      <button onClick={onLigar} style={{ ...btn, color: C.blue, borderColor: C.blueBorder }}>
        é este
      </button>
    </div>
  )
}

export function PainelVinculo({
  h,
  bruto,
  pos,
  anoBase,
  estado,
}: {
  h: Hist
  bruto: Hist
  pos: PosicaoAno
  anoBase: number
  estado: EstadoVinculo
}) {
  const [verTodos, setVerTodos] = useState(false)
  const [busca, setBusca] = useState('')
  // Um bem que mudou de nome três vezes precisa de três ligações. Marcar de uma
  // vez é o que transforma isso em um clique — e evita a ordem errada, que era
  // o que partia a série no meio.
  const [marcados, setMarcados] = useState<string[]>([])
  const { vinculos, vinculosAuto, vetados, onVinculos, onVetados } = estado

  const indice = useMemo(() => indicePorId(bruto), [bruto])
  const origens = useMemo(() => origensDe(pos.id, vinculos, vinculosAuto, indice), [pos.id, vinculos, vinculosAuto, indice])
  const candidatos = useMemo(() => candidatosPara(h, pos, anoBase).filter((c) => !c.naSerie), [h, pos, anoBase])

  const ligar = (c: Candidato) => {
    // o vínculo sempre aponta do ano mais velho para o mais novo: é o id do ano
    // novo que vira o id da série inteira
    const [de, para] = c.anoBase < anoBase ? [c.id, pos.id] : [pos.id, c.id]
    onVinculos({ ...vinculos, [de]: para })
  }

  const marcar = (id: string) =>
    setMarcados((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]))

  /** Tudo o que foi marcado vira UMA série, apontada para o ano mais novo. */
  const ligarMarcados = () => {
    const alvos = candidatos.filter((c) => marcados.includes(c.id)).map((c) => ({ id: c.id, anoBase: c.anoBase }))
    if (alvos.length === 0) return
    const todos = [...alvos, { id: pos.id, anoBase }]
    const canonico = todos.reduce((a, b) => (b.anoBase > a.anoBase ? b : a))
    const novo = { ...vinculos }
    for (const t of todos) if (t.id !== canonico.id) novo[t.id] = canonico.id
    onVinculos(novo)
    setMarcados([])
  }

  const desfazer = (o: Origem) => {
    if (o.manual) {
      const copia = { ...vinculos }
      delete copia[o.id]
      onVinculos(copia)
      // veta também o automático: senão o app refaz a mesma ligação no próximo
      // render e o "desfazer" não desfaz nada
      if (vinculosAuto[o.id]) onVetados([...vetados, o.id])
    } else {
      onVetados([...vetados, o.id])
    }
  }

  const sugestoes = candidatos.filter((c) => c.pontos >= PRE_AJUSTE).slice(0, 5)
  const filtrados = busca.trim()
    ? candidatos.filter((c) => c.descricao.toLowerCase().includes(busca.trim().toLowerCase()))
    : candidatos

  const titulo: React.CSSProperties = { fontSize: 11, color: C.textMut, textTransform: 'uppercase', letterSpacing: '0.05em' }

  return (
    <div style={{ padding: '2px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={titulo}>Série deste bem</span>
        {origens.length === 0 ? (
          <span style={{ fontSize: 11.5, color: C.textMut }}>
            Só {anoBase}. Nada de outro ano está ligado a este bem.
          </span>
        ) : (
          origens.map((o) => (
            <div key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 11.5 }}>
              <span style={{ fontFamily: 'monospace', color: C.textMut, width: 38 }}>{o.anoBase}</span>
              <span style={{ flex: 1, minWidth: 150, color: C.textSec }}>{o.descricao || '(sem descrição)'}</span>
              <span style={chip(o.manual ? C.blue : C.textMut, o.manual ? C.blueDim : C.bg3)}>
                {o.manual ? 'ligado por você' : 'ligado pelo app'}
              </span>
              <span style={{ fontFamily: 'monospace', color: C.textMut, minWidth: 90, textAlign: 'right' }}>{fmt(o.saldoAtual)}</span>
              <button onClick={() => desfazer(o)} style={{ ...btn, color: C.red }} title="separar de novo: este bem volta a ser uma série só dele">
                desfazer
              </button>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={titulo}>Pré-ajuste — o mesmo bem em outro ano</span>
        <span style={{ fontSize: 11, color: C.textMut, lineHeight: 1.5 }}>
          Um bem que mudou de nome aparece em vários anos: marque todos e ligue de uma vez. «É este» liga um só.
        </span>
        {sugestoes.length === 0 ? (
          <span style={{ fontSize: 11.5, color: C.textMut }}>
            Nenhum bem de outro ano se parece com este por saldo de 31/12, CNPJ, código ou nome.
          </span>
        ) : (
          sugestoes.map((c) => (
            <LinhaCandidato
              key={`${c.anoBase}-${c.id}`}
              c={c}
              preAjuste={c.pontos >= LIMIAR}
              marcado={marcados.includes(c.id)}
              onMarcar={() => marcar(c.id)}
              onLigar={() => ligar(c)}
            />
          ))
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {marcados.length > 0 ? (
            <>
              <button onClick={ligarMarcados} style={{ ...btn, color: C.orange, borderColor: C.orangeBorder, background: C.orangeDim }}>
                ligar {marcados.length} {marcados.length === 1 ? 'marcado' : 'marcados'} como o mesmo bem
              </button>
              <button onClick={() => setMarcados([])} style={btn}>
                desmarcar
              </button>
            </>
          ) : (
            sugestoes.length > 1 && (
              <button onClick={() => setMarcados(sugestoes.map((c) => c.id))} style={btn}>
                marcar as {sugestoes.length} sugestões
              </button>
            )
          )}
          <button onClick={() => setVerTodos((v) => !v)} style={btn}>
            {verTodos ? 'fechar a lista completa' : `ver todos os bens dos outros anos (${candidatos.length})`}
          </button>
          {verTodos && (
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="buscar pelo nome"
              aria-label="buscar bem de outro ano pelo nome"
              style={{ ...btn, cursor: 'text', width: 180, color: C.text }}
            />
          )}
        </div>
        {verTodos && (
          <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, border: `0.5px solid ${C.border}`, borderRadius: 6, padding: 8 }}>
            {filtrados.length === 0 ? (
              <span style={{ fontSize: 11.5, color: C.textMut }}>Nada com esse nome nos outros anos.</span>
            ) : (
              filtrados.map((c) => (
                <LinhaCandidato
                  key={`todos-${c.anoBase}-${c.id}`}
                  c={c}
                  preAjuste={c.pontos >= LIMIAR}
                  marcado={marcados.includes(c.id)}
                  onMarcar={() => marcar(c.id)}
                  onLigar={() => ligar(c)}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
