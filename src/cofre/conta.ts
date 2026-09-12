// A conta: tudo o que fala com o Supabase.
//
// Separado de `cofre/index.ts` para ser importado sob demanda — `import()`
// dinâmico, não estático. O SDK do Supabase são ~200 kB, e o app funciona inteiro
// sem conta nenhuma: quem nunca abre esta tela não deve baixá-los.
export { remotoSupabase, clienteSupabase, esquecerClienteSupabase, docDaLinha, wrapDaLinha } from './remoto'
export * from './admin'
export { ContaSync } from './ContaSync'
export { Admin } from './Admin'
