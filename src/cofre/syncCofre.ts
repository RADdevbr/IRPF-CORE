// Orquestração do sync — usa a política de `sync.ts` e um `Remoto` qualquer.
// Não conhece Supabase nem React: dá para exercitar o fluxo inteiro com um
// servidor falso, que é como os testes cobrem conflito e cofres divergentes.

import type { CofreCompleto, Wrap } from './crypto.js'
import {
  decidirSync,
  deDoc,
  paraDoc,
  unirWraps,
  ChavesDiferentes,
  ConflitoDeVersao,
  DOC_ESTADO,
  type Decisao,
  type EstadoSync,
  type Remoto,
  type ResumoRemoto,
} from './sync.js'

export interface ResultadoSync {
  acao: Decisao['acao'] | 'adotar-chave'
  estado: EstadoSync
  /** Preenchido quando o conteúdo local deve ser substituído. */
  cofre?: CofreCompleto
  remoto?: ResumoRemoto
  /**
   * Preenchido em `adotar-chave`: os métodos que a conta já tem. A tela pede um
   * deles, abre a chave com `abrirDek` e cria o cofre deste app com ELA — nunca
   * com uma chave nova, que invalidaria os métodos dos outros apps da conta.
   */
  wraps?: Wrap[]
  mensagem: string
}

/**
 * Traduz a recusa de misturar chaves para a tela que já existe.
 *
 * Qualquer união de embrulhos passa por aqui: é o que garante que nenhum caminho
 * do sync consiga gravar um cofre com métodos de uma chave e conteúdo de outra.
 */
function unir(locais: Wrap[], remotos: Wrap[]): Wrap[] | 'chaves-diferentes' {
  try {
    return unirWraps(locais, remotos)
  } catch (e) {
    if (e instanceof ChavesDiferentes) return 'chaves-diferentes'
    throw e
  }
}

const COFRES_DIFERENTES =
  'A conta tem um cofre diferente deste — criados separadamente, com chaves diferentes. Um dos dois ' +
  'precisa ser escolhido; juntar não é possível, porque os métodos de um não abrem o conteúdo do outro.'

const SEM_MUDANCA: EstadoSync = { baseVersion: null, sujo: false }

