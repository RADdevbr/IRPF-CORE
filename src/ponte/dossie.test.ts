import { describe, it, expect } from 'vitest'
import { montarDossie, dossieEmTexto, DOSSIE_VERSAO, CLASSES_DOSSIE, type EntradaDossie } from './dossie.js'
import { apurarSerie, MODALIDADES, type Operacao } from '../bolsa/bolsa.js'
import { REGIME } from '../historico/historico.js'
import { serieProventos, TIPOS_PROVENTO, type ProventoRecebido } from '../bolsa/proventos.js'

const compra = (ano: number, mes: number, ticker: string, q: number, p: number, dia?: number): Operacao => ({
  ano, mes, ticker, tipo: 'compra', quantidade: q, precoUnitario: p,
  ...(dia === undefined ? {} : { data: `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}` }),
})
const venda = (ano: number, mes: number, ticker: string, q: number, p: number, dia?: number): Operacao => ({
  ano, mes, ticker, tipo: 'venda', quantidade: q, precoUnitario: p,
  ...(dia === undefined ? {} : { data: `${String(dia).padStart(2, '0')}/${String(mes).padStart(2, '0')}/${ano}` }),
})
const prov = (ano: number, mes: number, ticker: string, valor: number, tipo: ProventoRecebido['tipo'] = 'dividendo'): ProventoRecebido =>
  ({ ano, mes, ticker, pagador: ticker.slice(0, 4), tipo, valor, ir: 0 })

const AGORA = '2026-09-13T12:00:00.000Z'

function dossie(extra: Partial<EntradaDossie> = {}, operacoes?: Operacao[], recebidos: ProventoRecebido[] = []) {
  const ops = operacoes ?? [
    compra(2025, 2, 'PETR4', 100, 30, 5),
    compra(2025, 8, 'HGLG11', 10, 150, 12),
    compra(2026, 1, 'VALE3', 50, 60, 20),
    venda(2026, 4, 'VALE3', 20, 75, 8),
  ]
  const apuracoes = apurarSerie({ operacoes: ops })
  return montarDossie({
    apuracoes,
    operacoes: ops,
    proventos: serieProventos(recebidos),
    posicao: apuracoes[apuracoes.length - 1]?.posicaoFinal ?? [],
    classes: { PETR4: 'acao', HGLG11: 'fii', VALE3: 'acao' },
    geradoPor: 'IRPF-calc',
    agora: AGORA,
    ...extra,
  })
}

const perto = (a: number, b: number) => expect(a).toBeCloseTo(b, 5)

// ------------------------------------------------------ o invariante da anonimização

/**
 * TODA chave que pode existir no dossiê, escrita à mão.
 *
 * Lista de PERMITIDAS, e não de proibidas, de propósito: uma lista de proibidas
 * falharia em silêncio no dia em que um campo novo entrasse, que é exatamente o
 * dia em que ela precisaria funcionar. Esta quebra o build — e quebrar o build é
 * o comportamento certo, porque significa que alguém tem de DECIDIR que o campo
 * novo pode sair de casa.
 */
const CHAVES_PERMITIDAS = new Set([
  // topo
  'manifesto', 'contexto', 'carteira', 'vendas', 'proventos', 'resumo',
  // manifesto
  'versao', 'geradoEm', 'geradoPor', 'de', 'ate', 'modo', 'incluido', 'excluido', 'ressalvas',
  // contexto
  'referencia', 'pesoDaBolsa',
  // carteira
  'ticker', 'classe', 'precoMedio', 'proporcao', 'primeiraCompra', 'ultimaCompra',
  'resultadoRealizado', 'rendimento12m', 'rendimentoPeriodo', 'semCusto',
  // vendas
  'data', 'modalidade', 'precoVenda', 'precoMedioNaVenda', 'resultadoPct', 'parteDaPosicao', 'isenta',
  // proventos
  'meses', 'porAno', 'porTicker', 'ano', 'mes', 'rendimento', 'porTipo', 'periodo', 'ultimos12m',
  ...TIPOS_PROVENTO,
  // resumo
  'papeis', 'porClasse', 'concentracao', 'top1', 'top5', 'hhi', 'resultadoPorAno', 'giro',
])

const chavesDe = (v: unknown, achadas = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => chavesDe(x, achadas))
  else if (v !== null && typeof v === 'object') {
    Object.entries(v as Record<string, unknown>).forEach(([k, x]) => {
      achadas.add(k)
      chavesDe(x, achadas)
    })
  }
  return achadas
}

