# Funções de borda

Só uma, e só porque não dá de outro jeito.

## `apagar-conta`

A tela de controle de contas faz tudo o que a RLS autoriza com a chave anon:
criar convite, bloquear, apagar o cofre de alguém. Apagar a linha em
`auth.users` é a exceção — isso exige a `service_role`, que não pode viajar para
o navegador. Esta função guarda essa chave no servidor e só a usa depois de
conferir, com a chave anon e o JWT de quem pediu, que a pessoa está em `admins`.

Implantar (CLI do Supabase, uma vez):

```sh
supabase login
supabase link --project-ref SEU_REF
supabase functions deploy apagar-conta
```

Restrinja de onde ela aceita ser chamada — a autorização é por Bearer, então não
havia CSRF a explorar, mas `Access-Control-Allow-Origin: *` não descreve a
intenção de uma função que só a tela de admin deste app usa:

```sh
supabase secrets set ORIGENS="https://seu-app.vercel.app,http://localhost:5173"
```

Sem `ORIGENS`, ela continua aceitando qualquer origem — para não quebrar quem já
a tinha implantada.

Sem implantar, nada quebra: o app detecta a ausência e cai no plano B — apaga o
cofre e os embrulhos e bloqueia a conta —, dizendo na tela qual dos dois
aconteceu.
