import { describe, it, expect } from 'vitest'
import {
  sugerirCategoria,
  agruparPagamentos,
  somarPagamentos,
  totalIndefinido,
  chavePagamento,
  type CategoriaDeducao,
} from './deducoes'
import type { Pagamento } from './decParser'

const pag = (over: Partial<Pagamento>): Pagamento => ({
  linha: 1,
  codigo: '07',
  beneficiario: '',
  documento: '',
  valor: 0,
  naoDedutivel: 0,
  bruta: '',
  ...over,
})

describe('sugestão pelo nome de quem recebeu', () => {
  it('reconhece serviço e plano de saúde', () => {
    expect(sugerirCategoria({ beneficiario: 'UNIMED REGIONAL' }).categoria).toBe('saude')
    expect(sugerirCategoria({ beneficiario: 'Hospital Sao Lucas' }).categoria).toBe('saude')
    expect(sugerirCategoria({ beneficiario: 'CLINICA ODONTOLOGICA XYZ' }).categoria).toBe('saude')
  })

  it('reconhece ensino e previdência complementar', () => {
    expect(sugerirCategoria({ beneficiario: 'Colégio Santa Maria' }).categoria).toBe('instrucao')
    expect(sugerirCategoria({ beneficiario: 'BRASILPREV SEGUROS' }).categoria).toBe('previdenciaPrivada')
  })

  it('acento e caixa não mudam o palpite', () => {
    expect(sugerirCategoria({ beneficiario: 'clínica médica' }).categoria).toBe('saude')
    expect(sugerirCategoria({ beneficiario: 'UNIVERSIDADE FEDERAL' }).categoria).toBe('instrucao')
  })

  // O padrão é não saber. Uma linha classificada errado entra na conta do
  // imposto devido, e o erro só apareceria no IRPFM meses depois.
  it('o que não é inequívoco fica indefinido, com o motivo', () => {
    const s = sugerirCategoria({ beneficiario: 'JOAO DA SILVA' })
    expect(s.categoria).toBe('indefinido')
    expect(s.porque.length).toBeGreaterThan(0)
    expect(sugerirCategoria({ beneficiario: '' }).categoria).toBe('indefinido')
  })
})

describe('agrupamento dos pagamentos', () => {
  it('junta o mesmo beneficiário, soma as linhas e ordena pelo maior', () => {
    const g = agruparPagamentos([
      pag({ beneficiario: 'UNIMED', valor: 6000 }),
      pag({ beneficiario: 'UNIMED', valor: 6000 }),
      pag({ beneficiario: 'COLEGIO ABC', codigo: '09', valor: 20000 }),
    ])
    expect(g).toHaveLength(2)
    expect(g[0]).toMatchObject({ beneficiario: 'COLEGIO ABC', total: 20000, quantos: 1 })
    expect(g[1]).toMatchObject({ beneficiario: 'UNIMED', total: 12000, quantos: 2 })
  })

  it('desconta a parcela não dedutível que o próprio arquivo informa', () => {
    const [g] = agruparPagamentos([pag({ beneficiario: 'UNIMED', valor: 10000, naoDedutivel: 2500 })])
    expect(g.total).toBe(7500)
    expect(g.naoDedutivel).toBe(2500)
  })

  it('mesmo nome com código diferente são grupos diferentes', () => {
    const g = agruparPagamentos([
      pag({ beneficiario: 'MESMO NOME', codigo: '10', valor: 100 }),
      pag({ beneficiario: 'MESMO NOME', codigo: '11', valor: 100 }),
    ])
    expect(g).toHaveLength(2)
    expect(chavePagamento({ codigo: '10', beneficiario: 'MESMO NOME' })).not.toBe(
      chavePagamento({ codigo: '11', beneficiario: 'MESMO NOME' }),
    )
  })

  it('linha sem valor nenhum não vira grupo', () => {
    expect(agruparPagamentos([pag({ beneficiario: 'SEM VALOR', valor: 0 })])).toEqual([])
  })
})

describe('soma nas linhas da declaração', () => {
  const grupos = agruparPagamentos([
    pag({ beneficiario: 'UNIMED', valor: 12000 }),
    pag({ beneficiario: 'COLEGIO ABC', codigo: '09', valor: 8000 }),
    pag({ beneficiario: 'JOAO DA SILVA', codigo: '10', valor: 5000 }),
  ])

  it('instrução entra inteira aqui — o teto por pessoa é aplicado na apuração', () => {
    expect(somarPagamentos(grupos).instrucao).toBe(8000)
  })

  it('usa a sugestão quando ninguém respondeu', () => {
    const d = somarPagamentos(grupos)
    expect(d.saude).toBe(12000)
    expect(d.instrucao).toBe(8000)
  })

  it('o indefinido fica de fora até alguém decidir, e a tela sabe quanto é', () => {
    expect(somarPagamentos(grupos).outras).toBe(0)
    expect(totalIndefinido(grupos)).toBe(5000)
  })

  it('a resposta guardada manda sobre a sugestão', () => {
    const atribuicoes: Record<string, CategoriaDeducao> = {
      [chavePagamento({ codigo: '10', beneficiario: 'JOAO DA SILVA' })]: 'pensao',
      [chavePagamento({ codigo: '07', beneficiario: 'UNIMED' })]: 'naoDedutivel',
    }
    const d = somarPagamentos(grupos, atribuicoes)
    expect(d.pensao).toBe(5000)
    expect(d.saude).toBe(0) // marcado como não dedutível
    expect(totalIndefinido(grupos, atribuicoes)).toBe(0)
  })

  it('sem pagamento nenhum, tudo zero', () => {
    const d = somarPagamentos([])
    Object.values(d).forEach((v) => expect(v).toBe(0))
  })
})
