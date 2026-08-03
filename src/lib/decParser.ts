// Leitor posicional do arquivo .DEC da declaração de IRPF.
//
// O .DEC é largura-fixa: cada linha é um registro identificado pelos 2 primeiros
// dígitos (NR_REG), com campos em posições fixas. Valores são "13 2 N" = 13
// posições, 2 casas decimais (centavos → dividir por 100). Layout calibrado pelo
// leiaute oficial "Especificação do Arquivo de Integração do IRPF" (base 2014).
// Registros mais novos podem deslocar posições — por isso o app mostra o nome da
// fonte e a linha bruta para conferência, e nada é aplicado sem o usuário.

export interface Lancamento {
  linha: number
  tipo: string // ex.: '21'
  tipoLabel: string
  fonte: string // nome da fonte pagadora (quando o registro tem)
  cnpj: string
  rotulo: string // ex.: 'Rendimento', 'IR retido', 'Dividendo'
  valor: number // já em reais (÷100)
  alvo: string // campo sugerido do baseline (key/ir key)
}

export interface DecRegistro {
  tipo: string
  count: number
  amostra: string
}

// Posição de Bens e Direitos (Registro 27) — o "patrimônio" de investimentos.
export interface Posicao {
  linha: number
  cdBem: string
  descricao: string
  saldoAnterior: number // 31/12 do ano anterior
  saldoAtual: number // 31/12 do ano-base — vira o "valor aplicado" na carteira
  tipoCarteira: string // classe sugerida p/ a Carteira de renda fixa
}

export interface DecResult {
  ano: string | null
  registros: DecRegistro[]
  lancamentos: Lancamento[]
  posicoes: Posicao[]
  ndep: number
  linhas: string[]
  totalLinhas: number
}

// Classifica a posição na classe da carteira pela descrição do bem.
function classifica(descricao: string): string {
  const d = descricao.toUpperCase()
  if (/POUPAN/.test(d)) return 'poupanca'
  if (/\bLC[IA]\b|LETRA DE CR[ÉE]DITO/.test(d)) return 'lci'
  if (/\bCR[IA]\b|CERTIFICAD[OA] DE RECEB/.test(d)) return 'cri'
  if (/INCENTIVAD/.test(d)) return 'debentureInc'
  if (/DEB[ÊE]NTURE/.test(d)) return 'debentureComum'
  if (/TESOURO|NTN-|LFT|LTN/.test(d)) return 'tesouro'
  if (/\bCDB\b|\bRDB\b/.test(d)) return 'cdb'
  if (/FUNDO|\bFIC\b|\bFI\b|COTAS/.test(d)) return 'fundo'
  return 'cdb'
}

interface CampoSpec {
  rotulo: string
  ini: number // 1-indexado, inclusivo
  fim: number
  alvo: string
}
interface RegistroSpec {
  label: string
  nome?: [number, number] // posição do nome da fonte
  cnpj?: [number, number]
  campos: CampoSpec[]
}

// Registros que carregam rendimentos relevantes para a base do IRPFM.
const REGISTROS: Record<string, RegistroSpec> = {
  '21': {
    label: 'Rend. tributável de PJ',
    cnpj: [14, 27],
    nome: [28, 87],
    campos: [
      { rotulo: 'Rendimento', ini: 88, fim: 100, alvo: 'salario' },
      { rotulo: 'IR retido', ini: 127, fim: 139, alvo: 'salario_ir' },
    ],
  },
  '22': {
    label: 'Rend. PF / exterior / carnê-leão',
    campos: [
      { rotulo: 'Exterior', ini: 41, fim: 53, alvo: 'exterior' },
      { rotulo: 'Outros (PF)', ini: 28, fim: 40, alvo: 'outros' },
      { rotulo: 'IR (carnê-leão)', ini: 119, fim: 131, alvo: 'exterior_ir' },
    ],
  },
  '24': {
    label: 'Tributação exclusiva',
    campos: [
      { rotulo: 'Aplic. financeiras', ini: 53, fim: 65, alvo: 'cdb' },
      { rotulo: 'Outros exclusivos', ini: 66, fim: 78, alvo: 'outros' },
      { rotulo: 'Juros s/ capital próprio', ini: 277, fim: 289, alvo: 'outros' },
    ],
  },
}
// Obs.: os dividendos NÃO são lidos do Registro 33 — no arquivo real eles vêm no
// Registro 84 linha 09 (junto com LCI/LCA etc.). Ler os dois dobraria o valor.

// Âncora "CNPJ (14 díg.) + nome (texto) + valor (13 díg.)" — o padrão comum aos
// registros de detalhe (21, 33 e o 24 por fundo). Independe de offset exato.
const ANCHOR = /(\d{14})([A-Za-zÀ-ÿ][^\d]{0,59}?)\s*(\d{13})/g

