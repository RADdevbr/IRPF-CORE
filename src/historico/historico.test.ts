import { describe, it, expect } from 'vitest'
import {
  classificaPatrimonio,
  classificaPosicao,
  REGIME,
  somaPorAlvo,
  idPosicao,
  idPagador,
  rendaPorPagador,
  pagadoresDoHistorico,
  rendaPorPagadorDoHistorico,
  LEITURA_ATUAL,
  montarDeclaracao,
  seriePatrimonio,
  cagr,
  porClasse,
  upsertDeclaracao,
  removerAno,
  reatribuirAno,
  aplicarOverrides,
  aplicarVinculos,
  posicoesDoAno,
  anosDisponiveis,
  normalizaHistorico,
  baseEstocada,
  serieDaPosicao,
  chaveAporte,
  type Historico,
  rotuloCodigo,
  chaveCodigo,
  idsPorCodigo,
  COMO_VALORA,
  segueMercado,
  pgblAportado,
} from './historico.js'
import type { DecResult, Lancamento, Pagamento, Posicao } from '../dec/decParser.js'

const lanc = (alvo: string, valor: number): Lancamento => ({
  linha: 1,
  tipo: '84',
  tipoLabel: 'x',
  fonte: 'Fonte',
  cnpj: '',
  rotulo: 'Rendimento',
  valor,
  alvo,
})

const pos = (descricao: string, saldoAtual: number, saldoAnterior = 0, codigo = '99', subcodigo = '01'): Posicao => ({
  linha: 1,
  cdBem: '00',
  codigo,
  subcodigo,
  bruta: `27BENS            ${descricao}`,
  descricao,
  saldoAnterior,
  saldoAtual,
  tipoCarteira: 'cdb',
})

const dec = (
  ano: string | null,
  lancamentos: Lancamento[],
  posicoes: Posicao[],
  ndep = 0,
  pagamentos: Pagamento[] = [],
): DecResult => ({
  ano,
  registros: [],
  lancamentos,
  posicoes,
  pagamentos,
  ndep,
  linhas: [],
  totalLinhas: 0,
})

const pagou = (beneficiario: string, valor: number, naoDedutivel = 0): Pagamento => ({
  linha: 1,
  codigo: '36',
  beneficiario,
  documento: '',
  valor,
  naoDedutivel,
  bruta: '',
})

describe('classificação do patrimônio', () => {
  it('reconhece as classes que decidem o regime', () => {
    expect(classificaPatrimonio('CDB BANCO X VENC 2027')).toBe('cdb')
    expect(classificaPatrimonio('TESOURO IPCA+ 2029')).toBe('tesouro')
    expect(classificaPatrimonio('LCA BANCO Y')).toBe('lci')
    expect(classificaPatrimonio('CRI SETOR IMOBILIARIO')).toBe('cri')
    expect(classificaPatrimonio('DEBENTURE INCENTIVADA XPTO')).toBe('debentureInc')
    expect(classificaPatrimonio('POUPANCA BANCO Z')).toBe('poupanca')
    expect(classificaPatrimonio('APARTAMENTO RUA TAL 120M2')).toBe('imovel')
    expect(classificaPatrimonio('ACOES PETR4 B3')).toBe('acoes')
    expect(classificaPatrimonio('PGBL SEGURADORA')).toBe('previdencia')
  })

  it('não chuta: bem irreconhecível NÃO entra como base do IRPFM', () => {
    const c = classificaPatrimonio('BEM ESQUISITO SEM NOME CLARO')
    expect(c).toBe('desconhecido')
    expect(REGIME[c]).toBe('depende')
  })

  it('separa o que a lei já resolveu do que ainda não', () => {
    expect(REGIME.cdb).toBe('inBase')
    expect(REGIME.tesouro).toBe('inBase')
    expect(REGIME.lci).toBe('foraBase')
    expect(REGIME.poupanca).toBe('foraBase')
    expect(REGIME.acoes).toBe('depende')
    expect(REGIME.imovel).toBe('depende')
  })
})

describe('soma por destino', () => {
  it('agrupa lançamentos e ignora os sem destino', () => {
    const vals = somaPorAlvo([lanc('cdb', 1000), lanc('cdb', 500), lanc('divBR', 200), lanc('', 999)])
    expect(vals).toEqual({ cdb: 1500, divBR: 200 })
  })
})

