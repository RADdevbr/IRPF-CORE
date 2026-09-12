// Ponto de entrada mínimo: só a identidade do app.
//
// O resto entra por subpath (`@raddevbr/irpf-core/cofre`, `/historico`, …) de
// propósito. Um índice que reexportasse tudo faria o app que só quer formatar um
// número arrastar o SDK do Supabase e o leitor de .xlsx para o bundle.
export * from './app/config'
