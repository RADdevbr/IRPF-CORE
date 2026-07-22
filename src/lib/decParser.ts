// Leitor best-effort do arquivo .DEC da declaração de IRPF.
//
// Limitação real: o .DEC tem registros (linhas CRLF) com campos de LARGURA FIXA
// e CONTÍGUOS (sem separador). O leiaute posicional oficial é gov-gated e muda
// a cada ano. Sem esse mapa, só é seguro extrair valores que aparecem ISOLADOS
// (cercados por texto/espaço). Valores colados a outros campos não são
// separáveis com confiança — por isso isto é um importador ASSISTIDO: sugere
// candidatos e o usuário confirma/atribui. Nada é aplicado automaticamente.

export interface DecCandidate {
  valor: number
  contexto: string
  linha: number
}

export interface DecRegistro {
  tipo: string
  count: number
  amostra: string
}

export interface DecResult {
  ano: string | null
  registros: DecRegistro[]
  candidatos: DecCandidate[]
  totalLinhas: number
}

// Interpreta um bloco de dígitos como valor monetário (centavos → reais).
function toValor(digits: string): number {
  return parseInt(digits, 10) / 100
}

export function parseDec(text: string): DecResult {
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)

  // Ano do exercício: primeiro 20xx no cabeçalho.
  const anoMatch = text.slice(0, 400).match(/20\d{2}/)
  const ano = anoMatch ? anoMatch[0] : null

  // Tipos de registro pela heurística do prefixo (2 primeiros caracteres).
  const tipos = new Map<string, { count: number; amostra: string }>()
  lines.forEach((l) => {
    const t = l.slice(0, 2)
    const cur = tipos.get(t)
    if (cur) cur.count += 1
    else tipos.set(t, { count: 1, amostra: l.slice(0, 60) })
  })

  // Candidatos monetários: blocos de dígitos ISOLADOS (delimitados por
  // não-dígito), de 6 a 13 caracteres. Campos colados viram runs longos (>13)
  // e são descartados de propósito, para não gerar valores errados.
  const seen = new Set<string>()
  const candidatos: DecCandidate[] = []
  lines.forEach((l, i) => {
    const re = /(?<!\d)(\d{6,13})(?!\d)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(l)) !== null) {
      const valor = toValor(m[1])
      if (valor < 1000 || valor > 20_000_000) continue
      const start = Math.max(0, m.index - 14)
      const contexto = l
        .slice(start, m.index + m[1].length + 6)
        .replace(/\s+/g, ' ')
        .trim()
      const dedupe = `${valor}|${contexto}`
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      candidatos.push({ valor, contexto, linha: i + 1 })
    }
  })
  candidatos.sort((a, b) => b.valor - a.valor)

  const registros = [...tipos.entries()]
    .map(([tipo, v]) => ({ tipo, count: v.count, amostra: v.amostra }))
    .sort((a, b) => b.count - a.count)

  return { ano, registros, candidatos: candidatos.slice(0, 40), totalLinhas: lines.length }
}