describe('identidade da posição entre anos', () => {
  it('sobrevive a pontuação e espaço extra — é o que liga a mesma aplicação ano a ano', () => {
    expect(idPosicao('CDB  Banco X - venc. 03/2027', 'cdb')).toBe(idPosicao('cdb banco x venc 03 2027', 'cdb'))
  })

  it('separa bens de classes diferentes com a mesma descrição', () => {
    expect(idPosicao('BANCO X', 'cdb')).not.toBe(idPosicao('BANCO X', 'poupanca'))
  })
})

describe('montagem da declaração', () => {
  it('calcula a base do ano e deriva o ano-base do exercício', () => {
    const d = montarDeclaracao(
      dec('2026', [lanc('divBR', 800_000), lanc('cdb', 100_000)], [pos('CDB BANCO X', 500_000)]),
      'IRPF2026.DEC',
      '2026-08-23T00:00:00.000Z',
    )!
    expect(d.exercicio).toBe(2026)
    expect(d.anoBase).toBe(2025)
    expect(d.base).toBe(900_000)
    // O imposto do ano não sai daqui: exige o cálculo inteiro do IRPFM, que é
    // assunto do app de estimativa. Ver `Declaracao.irpfm`.
    expect(d.irpfm).toBeUndefined()
    expect(d.patrimonio).toBe(500_000)
    expect(d.posicoes[0].regime).toBe('inBase')
  })

  it('soma na base só o que a lista de fontes manda somar', () => {
    const d = montarDeclaracao(
      dec('2024', [lanc('cdb', 400_000), lanc('divFII', 90_000)], []),
      'x.DEC',
      'agora',
    )!
    // divFII é isento por lei (`base: false` em `fiscal/fontes.ts`): entra no
    // histórico, não entra na base.
    expect(d.base).toBe(400_000)
  })

  it('devolve null quando o ano não pôde ser lido', () => {
    expect(montarDeclaracao(dec(null, [], []), 'x.DEC', 'agora')).toBeNull()
  })

  it('aceita o ano corrigido à mão quando o arquivo engana', () => {
    const d = montarDeclaracao(dec('1999', [], []), 'x.DEC', 'agora', 2023)!
    expect(d.anoBase).toBe(2022)
  })
})

describe('séries do histórico', () => {
  const montar = (): Historico => {
    let h: Historico = {}
    h = upsertDeclaracao(
      h,
      montarDeclaracao(
        dec('2024', [lanc('cdb', 500_000)], [pos('CDB BANCO X', 400_000), pos('LCA BANCO Y', 300_000), pos('APARTAMENTO', 300_000)]),
        'a.DEC',
        'agora',
      )!,
    )
    h = upsertDeclaracao(
      h,
      montarDeclaracao(
        dec('2026', [lanc('cdb', 700_000)], [pos('CDB BANCO X', 800_000), pos('LCA BANCO Y', 400_000), pos('APARTAMENTO', 400_000)]),
        'b.DEC',
        'agora',
      )!,
    )
    return h
  }

  it('empilha o patrimônio por regime, em ordem cronológica', () => {
    const s = seriePatrimonio(montar())
    expect(s.map((p) => p.anoBase)).toEqual([2023, 2025])
    expect(s[0]).toMatchObject({ inBase: 400_000, foraBase: 300_000, depende: 300_000, total: 1_000_000 })
    expect(s[1]).toMatchObject({ inBase: 800_000, foraBase: 400_000, depende: 400_000, total: 1_600_000 })
  })

  it('calcula o CAGR entre o primeiro e o último ano', () => {
    const c = cagr(seriePatrimonio(montar()))!
    // 1,0M → 1,6M em 2 anos = 26,49% a.a.
    expect(c).toBeCloseTo(Math.pow(1.6, 1 / 2) - 1, 6)
  })

  it('não inventa CAGR com um ano só', () => {
    expect(cagr(seriePatrimonio(removerAno(montar(), 2023)))).toBeNull()
  })

  it('agrupa o ano mais recente por classe, com o regime junto', () => {
    const c = porClasse(montar())
    expect(c[0]).toEqual({ classe: 'cdb', regime: 'inBase', total: 800_000 })
    expect(c.find((x) => x.classe === 'lci')).toEqual({ classe: 'lci', regime: 'foraBase', total: 400_000 })
    expect(c.find((x) => x.classe === 'imovel')?.regime).toBe('depende')
  })

  it('reimportar o mesmo ano substitui em vez de duplicar', () => {
    let h = montar()
    h = upsertDeclaracao(h, montarDeclaracao(dec('2026', [lanc('cdb', 10)], []), 'c.DEC', 'agora')!)
    expect(Object.keys(h)).toHaveLength(2)
    expect(h['2025'].base).toBe(10)
  })
})

