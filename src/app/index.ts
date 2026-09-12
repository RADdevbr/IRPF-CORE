// Identidade do app e onde ele grava.
//
// `configurarApp()` é a primeira coisa que o `main.tsx` chama: sem ela o núcleo
// não sabe sob que prefixo gravar e recusa gravar, em vez de escolher um padrão
// que faria dois apps dividirem o mesmo estado.
export * from './config.js'
export * from './armazenamento.js'
export * from './persistencia.js'
// A fiação do cofre (destravar, autosalvar, sincronizar, trancar sozinho) —
// escrita uma vez para os três apps. Ver o cabeçalho de `useCofreDoApp.ts`.
export * from './useCofreDoApp.js'
