// @vitest-environment jsdom
//
// O terceiro invariante que a auditoria propôs: a promessa do modo visita.
//
// Ele não se prova campo a campo — se provasse, não teria falhado em quatro
// pontos. Prova-se exercitando TODO caminho que grava (estado, cenários, cofre,
// chave de sessão, estado do sync, e-mail da conta) e afirmando que o disco
// continua vazio no fim.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  armazenamentoLocal,
  armazenamentoSessao,
  chavesGravadas,
  apagarTudoDesteAparelho,
  modoVisita,
  setModoVisita,
} from './armazenamento.js'
import { prefixoApp } from './config.js'
import { criarPersistencia } from './persistencia.js'
import { gravarCofre, lerCofre, lembrarDek, dekLembrada, gravarEstadoSync, lerEstadoSync } from '../cofre/vault.js'
import { lembrarConta, contaLembrada, esquecerConta } from '../cofre/sessaoLembrada.js'
import type { CofreCompleto } from '../cofre/crypto.js'

// O núcleo não conhece o formato de estado de app nenhum — ver `persistencia.ts`.
// Para este teste basta um objeto qualquer que atravesse a porta.
interface Estado {
  schemaVersion?: number
  vals: Record<string, number>
  ndep: number
}
const { saveState, saveScenarios, loadState } = criarPersistencia<Estado>({
  versao: 1,
  migrar: (b) => b as Estado,
})
const estado: Estado = { vals: { cdb: 1 }, ndep: 0 }
const cofre: CofreCompleto = {
  schemaVersion: 1,
  vaultId: 'abc',
  wraps: [],
  cofre: { v: 1, iv: 'aXY=', ciphertext: 'Z29zdG8=' },
}

/** Todo caminho do app que grava alguma coisa neste aparelho. */
function gravarTudo() {
  saveState(estado)
  saveScenarios([{ name: 'x', savedAt: 'agora', state: estado }])
  gravarCofre(cofre)
  lembrarDek(new Uint8Array([1, 2, 3]))
  gravarEstadoSync({ baseVersion: 3, sujo: true })
  lembrarConta('alguem@exemplo.com')
  // o token da conta é gravado pelo SDK do Supabase, sob a chave do app
  armazenamentoLocal().setItem(`${prefixoApp()}auth:v1`, '{"access_token":"tok"}')
}

/** O que ficou no disco de verdade, nos dois storages nativos. */
function noDisco(): string[] {
  const fora: string[] = []
  for (const st of [localStorage, sessionStorage]) {
    for (let i = 0; i < st.length; i++) {
      const k = st.key(i)
      if (k && k.startsWith(prefixoApp())) fora.push(k)
    }
  }
  return fora.sort()
}

beforeEach(() => {
  setModoVisita(false)
  localStorage.clear()
  sessionStorage.clear()
  apagarTudoDesteAparelho()
  esquecerConta()
})

describe('modo visita — a promessa, exercitada inteira', () => {
  it('com ele ligado, NENHUM caminho grava no aparelho', () => {
    setModoVisita(true)
    gravarTudo()
    expect(noDisco()).toEqual([])
    expect(chavesGravadas()).toEqual([])
  })

  it('e mesmo assim tudo continua legível dentro da sessão', () => {
    setModoVisita(true)
    gravarTudo()
    expect(loadState()?.vals.cdb).toBe(1)
    expect(lerCofre()?.vaultId).toBe('abc')
    expect(dekLembrada()).toEqual(new Uint8Array([1, 2, 3]))
    expect(lerEstadoSync()).toEqual({ baseVersion: 3, sujo: true })
    expect(contaLembrada()).toBe('alguem@exemplo.com')
    expect(armazenamentoLocal().getItem(`${prefixoApp()}auth:v1`)).toContain('tok')
  })

  it('com ele DESLIGADO, os mesmos caminhos gravam — o teste acima não passa por vácuo', () => {
    gravarTudo()
    expect(noDisco()).toEqual([
      `${prefixoApp()}auth:v1`,
      `${prefixoApp()}conta:v1`,
      `${prefixoApp()}dek:v1`,
      `${prefixoApp()}scenarios:v1`,
      `${prefixoApp()}state:v1`,
      `${prefixoApp()}sync:v1`,
      `${prefixoApp()}vault:v1`,
    ])
  })

  it('desligar o modo descarta a memória: a sessão volta a ler o disco', () => {
    saveState({ ...estado, vals: { cdb: 1 } })
    setModoVisita(true)
    saveState({ ...estado, vals: { cdb: 2 } })
    expect(loadState()?.vals.cdb).toBe(2)
    setModoVisita(false)
    expect(loadState()?.vals.cdb).toBe(1)
  })

  it('o interruptor é lido, não adivinhado', () => {
    expect(modoVisita()).toBe(false)
    setModoVisita(true)
    expect(modoVisita()).toBe(true)
  })
})