describe('correção manual da classe', () => {
  const montar = () => {
    let h: Historico = {}
    for (const [ex, saldo] of [[2025, 300_000], [2026, 500_000]] as const) {
      h = upsertDeclaracao(h, montarDeclaracao(dec(String(ex), [], [pos('BEM SEM NOME CLARO', saldo)]), 'x.DEC', 'agora')!)
    }
    return h
  }

  it('uma correção arruma a série inteira, não só o ano visível', () => {
    const h = montar()
    const id = h['2025'].posicoes[0].id
    expect(h['2025'].posicoes[0].regime).toBe('depende')

    const corrigido = aplicarOverrides(h, { [id]: 'cdb' })
    expect(corrigido['2024'].posicoes[0].regime).toBe('inBase')
    expect(corrigido['2025'].posicoes[0].regime).toBe('inBase')
  })

  it('sem correções, devolve o histórico intocado', () => {
    const h = montar()
    expect(aplicarOverrides(h, {})).toBe(h)
  })
})

describe('base estocada', () => {
  const montar = () => {
    let h: Historico = {}
    // CDB: 300k → 400k → 600k. Sem aporte informado, o crescimento inteiro conta.
    h = upsertDeclaracao(h, montarDeclaracao(dec('2025', [], [pos('CDB BANCO X', 400_000, 300_000)]), 'a.DEC', 'agora')!)
    h = upsertDeclaracao(h, montarDeclaracao(dec('2026', [], [pos('CDB BANCO X', 600_000, 400_000)]), 'b.DEC', 'agora')!)
    return h
  }

  it('acumula o crescimento das posições que caem na base', () => {
    const r = baseEstocada(montar())
    expect(r.total).toBe(300_000) // 100k em 2024 + 200k em 2025
    expect(r.algumEstimado).toBe(true)
    expect(r.itens[0].porAno.map((a) => a.anoBase)).toEqual([2024, 2025])
  })

  it('aporte informado sai da conta — e a linha deixa de ser estimativa', () => {
    const h = montar()
    const id = h['2025'].posicoes[0].id
    const r = baseEstocada(h, { [chaveAporte(id, 2024)]: 100_000, [chaveAporte(id, 2025)]: 150_000 })
    expect(r.total).toBe(50_000) // só o que sobrou de rendimento
    expect(r.algumEstimado).toBe(false)
  })

  it('não deixa o embutido ficar negativo quando o aporte supera o crescimento', () => {
    const h = montar()
    const id = h['2025'].posicoes[0].id
    const r = baseEstocada(h, { [chaveAporte(id, 2024)]: 999_000, [chaveAporte(id, 2025)]: 999_000 })
    expect(r.total).toBe(0)
  })

  it('ignora o que está fora da base — LCA não estoca base de IRPFM', () => {
    let h: Historico = {}
    h = upsertDeclaracao(h, montarDeclaracao(dec('2026', [], [pos('LCA BANCO Y', 500_000, 300_000)]), 'x.DEC', 'agora')!)
    expect(baseEstocada(h).total).toBe(0)
  })

  it('acompanha a mesma posição entre anos pelo id', () => {
    const h = montar()
    const id = h['2025'].posicoes[0].id
    expect(serieDaPosicao(h, id).map((p) => p.saldo)).toEqual([400_000, 600_000])
  })
})

describe('arquivos de anos antigos', () => {
  it('registra o que foi lido, para dar o que conversar quando o leiaute muda', () => {
    const d = montarDeclaracao(
      { ...dec('2021', [lanc('cdb', 1000)], [pos('CDB', 5000)]), registros: [{ tipo: '27', count: 3, amostra: '' }], totalLinhas: 42 },
      'IRPF2021.DEC',
      'agora',
    )!
    expect(d.diagnostico).toEqual({
      registros: [{ tipo: '27', count: 3 }],
      lancamentos: 1,
      posicoes: 1,
      totalLinhas: 42,
      anoDetectado: true,
    })
  })

  it('importa com o ano informado à mão quando o arquivo não diz qual é', () => {
    const d = montarDeclaracao(dec(null, [lanc('cdb', 1000)], []), 'antigo.DEC', 'agora', 2021)!
    expect(d.anoBase).toBe(2020)
    expect(d.diagnostico.anoDetectado).toBe(false)
  })

  it('não perde o rendimento de um arquivo antigo só porque o ano veio à mão', () => {
    const d = montarDeclaracao(dec(null, [lanc('cdb', 700_000)], []), 'antigo.DEC', 'agora', 2021)!
    // A base é o que se perdia: o arquivo sem ano detectado entrava no
    // histórico com rendimento zero.
    expect(d.base).toBe(700_000)
  })
})

