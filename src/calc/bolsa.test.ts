import { describe, it, expect } from 'vitest'
import { apurarBolsa, paraBase, ISENCAO_MENSAL, type Operacao, type EntradaBolsa } from './bolsa'

const compra = (mes: number, ticker: string, quantidade: number, precoUnitario: number): Operacao => ({
  ano: 2026, mes, ticker, tipo: 'compra', quantidade, precoUnitario,
})
const venda = (
  mes: number, ticker: string, quantidade: number, precoUnitario: number,
  modalidade?: Operacao['modalidade'],
): Operacao => ({ ano: 2026, mes, ticker, tipo: 'venda', quantidade, precoUnitario, modalidade })

const apurar = (e: Partial<EntradaBolsa> & { operacoes: Operacao[] }) =>
  apurarBolsa({ ano: 2026, ...e })

const perto = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('preço médio', () => {
  it('é a média ponderada das compras, não o preço da última', () => {
    // 100 a 10 + 100 a 20 → médio 15; vende 100 a 25 → ganho 1.000
    const r = apurar({
      operacoes: [compra(1, 'A', 100, 10), compra(2, 'A', 100, 20), venda(3, 'A', 100, 25)],
    })
    perto(r.meses[2].resultado.comum, 1000)
  })

  it('venda não mexe no preço médio — a venda seguinte continua certa', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 200, 10), venda(2, 'A', 100, 30), venda(3, 'A', 100, 30)],
    })
    perto(r.meses[1].resultado.comum, 2000)
    perto(r.meses[2].resultado.comum, 2000)
    expect(r.posicaoFinal).toEqual([])
  })

  it('prejuízo aparece como resultado negativo', () => {
    const r = apurar({ operacoes: [compra(1, 'A', 100, 30), venda(2, 'A', 100, 10)] })
    perto(r.meses[1].resultado.comum, -2000)
  })

  it('parte da posição vendida deixa o resto no preço médio antigo', () => {
    const r = apurar({ operacoes: [compra(1, 'A', 100, 10), venda(2, 'A', 40, 50)] })
    expect(r.posicaoFinal).toEqual([{ ticker: 'A', quantidade: 60, custoMedio: 10 }])
  })
})

describe('eventos que mexem na quantidade', () => {
  it('desdobro 1:2 dobra a quantidade e parte o custo unitário ao meio', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 100, 10), venda(6, 'A', 200, 8)],
      eventos: [{ ano: 2026, mes: 3, ticker: 'A', delta: 100 }],
    })
    // custo total continua 1.000, agora em 200 ações → médio 5; vende a 8 → 600
    perto(r.meses[5].resultado.comum, 600)
  })

  it('grupamento 2:1 corta a quantidade e dobra o custo unitário', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 100, 10)],
      eventos: [{ ano: 2026, mes: 3, ticker: 'A', delta: -50 }],
    })
    expect(r.posicaoFinal).toEqual([{ ticker: 'A', quantidade: 50, custoMedio: 20 }])
  })

  it('bonificação não é ganho: entra quantidade, não entra custo', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 100, 10)],
      eventos: [{ ano: 2026, mes: 2, ticker: 'A', delta: 10 }],
    })
    perto(r.posicaoFinal[0].custoMedio, 1000 / 110)
    expect(r.ganhoTributavel).toBe(0)
  })
})

describe('isenção mensal dos R$ 20 mil', () => {
  it('olha o total vendido no mês, não o lucro', () => {
    const r = apurar({ operacoes: [compra(1, 'A', 1000, 10), venda(2, 'A', 1000, 19)] })
    expect(r.meses[1].isentoNoMes).toBe(true)
    perto(r.ganhoIsento, 9000)
    expect(r.ganhoTributavel).toBe(0)
    expect(r.ir).toBe(0)
  })

  it('na fronteira: 20.000 é isento, 20.001 não é', () => {
    const na = apurar({ operacoes: [compra(1, 'A', 1000, 10), venda(2, 'A', 1000, 20)] })
    expect(na.meses[1].vendas.comum).toBe(ISENCAO_MENSAL)
    expect(na.meses[1].isentoNoMes).toBe(true)

    const passou = apurar({ operacoes: [compra(1, 'A', 1000, 10), venda(2, 'A', 1000, 20.001)] })
    expect(passou.meses[1].isentoNoMes).toBe(false)
    perto(passou.ganhoTributavel, 10001)
  })

  it('soma as vendas do mês inteiro antes de decidir', () => {
    const r = apurar({
      operacoes: [
        compra(1, 'A', 1000, 10), compra(1, 'B', 1000, 10),
        venda(2, 'A', 1000, 15), venda(2, 'B', 1000, 15),
      ],
    })
    expect(r.meses[1].vendas.comum).toBe(30000)
    expect(r.meses[1].isentoNoMes).toBe(false)
  })

  it('não alcança FII', () => {
    const r = apurar({
      operacoes: [compra(1, 'F11', 100, 100), venda(2, 'F11', 100, 150, 'fii')],
    })
    expect(r.meses[1].isentoNoMes).toBe(false)
    perto(r.ir, 5000 * 0.2)
  })

  it('não alcança day trade', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 100, 10), venda(2, 'A', 100, 20, 'daytrade')],
    })
    expect(r.meses[1].isentoNoMes).toBe(false)
    perto(r.ir, 1000 * 0.2)
  })

  it('prejuízo em mês isento não vira crédito para compensar depois', () => {
    const r = apurar({
      operacoes: [
        compra(1, 'A', 1000, 15), venda(2, 'A', 1000, 10), // vendeu 10.000: mês isento
        compra(3, 'B', 1000, 10), venda(4, 'B', 1000, 50), // 40.000: tributável
      ],
    })
    expect(r.meses[1].isentoNoMes).toBe(true)
    perto(r.ganhoTributavel, 40000)
    expect(r.prejuizoAcumulado.comum).toBe(0)
  })
})

