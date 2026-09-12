import { describe, it, expect } from 'vitest'
import {
  criarCofre,
  novoWrap,
  destravar,
  podeRemover,
  removerWrap,
  gerarCodigoRecuperacao,
  normalizarCodigo,
  cifrarCofre,
  decifrarCofre,
  gerarDek,
  type Argon2Params,
  type CofreCompleto,
} from './crypto'

// Argon2id leve só para os testes — produção usa ARGON2_PADRAO (64 MiB, t=3).
const LEVE: Argon2Params = { m: 8192, t: 1, p: 1 }
const AGORA = '2026-08-23T19:00:00.000Z'
const DADOS = { vals: { salario: 180000, divBR: 840000 }, ndep: 2 }

// Simula os 32 bytes que o PRF da passkey devolve.
const segredoPasskey = () => new Uint8Array(32).fill(7)

describe('cofre — ciclo básico', () => {
  it('cifra e decifra os dados pela senha', async () => {
    const { cofre } = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'senha-forte-123' }, AGORA, LEVE)
    const { dados } = await destravar<typeof DADOS>(cofre, 'senha', 'senha-forte-123')
    expect(dados).toEqual(DADOS)
  })

  it('o cofre guardado não contém os dados em claro', async () => {
    const { cofre } = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'x1y2z3w4' }, AGORA, LEVE)
    const serializado = JSON.stringify(cofre)
    expect(serializado).not.toContain('840000')
    expect(serializado).not.toContain('salario')
  })

  it('recusa senha errada', async () => {
    const { cofre } = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'certa' }, AGORA, LEVE)
    await expect(destravar(cofre, 'senha', 'errada')).rejects.toThrow(/não foi possível abrir/i)
  })

  it('detecta cofre adulterado', async () => {
    const dek = gerarDek()
    const cofre = await cifrarCofre(dek, DADOS)
    const bytes = [...atob(cofre.ciphertext)].map((c) => c.charCodeAt(0))
    bytes[0] ^= 0xff
    const adulterado = { ...cofre, ciphertext: btoa(String.fromCharCode(...bytes)) }
    await expect(decifrarCofre(dek, adulterado)).rejects.toThrow(/adulterado/i)
  })

  it('embrulho de um cofre com conteúdo de outro: diz que a chave está CERTA e o conteúdo não', async () => {
    // O estrago que uma sincronização de cofres misturados deixa: o método abre
    // o embrulho, mas a DEK que sai dele não decifra o conteúdo. A mensagem
    // não pode culpar a chave — é ela a única coisa certa nessa história.
    const a = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'senha-do-a-1' }, AGORA, LEVE)
    const b = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'senha-do-b-2' }, AGORA, LEVE)
    const misturado: CofreCompleto = { ...a.cofre, cofre: b.cofre.cofre }
    await expect(destravar(misturado, 'senha', 'senha-do-a-1')).rejects.toThrow(/chave está certa/i)
    // senha errada continua sendo "não foi possível abrir" — são erros distintos
    await expect(destravar(misturado, 'senha', 'senha-errada')).rejects.toThrow(/não foi possível abrir/i)
  })
})

