import { describe, it, expect } from 'vitest'
import {
  nomeDaInstituicao,
  sugerirInstituicao,
  emissorDaDescricao,
  respostasCanonicas,
  lerInstituicaoPorBem,
  bensEmInstituicao,
  nomesUsados,
  respostaCompleta,
  idInstituicao,
  estaEmInstituicao,
  nomesPorCnpj,
} from './instituicao.js'
import { REGIME, type ClassePatrimonio, type Declaracao, type Historico, type PosicaoAno } from './historico.js'

const p = (id: string, descricao: string, classe: ClassePatrimonio, saldoAtual: number, saldoAnterior = 0): PosicaoAno => ({
  id,
  descricao,
  codigo: '04',
  classe,
  regime: REGIME[classe],
  saldoAnterior,
  saldoAtual,
})

const ano = (anoBase: number, posicoes: PosicaoAno[]): Declaracao =>
  ({ anoBase, exercicio: anoBase + 1, posicoes, vals: {}, ndep: 0, base: 0, patrimonio: 0 }) as unknown as Declaracao

const hist = (...ds: Declaracao[]): Historico => Object.fromEntries(ds.map((d) => [String(d.anoBase), d]))

describe('sugestão de instituição e emissor', () => {
  it('corretora e banco citados: a corretora é onde está, o banco é quem deve', () => {
    // O caso que justifica os dois campos: o CDB está NA XP e é dívida do BTG.
    const s = sugerirInstituicao('CDB BTG PACTUAL 110% CDI VENC 2027 - CUSTODIADO NA XP', 'cdb')
    expect(s).toMatchObject({ instituicao: 'XP Investimentos', emissor: 'BTG Pactual' })
    expect(s?.aproximada).toBeUndefined()
    expect(s?.motivo).toMatch(/«XP Investimentos» e «BTG Pactual»/)
  })

  it('só o banco citado: comprado no próprio banco', () => {
    expect(sugerirInstituicao('CDB ITAÚ UNIBANCO S.A. 2026', 'cdb')).toMatchObject({ instituicao: 'Itaú', emissor: 'Itaú' })
    expect(sugerirInstituicao('CONTA CORRENTE BANCO DO BRASIL AG 1234-5', 'contaCorrente')).toMatchObject({
      instituicao: 'Banco do Brasil',
      emissor: 'Banco do Brasil',
    })
  })

  it('dois bancos e nenhuma corretora: a ordem é palpite, e o palpite não entra em bloco', () => {
    const s = sugerirInstituicao('CDB BANCO PAN VIA BTG', 'cdb')
    expect(s).toMatchObject({ instituicao: 'Banco Pan', emissor: 'Banco Pan', aproximada: true })
  })

  it('banco conhecido E um nome desconhecido: o desconhecido é quem deve, e o palpite não entra em bloco', () => {
    // Achado olhando a tela: o BTG estava na lista como banco, e virava emissor
    // do CDB do Aurora guardado nele — o FGC na conta do banco errado, com cara
    // de certeza, dentro do «aceitar tudo».
    const s = sugerirInstituicao('CDB BANCO AURORA 2028 BTG', 'cdb')
    expect(s).toMatchObject({ instituicao: 'BTG Pactual', emissor: 'BANCO AURORA', aproximada: true })
  })

  it('o nome inteiro do conhecido sai antes de ler a sobra: «PACTUAL» não é outro banco', () => {
    expect(sugerirInstituicao('CDB BTG PACTUAL PRE 2027', 'cdb')).toMatchObject({ instituicao: 'BTG Pactual', emissor: 'BTG Pactual' })
    expect(sugerirInstituicao('CDB BANCO SANTANDER BRASIL S.A.', 'cdb')?.aproximada).toBeUndefined()
  })

  it('banco desconhecido: o que sobra da descrição, marcado como aproximado', () => {
    const s = sugerirInstituicao('CDB BANCO ABC BRASIL 12,5% A.A. VENC 15/03/2027 CUSTODIADO NA XP', 'cdb')
    expect(s).toMatchObject({ instituicao: 'XP Investimentos', emissor: 'BANCO ABC BRASIL', aproximada: true })
    // o nome da corretora não pode vazar para dentro do nome do emissor
    expect(s?.emissor).not.toMatch(/XP/)
  })

  it('corretora citada e nenhum emissor legível: sugere onde está, sem inventar quem deve', () => {
    const s = sugerirInstituicao('CDB 2027 XP', 'cdb')
    expect(s).toMatchObject({ instituicao: 'XP Investimentos' })
    expect(s?.emissor).toBeUndefined()
    expect(s?.aproximada).toBeUndefined()
  })

  it('sem nada reconhecível, não sugere', () => {
    expect(sugerirInstituicao('CDB 2027', 'cdb')).toBeNull()
    expect(sugerirInstituicao('TESOURO IPCA+ 2035', 'tesouro')).toBeNull()
  })

  it('fora do crédito bancário, só onde está — e ninguém pergunta quem deve', () => {
    expect(sugerirInstituicao('TESOURO SELIC 2029 - XP', 'tesouro')).toEqual({
      instituicao: 'XP Investimentos',
      motivo: 'a descrição cita «XP Investimentos»',
    })
    expect(sugerirInstituicao('BB RENDA FIXA 500', 'fundo')).toMatchObject({ instituicao: 'Banco do Brasil' })
    expect(sugerirInstituicao('VGBL BRADESCO VIDA E PREVIDENCIA', 'previdencia')).toMatchObject({ instituicao: 'Bradesco' })
  })

  it('em ação, o banco citado é a companhia, e não onde a ação está', () => {
    expect(sugerirInstituicao('1000 ACOES ITAU UNIBANCO ITUB4', 'acoes')).toBeNull()
    expect(sugerirInstituicao('1000 ACOES ITAU UNIBANCO ITUB4 CUSTODIADAS NA XP', 'acoes')).toMatchObject({
      instituicao: 'XP Investimentos',
    })
  })

  it('fronteira de palavra: ITAUSA não é o Itaú, e INTERNACIONAL não é o Inter', () => {
    expect(sugerirInstituicao('CDB ITAUSA 2027', 'cdb')?.instituicao).not.toBe('Itaú')
    expect(sugerirInstituicao('CDB BANCO INTERNACIONAL 2027', 'cdb')?.instituicao).not.toBe('Banco Inter')
  })

  it('imóvel, veículo e quota não estão em instituição nenhuma', () => {
    expect(sugerirInstituicao('APARTAMENTO FINANCIADO PELO ITAU', 'imovel')).toBeNull()
    expect(estaEmInstituicao('veiculo')).toBe(false)
    expect(estaEmInstituicao('participacao')).toBe(false)
    expect(estaEmInstituicao('exterior')).toBe(true)
  })
})

