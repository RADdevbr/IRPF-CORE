// Persistência local: autosave do estado + cenários nomeados + export/import.
//
// Quem decide ONDE gravar é `armazenamento.ts` — inclusive a resposta "em lugar
// nenhum", que é o modo visita. Aqui não há mais `if (visita) return` espalhado:
// essa checagem campo a campo era o que deixava o cofre, o sync e o token da
// conta de fora da promessa.

import {
  armazenamentoLocal,
  PREFIXO,
  modoVisita,
  setModoVisita,
  chavesGravadas,
  apagarTudoDesteAparelho,
} from './armazenamento'

export { PREFIXO, modoVisita, setModoVisita, chavesGravadas, apagarTudoDesteAparelho }

const STATE_KEY = 'irpfm2027:state:v1'
const SCEN_KEY = 'irpfm2027:scenarios:v1'

import type { YtdConfig, DivGrid } from '../calc/ytd'
import type { Carteira } from '../calc/rendafixa'
import type { HoldingConfig } from '../calc/holding'
import type { Historico, Overrides, Aportes, Vinculos } from './historico'
import type { Entradas } from './consistencia'
import type { Operacao, EventoQuantidade, Posicao, Modalidade } from '../calc/bolsa'
import type { PapelNaCarteira } from './b3posicao'
import type { ArquivoB3 } from './b3acervo'
import type { Origem } from './origem'
import type { OverridesParametros } from '../calc/params'
import type { DeducoesLegais } from '../calc/declaracao'
import type { CategoriaDeducao } from './deducoes'

export type CdbMode = 'anual' | 'ytd' | 'carteira'

/**
 * Formato do estado salvo. Suba este número ao mudar o significado de um campo
 * (renomear, trocar unidade, remover) e ensine `migrarEstado` a converter — o
 * app lê arquivos de formatos anteriores e recusa, com aviso, os de formatos
 * futuros. Campo novo e opcional NÃO exige subir: o estado antigo continua
 * válido sem ele.
 *
 * 1 — formato original, sem o campo (tudo o que foi salvo até agora).
 * 2 — passa a carregar `schemaVersion` e a normalizar os primitivos na leitura.
 */
export const SCHEMA_VERSION = 2