describe('corrigir o ano depois de importado', () => {
  const base = () =>
    upsertDeclaracao({}, montarDeclaracao(dec('2000', [lanc('cdb', 90_000)], [pos('CDB', 250_000)]), 'antigo.DEC', 'agora')!)

  it('move a declaração para o ano certo, sem perder os dados', () => {
    const h = base()
    expect(Object.keys(h)).toEqual(['1999'])

    const corrigido = reatribuirAno(h, 1999, 2021)
    expect(Object.keys(corrigido)).toEqual(['2020'])
    expect(corrigido['2020'].exercicio).toBe(2021)
    expect(corrigido['2020'].base).toBe(90_000)
    expect(corrigido['2020'].posicoes[0].saldoAtual).toBe(250_000)
  })

  it('ignora pedido para um ano que não está no histórico', () => {
    const h = base()
    expect(reatribuirAno(h, 2015, 2021)).toBe(h)
  })
})

describe('estado gravado por versões anteriores', () => {
  // Declaração como a fase A gravava: sem `diagnostico`, sem `codigo` nas posições.
  const antigo = () =>
    ({
      '2025': {
        exercicio: 2026,
        anoBase: 2025,
        arquivo: 'IRPF2026.DEC',
        importadoEm: 'x',
        vals: { cdb: 500_000 },
        ndep: 0,
        base: 500_000,
        irpfm: 0,
        patrimonio: 400_000,
        posicoes: [
          { id: 'cdb:CDB BANCO X', descricao: 'CDB BANCO X', classe: 'cdb', regime: 'inBase', saldoAnterior: 300_000, saldoAtual: 400_000 },
        ],
      },
    }) as unknown as Historico

  it('preenche os campos que faltam em vez de deixar a leitura quebrar', () => {
    const h = normalizaHistorico(antigo())
    expect(h['2025'].diagnostico).toEqual({ registros: [], lancamentos: 0, posicoes: 1, totalLinhas: 0, anoDetectado: true })
    expect(h['2025'].posicoes[0].codigo).toBe('')
    expect(h['2025'].base).toBe(500_000)
  })

  it('as contas seguem funcionando sobre o histórico migrado', () => {
    const h = normalizaHistorico(antigo())
    expect(seriePatrimonio(h)[0].inBase).toBe(400_000)
    expect(baseEstocada(h).total).toBe(100_000)
  })

  it('aguenta lixo: nulo, indefinido e entradas quebradas', () => {
    expect(normalizaHistorico(undefined)).toEqual({})
    expect(normalizaHistorico(null)).toEqual({})
    expect(normalizaHistorico({ '2020': null } as unknown as Historico)).toEqual({})
    const semPosicoes = normalizaHistorico({ '2021': { anoBase: 2021 } } as unknown as Historico)
    expect(semPosicoes['2021'].posicoes).toEqual([])
  })
})

describe('vínculo manual entre anos', () => {
  // Mesma aplicação, nome diferente entre os anos: o casamento automático falha.
  const montar = (): Historico => {
    let h: Historico = {}
    h = upsertDeclaracao(h, montarDeclaracao(dec('2025', [], [pos('CDB BCO X', 300_000, 200_000)]), 'a.DEC', 'agora')!)
    h = upsertDeclaracao(h, montarDeclaracao(dec('2026', [], [pos('CDB BANCO X S.A.', 500_000, 300_000)]), 'b.DEC', 'agora')!)
    return h
  }

  it('sem vínculo, a mesma aplicação vira duas séries curtas', () => {
    const h = montar()
    const idNovo = h['2025'].posicoes[0].id
    expect(serieDaPosicao(h, idNovo).map((p) => p.anoBase)).toEqual([2025])
  })

  it('com vínculo, a série volta a ser uma só', () => {
    const h = montar()
    const idAntigo = h['2024'].posicoes[0].id
    const idNovo = h['2025'].posicoes[0].id
    const ligado = aplicarVinculos(h, { [idAntigo]: idNovo })
    expect(serieDaPosicao(ligado, idNovo).map((p) => p.anoBase)).toEqual([2024, 2025])
  })

  it('o rendimento embutido passa a somar os dois anos', () => {
    const h = montar()
    const idAntigo = h['2024'].posicoes[0].id
    const idNovo = h['2025'].posicoes[0].id
    expect(baseEstocada(h).total).toBe(200_000) // só 2025: 500k − 300k
    expect(baseEstocada(aplicarVinculos(h, { [idAntigo]: idNovo })).total).toBe(300_000) // + 100k de 2024
  })

  it('sem vínculos, devolve o histórico intocado', () => {
    const h = montar()
    expect(aplicarVinculos(h, {})).toBe(h)
  })

  it('o mapa pode ser pedido para qualquer ano, não só o mais recente', () => {
    const h = montar()
    expect(anosDisponiveis(h)).toEqual([2025, 2024])
    expect(posicoesDoAno(h, 2024)[0].descricao).toBe('CDB BCO X')
    expect(posicoesDoAno(h, 2025)[0].descricao).toBe('CDB BANCO X S.A.')
  })
})

