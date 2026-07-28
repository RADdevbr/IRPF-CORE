// Leitor best-effort do arquivo .DEC da declaração de IRPF.
//
// Limitação real: o .DEC tem registros (linhas CRLF) com campos de LARGURA FIXA
// e CONTÍGUOS (sem separador). O leiaute posicional oficial é gov-gated e muda
// a cada ano. Sem esse mapa, só é seguro extrair blocos de dígitos ISOLADOS
// (cercados por não-dígito) e deixar o usuário CONFERIR: escala (centavos vs
// reais), descrição da linha e atribuição. Nada é aplicado automaticamente, e
// a divisão por 100 NÃO é assumida aqui — a UI aplica a escala escolhida.

export interface DecCandidate {
  digits: string // bloco bruto de dígitos capturado
  raw: number // parseInt(digits) — sem escala
  linha: number // nº da linha (1-based)
  contexto: string // trecho da linha ao redor do valor (para achar a descrição)
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
  linhas: string[] // registros brutos, para o visor
  totalLinhas: number
}

export function parseDec(text: string): DecResult {
  const linhas = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)

  // Ano do exercício: primeiro 20xx no cabeçalho.
  const anoMatch = text.slice(0, 400).match(/20\d{2}/)
  const ano = anoMatch ? anoMatch[0] : null

  // Tipos de registro pela heurística do prefixo (2 primeiros caracteres).
  const tipos = new Map<string, { count: number; amostra: string }>()
  linhas.forEach((l) => {
    const t = l.slice(0, 2)
    const cur = tipos.get(t)
    if (cur) cur.count += 1
    else tipos.set(t, { count: 1, amostra: l.slice(0, 60) })
  })

  // Candidatos: blocos de dígitos ISOLADOS (delimitados por não-dígito), de 6 a
  // 13 caracteres. Runs longos (campos colados) são descartados de propósito.
  const candidatos: DecCandidate[] = []
  linhas.forEach((l, i) => {
    const re = /(?<!\d)(\d{6,13})(?!\d)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(l)) !== null) {
      const digits = m[1]
      const raw = parseInt(digits, 10)
      if (raw < 10000) continue // descarta códigos pequenos
      const start = Math.max(0, m.index - 40)
      const contexto = l
        .slice(start, m.index + digits.length + 8)
        .replace(/\s+/g, ' ')
        .trim()
      candidatos.push({ digits, raw, linha: i + 1, contexto })
    }
  })
  candidatos.sort((a, b) => b.raw - a.raw)

  const registros = [...tipos.entries()]
    .map(([tipo, v]) => ({ tipo, count: v.count, amostra: v.amostra }))
    .sort((a, b) => b.count - a.count)

  return { ano, registros, candidatos: candidatos.slice(0, 60), linhas, totalLinhas: linhas.length }
}