const textosDe = (v: unknown, achados: string[] = []): string[] => {
  if (typeof v === 'string') achados.push(v)
  else if (Array.isArray(v)) v.forEach((x) => textosDe(x, achados))
  else if (v !== null && typeof v === 'object') Object.values(v).forEach((x) => textosDe(x, achados))
  return achados
}

/**
 * Um dossiê com TODOS os ramos preenchidos: contexto, provento dos quatro
 * tipos, venda e papel sem custo.
 *
 * Existe porque a primeira versão destes testes usava o dossiê comum, que não
 * tem provento — e uma allowlist que nunca vê `porTipo` não está guardando
 * `porTipo`. Um invariante sobre um documento pela metade guarda metade.
 */
const completo = () =>
  dossie(
    {
      contexto: {
        referencia: '2025-12-31',
        porClasse: [{ classe: 'tesouro', proporcao: 0.7 }, { classe: 'acoes', proporcao: 0.3 }],
        pesoDaBolsa: 0.3,
      },
    },
    [
      compra(2025, 2, 'PETR4', 100, 30, 5),
      compra(2026, 1, 'VALE3', 50, 60, 20),
      venda(2026, 4, 'VALE3', 20, 75, 8),
      venda(2026, 5, 'MGLU3', 10, 9), // sem custo: o ramo do papel listado fora
    ],
    [
      prov(2026, 3, 'PETR4', 150, 'dividendo'),
      prov(2026, 3, 'PETR4', 90, 'jcp'),
      prov(2026, 6, 'HGLG11', 75, 'rendimento'),
      prov(2026, 7, 'PETR4', 12, 'outro'),
    ],
  )

describe('o invariante da anonimização', () => {
  it('nenhuma chave sai do dossiê sem estar na lista de permitidas', () => {
    const achadas = chavesDe(JSON.parse(JSON.stringify(completo())))
    expect([...achadas].filter((k) => !CHAVES_PERMITIDAS.has(k))).toEqual([])
    // e o documento do teste tem que ser grande o bastante para a lista valer:
    // uma allowlist que nunca vê `porTipo` não está guardando `porTipo`.
    ;['porTipo', 'rendimento', 'mes', 'semCusto', 'contexto', 'isenta', 'hhi'].forEach((k) =>
      expect(achadas.has(k)).toBe(true),
    )
  })

  it('fora do manifesto, só há ticker, data e vocabulário fechado', () => {
    const d = completo()
    const { manifesto: _, ...resto } = d
    const permitido = (t: string) =>
      /^[A-Z0-9]{1,10}$/.test(t) || // ticker
      /^\d{4}-\d{2}(-\d{2})?$/.test(t) || // data
      (CLASSES_DOSSIE as readonly string[]).includes(t) ||
      (MODALIDADES as readonly string[]).includes(t) ||
      // a classe do contexto, que `normalizarContexto` prende ao catálogo
      Object.keys(REGIME).includes(t)
    const textos = textosDe(resto)
    expect(textos.length).toBeGreaterThan(10) // não passa por estar vazio
    expect(textos.filter((t) => !permitido(t))).toEqual([])
  })

  it('CPF, nome e conta metidos na classe de um papel não chegam ao arquivo', () => {
    const sujeira = {
      PETR4: '123.456.789-01',
      HGLG11: 'FULANO DE TAL',
      VALE3: 'XP INVESTIMENTOS CCTVM · conta 1234567-8',
    }
    const d = dossie({ classes: sujeira })
    const texto = JSON.stringify(d)
    Object.values(sujeira).forEach((s) => expect(texto).not.toContain(s))
    // e cada um deles virou `outro`, em vez de sumir com o papel junto
    expect(d.carteira.every((p) => p.classe === 'outro')).toBe(true)
  })

  it('quantidade e custo total não existem em campo nenhum', () => {
    const d = dossie()
    const chaves = chavesDe(JSON.parse(JSON.stringify(d)))
    expect(chaves.has('quantidade')).toBe(false)
    expect(chaves.has('custoTotal')).toBe(false)
    expect(chaves.has('custoBaixado')).toBe(false)
    expect(chaves.has('valorVenda')).toBe(false)
    expect(chaves.has('pagador')).toBe(false)
  })
})

// ------------------------------------------------------------------ a carteira