describe('classificação pelo código do bem', () => {
  it('usa o código quando a descrição não diz nada', () => {
    expect(classificaPosicao('XXXXXXXX XXXXX', '45')).toBe('cdb')
    expect(classificaPosicao('XXXXXXXX XXXXX', '32')).toBe('participacao')
    expect(classificaPosicao('XXXXXXXX XXXXX', '61')).toBe('contaCorrente')
    expect(classificaPosicao('XXXXXXXX XXXXX', '21')).toBe('veiculo')
  })

  it('a descrição manda quando reconhece — o código não separa LCA de CDB', () => {
    // ambos são "aplicação de renda fixa" (45), mas o regime é oposto
    expect(classificaPosicao('LCA BANCO Y', '45')).toBe('lci')
    expect(REGIME[classificaPosicao('LCA BANCO Y', '45')]).toBe('foraBase')
    expect(REGIME[classificaPosicao('CDB BANCO X', '45')]).toBe('inBase')
  })

  it('códigos de fundo ficam sem classe de propósito — errar aí inventaria imposto', () => {
    for (const cod of ['71', '72', '73', '74', '79']) {
      expect(classificaPosicao('XXXXX XXXXX', cod)).toBe('desconhecido')
      expect(REGIME[classificaPosicao('XXXXX XXXXX', cod)]).toBe('depende')
    }
  })

  it('código desconhecido não vira palpite', () => {
    expect(classificaPosicao('XXXXX', '99')).toBe('desconhecido')
    expect(classificaPosicao('XXXXX', undefined)).toBe('desconhecido')
    expect(classificaPosicao('XXXXX', '  ')).toBe('desconhecido')
  })

  it('participação societária depende de confirmação, não entra na base', () => {
    expect(REGIME.participacao).toBe('depende')
  })
})

describe('código × grupo (o layout do Registro 27 mudou em 2019)', () => {
  it('rotuloCodigo esconde o subcódigo neutro e mostra o par quando ele informa', () => {
    expect(rotuloCodigo('45', '01')).toBe('45') // esquema antigo: só o código
    expect(rotuloCodigo('04', '02')).toBe('04·02') // esquema novo: grupo·código
    expect(rotuloCodigo('', '02')).toBe('')
    expect(rotuloCodigo(undefined, undefined)).toBe('')
  })

  it('chaveCodigo agrupa pelo par, não pelo grupo — 04·01 e 04·02 são bens diferentes', () => {
    expect(chaveCodigo({ codigo: '04', subcodigo: '01' })).toBe('04·01')
    expect(chaveCodigo({ codigo: '04', subcodigo: '01' })).not.toBe(chaveCodigo({ codigo: '04', subcodigo: '02' }))
    expect(chaveCodigo({ codigo: ' 45 ', subcodigo: ' 01 ' })).toBe(chaveCodigo({ codigo: '45', subcodigo: '01' }))
    expect(chaveCodigo({})).toBe('·')
  })

  it('idsPorCodigo alcança o mesmo código em todos os anos — é isso que faz o "aplicar a todos" valer para trás', () => {
    let h: Historico = {}
    h = upsertDeclaracao(
      h,
      montarDeclaracao(dec('2024', [], [pos('CDB BCO X', 100, 0, '45', '01'), pos('APTO', 500, 0, '11', '01'), pos('BEM SEM CODIGO', 10, 0, '  ', '  ')]), 'a.DEC', 'agora')!,
    )
    h = upsertDeclaracao(h, montarDeclaracao(dec('2025', [], [pos('CDB BANCO X S.A.', 200, 100, '45', '01')]), 'b.DEC', 'agora')!)
    const ids = idsPorCodigo(h, '45·01')
    expect(ids).toHaveLength(2) // a descrição mudou de ano para ano, o código não
    expect(idsPorCodigo(h, '11·01')).toHaveLength(1)
    expect(idsPorCodigo(h, '99·99')).toEqual([])
    // sem código não há grupo: senão todo bem sem código viraria "o mesmo bem"
    expect(idsPorCodigo(h, '·')).toEqual([])
    expect(idsPorCodigo(h, '  ·  ')).toEqual([])
  })
})