export interface PersistedState {
  /** Ausente = formato 1, gravado antes de o app versionar o estado. */
  schemaVersion?: number
  vals: Record<string, number>
  ndep: number
  cdbA: number | null
  red: boolean
  aliqEmp: number
  limR: number
  // Projeção YTD (opcionais — cenários antigos podem não ter).
  mesRef?: number
  ytd?: Record<string, YtdConfig>
  divGrid?: DivGrid
  // Renda fixa detalhada (opcional).
  cdbMode?: CdbMode
  carteira?: Carteira
  // Comparador de holding (opcional).
  holding?: HoldingConfig
  // Projeção de vencimentos (opcional).
  maturity?: { anoBase: number; rendaRecorrente: number; horizonte: number }
  // Baseline do ano anterior (opcional).
  priorYear?: { aberto: boolean; vals: Record<string, number>; ndep: number }
  // Histórico plurianual das declarações (opcional).
  historico?: Historico
  // Correções manuais de classe por posição, e aportes informados por ano.
  classeOverrides?: Overrides
  aportes?: Aportes
  vinculos?: Vinculos
  /** Ligações automáticas desfeitas à mão — o app não as refaz. */
  vetados?: string[]
  /** Ligação automática entre anos. Ausente = ligada (é o padrão útil). */
  autoLigar?: boolean
  /** O que só a pessoa sabe, por ano: dívidas, entradas não recorrentes, gastos. */
  consistencia?: Entradas
  /** Lucros da própria PJ contam como trabalho na origem da renda. */
  dividendosSaoTrabalho?: boolean
  /** CDI/Selic/IPCA informados à mão — chave `indice:ano`, valor em fração. */
  benchmarks?: Record<string, number>
  /**
   * O que cada texto de movimentação/evento da B3 significa, respondido uma vez
   * na tela de import. Guardado porque o catálogo é grande e estável: no ano
   * seguinte só os tipos novos perguntam de novo.
   */
  b3?: Record<string, 'base' | 'isento' | 'ignorar' | 'indefinido'>
  /** O mesmo, para a carteira: que movimentação é compra, venda ou evento. */
  b3Carteira?: Record<string, PapelNaCarteira>
  /**
   * Quem é o PAGADOR de cada produto da B3, quando a pessoa discorda do palpite.
   *
   * O padrão agrupa pela raiz do ticker — PETR3 e PETR4 são a mesma companhia, e
   * o gatilho do Art. 6º-A conta o total pago pela mesma pessoa jurídica. Mas o
   * ticker não prova CNPJ, e nada garante que duas empresas não compartilhem a
   * raiz: por isso é sugestão, e a resposta de quem discorda fica guardada.
   *
   * Chave: o produto como vem no extrato. Valor: o nome do pagador. Produto
   * apontando para si mesmo = «não agrupe este».
   */
  b3Emissor?: Record<string, string>
  /**
   * Pagadores cujo dividendo de 2026 em diante veio BRUTO, sem retenção.
   *
   * O padrão é o contrário: a partir de 2026 o dividendo que passa de R$ 50 mil
   * no mês vem líquido de 10% (Art. 6º-A), e o app refaz o bruto — senão a base
   * sai menor e a retenção, que é dedução do próprio IRPFM, é jogada fora.
   *
   * Mas a lei tem uma saída que o arquivo não conta: lucro apurado e
   * distribuição aprovada antes da virada, paga depois, cai em 2026 pelo valor
   * cheio. Reconstituir esse criaria imposto pago que não existe. Quem sabe
   * disso — está no anúncio da companhia — marca o pagador aqui.
   *
   * Lista de exceções, e não mapa de respostas, porque não há o que confirmar
   * do lado do padrão: ausente da lista = lido como líquido.
   */
  b3DividendoBruto?: string[]
  /**
   * O pote de cada papel, por ticker, quando a pessoa confirma.
   *
   * Existe porque o sufixo 11 não separa FII (20%, sem isenção), ETF de ações
   * (15%, sem isenção) e unit (15%, com isenção): o app sugere o mais caro dos
   * três e a pessoa corrige. Mapa de respostas, e não lista, porque as três
   * escolhas são diferentes entre si — não há um padrão que dispense confirmar.
   */
  b3Modalidade?: Record<string, string>
  /**
   * Dias confirmados como day trade, na forma `TICKER@dd/mm/aaaa`.
   *
   * O extrato da B3 não marca modalidade, e comprar e vender o mesmo papel no
   * dia é indício, não prova (pode ser venda de posição antiga). Confirmado o
   * dia, só a QUANTIDADE CASADA vira day trade — o resto continua sendo venda
   * comum, com a isenção mensal que ela tem.
   */
  b3DayTrade?: string[]
  /**
   * IRRF que a corretora informou, por `ano·pagador`, mês a mês.
   *
   * O extrato traz o líquido e não traz o imposto; o informe de rendimentos
   * traz os dois. Onde ele existe, o app para de inferir a retenção a partir do
   * gatilho e usa o número informado — que é fato, não leitura.
   */
  b3IrrfInformado?: Record<string, number[]>
  /**
   * De onde veio cada número, pela mesma chave dos `vals`. Ausente = não
   * registrado (estado salvo antes deste campo existir), que é diferente de
   * digitado.
   */
  origem?: Record<string, Origem>
  /**
   * Deduções legais da declaração de ajuste anual, no ano.
   *
   * Não entram na base do IRPFM — entram no imposto DEVIDO, que é o que a Lei
   * 15.270/2025 manda abater. Ausente = nada informado, e aí o único abatimento
   * é a previdência oficial, que o app deriva do próprio pró-labore.
   */
  deducoes?: Partial<DeducoesLegais>
  /**
   * Em que linha da declaração entra cada beneficiário do Registro 26,
   * respondido uma vez. Mesmo arranjo do `b3`: o texto vem de fora, a resposta
   * fica guardada, e no ano seguinte só o que é novo pergunta de novo.
   */
  deducoesCategoria?: Record<string, CategoriaDeducao>
  /**
   * Tabelas fiscais trocadas à mão. INSS e IRRF de 2026 são estimativa aqui;
   * quando a portaria sair, ninguém deveria esperar um deploy para ter a conta
   * certa.
   */
  parametros?: OverridesParametros
  /**
   * Renda variável: as operações do ano e as duas leituras da lei que ainda
   * estão em aberto. Guarda a ENTRADA da apuração, nunca o resultado — o ganho
   * é sempre recalculado, para não congelar um número apurado com uma regra
   * que mudou depois.
   */
  bolsa?: {
    operacoes: Operacao[]
    eventos?: EventoQuantidade[]
    /** Posição em 31/12 do ano anterior, com custo médio de aquisição. */
    posicaoInicial?: Posicao[]
    prejuizoAnterior?: Partial<Record<Modalidade, number>>
    /** ⟨confirmar⟩ Ganho em bolsa entra na base do IRPFM? */
    entraNaBase: boolean
    /** ⟨confirmar⟩ A isenção mensal dos R$ 20 mil alcança o mínimo? */
    isentoEntraNaBase: boolean
  }
  /**
   * Provento lido da B3, por ano e por pagador.
   *
   * A grade de dividendos guarda UM ano — o que entra na conta do IRPFM. Mas o
   * extrato de movimentação traz vários, e até agora os anos que não eram o
   * ano-base eram lidos, aplicados e esquecidos. Sem eles não dá para
   * confrontar o que a corretora pagou com o que a declaração daquele ano
   * informou, que é a pergunta que sobra depois de conferir os bens.
   *
   * Guarda o mês a mês porque o gatilho do Art. 6º-A é mensal: um total anual
   * não permite refazer a retenção.
   *
   * Chave: o ano-base como texto.
   */
  proventosB3?: Record<string, { pagador: string; meses: number[] }[]>
  /**
   * Um registro por arquivo da B3 que já entrou: nome, o que era, anos, linhas
   * e o total lido por ano e por tipo.
   *
   * Existe por dois motivos que são o mesmo. Primeiro: sem ele, a lista do que
   * foi importado morria ao fechar o painel, e três meses depois não havia como
   * responder «de onde veio este número». Segundo: os dois relatórios da B3 se
   * conferem — o Consolidado tem o total impresso e não tem data, o Extrato tem
   * data e não tem total nenhum —, e essa conferência só é útil se sobreviver à
   * sessão. Quem importou o Consolidado em março e o Extrato em agosto precisa
   * ser avisado em agosto.
   *
   * Por isso guarda o total POR TIPO E POR ANO, não só o nome do arquivo: é o
   * bastante para refazer a comparação sem o arquivo em mãos.
   *
   * (O plano da auditoria chamava isto de `b3.arquivos`; aqui é campo irmão
   * porque `b3` já é o mapa de classificação.)
   */
  b3Arquivos?: ArquivoB3[]
}