describe('emissor pelo que sobra da descrição', () => {
  it('vencimento e taxa não viram emissor', () => {
    expect(emissorDaDescricao('CDB BANCO X VENC 2027')).toBe('BANCO X')
    expect(emissorDaDescricao('LCA BANCO Y 98% CDI 2028')).toBe('BANCO Y')
    expect(emissorDaDescricao('DEBENTURE INCENTIVADA XPTO IPCA+ 6,5% 2030')).toBe('XPTO')
    expect(emissorDaDescricao('CONTA CORRENTE BANCO Z S.A. AG 0001 CC 12345-6')).toBe('BANCO Z')
  })

  it('sem sobra que nomeie alguém, não força um nome', () => {
    expect(emissorDaDescricao('CDB 2027')).toBeNull()
    expect(emissorDaDescricao('CDB BANCO 2027')).toBeNull()
  })
})

describe('respostas pelo id canônico', () => {
  it('a resposta dada antes do vínculo passa para o bem ligado', () => {
    // A pessoa respondeu o CDB de 2021; em 2022 o banco renomeou o produto, e o
    // vínculo juntou as séries no id novo. Sem isto a resposta sumia.
    const r = respostasCanonicas({ 'cdb:CDB BCO X': { instituicao: 'XP', emissor: 'Banco X' } }, { 'cdb:CDB BCO X': 'cdb:CDB BANCO X SA' })
    expect(r).toEqual({ 'cdb:CDB BANCO X SA': { instituicao: 'XP', emissor: 'Banco X' } })
  })

  it('com resposta nos dois, vale a do canônico, campo a campo', () => {
    const r = respostasCanonicas(
      { velho: { instituicao: 'Rico', emissor: 'Banco X' }, novo: { instituicao: 'XP' } },
      { velho: 'novo' },
    )
    expect(r.novo).toEqual({ instituicao: 'XP', emissor: 'Banco X' })
  })

  it('cadeia de vínculos chega ao fim', () => {
    const r = respostasCanonicas({ a: { instituicao: 'XP' } }, { a: 'b', b: 'c' })
    expect(r).toEqual({ c: { instituicao: 'XP' } })
  })
})

describe('leitura do que veio de fora', () => {
  it('fica o que tem forma, sai o resto', () => {
    const r = lerInstituicaoPorBem({
      a: { instituicao: '  XP  ', emissor: 'Banco X' },
      b: { instituicao: 42 },
      c: 'texto',
      d: { instituicao: '', emissor: null },
      e: { emissor: 'Banco Y' },
    })
    expect(r).toEqual({ a: { instituicao: 'XP', emissor: 'Banco X' }, e: { emissor: 'Banco Y' } })
  })

  it('o que não é objeto vira vazio, e não erro', () => {
    expect(lerInstituicaoPorBem(undefined)).toEqual({})
    expect(lerInstituicaoPorBem([1, 2])).toEqual({})
  })
})