// PAT-01 — o painel somava custo de aquisição com saldo de mercado como se
// fossem a mesma grandeza. A declaração pede coisas diferentes por classe, e é
// isso que esta tabela guarda.
describe('PAT-01 — o que o valor declarado significa', () => {
  it('renda fixa e fundos vêm pelo saldo, que já inclui o rendimento', () => {
    for (const c of ['cdb', 'tesouro', 'fundo', 'debentureComum', 'lci', 'cri', 'debentureInc', 'poupanca', 'contaCorrente'] as const) {
      expect(COMO_VALORA[c]).toBe('mercado')
    }
  })

  it('VGBL vem pelo saldo: a declaração traz 31/12 anterior e atual, sem os aportes', () => {
    expect(COMO_VALORA.previdencia).toBe('mercado')
    expect(segueMercado('previdencia')).toBe(true)
  })

  it('ação, FII, quota, imóvel e veículo vêm pelo custo de aquisição', () => {
    // Para ações é preço médio × quantidade em 31/12: move com compra e venda,
    // nunca com valorização — essa só aparece na venda.
    for (const c of ['acoes', 'fii', 'participacao', 'imovel', 'veiculo'] as const) {
      expect(COMO_VALORA[c]).toBe('custo')
      expect(segueMercado(c)).toBe(false)
    }
  })

  it('onde não dá para saber, não afirma — como o REGIME já fazia', () => {
    expect(COMO_VALORA.exterior).toBe('incerto')
    expect(COMO_VALORA.desconhecido).toBe('incerto')
  })

  it('toda classe tem uma resposta: nenhuma cai no vazio', () => {
    for (const c of Object.keys(REGIME) as (keyof typeof REGIME)[]) {
      expect(COMO_VALORA[c]).toBeDefined()
    }
  })
})

describe('PAT-01/PAT-02 — a série separa custo de mercado e conhece dívidas', () => {
  const montar = (): Historico => {
    let h: Historico = {}
    h = upsertDeclaracao(
      h,
      montarDeclaracao(
        dec('2026', [lanc('cdb', 100_000)], [pos('CDB BANCO X', 600_000), pos('ACOES PETR4', 300_000), pos('APARTAMENTO', 100_000)]),
        'a.DEC',
        'agora',
      )!,
    )
    return h
  }

  it('separa o que acompanha o mercado do que está parado no custo', () => {
    const [p] = seriePatrimonio(montar())
    expect(p.total).toBe(1_000_000)
    expect(p.aMercado).toBe(600_000) // CDB
    expect(p.aoCusto).toBe(400_000) // ações + imóvel
    expect(p.incerto).toBe(0)
    // e as três partes fecham o bruto
    expect(p.aMercado + p.aoCusto + p.incerto).toBe(p.total)
  })

  it('sem dívida informada, líquido é o bruto — e o campo diz que ninguém informou', () => {
    const [p] = seriePatrimonio(montar())
    expect(p.dividas).toBeNull() // ausente ≠ zero
    expect(p.liquido).toBe(p.total)
  })

  it('com dívida informada, o líquido desconta', () => {
    const [p] = seriePatrimonio(montar(), { 2025: 250_000 })
    expect(p.dividas).toBe(250_000)
    expect(p.liquido).toBe(750_000)
    expect(p.total).toBe(1_000_000) // o bruto continua disponível
  })

  it('dívida de outro ano não vaza para este', () => {
    const [p] = seriePatrimonio(montar(), { 2099: 999_999 })
    expect(p.dividas).toBeNull()
    expect(p.liquido).toBe(p.total)
  })
})

