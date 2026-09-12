// O cofre cifrado: Argon2id + AES-GCM, uma chave embrulhada N vezes — uma por
// método de desbloqueio. O servidor guarda blobs opacos e a chave nunca sai do
// navegador.
//
// A CONTA não está aqui, e isso é de propósito: `remoto.ts`, `admin.ts`,
// `ContaSync` e `Admin` importam o SDK do Supabase (~200 kB) e vivem em
// `@raddevbr/irpf-core/cofre/conta`, para ser carregados sob demanda. Quem usa o
// app só localmente não paga por eles. Reexportá-los aqui apagaria a fronteira
// que faz o code-splitting funcionar.
//
// Com três apps na mesma conta, os embrulhos continuam sendo UM conjunto por
// conta (um desbloqueio serve para todos) e os documentos passaram a ser um por
// app. Ver `dekId` em `crypto.ts` e `adotar-chave` em `syncCofre.ts` para o que
// impede que isso misture chaves de apps diferentes.
export * from './crypto'
export * from './vault'
export * from './passkey'
export * from './dispositivo'
export * from './sync'
export * from './syncCofre'
export * from './config'
export * from './sessaoLembrada'
export { VaultGate } from './VaultGate'
export { UnlockMethods } from './UnlockMethods'
export { PasskeyDoctor } from './PasskeyDoctor'