describe('carteira', () => {
  it('a proporção soma 1 e é medida sobre o custo', () => {
    const d = dossie()
    // PETR4 3.000 · HGLG11 1.500 · VALE3 30×60 = 1.800 → total 6.300
    perto(d.carteira.reduce((s, p) => s + p.proporcao, 0), 1)
    perto(d.carteira.find((p) => p.ticker === 'PETR4')!.proporcao, 3000 / 6300)
    perto(d.carteira.find((p) => p.ticker === 'VALE3')!.proporcao, 1800 / 6300)
  })

  it('o preço médio é o único absoluto, e é por unidade', () => {
    const d = dossie()
    perto(d.carteira.find((p) => p.ticker === 'PETR4')!.precoMedio, 30)
    perto(d.carteira.find((p) => p.ticker === 'HGLG11')!.precoMedio, 150)
  })

  it('vem ordenada por peso, que é como se lê risco', () => {
    const pesos = dossie().carteira.map((p) => p.proporcao)
    expect(pesos).toEqual([...pesos].sort((a, b) => b - a))
  })

  it('traz o mês da primeira e da última compra', () => {
    const d = dossie({}, [
      compra(2021, 3, 'PETR4', 100, 20),
      compra(2024, 11, 'PETR4', 100, 40),
    ])
    expect(d.carteira[0]).toMatchObject({ primeiraCompra: '2021-03', ultimaCompra: '2024-11' })
  })

  it('posição herdada, sem compra nos arquivos, sai sem data em vez de com data inventada', () => {
    const apuracoes = apurarSerie({ operacoes: [], posicaoInicial: [{ ticker: 'PETR4', quantidade: 100, custoMedio: 20 }], ate: 2026 })
    const d = montarDossie({
      apuracoes, operacoes: [], proventos: serieProventos([]),
      posicao: apuracoes[apuracoes.length - 1].posicaoFinal,
      geradoPor: 'teste', agora: AGORA,
    })
    expect(d.carteira[0].primeiraCompra).toBeUndefined()
    expect(d.carteira[0].ultimaCompra).toBeUndefined()
  })

  it('o resultado realizado é sobre o custo do que saiu', () => {
    const d = dossie()
    // VALE3: vendeu 20 a 75, custo 60 → 300 sobre 1.200
    perto(d.carteira.find((p) => p.ticker === 'VALE3')!.resultadoRealizado!, 0.25)
    expect(d.carteira.find((p) => p.ticker === 'PETR4')!.resultadoRealizado).toBeNull()
  })

  it('papel sem custo conhecido entra LISTADO e fora de toda conta', () => {
    const ops = [compra(2026, 1, 'PETR4', 100, 30), venda(2026, 5, 'MGLU3', 50, 10)]
    const d = dossie({}, ops)
    expect(d.resumo.semCusto).toEqual(['MGLU3'])
    const mglu = d.carteira.find((p) => p.ticker === 'MGLU3')!
    expect(mglu.semCusto).toBe(true)
    perto(mglu.proporcao, 0)
    // e a proporção do resto continua somando 1
    perto(d.carteira.filter((p) => p.semCusto !== true).reduce((s, p) => s + p.proporcao, 0), 1)
  })
})

describe('resumo', () => {
  it('carteira de um papel só tem HHI 1 e top1 1', () => {
    const d = dossie({}, [compra(2026, 1, 'PETR4', 100, 30)])
    perto(d.resumo.concentracao.hhi, 1)
    perto(d.resumo.concentracao.top1, 1)
    perto(d.resumo.concentracao.top5, 1)
  })

  it('o peso por classe soma 1', () => {
    perto(dossie().resumo.porClasse.reduce((s, c) => s + c.proporcao, 0), 1)
  })

  it('o resultado do ano é sobre o custo baixado no ano', () => {
    const porAno = dossie().resumo.resultadoPorAno
    expect(porAno.find((a) => a.ano === 2025)!.resultadoPct).toBeNull()
    perto(porAno.find((a) => a.ano === 2026)!.resultadoPct!, 0.25)
  })

  it('carteira vazia gera dossiê válido, e não divisão por zero', () => {
    const d = montarDossie({
      apuracoes: [], operacoes: [], proventos: serieProventos([]), posicao: [],
      geradoPor: 'teste', agora: AGORA,
    })
    expect(d.carteira).toEqual([])
    expect(d.resumo.concentracao).toEqual({ top1: 0, top5: 0, hhi: 0 })
    expect(Number.isFinite(d.resumo.concentracao.hhi)).toBe(true)
    expect(() => dossieEmTexto(d)).not.toThrow()
  })
})

describe('vendas', () => {
  it('a data vira aaaa-mm-dd quando o extrato trouxe o dia', () => {
    expect(dossie().vendas[0].data).toBe('2026-04-08')
  })

  it('sem dia no extrato, cai no mês em vez de inventar um dia', () => {
    const d = dossie({}, [compra(2026, 1, 'VALE3', 50, 60), venda(2026, 4, 'VALE3', 20, 75)])
    expect(d.vendas[0].data).toBe('2026-04')
  })

  it('leva preço e custo médio por unidade, e resultado em percentual', () => {
    const v = dossie().vendas[0]
    expect(v).toMatchObject({ ticker: 'VALE3', precoVenda: 75, precoMedioNaVenda: 60 })
    perto(v.resultadoPct!, 0.25)
    perto(v.parteDaPosicao, 20 / 50)
  })
})