describe('a lista de bens', () => {
  const h = hist(
    ano(2023, [
      p('cdb:A', 'CDB BANCO A', 'cdb', 100_000),
      p('fundo:F', 'FUNDO F', 'fundo', 50_000),
      p('imovel:AP', 'APARTAMENTO', 'imovel', 900_000),
    ]),
    ano(2024, [
      p('cdb:A', 'CDB BANCO A S.A. 2027', 'cdb', 120_000, 100_000),
      p('fundo:F', 'FUNDO F', 'fundo', 0, 50_000),
      p('lci:L', 'LCI BANCO B', 'lci', 30_000),
    ]),
  )

  it('um por bem, com a descrição do último ano — e sem imóvel', () => {
    const bens = bensEmInstituicao(h)
    expect(bens.map((b) => b.id)).toEqual(['cdb:A', 'lci:L', 'fundo:F'])
    expect(bens[0]).toMatchObject({ descricao: 'CDB BANCO A S.A. 2027', anos: [2023, 2024], saldo: 120_000 })
  })

  it('o bem que já saiu entra depois dos atuais: a rentabilidade dos anos passados precisa dele', () => {
    const fundo = bensEmInstituicao(h).find((b) => b.id === 'fundo:F')
    expect(fundo).toMatchObject({ anos: [2023], saldo: 50_000 })
  })
})

describe('nomes e respostas', () => {
  it('a mesma instituição escrita de dois jeitos é uma só', () => {
    expect(idInstituicao('XP Investimentos')).toBe(idInstituicao('X.P. INVESTIMENTOS'))
    expect(nomesUsados({ a: { instituicao: 'XP' }, b: { instituicao: 'xp', emissor: 'Banco X' } })).toEqual(['Banco X', 'XP'])
  })

  it('o emissor só falta onde ele é pergunta', () => {
    expect(respostaCompleta('cdb', { instituicao: 'XP' })).toBe(false)
    expect(respostaCompleta('cdb', { instituicao: 'XP', emissor: 'Banco X' })).toBe(true)
    expect(respostaCompleta('tesouro', { instituicao: 'XP' })).toBe(true)
    expect(respostaCompleta('tesouro', undefined)).toBe(false)
  })
})

describe('sugestão pelo CNPJ da linha do bem', () => {
  // Nomes como vêm nos registros de rendimento: razão social, em maiúsculas.
  const BB = '00000000000191'
  const DTVM = '34508872000187' // qualquer CNPJ válido serve: o nome é que diz o que ele é
  const IP = '12345678000195'
  const nomePorCnpj = {
    [BB]: 'BANCO DO BRASIL S.A.',
    [DTVM]: 'INTER DISTRIB DE TIT E VAL MOB LTDA',
    [IP]: 'EXEMPLO PAY INSTITUICAO DE PAGAMENTO S.A.',
  }

  it('na conta, o banco do CNPJ é onde está e quem deve', () => {
    const s = sugerirInstituicao('CONTA CORRENTE AG 1234', 'contaCorrente', { cnpj: BB, grupo: '06', nomePorCnpj })
    expect(s).toMatchObject({ instituicao: 'Banco do Brasil', emissor: 'Banco do Brasil' })
    expect(s?.aproximada).toBeUndefined()
    expect(s?.motivo).toMatch(/BANCO DO BRASIL S\.A\./)
  })

  it('conta em quem não é banco sugere «sem FGC» — e não entra em bloco', () => {
    // Há conta de pagamento cujo saldo é aplicado sozinho num papel de banco, e
    // aí tem FGC: só a pessoa sabe.
    const s = sugerirInstituicao('SALDO EM CONTA', 'contaCorrente', { cnpj: IP, grupo: '06', nomePorCnpj })
    expect(s).toMatchObject({ instituicao: 'EXEMPLO PAY INSTITUICAO DE PAGAMENTO S.A.', semFgc: true, aproximada: true })
    expect(s?.emissor).toBeUndefined()
  })

  it('na renda fixa guardada no banco, sem outro banco na descrição, o banco é quem deve', () => {
    const s = sugerirInstituicao('LCA 2026', 'lci', { cnpj: BB, grupo: '04', nomePorCnpj })
    expect(s).toMatchObject({ instituicao: 'Banco do Brasil', emissor: 'Banco do Brasil' })
    expect(s?.aproximada).toBeUndefined()
  })

  it('na renda fixa guardada numa distribuidora, onde está é ela, e quem deve fica sem palpite', () => {
    // Distribuidora não emite CDB: tomá-la por emissor erraria o FGC.
    const s = sugerirInstituicao('CDB 2027', 'cdb', { cnpj: DTVM, grupo: '04', nomePorCnpj })
    expect(s?.instituicao).toBe('Banco Inter') // o nome conhecido, para juntar com a conta do mesmo lugar
    expect(s?.emissor).toBeUndefined()
    expect(s?.motivo).toMatch(/distribuidora não emite/)
  })

  it('a descrição ainda diz quem deve, quando cita alguém', () => {
    const s = sugerirInstituicao('CDB BANCO AURORA 2028', 'cdb', { cnpj: DTVM, grupo: '04', nomePorCnpj })
    expect(s).toMatchObject({ instituicao: 'Banco Inter', emissor: 'BANCO AURORA', aproximada: true })
  })

  it('no fundo o CNPJ é o próprio fundo, e não diz onde ele está', () => {
    const s = sugerirInstituicao('FUNDO QUALQUER XP', 'fundo', { cnpj: BB, grupo: '07', nomePorCnpj })
    expect(s?.instituicao).toBe('XP Investimentos') // veio da descrição, não do CNPJ
  })

  it('CNPJ sem nome nos rendimentos não vira nome de banco, mas fica no motivo', () => {
    const s = sugerirInstituicao('CDB BTG PACTUAL 2027', 'cdb', { cnpj: '11222333000181', grupo: '04', nomePorCnpj })
    expect(s?.instituicao).toBe('BTG Pactual')
    expect(s?.motivo).toMatch(/11\.222\.333\/0001-81, sem nome/)
  })
})