describe('apagar deste aparelho', () => {
  it('leva o token da conta junto — ele agora nasce sob o prefixo do app', () => {
    gravarTudo()
    expect(chavesGravadas()).toContain(`${prefixoApp()}auth:v1`)
    apagarTudoDesteAparelho()
    expect(noDisco()).toEqual([])
  })

  it('varre também o que morre com a aba (a chave da sessão destravada)', () => {
    lembrarDek(new Uint8Array([9]))
    expect(sessionStorage.getItem(`${prefixoApp()}dek:v1`)).toBeTruthy()
    apagarTudoDesteAparelho()
    expect(sessionStorage.getItem(`${prefixoApp()}dek:v1`)).toBeNull()
  })

  it('não toca no que não é deste app', () => {
    localStorage.setItem('outro-app', 'fica')
    gravarTudo()
    apagarTudoDesteAparelho()
    expect(localStorage.getItem('outro-app')).toBe('fica')
  })

  it('conta o que apagou', () => {
    gravarTudo()
    expect(apagarTudoDesteAparelho()).toBe(7)
    expect(apagarTudoDesteAparelho()).toBe(0)
  })

  it('em modo visita, esvazia a memória também', () => {
    setModoVisita(true)
    gravarTudo()
    apagarTudoDesteAparelho()
    expect(loadState()).toBeNull()
    expect(lerCofre()).toBeNull()
  })
})

// A promessa acima vale para os caminhos que existem hoje. Este teste é o que
// faz ela valer para os de amanhã: quem escrever `localStorage` direto num
// componente novo fura o modo visita exatamente como `gravarCofre` furava, e
// nenhum teste de comportamento pega isso até alguém reparar.
describe('a porta é única — e continua sendo', () => {
  // `import.meta.glob` com `?raw` entrega o texto de cada fonte do app pela
  // própria máquina do Vite — sem `fs`, que este projeto não tem tipado.
  const fontes = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >

  it('nenhum arquivo fora de armazenamento.ts fala com o storage do navegador', () => {
    const fora: string[] = []
    for (const [caminho, texto] of Object.entries(fontes)) {
      if (/\.test\.tsx?$/.test(caminho)) continue
      if (/(^|\/)armazenamento\.ts$/.test(caminho)) continue // a porta
      texto.split('\n').forEach((linha, i) => {
        // tira comentário de linha, de bloco numa linha só, e continuação de bloco
        const codigo = linha
          .replace(/\/\*.*?\*\//g, '')
          .replace(/\/\/.*$/, '')
          .replace(/^\s*[*/].*$/, '')
        if (/\b(localStorage|sessionStorage)\b/.test(codigo)) fora.push(`${caminho}:${i + 1}`)
      })
    }
    // se este teste ficar vazio por engano, ele passa por vácuo: confere que leu
    expect(Object.keys(fontes).length).toBeGreaterThan(20)
    expect(fora).toEqual([])
  })
})

describe('storage bloqueado pelo navegador', () => {
  it('cai na memória em vez de perder a escrita em silêncio', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')!
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('bloqueado')
      },
    })
    try {
      saveState({ ...estado, vals: { cdb: 42 } })
      expect(loadState()?.vals.cdb).toBe(42)
      expect(chavesGravadas()).toEqual([])
    } finally {
      Object.defineProperty(window, 'localStorage', real)
    }
  })

  it('a sessão também', () => {
    const real = Object.getOwnPropertyDescriptor(window, 'sessionStorage')!
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('bloqueado')
      },
    })
    try {
      expect(() => armazenamentoSessao().setItem('x', 'y')).not.toThrow()
    } finally {
      Object.defineProperty(window, 'sessionStorage', real)
    }
  })
})
