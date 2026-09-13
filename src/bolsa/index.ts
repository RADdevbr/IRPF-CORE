// Renda variável: do extrato de operações até o ganho apurado.
//
// Preço médio, isenção mensal, compensação de prejuízo por modalidade. Está no
// núcleo porque dois apps precisam do MESMO número: quem importa o extrato da B3
// para conferir a declaração, e quem projeta o imposto do ano corrente.
export * from './bolsa.js'
// E o que ela PAGOU: a série de proventos, por mês, por ano e por papel. Separada
// da grade de `/fiscal` de propósito — lá o agrupamento é por pagador, porque o
// gatilho dos R$ 50 mil é por CNPJ; aqui é por papel, porque a pergunta é o
// rendimento. Ver o cabeçalho de `proventos.ts`.
export * from './proventos.js'