export async function sincronizar(
  r: Remoto,
  local: CofreCompleto | null,
  estado: EstadoSync,
  docId: string = DOC_ESTADO,
): Promise<ResultadoSync> {
  const doc = await r.lerDoc(docId)

  if (!local && !doc) {
    // Os embrulhos são um conjunto por CONTA; os documentos, um por APP. Então
    // "não tenho documento" tem dois significados diferentes, e tratá-los igual
    // era o que travava o segundo app da conta.
    const daConta = await r.lerWraps()
    if (daConta.length > 0) {
      return {
        acao: 'adotar-chave',
        estado: SEM_MUDANCA,
        wraps: daConta,
        mensagem:
          'Sua conta já tem uma chave, de outro app da família. Destrave com um dos métodos dela e este ' +
          'app passa a usar a MESMA chave — os seus dados aqui ficam num cofre separado, mas um ' +
          'desbloqueio só serve para todos.',
      }
    }
    // Nem aqui nem na conta. Quem chega por este caminho quase sempre é alguém no
    // aparelho NOVO esperando os dados do outro: dizer só "nada para sincronizar"
    // deixa a pessoa achando que perdeu tudo, quando o que falta é um passo no
    // aparelho onde os dados estão.
    return {
      acao: 'nada',
      estado: SEM_MUDANCA,
      mensagem:
        'Sua conta ainda não tem cofre. No aparelho onde estão os dados, abra Conta e clique em "Sincronizar agora" — depois volte aqui.',
    }
  }

  // Aparelho novo: não há nada local para conflitar, então é só trazer.
  if (!local && doc) {
    const cofre = deDoc(doc, await r.lerWraps())
    return {
      acao: 'baixar',
      estado: { baseVersion: doc.version, sujo: false },
      cofre,
      mensagem: 'Cofre trazido da sua conta. Destrave com senha ou chave de recuperação.',
    }
  }

  const cofreLocal = local as CofreCompleto
  const decisao = decidirSync(estado, doc, cofreLocal.vaultId)

  switch (decisao.acao) {
    case 'nada':
      return { acao: 'nada', estado, mensagem: 'Já estava em dia.' }

    case 'enviar': {
      // Mesmo enviando, trazemos os métodos que só existem no servidor: eles
      // abrem a mesma chave, e perder o desbloqueio de outro aparelho é o pior
      // estrago que um sync pode fazer.
      //
      // Os embrulhos da conta são lidos SEMPRE, inclusive na primeira subida
      // deste documento. Antes eram lidos só quando o documento já existia — e
      // com três apps numa conta é exatamente na primeira subida que o app
      // encontraria as chaves dos outros pela frente.
      const wraps = unir(cofreLocal.wraps, await r.lerWraps())
      if (wraps === 'chaves-diferentes') {
        return { acao: 'cofres-diferentes', estado, remoto: doc ?? undefined, mensagem: COFRES_DIFERENTES }
      }
      const version = (doc?.version ?? 0) + 1
      const unido: CofreCompleto = { ...cofreLocal, wraps }
      await r.gravarWraps(wraps)
      let gravado
      try {
        gravado = await r.gravarDoc(paraDoc(unido, docId, version))
      } catch (e) {
        // Outro aparelho gravou entre a leitura e a escrita. Não é erro de rede
        // nem falha do app: é a mesma pergunta do conflito, e vai para a mesma
        // tela — decidir por conta própria aqui é como se perdia dado antes.
        if (e instanceof ConflitoDeVersao) {
          return {
            acao: 'conflito',
            estado,
            remoto: (await r.lerDoc(docId)) ?? undefined,
            mensagem:
              'Outro aparelho gravou este cofre enquanto você editava aqui. Escolha qual versão vale.',
          }
        }
        throw e
      }
      return {
        acao: 'enviar',
        estado: { baseVersion: gravado.version, sujo: false },
        cofre: unido,
        mensagem: 'Enviado para a sua conta.',
      }
    }

    case 'baixar': {
      const wraps = unir(cofreLocal.wraps, await r.lerWraps())
      if (wraps === 'chaves-diferentes') {
        return { acao: 'cofres-diferentes', estado, remoto: doc!, mensagem: COFRES_DIFERENTES }
      }
      return {
        acao: 'baixar',
        estado: { baseVersion: doc!.version, sujo: false },
        cofre: deDoc(doc!, wraps),
        mensagem: 'Versão da sua conta trazida para este aparelho.',
      }
    }

    case 'conflito':
      return {
        acao: 'conflito',
        estado,
        remoto: doc!,
        mensagem: 'Este cofre foi editado em outro aparelho. Escolha qual versão vale.',
      }

    case 'cofres-diferentes':
      return { acao: 'cofres-diferentes', estado, remoto: doc!, mensagem: COFRES_DIFERENTES }
  }
}

/** Resolve mandando o conteúdo local por cima do servidor. */
export async function resolverComLocal(
  r: Remoto,
  local: CofreCompleto,
  docId: string = DOC_ESTADO,
  unirMetodos = true,
): Promise<ResultadoSync> {
  const doc = await r.lerDoc(docId)
  const juntos = unirMetodos ? unir(local.wraps, await r.lerWraps()) : local.wraps
  // Resolver «minha versão vale» é escolha explícita: se as chaves divergem, o
  // que a pessoa quer é o próprio conjunto, não uma mistura que não abre.
  const wraps = juntos === 'chaves-diferentes' ? local.wraps : juntos
  const unido: CofreCompleto = { ...local, wraps }
  await r.gravarWraps(wraps)
  const gravado = await r.gravarDoc(paraDoc(unido, docId, (doc?.version ?? 0) + 1))
  return {
    acao: 'enviar',
    estado: { baseVersion: gravado.version, sujo: false },
    cofre: unido,
    mensagem: 'Sua versão foi mantida e enviada.',
  }
}

/** Resolve trazendo o servidor por cima do local. */
export async function resolverComRemoto(
  r: Remoto,
  local: CofreCompleto | null,
  docId: string = DOC_ESTADO,
  unirMetodos = true,
): Promise<ResultadoSync> {
  const doc = await r.lerDoc(docId)
  if (!doc) throw new Error('A conta não tem cofre para trazer.')
  const remotos = await r.lerWraps()
  const juntos = unirMetodos && local ? unir(local.wraps, remotos) : remotos
  // Simétrico ao de cima: escolher «a versão da conta vale» com chaves
  // divergentes significa ficar com os métodos DA CONTA, que são os que abrem o
  // conteúdo que está vindo.
  const wraps = juntos === 'chaves-diferentes' ? remotos : juntos
  return {
    acao: 'baixar',
    estado: { baseVersion: doc.version, sujo: false },
    cofre: deDoc(doc, wraps),
    mensagem: 'Versão da conta trazida. Destrave com um método que exista nela.',
  }
}