// O ponto cego que o PAT-01 revelou: PGBL não está em «Bens e Direitos». Ele foi
// deduzido, então mora em «Pagamentos Efetuados» — e some do painel de
// patrimônio, justamente sendo o ativo mais caro de resgatar.
describe('PGBL — o patrimônio que a declaração esconde', () => {
  const comPgbl = (): Historico => {
    let h: Historico = {}
    for (const [ano, valor] of [['2024', 30_000], ['2025', 40_000], ['2026', 50_000]] as [string, number][]) {
      h = upsertDeclaracao(
        h,
        montarDeclaracao(
          dec(ano, [], [pos('CDB BANCO X', 100_000)], 0, [pagou('BRASILPREV SEGUROS', valor)]),
          `${ano}.DEC`,
          'agora',
        )!,
      )
    }
    return h
  }

  it('reconstrói o aportado ano a ano e acumulado, em ordem', () => {
    const s = pgblAportado(comPgbl())
    expect(s.map((p) => p.anoBase)).toEqual([2023, 2024, 2025])
    expect(s.map((p) => p.noAno)).toEqual([30_000, 40_000, 50_000])
    expect(s.map((p) => p.acumulado)).toEqual([30_000, 70_000, 120_000])
  })

  it('não confunde plano de saúde com previdência', () => {
    let h: Historico = {}
    h = upsertDeclaracao(
      h,
      montarDeclaracao(
        dec('2026', [], [], 0, [pagou('UNIMED PLANO DE SAUDE', 20_000), pagou('ICATU PREVIDENCIA', 15_000)]),
        'x.DEC',
        'agora',
      )!,
    )
    expect(pgblAportado(h)[0].noAno).toBe(15_000)
  })

  it('desconta a parcela não dedutível que o próprio arquivo informa', () => {
    let h: Historico = {}
    h = upsertDeclaracao(
      h,
      montarDeclaracao(dec('2026', [], [], 0, [pagou('BRASILPREV', 30_000, 5_000)]), 'x.DEC', 'agora')!,
    )
    expect(pgblAportado(h)[0].noAno).toBe(25_000)
  })

  it('ano sem pagamentos lidos não inventa aporte', () => {
    let h: Historico = {}
    h = upsertDeclaracao(h, montarDeclaracao(dec('2026', [], [pos('CDB', 100_000)]), 'x.DEC', 'agora')!)
    expect(pgblAportado(h)[0].noAno).toBe(0)
  })
})

describe('identidade do pagador', () => {
  it('o CNPJ manda, porque é ele que não muda entre os anos', () => {
    expect(idPagador('CIA XPTO S/A', '12345678000199')).toBe('cnpj:12345678000199')
    expect(idPagador('CIA XPTO SA', '12.345.678/0001-99')).toBe('cnpj:12345678000199')
  })

  it('zero à esquerda faz parte do número e fica', () => {
    expect(idPagador('CIA', '00011222000133')).toBe('cnpj:00011222000133')
  })

  it('CNPJ todo zero não é CNPJ — cai no nome', () => {
    // o campo vem zerado em registro sem fonte; aceitá-lo juntaria num pagador
    // só todo mundo que não tem pagador, e uma resposta erraria várias fichas
    expect(idPagador('BANCO Y', '00000000000000')).toBe('nome:BANCO Y')
  })

  it('sem CNPJ, o nome normalizado; sem nome nenhum, vazio', () => {
    expect(idPagador('  Banco   Ômega S.A. ')).toBe('nome:BANCO MEGA S A')
    expect(idPagador('', '')).toBe('')
    expect(idPagador('   ', '000')).toBe('')
  })
})

