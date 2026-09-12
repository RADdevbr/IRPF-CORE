// Leitor de .xlsx sem dependência: um .xlsx é um zip com XML dentro, e o
// navegador já traz `DecompressionStream`. Num app que existe para não mandar
// dado fiscal a lugar nenhum, entregar a planilha a um pacote de terceiro só
// para abri-la seria contraditório.
export * from './xlsx.js'
export * from './exemplo.js'
export * from './montar.js'
