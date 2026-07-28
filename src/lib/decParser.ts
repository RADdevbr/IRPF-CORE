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

export interface DecResult {
  ano: string | null
  registros: DecRegistro[]
  lancamentos: Lancamento[]
  ndep: number
  linhas: string[]
  totalLinhas: number
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
  '33': {
    label: 'Lucros e dividendos',
    cnpj: [20, 33],
    nome: [34, 93],
    campos: [{ rotulo: 'Dividendo', ini: 94, fim: 106, alvo: 'divBR' }],
  },
}

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
  let ndep = 0

  linhas.forEach((l, i) => {
    const tipo = l.slice(0, 2)
    const cur = tipos.get(tipo)
    if (cur) cur.count += 1
    else tipos.set(tipo, { count: 1, amostra: l.slice(0, 60) })

    if (tipo === '25') ndep += 1

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

  return { ano, registros, lancamentos, ndep, linhas, totalLinhas: linhas.length }
}