export interface NamedScenario {
  name: string
  savedAt: string
  state: PersistedState
}

const num = (v: unknown, padrao: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : padrao

/** Só os pares chave→número finito; o resto do objeto é descartado. */
function somenteNumeros(o: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    Object.entries(o as Record<string, unknown>).forEach(([k, v]) => {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    })
  }
  return out
}

/**
 * Porta de entrada de todo estado que vem de fora da sessão: localStorage,
 * arquivo JSON importado, cofre sincronizado de outro aparelho. Recusa o que
 * não dá para usar (com mensagem que diz o quê) e normaliza os primitivos em
 * que o app indexa — um `mesRef` fora de 1..12, por exemplo, quebrava a
 * projeção inteira sem nenhum aviso.
 *
 * O que não é primitivo conhecido passa como está: campo novo em versão futura
 * do app não deve sumir só porque esta função não o conhecia.
 */
export function migrarEstado(bruto: unknown): PersistedState {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
    throw new Error('Arquivo inválido: o conteúdo não é um objeto JSON.')
  }
  const o = bruto as Record<string, unknown>
  const versao = num(o.schemaVersion, 1)
  if (versao > SCHEMA_VERSION) {
    throw new Error(
      `Arquivo gravado por uma versão mais nova do app (formato ${versao}; este lê até ${SCHEMA_VERSION}). Atualize a página e tente de novo.`,
    )
  }
  if (!o.vals || typeof o.vals !== 'object' || Array.isArray(o.vals)) {
    throw new Error('Arquivo inválido: falta o campo "vals" com as fontes de renda.')
  }

  const mesRef = Math.min(12, Math.max(1, Math.round(num(o.mesRef, 6))))
  return {
    ...(o as unknown as PersistedState),
    schemaVersion: SCHEMA_VERSION,
    vals: somenteNumeros(o.vals),
    ndep: Math.max(0, Math.round(num(o.ndep, 0))),
    cdbA: typeof o.cdbA === 'number' && Number.isFinite(o.cdbA) ? o.cdbA : null,
    red: Boolean(o.red),
    aliqEmp: num(o.aliqEmp, 0),
    limR: num(o.limR, 0.34),
    mesRef,
  }
}

export function loadState(): PersistedState | null {
  try {
    const raw = armazenamentoLocal().getItem(STATE_KEY)
    return raw ? migrarEstado(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function saveState(state: PersistedState): void {
  try {
    armazenamentoLocal().setItem(STATE_KEY, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }))
  } catch {
    /* armazenamento indisponível — ignora silenciosamente */
  }
}

export function loadScenarios(): NamedScenario[] {
  try {
    const raw = armazenamentoLocal().getItem(SCEN_KEY)
    const list = raw ? (JSON.parse(raw) as NamedScenario[]) : []
    if (!Array.isArray(list)) return []
    // Um cenário corrompido não pode levar os outros junto.
    return list.flatMap((s) => {
      try {
        return [{ ...s, state: migrarEstado(s?.state) }]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

export function saveScenarios(list: NamedScenario[]): void {
  try {
    armazenamentoLocal().setItem(SCEN_KEY, JSON.stringify(list))
  } catch {
    /* ignora */
  }
}

// Insere ou atualiza um cenário pelo nome. Devolve a nova lista.
export function upsertScenario(
  list: NamedScenario[],
  name: string,
  state: PersistedState,
  now: string,
): NamedScenario[] {
  const next = list.filter((s) => s.name !== name)
  next.push({ name, savedAt: now, state: { ...state, schemaVersion: SCHEMA_VERSION } })
  next.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return next
}

export function removeScenario(list: NamedScenario[], name: string): NamedScenario[] {
  return list.filter((s) => s.name !== name)
}

// Dispara o download de um arquivo JSON no navegador.
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Lê um arquivo escolhido pelo usuário e valida o formato mínimo.
export function readStateFile(file: File): Promise<PersistedState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(migrarEstado(JSON.parse(String(reader.result))))
      } catch (e) {
        reject(e instanceof Error ? e : new Error('JSON inválido.'))
      }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.readAsText(file)
  })
}
