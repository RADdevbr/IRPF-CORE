// Primitivos de tela: as cores, os números formatados e os três componentes que
// todo app da família usa. Nada aqui sabe de imposto.
export * from './theme'
export * from './format'
export { NumInput } from './NumInput'
export { ComDica, Rolavel, useDica } from './Dica'
export { ErroFatal } from './ErroFatal'
// Checagens de forma dos gráficos, para o teste de cada app rodar sobre as suas
// próprias fontes — ver `invariantes.ts`.
export * from './invariantes'
