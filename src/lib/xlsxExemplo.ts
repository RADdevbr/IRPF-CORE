// Planilha de teste: um .xlsx montado à mão, em base64, exercitando o que o
// leitor precisa aguentar num extrato de verdade — duas abas, tabela de
// strings compartilhadas, string inline, célula numérica crua, tag vazia
// (<sheet ... />) e linhas de título antes do cabeçalho.
//
// Vive em base64 para o teste não depender de arquivo binário no repo: dá para
// ler o que tem dentro pelo próprio teste, e não há anexo opaco no versionamento.

export const XLSX_EXEMPLO_B64 =
  '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'

/** Os bytes do arquivo, prontos para `lerXlsx`. */
export function xlsxExemplo(): ArrayBuffer {
  const bin = atob(XLSX_EXEMPLO_B64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}
