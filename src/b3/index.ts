// Os relatórios da B3: o leitor do Extrato de Movimentação, o que cada linha
// significa, e a ponte entre o extrato e os bens da declaração.
//
// Está no núcleo porque dois apps leem o mesmo arquivo com perguntas diferentes —
// o IRPF-calc, para o imposto (provento por mês, apuração de bolsa), e o
// networthcontrol, para o patrimônio (aporte, data do dinheiro, custódia). Duas
// cópias do leitor e do vocabulário divergiriam na primeira renomeação da B3, e o
// mesmo arquivo passaria a dizer coisas diferentes em cada app.
//
// O que fica no IRPF-calc é o que só o imposto pergunta: a grade de proventos
// [mês × pagador], o Consolidado Anual e a apuração de bolsa.
export * from './leitura.js'
export * from './movimentacao.js'
export * from './produto.js'
export * from './papel.js'
export * from './efeito.js'
export * from './fluxos.js'
export * from './bens.js'
export * from './posicao.js'
export * from './negociacao.js'