describe('sem FGC', () => {
  it('a conta sem FGC está respondida sem quem deve', () => {
    expect(respostaCompleta('contaCorrente', { instituicao: 'Exemplo Pay', semFgc: true })).toBe(true)
    expect(respostaCompleta('cdb', { instituicao: 'Exemplo Pay', semFgc: true })).toBe(false)
  })

  it('atravessa a porta só se for verdadeiro, e acompanha o vínculo', () => {
    expect(lerInstituicaoPorBem({ a: { instituicao: 'X', semFgc: true }, b: { instituicao: 'Y', semFgc: 'sim' } })).toEqual({
      a: { instituicao: 'X', semFgc: true },
      b: { instituicao: 'Y' },
    })
    expect(respostasCanonicas({ velho: { semFgc: true }, novo: { instituicao: 'X' } }, { velho: 'novo' })).toEqual({
      novo: { instituicao: 'X', semFgc: true },
    })
  })
})

describe('o CNPJ na lista de bens e o nome dos rendimentos', () => {
  it('o bem leva o CNPJ e o grupo do ano mais recente que os traz', () => {
    const h = hist(
      ano(2023, [{ ...p('lci:L', 'LCA 2026', 'lci', 10_000), codigo: '04', subcodigo: '03', cnpj: '00000000000191' }]),
      ano(2024, [{ ...p('lci:L', 'LCA 2026', 'lci', 12_000, 10_000), codigo: '04', subcodigo: '03' }]),
    )
    expect(bensEmInstituicao(h)[0]).toMatchObject({ cnpj: '00000000000191', grupo: '04' })
  })

  it('o nome de cada CNPJ sai dos pagadores das declarações', () => {
    const d = ano(2024, [])
    d.porPagador = [
      { alvo: 'cdb', pagador: { id: 'cnpj:00000000000191', nome: '', cnpj: '00000000000191' }, valor: 1 },
      { alvo: 'isentos', pagador: { id: 'cnpj:00000000000191', nome: 'BANCO DO BRASIL S.A.', cnpj: '00000000000191' }, valor: 1 },
    ]
    expect(nomesPorCnpj(hist(d))).toEqual({ '00000000000191': 'BANCO DO BRASIL S.A.' })
  })
})

describe('o nome da instituição, venha de onde vier', () => {
  it('a razão social de uma conhecida vira o nome curto — a XP do extrato é a XP do .DEC', () => {
    expect(nomeDaInstituicao('XP INVESTIMENTOS CCTVM S/A')).toBe('XP Investimentos')
    expect(nomeDaInstituicao('XP Investimentos Corretora de Câmbio, Títulos e Valores Mobiliários S.A.')).toBe('XP Investimentos')
    expect(nomeDaInstituicao('BTG PACTUAL CTVM S/A')).toBe('BTG Pactual')
  })

  it('a que não está na lista fica como veio, só sem espaço sobrando', () => {
    expect(nomeDaInstituicao('  CORRETORA  QUALQUER  S/A ')).toBe('CORRETORA QUALQUER S/A')
  })
})
