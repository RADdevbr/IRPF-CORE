/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `node` por padrão, e não jsdom: o leitor de .xlsx usa `Blob.stream()`, que o
// Blob do jsdom não tem. Quem precisa de DOM pede no próprio arquivo, com
// `// @vitest-environment jsdom` na primeira linha — é como o app fazia, e trocar
// o padrão quebrou o leitor sem que nada no teste dele tivesse mudado.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', setupFiles: ['./vitest.setup.ts'] },
})
