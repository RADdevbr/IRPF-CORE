import { describe, it, expect } from 'vitest'
import { normalizaCodigo, validaConvite, conviteEsgotado, funcaoAusente, AVISO_APAGAR, type Convite } from './admin.js'

// A conversa com o banco não dá para testar aqui — quem autoriza é a RLS, e ela
// mora no Postgres. O que dá é o que decide antes de mandar: o código que a
// pessoa vai digitar no celular e o convite que não vale mais.

const convite = (p: Partial<Convite> = {}): Convite => ({
  codigo: 'AMIGOS-2027',
  usos: 0,
  usosMax: 10,
  criadoEm: '2026-01-01T00:00:00.000Z',
  ...p,
})

describe('código de convite', () => {
  it('vira maiúscula sem acento e sem espaço — é ditado por telefone', () => {
    expect(normalizaCodigo('amigos do consultório 2027')).toBe('AMIGOS-DO-CONSULTORIO-2027')
    expect(normalizaCodigo('  Ação  Nova ')).toBe('ACAO-NOVA')
  })

  it('não deixa traço sobrando nas pontas nem repetido no meio', () => {
    expect(normalizaCodigo('--turma---2027--')).toBe('TURMA-2027')
  })

  it('recusa o que não dá para ditar', () => {
    expect(validaConvite({ codigo: 'ab', usosMax: 1 })).toMatch(/4 caracteres/)
    expect(validaConvite({ codigo: '!!!', usosMax: 1 })).toMatch(/4 caracteres/)
  })

  it('convite sem uso nenhum não é convite', () => {
    expect(validaConvite({ codigo: 'TURMA-2027', usosMax: 0 })).toMatch(/pelo menos uma conta/)
    expect(validaConvite({ codigo: 'TURMA-2027', usosMax: Number.NaN })).toMatch(/pelo menos uma conta/)
  })

  it('validade, quando existe, é de pelo menos um dia', () => {
    expect(validaConvite({ codigo: 'TURMA-2027', usosMax: 5, diasDeValidade: 0 })).toMatch(/pelo menos um dia/)
    expect(validaConvite({ codigo: 'TURMA-2027', usosMax: 5, diasDeValidade: 30 })).toBe(null)
    // sem prazo é opção legítima
    expect(validaConvite({ codigo: 'TURMA-2027', usosMax: 5 })).toBe(null)
  })
})

describe('convite esgotado', () => {
  const agora = new Date('2026-06-01T12:00:00.000Z')

  it('acabaram os usos', () => {
    expect(conviteEsgotado(convite({ usos: 10, usosMax: 10 }), agora)).toBe(true)
    expect(conviteEsgotado(convite({ usos: 9, usosMax: 10 }), agora)).toBe(false)
  })

  it('venceu o prazo', () => {
    expect(conviteEsgotado(convite({ expiraEm: '2026-05-31T00:00:00.000Z' }), agora)).toBe(true)
    expect(conviteEsgotado(convite({ expiraEm: '2026-06-30T00:00:00.000Z' }), agora)).toBe(false)
  })

  it('sem prazo e com uso sobrando, vale', () => {
    expect(conviteEsgotado(convite(), agora)).toBe(false)
  })
})

describe('quando cair no plano B da exclusão', () => {
  it('função não implantada é ausência: segue e apaga os dados', () => {
    expect(funcaoAusente(new Error('Function not found'))).toBe(true)
    expect(funcaoAusente(new Error('Failed to send a request to the Edge Function'))).toBe(true)
    expect(funcaoAusente(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('recusa da função é resposta, não ausência — apagar assim mesmo seria desobedecer', () => {
    expect(funcaoAusente(new Error('só quem administra pode apagar contas'))).toBe(false)
    expect(funcaoAusente(new Error('você não pode apagar a sua própria conta por aqui'))).toBe(false)
    expect(funcaoAusente(new Error('403 Forbidden'))).toBe(false)
  })

  it('o aviso diz o que acontece nos dois casos', () => {
    expect(AVISO_APAGAR).toMatch(/conta inteira/)
    expect(AVISO_APAGAR).toMatch(/Sem a função de borda/)
  })
})
