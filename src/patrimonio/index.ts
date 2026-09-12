// Quanto o capital rendeu, e com que referência comparar.
//
// Está no núcleo porque é a mesma aritmética de dois lados: o painel de
// patrimônio a mostra como resultado, e a auditoria dos anos passados a usa para
// responder «o patrimônio cresceu mais do que a renda explica?». Duas versões
// dela divergiriam em silêncio, e divergir aqui é dizer a uma pessoa que ela tem
// acréscimo a descoberto quando não tem.
//
// O que NÃO está aqui: as telas e as séries do painel (projeção, poupança, renda
// menos gasto). Aquelas são as perguntas do networthcontrol.
export * from './capital.js'
export * from './benchmarks.js'
export * from './renda.js'
export * from './baseFutura.js'
