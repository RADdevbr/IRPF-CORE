// Apagar uma conta de verdade — a única coisa que a tela não conseguia fazer.
//
// Existe porque apagar `auth.users` exige a service_role, e essa chave não pode
// morar no navegador: quem a tivesse no bundle apagaria qualquer coisa do
// projeto. Aqui ela fica no servidor, e o que chega do app é só um pedido
// assinado — que esta função confere antes de obedecer.
//
// A conferência é em duas etapas, e as duas importam:
//   1. o JWT de quem pediu é válido? (senão, 401)
//   2. essa pessoa está em `admins`? — perguntado com a chave ANON e o JWT
//      dela, então quem responde é a RLS, não a nossa opinião (senão, 403)
//
// Só depois disso a service_role entra em cena. O apagar é um só: as tabelas do
// cofre têm `on delete cascade` para auth.users, então sai tudo junto.
//
// Implantar (uma vez, com a CLI do Supabase):
//
//   supabase functions deploy apagar-conta --project-ref SEU_REF
//
// Sem implantar, o app continua funcionando: ele detecta a ausência e cai no
// plano B (apagar os dados e bloquear), dizendo qual dos dois fez.

import { createClient } from 'jsr:@supabase/supabase-js@2'

/**
 * De onde esta função aceita ser chamada.
 *
 * `ORIGENS` é uma lista separada por vírgula, configurada no ambiente da função:
 *
 *   supabase secrets set ORIGENS="https://seu-app.vercel.app,http://localhost:5173"
 *
 * Não havia CSRF a explorar aqui — a autorização é por Bearer, não por cookie,
 * e o navegador não anexa credencial sozinho. Mas `*` não descreve a intenção:
 * esta função só existe para a tela de administração deste app, e a lista diz
 * isso. Sem `ORIGENS` configurada, mantém-se `*` para não quebrar quem já a tem
 * implantada — o app avisa na tela de admin.
 */
const ORIGENS = (Deno.env.get('ORIGENS') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function corsPara(req: Request): Record<string, string> {
  const origem = req.headers.get('Origin') ?? ''
  const permitida = ORIGENS.length === 0 ? '*' : ORIGENS.includes(origem) ? origem : ''
  return {
    // Origem fora da lista não recebe o cabeçalho: o navegador bloqueia a
    // resposta, que é o comportamento correto — e a função nem chega a agir.
    ...(permitida ? { 'Access-Control-Allow-Origin': permitida } : {}),
    // A resposta varia com a origem: sem isto, um cache intermediário poderia
    // servir a permissão de um site para outro.
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsPara(req)
  const json = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ erro: 'método não suportado' }, 405)
  if (ORIGENS.length > 0 && !cors['Access-Control-Allow-Origin']) {
    return json({ erro: 'origem não autorizada' }, 403)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const autorizacao = req.headers.get('Authorization') ?? ''
  if (!autorizacao.startsWith('Bearer ')) return json({ erro: 'sem credencial' }, 401)

  // Cliente com a chave ANON e o JWT de quem pediu: tudo o que ele enxergar é o
  // que a RLS deixa ESSA pessoa enxergar.
  const comoUsuario = createClient(url, anon, { global: { headers: { Authorization: autorizacao } } })
  const { data: sessao } = await comoUsuario.auth.getUser()
  const pedinte = sessao?.user
  if (!pedinte) return json({ erro: 'credencial inválida' }, 401)

  const { data: admin } = await comoUsuario.from('admins').select('user_id').eq('user_id', pedinte.id).maybeSingle()
  if (!admin) return json({ erro: 'só quem administra pode apagar contas' }, 403)

  let alvo: string | undefined
  try {
    alvo = (await req.json())?.userId
  } catch {
    return json({ erro: 'corpo inválido' }, 400)
  }
  if (!alvo || typeof alvo !== 'string') return json({ erro: 'falta o userId' }, 400)

  // Apagar a si mesmo deixaria o app sem dono e sem quem crie convites. Se for
  // mesmo a intenção, o painel do Supabase faz.
  if (alvo === pedinte.id) return json({ erro: 'você não pode apagar a sua própria conta por aqui' }, 400)

  const comoServico = createClient(url, service)
  const { error } = await comoServico.auth.admin.deleteUser(alvo)
  if (error) return json({ erro: error.message }, 500)

  // As tabelas do cofre referenciam auth.users com on delete cascade: com o
  // usuário fora, cofre, embrulhos e espelho já foram junto. Conferimos em vez
  // de acreditar — falha silenciosa aqui deixaria dado de gente para trás.
  const { count } = await comoServico
    .from('vaults')
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', alvo)
  if ((count ?? 0) > 0) return json({ erro: 'usuário apagado, mas sobrou cofre — confira no painel' }, 500)

  return json({ ok: true })
})