function slice1(line: string, ini: number, fim: number): string {
  return line.slice(ini - 1, fim)
}
function num(line: string, ini: number, fim: number): number {
  const d = slice1(line, ini, fim).replace(/\D/g, '')
  return d ? parseInt(d, 10) / 100 : 0
}

export function parseDec(text: string): DecResult {
  const linhas = text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0)

  const anoMatch = text.slice(0, 400).match(/20\d{2}/)
  const ano = anoMatch ? anoMatch[0] : null

  const tipos = new Map<string, { count: number; amostra: string }>()
  const lancamentos: Lancamento[] = []
  const posicoes: Posicao[] = []
  let ndep = 0

  linhas.forEach((l, i) => {
    const tipo = l.slice(0, 2)
    const cur = tipos.get(tipo)
    if (cur) cur.count += 1
    else tipos.set(tipo, { count: 1, amostra: l.slice(0, 60) })

    if (tipo === '25') ndep += 1

    // Registro 27 — Bens e Direitos (investimentos): descrição (20-531) e saldo
    // em 31/12 (545-557). País 105 na pos. 17-19 confirmou este layout.
    if (tipo === '27') {
      const descricao = slice1(l, 20, 531).replace(/\s+/g, ' ').trim()
      const saldoAtual = num(l, 545, 557)
      const saldoAnterior = num(l, 532, 544)
      if (descricao) {
        posicoes.push({ linha: i + 1, cdBem: slice1(l, 14, 15), descricao, saldoAnterior, saldoAtual, tipoCarteira: classifica(descricao) })
      }
      return
    }

    // Registros 84/88 — rendimentos por fonte, mesmo layout (confirmado por
    // linhas reais): código da linha em 26-29, nome do fundo em 44-103 (60
    // chars) e VALOR em 104-116 (13 díg. = centavos).
    // - 88 = tributação exclusiva/definitiva → entra na base (CDB).
    // - 84 = ficha de isentos, VÁRIAS linhas por código:
    //     · linha 09 = Lucros e dividendos → isento em 2025, mas NA BASE do
    //       IRPFM 2026+ → mapeia para Dividendos.
    //     · demais (LCI/LCA/poupança/etc.) → fora da base → "ignorar".
    if (tipo === '84' || tipo === '88') {
      const valor = num(l, 104, 116)
      if (valor > 0) {
        const fonte = slice1(l, 44, 103).trim()
        const cnpj = slice1(l, 30, 43).trim()
        const cod = parseInt(slice1(l, 26, 29).replace(/\D/g, '') || '0', 10)
        let tipoLabel = 'Rend. isento / não tributável'
        let alvo = ''
        if (tipo === '88') {
          tipoLabel = 'Rend. tributação definitiva'
          alvo = 'cdb'
        } else if (cod === 9) {
          tipoLabel = 'Lucros e dividendos'
          alvo = 'divBR'
        }
        lancamentos.push({ linha: i + 1, tipo, tipoLabel, fonte, cnpj, rotulo: 'Rendimento', valor, alvo })
      }
      return
    }

    // Registro 24 SÓ quando vem por fundo COM nome (código + CNPJ + nome +
    // valor), ancorando em "CNPJ(14) + nome(texto) + valor(13)". O formato
    // compacto SEM nome NÃO é lido: sem o nome/âncora não dá pra saber a posição
    // do valor com segurança, e chutar gerava valores absurdos (bilhões).
    if (tipo === '24') {
      let achou = false
      let m: RegExpExecArray | null
      ANCHOR.lastIndex = 0
      while ((m = ANCHOR.exec(l)) !== null) {
        const valor = parseInt(m[3], 10) / 100
        if (valor <= 0) continue
        achou = true
        lancamentos.push({ linha: i + 1, tipo: '24', tipoLabel: 'Rend. aplicação financeira', fonte: m[2].trim(), cnpj: m[1], rotulo: 'Rendimento', valor, alvo: 'cdb' })
      }
      if (achou) return
    }

    const spec = REGISTROS[tipo]
    if (!spec) return
    const fonte = spec.nome ? slice1(l, spec.nome[0], spec.nome[1]).trim() : ''
    const cnpj = spec.cnpj ? slice1(l, spec.cnpj[0], spec.cnpj[1]).trim() : ''
    spec.campos.forEach((c) => {
      const valor = num(l, c.ini, c.fim)
      if (valor <= 0) return
      lancamentos.push({ linha: i + 1, tipo, tipoLabel: spec.label, fonte, cnpj, rotulo: c.rotulo, valor, alvo: c.alvo })
    })
  })

  const registros = [...tipos.entries()]
    .map(([tipo, v]) => ({ tipo, count: v.count, amostra: v.amostra }))
    .sort((a, b) => b.count - a.count)

  return { ano, registros, lancamentos, posicoes, ndep, linhas, totalLinhas: linhas.length }
}