describe('renda por pagador', () => {
  const l = (alvo: string, valor: number, fonte: string, cnpj = ''): Lancamento => ({
    linha: 1,
    tipo: '84',
    tipoLabel: 'x',
    fonte,
    cnpj,
    rotulo: 'Rendimento',
    valor,
    alvo,
  })

  it('separa dois pagadores dentro da mesma ficha', () => {
    const r = rendaPorPagador([
      l('divBR', 360_000, 'MINHA CLINICA LTDA', '11111111000111'),
      l('divBR', 120_000, 'ITAUSA', '22222222000122'),
    ])
    expect(r.map((x) => [x.pagador.id, x.valor])).toEqual([
      ['cnpj:11111111000111', 360_000],
      ['cnpj:22222222000122', 120_000],
    ])
    expect(r[0].pagador.cnpj).toBe('11111111000111')
  })

  it('o mesmo pagador em duas fichas vira duas linhas', () => {
    // a resposta sobre ele vale para as duas, porque a chave é o pagador
    const r = rendaPorPagador([
      l('cdb', 10_000, 'BANCO X', '33333333000133'),
      l('isentos', 5_000, 'BANCO X', '33333333000133'),
    ])
    expect(r).toHaveLength(2)
    expect(new Set(r.map((x) => x.pagador.id)).size).toBe(1)
    expect(r.map((x) => x.alvo).sort()).toEqual(['cdb', 'isentos'])
  })

  it('soma o mesmo pagador quando ele aparece duas vezes na mesma ficha', () => {
    const r = rendaPorPagador([
      l('divBR', 30_000, 'CIA', '44444444000144'),
      l('divBR', 20_000, 'CIA', '44444444000144'),
    ])
    expect(r).toEqual([
      { alvo: 'divBR', pagador: { id: 'cnpj:44444444000144', nome: 'CIA', cnpj: '44444444000144' }, valor: 50_000 },
    ])
  })

  it('imposto retido não é renda, e não vira pagador', () => {
    const r = rendaPorPagador([l('salario', 300_000, 'EMPRESA', '55555555000155'), l('salario_ir', 80_000, 'EMPRESA', '55555555000155')])
    expect(r).toHaveLength(1)
    expect(r[0].valor).toBe(300_000)
  })

  it('lançamento sem fonte identificada fica de fora — o Registro 22 não traz nenhuma', () => {
    // inventar um pagador «não identificado» daria à pessoa uma linha para
    // responder sobre algo que ela não tem como reconhecer
    expect(rendaPorPagador([l('exterior', 50_000, '', '')])).toEqual([])
  })

  it('a soma por ficha nunca passa do total da ficha', () => {
    const lancamentos = [
      l('divBR', 360_000, 'MINHA CLINICA', '11111111000111'),
      l('divBR', 120_000, 'ITAUSA', '22222222000122'),
      l('exterior', 50_000, '', ''),
      l('salario_ir', 80_000, 'EMPRESA', '55555555000155'),
    ]
    const vals = somaPorAlvo(lancamentos)
    const porPagador = rendaPorPagador(lancamentos)
    for (const alvo of new Set(porPagador.map((x) => x.alvo))) {
      const soma = porPagador.filter((x) => x.alvo === alvo).reduce((t, x) => t + x.valor, 0)
      expect(soma).toBeLessThanOrEqual(vals[alvo])
    }
    // e o que ficou de fora é exatamente o lançamento sem fonte
    expect(porPagador.some((x) => x.alvo === 'exterior')).toBe(false)
    expect(vals.exterior).toBe(50_000)
  })

  it('a declaração montada guarda o detalhamento e carimba a leitura', () => {
    const d = montarDeclaracao(
      dec('2026', [l('divBR', 400_000, 'MINHA CLINICA', '11111111000111'), l('cdb', 60_000, 'BANCO X', '33333333000133')], []),
      'x.DEC',
      'agora',
    )!
    expect(d.versaoLeitura).toBe(LEITURA_ATUAL)
    expect(d.porPagador).toHaveLength(2)
    expect(d.vals.divBR).toBe(400_000)
    expect(d.porPagador!.find((x) => x.alvo === 'divBR')!.valor).toBe(400_000)
  })
})

describe('os pagadores do histórico', () => {
  const l = (alvo: string, valor: number, fonte: string, cnpj = ''): Lancamento => ({
    linha: 1, tipo: '84', tipoLabel: 'x', fonte, cnpj, rotulo: 'Rendimento', valor, alvo,
  })
  const CLINICA = '11111111000111'
  const BANCO = '33333333000133'

  const h = (() => {
    let acc: Historico = {}
    for (const ex of ['2025', '2026']) {
      acc = upsertDeclaracao(
        acc,
        montarDeclaracao(
          dec(ex, [l('divBR', 300_000, 'MINHA CLINICA', CLINICA), l('salario', 100_000, 'MINHA CLINICA', CLINICA), l('cdb', 20_000, 'BANCO X', BANCO)], []),
          `${ex}.DEC`,
          'agora',
        )!,
      )
    }
    return acc
  })()

  it('soma o mesmo pagador entre os anos, do maior para o menor', () => {
    const p = pagadoresDoHistorico(h)
    expect(p.map((x) => [x.pagador.id, x.total])).toEqual([
      [`cnpj:${CLINICA}`, 800_000],
      [`cnpj:${BANCO}`, 40_000],
    ])
  })

  it('guarda em que fichas e em que anos ele apareceu', () => {
    const clinica = pagadoresDoHistorico(h)[0]
    expect(clinica.fichas).toEqual([
      { alvo: 'divBR', total: 600_000 },
      { alvo: 'salario', total: 200_000 },
    ])
    expect(clinica.anos).toEqual([2024, 2025])
  })

  it('ano lido por versão anterior à 4 não contribui, e não quebra', () => {
    const antigo: Historico = { 2020: { ...Object.values(h)[0], anoBase: 2020, porPagador: undefined } }
    expect(pagadoresDoHistorico(antigo)).toEqual([])
    expect(rendaPorPagadorDoHistorico(antigo)).toEqual([])
  })

  it('a soma dos pagadores bate com a soma dos lançamentos do histórico', () => {
    const total = rendaPorPagadorDoHistorico(h).reduce((t, r) => t + r.valor, 0)
    expect(pagadoresDoHistorico(h).reduce((t, p) => t + p.total, 0)).toBe(total)
  })
})