describe('compensação de prejuízo', () => {
  it('prejuízo de um mês abate lucro do mês seguinte', () => {
    const r = apurar({
      operacoes: [
        compra(1, 'A', 1000, 40), venda(2, 'A', 1000, 30), // −10.000, vendeu 30k
        compra(3, 'B', 1000, 30), venda(4, 'B', 1000, 60), // +30.000
      ],
    })
    perto(r.ganhoTributavel, 20000)
    perto(r.ir, 20000 * 0.15)
  })

  it('prejuízo de anos anteriores entra e o saldo sobra para o ano seguinte', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 1000, 30), venda(2, 'A', 1000, 60)],
      prejuizoAnterior: { comum: 50000 },
    })
    expect(r.ganhoTributavel).toBe(0)
    perto(r.prejuizoAcumulado.comum, 20000)
  })

  it('cada pote compensa só o seu — prejuízo em ação não abate lucro de FII', () => {
    const r = apurar({
      operacoes: [
        compra(1, 'A', 1000, 40), venda(2, 'A', 1000, 30, 'comum'),
        compra(3, 'F11', 100, 100), venda(4, 'F11', 100, 300, 'fii'),
      ],
    })
    perto(r.ganhoTributavel, 20000)
    perto(r.prejuizoAcumulado.comum, 10000)
    perto(r.ir, 20000 * 0.2)
  })
})

describe('custo desconhecido', () => {
  it('venda sem posição tira o papel inteiro da conta, e o denuncia', () => {
    const r = apurar({ operacoes: [venda(2, 'VELHA', 100, 50)] })
    expect(r.semCusto).toEqual(['VELHA'])
    expect(r.ganhoTributavel).toBe(0)
    expect(r.meses[1].vendas.comum).toBe(0)
  })

  it('contamina o papel todo, não só a venda a descoberto', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 50, 10), venda(2, 'A', 50, 30), venda(3, 'A', 50, 30)],
    })
    expect(r.semCusto).toEqual(['A'])
    expect(r.ganhoTributavel).toBe(0)
  })

  it('não contamina os outros papéis', () => {
    const r = apurar({
      operacoes: [venda(1, 'VELHA', 100, 50), compra(1, 'B', 1000, 10), venda(2, 'B', 1000, 50)],
    })
    expect(r.semCusto).toEqual(['VELHA'])
    perto(r.ganhoTributavel, 40000)
  })

  it('posição inicial informada resolve — é para isso que ela existe', () => {
    const r = apurar({
      // acima do teto de isenção de propósito: o que se quer provar aqui é que
      // o custo informado chega ao ganho tributável, não a regra dos 20k
      operacoes: [venda(2, 'VELHA', 100, 500)],
      posicaoInicial: [{ ticker: 'VELHA', quantidade: 100, custoMedio: 200 }],
    })
    expect(r.semCusto).toEqual([])
    expect(r.meses[1].isentoNoMes).toBe(false)
    perto(r.ganhoTributavel, 30000)
  })
})

describe('ordem dentro do mês', () => {
  it('compra do mesmo mês entra antes da venda', () => {
    const r = apurar({ operacoes: [venda(3, 'A', 100, 20), compra(3, 'A', 100, 10)] })
    expect(r.semCusto).toEqual([])
    perto(r.meses[2].resultado.comum, 1000)
  })

  it('operação de outro ano não entra na apuração deste', () => {
    const r = apurar({
      operacoes: [compra(1, 'A', 100, 10), { ...venda(2, 'A', 100, 30), ano: 2025 }],
    })
    expect(r.ganhoTributavel).toBe(0)
    expect(r.posicaoFinal).toEqual([{ ticker: 'A', quantidade: 100, custoMedio: 10 }])
  })
})

describe('para a base do IRPFM', () => {
  const r = apurar({
    operacoes: [
      compra(1, 'A', 1000, 10), venda(2, 'A', 1000, 19), // 9.000 isentos
      compra(3, 'B', 1000, 10), venda(4, 'B', 1000, 50), // 40.000 tributáveis
    ],
  })

  it('na leitura de que não entra, não entra nada — nem o IR volta como dedução', () => {
    expect(paraBase(r, { entraNaBase: false, isentoEntraNaBase: false })).toEqual({
      base: 0, deducao: 0,
    })
  })

  it('entrando, leva o ganho tributável e devolve o IR como dedução', () => {
    const b = paraBase(r, { entraNaBase: true, isentoEntraNaBase: false })
    perto(b.base, 40000)
    perto(b.deducao, 40000 * 0.15)
  })

  it('se a isenção dos 20k não alcançar o mínimo, o ganho isento vira base também', () => {
    const b = paraBase(r, { entraNaBase: true, isentoEntraNaBase: true })
    perto(b.base, 49000)
    perto(b.deducao, 40000 * 0.15)
  })
})
