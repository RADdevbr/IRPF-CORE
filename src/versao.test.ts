/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest'
import pacote from '../package.json?raw'
import historico from '../CHANGELOG.md?raw'

// A versão do núcleo e o CHANGELOG andam juntos: subir uma sem escrever a outra
// é publicar um número que ninguém sabe dizer o que trouxe. Os apps mostram este
// número no rodapé — um número errado ali manda procurar a mudança no lugar
// errado.

/** SemVer com os sufixos de fase que a família usa: -alpha, -beta, -rc.N. */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta)(\.(0|[1-9]\d*))?|-rc\.(0|[1-9]\d*))?$/

const versao = (JSON.parse(pacote) as { version: string }).version
const publicadas = [...historico.matchAll(/^## \[([^\]]+)\]/gm)].map((m) => m[1]).filter((v) => v !== 'Não publicado')

describe('a versão do núcleo', () => {
  it('segue o SemVer', () => {
    expect(versao).toMatch(SEMVER)
  })

  it('a entrada mais nova do CHANGELOG é a do package.json', () => {
    expect(publicadas[0]).toBe(versao)
  })

  it('cada versão do CHANGELOG aparece uma vez só, e é SemVer', () => {
    expect(new Set(publicadas).size).toBe(publicadas.length)
    for (const v of publicadas) expect(v).toMatch(SEMVER)
  })
})