describe('N embrulhos da mesma chave', () => {
  const montar = async (): Promise<{ cofre: CofreCompleto; codigo: string }> => {
    const { cofre, dek } = await criarCofre(
      DADOS,
      { wrapId: 'passkey:iphone', metodo: 'passkey', rotulo: 'iPhone · Face ID', segredo: segredoPasskey() },
      AGORA,
      LEVE,
    )
    const codigo = gerarCodigoRecuperacao()
    const wraps = [
      await novoWrap(dek, { wrapId: 'recuperacao', metodo: 'recuperacao', segredo: codigo }, AGORA, LEVE),
      await novoWrap(dek, { wrapId: 'senha', metodo: 'senha', segredo: 'alternativa-99' }, AGORA, LEVE),
    ]
    return { cofre: { ...cofre, wraps: [...cofre.wraps, ...wraps] }, codigo }
  }

  it('abre pelos três métodos e chega na MESMA chave', async () => {
    const { cofre, codigo } = await montar()
    const a = await destravar<typeof DADOS>(cofre, 'passkey:iphone', segredoPasskey())
    const b = await destravar<typeof DADOS>(cofre, 'recuperacao', codigo)
    const c = await destravar<typeof DADOS>(cofre, 'senha', 'alternativa-99')
    expect(a.dek).toEqual(b.dek)
    expect(b.dek).toEqual(c.dek)
    expect(a.dados).toEqual(DADOS)
    expect(c.dados).toEqual(DADOS)
  })

  it('cada método tem salt e embrulho próprios', async () => {
    const { cofre } = await montar()
    const salts = cofre.wraps.map((w) => w.salt)
    const blobs = cofre.wraps.map((w) => w.wrappedDek)
    expect(new Set(salts).size).toBe(3)
    expect(new Set(blobs).size).toBe(3)
  })

  it('remover um método não afeta os outros', async () => {
    const { cofre, codigo } = await montar()
    const menor = removerWrap(cofre, 'senha')
    expect(menor.wraps).toHaveLength(2)
    const { dados } = await destravar<typeof DADOS>(menor, 'recuperacao', codigo)
    expect(dados).toEqual(DADOS)
  })

  it('a senha errada em um método não abre pelo outro', async () => {
    const { cofre } = await montar()
    await expect(destravar(cofre, 'senha', 'chute')).rejects.toThrow()
    await expect(destravar(cofre, 'passkey:iphone', new Uint8Array(32).fill(8))).rejects.toThrow()
  })
})

describe('regra dos dois caminhos', () => {
  it('bloqueia a remoção quando sobrariam menos de dois métodos', async () => {
    const { cofre, dek } = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'abc12345' }, AGORA, LEVE)
    const comDois = {
      ...cofre,
      wraps: [...cofre.wraps, await novoWrap(dek, { wrapId: 'recuperacao', metodo: 'recuperacao', segredo: gerarCodigoRecuperacao() }, AGORA, LEVE)],
    }
    expect(podeRemover(comDois, 'senha')).toMatch(/pelo menos dois/i)
    expect(() => removerWrap(comDois, 'senha')).toThrow(/pelo menos dois/i)
  })

  it('libera a remoção com três métodos ativos', async () => {
    const { cofre, dek } = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'abc12345' }, AGORA, LEVE)
    const comTres = {
      ...cofre,
      wraps: [
        ...cofre.wraps,
        await novoWrap(dek, { wrapId: 'recuperacao', metodo: 'recuperacao', segredo: gerarCodigoRecuperacao() }, AGORA, LEVE),
        await novoWrap(dek, { wrapId: 'passkey:mac', metodo: 'passkey', segredo: segredoPasskey() }, AGORA, LEVE),
      ],
    }
    expect(podeRemover(comTres, 'senha')).toBeNull()
  })

  it('recusa remover método inexistente', async () => {
    const { cofre } = await criarCofre(DADOS, { wrapId: 'senha', metodo: 'senha', segredo: 'abc12345' }, AGORA, LEVE)
    expect(podeRemover(cofre, 'nao-existe')).toMatch(/não existe/i)
  })
})

describe('chave de recuperação', () => {
  it('gera 24 caracteres em 6 grupos', () => {
    const c = gerarCodigoRecuperacao()
    expect(c.split('-')).toHaveLength(6)
    expect(normalizarCodigo(c)).toHaveLength(24)
  })

  it('aceita como o usuário digita: minúsculas, espaços, O/0 e I/L/1', () => {
    const base = normalizarCodigo(gerarCodigoRecuperacao())
    const digitado = base.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l').match(/.{4}/g)!.join(' ')
    expect(normalizarCodigo(digitado)).toBe(base)
  })

  it('destrava mesmo com o código digitado torto', async () => {
    const codigo = gerarCodigoRecuperacao()
    const { cofre } = await criarCofre(DADOS, { wrapId: 'recuperacao', metodo: 'recuperacao', segredo: codigo }, AGORA, LEVE)
    const torto = normalizarCodigo(codigo).toLowerCase().replace(/0/g, 'o')
    const { dados } = await destravar<typeof DADOS>(cofre, 'recuperacao', torto)
    expect(dados).toEqual(DADOS)
  })

  it('reclama de tamanho e de caractere inválido', () => {
    expect(() => normalizarCodigo('ABC')).toThrow(/24 caracteres/)
    expect(() => normalizarCodigo('U'.repeat(24))).toThrow(/inválido/i)
  })
})
