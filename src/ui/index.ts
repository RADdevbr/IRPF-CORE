// Primitivos de tela: as cores, os números formatados e os três componentes que
// todo app da família usa. Nada aqui sabe de imposto.
export * from './theme.js'
export * from './format.js'
export { NumInput } from './NumInput.js'
export { ComDica, Rolavel, useDica } from './Dica.js'
export { ErroFatal } from './ErroFatal.js'
// Checagens de forma dos gráficos, para o teste de cada app rodar sobre as suas
// próprias fontes — ver `invariantes.ts`.
export * from './invariantes.js'