describe('proventos', () => {
  const recebidos = [
    prov(2026, 3, 'PETR4', 150),
    prov(2026, 3, 'PETR4', 90, 'jcp'),
    prov(2026, 6, 'HGLG11', 75, 'rendimento'),
  ]

  it('vêm em rendimento sobre o custo da carteira, nunca em reais', () => {
    const d = dossie({}, undefined, recebidos)
    // custo total 6.300; março teve 240
    perto(d.proventos.meses.find((m) => m.mes === 3)!.rendimento!, 240 / 6300)
    perto(d.proventos.porAno[0].porTipo.jcp!, 90 / 6300)
  })

  it('por papel, em 12 meses e no período', () => {
    const d = dossie({}, undefined, recebidos)
    // HGLG11 custou 1.500 e recebeu 75
    const hglg = d.proventos.porTicker.find((t) => t.ticker === 'HGLG11')!
    perto(hglg.periodo!, 75 / 1500)
    perto(hglg.ultimos12m!, 75 / 1500)
  })
})

describe('manifesto', () => {
  it('diz a versão, o modo e o período que o dossiê cobre', () => {
    const d = dossie({}, undefined, [prov(2024, 5, 'PETR4', 10)])
    expect(d.manifesto).toMatchObject({ versao: DOSSIE_VERSAO, modo: 'relativo', geradoEm: AGORA })
    expect(d.manifesto.de).toBe('2024-05')
    expect(d.manifesto.ate).toBe('2026-04')
  })

  it('sem histórico, não há contexto — e a ressalva diz isso', () => {
    const d = dossie()
    expect(d.contexto).toBeUndefined()
    expect(d.manifesto.ressalvas.some((r) => r.includes('só a bolsa'))).toBe(true)
  })

  it('com histórico, o contexto entra e a ressalva some', () => {
    const contexto = {
      referencia: '2025-12-31',
      porClasse: [{ classe: 'tesouro' as const, proporcao: 0.7 }, { classe: 'acoes' as const, proporcao: 0.3 }],
      pesoDaBolsa: 0.3,
    }
    const d = dossie({ contexto })
    expect(d.contexto).toEqual(contexto)
    expect(d.manifesto.ressalvas.some((r) => r.includes('só a bolsa'))).toBe(false)
  })

  it('classe fora do catálogo vira «desconhecido», e duas viram uma fatia só', () => {
    const d = dossie({
      contexto: {
        referencia: '2025-12-31',
        porClasse: [
          { classe: 'tesouro', proporcao: 0.5 },
          // vocabulário que não existe — e, no pior caso, texto de fora
          { classe: 'CARTEIRA DE FULANO' as never, proporcao: 0.3 },
          { classe: 'conta 1234567-8' as never, proporcao: 0.2 },
        ],
        pesoDaBolsa: 0.5,
      },
    })
    expect(d.contexto!.porClasse).toEqual([
      { classe: 'tesouro', proporcao: 0.5 },
      { classe: 'desconhecido', proporcao: 0.5 },
    ])
    expect(JSON.stringify(d)).not.toContain('FULANO')
    expect(JSON.stringify(d)).not.toContain('1234567-8')
  })

  it('referência que não é data sai vazia, em vez de sugerir precisão que não há', () => {
    const d = dossie({
      contexto: { referencia: 'ontem', porClasse: [{ classe: 'acoes', proporcao: 1 }], pesoDaBolsa: 1 },
    })
    expect(d.contexto!.referencia).toBe('')
  })

  it('a ressalva do papel sem custo aparece com a contagem', () => {
    const d = dossie({}, [compra(2026, 1, 'PETR4', 100, 30), venda(2026, 5, 'MGLU3', 50, 10)])
    expect(d.manifesto.ressalvas.some((r) => r.includes('1 papel(is) sem custo'))).toBe(true)
  })
})

describe('o briefing em texto', () => {
  it('leva a fórmula que converte peso de custo em peso de mercado', () => {
    const t = dossieEmTexto(dossie())
    expect(t).toContain('proporcao × (preçoHoje ÷ precoMedio)')
  })

  it('põe as ressalvas antes das tabelas', () => {
    const t = dossieEmTexto(dossie())
    expect(t.indexOf('Antes de concluir')).toBeLessThan(t.indexOf('## Carteira'))
  })

  it('todo R$ impresso é um preço unitário que está no dossiê', () => {
    const d = completo()
    const precos = new Set<string>([
      ...d.carteira.map((p) => p.precoMedio),
      ...d.vendas.map((v) => v.precoVenda),
      ...d.vendas.map((v) => v.precoMedioNaVenda),
    ].map((v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 })))
    const impressos = dossieEmTexto(d).match(/R\$\s?[\d.,]+/g) ?? []
    expect(impressos.length).toBeGreaterThan(0)
    // Nenhum valor em reais chega ao texto sem ser preço por unidade: não há
    // total de carteira, de ganho nem de provento para somar de volta.
    expect(impressos.filter((v) => !precos.has(v.replace(/\s/, '\u00a0')))).toEqual([])
  })
})

// ------------------------------------------- o que a revisão do lote achou

describe('o que não pode vazar nem afirmar', () => {
  it('tipo de provento fora do catálogo NÃO vira chave do arquivo', () => {
    // Era o furo mais grave: `porTipo` usa o tipo como chave de objeto, e
    // `montarDossie` copiava as chaves que achasse. Um rótulo vindo do texto
    // cru da B3 atravessava a série inteira até o dossiê exportado — o mesmo
    // arquivo cujo módulo diz que o contexto é «a única porta por onde chegaria
    // um rótulo de fora».
    const sujo = {
      ano: 2026, mes: 3, ticker: 'PETR4', pagador: 'PETR',
      tipo: 'JCP · conta 1234567-8 FULANO', valor: 100, ir: 0,
    } as unknown as ProventoRecebido
    const d = dossie({}, undefined, [sujo, prov(2026, 4, 'PETR4', 50)])
    const texto = JSON.stringify(d)
    expect(texto).not.toContain('FULANO')
    expect(texto).not.toContain('1234567-8')
    expect(Object.keys(d.proventos.porAno[0].porTipo).sort()).toEqual([...TIPOS_PROVENTO].sort())
  })

  it('sem custo conhecido, o rendimento é null e não 0 — zero é afirmação', () => {
    // Vendeu a carteira inteira: `custoTotal` é 0, e R$ 500 de dividendo saíam
    // como 0,0% — enquanto o `porTicker` do mesmo arquivo dizia `null`.
    const d = dossie({}, [compra(2025, 1, 'A', 100, 10), venda(2026, 2, 'A', 100, 45)], [prov(2026, 3, 'A', 500)])
    expect(d.carteira).toEqual([])
    expect(d.proventos.porAno[0].rendimento).toBeNull()
    expect(d.resumo.resultadoPorAno.find((a) => a.ano === 2026)!.giro).toBeNull()
  })

  it('data impossível cai para o mês, em vez de sair como está', () => {
    const ops = [compra(2026, 1, 'A', 100, 10), { ...venda(2026, 5, 'A', 50, 20), data: '31/13/2026' }]
    expect(dossie({}, ops).vendas[0].data).toBe('2026-05')
  })

  it('data que discorda do mês da venda também cai para o mês', () => {
    // Senão o razão diz junho e todo agregado do mesmo arquivo diz maio.
    const ops = [compra(2026, 1, 'A', 100, 10), { ...venda(2026, 5, 'A', 50, 20), data: '03/06/2026' }]
    expect(dossie({}, ops).vendas[0].data).toBe('2026-05')
  })

  it('o peso por classe do contexto é renormalizado, não só aparado', () => {
    const d = dossie({
      contexto: {
        referencia: '2025-12-31',
        porClasse: [{ classe: 'tesouro', proporcao: 0.8 }, { classe: 'acoes', proporcao: 0.8 }],
        pesoDaBolsa: 0.5,
      },
    })
    perto(d.contexto!.porClasse.reduce((s, c) => s + c.proporcao, 0), 1)
  })

  it('o briefing escreve número em pt-BR, sem misturar ponto e vírgula', () => {
    const t = dossieEmTexto(dossie({}, undefined, [prov(2026, 3, 'PETR4', 150)]))
    // nenhum percentual com ponto decimal numa linha de tabela
    expect(t).not.toMatch(/\d+\.\d+%/)
    expect(t).toMatch(/HHI \d+,\d{3}/)
  })

  it('o briefing usa o nome das coisas, não o código', () => {
    const t = dossieEmTexto(dossie({}, undefined, [prov(2026, 3, 'PETR4', 150, 'jcp')]))
    expect(t).toContain('Juros sobre capital próprio')
    expect(t).toContain('Ação')
    expect(t).not.toMatch(/\| acao \|/)
  })
})
