-- Esquema do cofre — ver PLAN-CONTA-E-HISTORICO.md §1.7.
--
-- O servidor NUNCA vê dados legíveis: `vaults.ciphertext` é AES-256-GCM fechado
-- com uma chave que só existe no navegador do usuário. `vault_wraps` guarda essa
-- mesma chave embrulhada uma vez por método de desbloqueio (passkey, senha,
-- chave de recuperação, futuramente certificado) — nenhum embrulho abre sozinho.
--
-- Rodar no SQL Editor do projeto Supabase. É idempotente: rodar de novo não
-- quebra nada, e a linha `alter table` abaixo acrescenta a coluna `vault_id` em
-- quem já tinha rodado a primeira versão deste arquivo.

create table if not exists public.vaults (
  user_id    uuid        not null references auth.users on delete cascade,
  doc_id     text        not null,          -- 'state' | 'scenario:<nome>' | 'dirpf:2024'
  ciphertext text        not null,          -- base64 do AES-256-GCM
  iv         text        not null,          -- base64
  version    integer     not null default 1,-- controle de conflito otimista
  vault_id   text,                            -- identidade do cofre (chaves diferentes = cofres diferentes)
  updated_at timestamptz not null default now(),
  primary key (user_id, doc_id)
);

create table if not exists public.vault_wraps (
  user_id     uuid        not null references auth.users on delete cascade,
  wrap_id     text        not null,         -- 'passkey:<credId>' | 'senha' | 'recuperacao'
  metodo      text        not null check (metodo in ('passkey', 'senha', 'recuperacao', 'certificado')),
  rotulo      text,                         -- 'iPhone · Face ID'
  kdf         text        not null check (kdf in ('argon2id', 'pbkdf2', 'hkdf')),
  kdf_params  jsonb,
  salt        text        not null,         -- base64
  wrapped_dek text        not null,         -- base64 (iv || ciphertext)
  dek_id      text,                         -- impressão da chave que este embrulho abre
  criado_em   timestamptz not null default now(),
  primary key (user_id, wrap_id)
);

-- Para quem rodou a versão anterior deste schema, antes de o sync existir:
alter table public.vaults add column if not exists vault_id text;

-- E para quem rodou antes de a família ter três apps.
--
-- Os embrulhos são um conjunto por CONTA; os cofres passaram a ser um por APP
-- (`doc_id` = 'irpfm:state', 'irpfcalc:state', 'networth:state'). Um app que
-- sorteasse chave própria subiria embrulhos dela para a mesma conta, e o outro
-- app destravaria com um método que devolve a chave errada: o embrulho abre, o
-- conteúdo não decifra. `dek_id` é a impressão (SHA-256 truncado) da chave que
-- cada embrulho abre — não é segredo, e é o bastante para o cliente recusar a
-- mistura antes de gravar. Nulo em embrulhos criados antes disto, e nulo
-- significa «não sei», nunca «chave diferente».
alter table public.vault_wraps add column if not exists dek_id text;

-- A versão só anda para a frente.
--
-- O controle de conflito de verdade é no cliente, que grava condicionado à
-- versão que leu (ver `remoto.ts`). Este gatilho é a segunda tranca: um cliente
-- antigo, um script, ou um bug futuro não conseguem rebobinar o cofre de
-- alguém. Recusar é melhor que aceitar em silêncio — quem perde a corrida vê a
-- tela de conflito e escolhe.
create or replace function public.versao_so_avanca() returns trigger
language plpgsql as $$
begin
  if new.version <= old.version then
    raise exception 'versão % não avança sobre a % já gravada', new.version, old.version
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists tg_versao_so_avanca on public.vaults;
create trigger tg_versao_so_avanca before update on public.vaults
  for each row execute function public.versao_so_avanca();

alter table public.vaults      enable row level security;
alter table public.vault_wraps enable row level security;

-- As políticas dos cofres estão mais abaixo, depois das tabelas de conta: elas
-- dependem de `esta_bloqueada()`, e conta bloqueada não acessa o próprio cofre.

-- Regra dos dois caminhos (§1.2) também no banco: impede que o último método
-- some por acidente de sync. A checagem de verdade fica na UI, que sabe explicar.
create or replace function public.impede_ultimo_wrap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.vault_wraps where user_id = old.user_id) <= 2 then
    raise exception 'O cofre precisa de pelo menos dois métodos de desbloqueio.';
  end if;
  return old;
end;
$$;

drop trigger if exists tg_impede_ultimo_wrap on public.vault_wraps;
create trigger tg_impede_ultimo_wrap before delete on public.vault_wraps
  for each row execute function public.impede_ultimo_wrap();

-- ---------------------------------------------------------------------------
-- Quem pode criar conta
--
-- Sem isto, qualquer pessoa que descubra o endereço do app pede um link mágico
-- e ganha uma conta no seu projeto Supabase. Ela não enxerga o SEU cofre — a
-- RLS acima cuida disso — mas consome o seu plano, aparece na sua lista de
-- usuários e recebe e-mail em seu nome.
--
-- A checagem tem de ser no banco. Qualquer bloqueio no app seria teatro: a
-- chave anon está no bundle e dá para chamar o Supabase direto do terminal.
--
-- São dois caminhos, e o segundo existe para você não ter de abrir o Supabase a
-- cada pessoa:
--
--   1. `contas_liberadas` — e-mail na lista entra. Use para o SEU e-mail.
--   2. `convites` — código que a pessoa digita na tela. Você cria o código uma
--      vez, com quantos usos quiser, e quem tiver o código se cadastra sozinho.
--
-- Quem já tem conta continua entrando: o gatilho só olha criação.
--
-- LIBERE O SEU E-MAIL antes de qualquer coisa (senão nem você entra num
-- aparelho novo):
--
--   insert into public.contas_liberadas (email, nota)
--   values (lower('voce@exemplo.com'), 'dono')
--   on conflict (email) do nothing;
--
-- CRIAR UM CONVITE (10 usos, vence em 30 dias):
--
--   insert into public.convites (codigo, nota, usos_max, expira_em)
--   values ('AMIGOS-2027', 'grupo do consultório', 10, now() + interval '30 days');
--
-- REVOGAR: delete from public.convites where codigo = 'AMIGOS-2027';
-- VER QUANTO USARAM: select codigo, usos, usos_max, expira_em from public.convites;
--
-- Para fechar de vez, sem lista nem convite, há o interruptor do painel:
-- Authentication → Sign In / Providers → Email → "Allow new users to sign up".
-- Desligado ali, nem a lista nem o convite liberam.

create table if not exists public.contas_liberadas (
  email     text        primary key,
  nota      text,
  criado_em timestamptz not null default now()
);

create table if not exists public.convites (
  codigo    text        primary key,
  nota      text,
  usos      integer     not null default 0,
  usos_max  integer     not null default 1,
  expira_em timestamptz,
  criado_em timestamptz not null default now()
);

-- Sem policy nenhuma e com RLS ligada, as duas tabelas são invisíveis pela API
-- pública: só o painel do Supabase e o gatilho (security definer) enxergam.
-- Ninguém consegue listar convites válidos a partir do app.
alter table public.contas_liberadas enable row level security;
alter table public.convites         enable row level security;

create or replace function public.exige_conta_liberada() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_codigo text;
begin
  if exists (select 1 from public.contas_liberadas where email = lower(new.email)) then
    return new;
  end if;

  -- O código chega nos metadados do cadastro (options.data no signInWithOtp).
  -- O update é a própria validação: só acha a linha se o código existe, não
  -- venceu e ainda tem uso sobrando — e já consome o uso, sem corrida entre
  -- dois cadastros simultâneos disputando a última vaga.
  v_codigo := upper(trim(coalesce(new.raw_user_meta_data ->> 'convite', '')));
  if v_codigo <> '' then
    update public.convites
       set usos = usos + 1
     where upper(codigo) = v_codigo
       and (expira_em is null or expira_em > now())
       and usos < usos_max;
    if found then
      return new;
    end if;
  end if;

  raise exception 'conta nova precisa de convite';
end;
$$;

drop trigger if exists tg_exige_conta_liberada on auth.users;
create trigger tg_exige_conta_liberada before insert on auth.users
  for each row execute function public.exige_conta_liberada();

-- ---------------------------------------------------------------------------
-- Controle de contas (a tela de administração do app)
--
-- O navegador só tem a chave anon, e é assim que tem de ser: a service_role
-- apagaria usuário de verdade, mas quem a tivesse no bundle apagaria QUALQUER
-- coisa. Então o controle é feito no que o próprio Postgres autoriza, via RLS:
-- o admin enxerga e mexe; o resto não vê nem que a tabela existe.
--
-- O que a tela de admin consegue fazer sem service_role:
--   · listar contas (o espelho abaixo, alimentado por gatilho)
--   · bloquear e desbloquear — conta bloqueada perde acesso ao próprio cofre
--   · apagar os DADOS de uma conta (cofre e embrulhos)
--   · criar, ver e revogar chaves de cadastro
--   · autorizar um e-mail direto, sem código
--
-- Apagar a linha em `auth.users` exige a service_role, que não pode viajar para
-- o navegador — para isso existe a função de borda `apagar-conta`
-- (supabase/functions/apagar-conta), que guarda a chave no servidor e confere
-- quem pediu antes de obedecer. Sem ela implantada, a tela ainda apaga os dados
-- e bloqueia: a conta fica inerte e a linha de auth que sobra não dá acesso a
-- nada. Nos dois casos a tela diz o que aconteceu.
--
-- DEPOIS de rodar isto, marque-se como admin (uma vez):
--
--   insert into public.admins (user_id)
--   select id from auth.users where email = lower('voce@exemplo.com')
--   on conflict do nothing;

create table if not exists public.admins (
  user_id   uuid        primary key references auth.users on delete cascade,
  criado_em timestamptz not null default now()
);

-- Espelho de auth.users que o app pode ler. Guarda só o que a tela precisa
-- mostrar: quem é, quando entrou, se está bloqueada.
create table if not exists public.contas (
  user_id       uuid        primary key references auth.users on delete cascade,
  email         text        not null,
  criado_em     timestamptz not null default now(),
  bloqueada     boolean     not null default false,
  bloqueada_em  timestamptz,
  convite_usado text,
  nota          text
);

alter table public.admins enable row level security;
alter table public.contas enable row level security;

-- security definer para não depender da RLS da própria tabela (e não cair em
-- recursão de política consultando `admins` de dentro da política de `admins`)
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.esta_bloqueada(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select bloqueada from public.contas where user_id = uid), false);
$$;

-- Cada um vê a própria linha; o admin vê e mexe em todas.
drop policy if exists conta_propria on public.contas;
create policy conta_propria on public.contas
  for select using (auth.uid() = user_id or public.eh_admin());

drop policy if exists conta_admin on public.contas;
create policy conta_admin on public.contas
  for all using (public.eh_admin()) with check (public.eh_admin());

-- Saber se VOCÊ é admin é permitido; saber quem mais é, não.
drop policy if exists admin_propria on public.admins;
create policy admin_propria on public.admins
  for select using (auth.uid() = user_id);

-- Convites e e-mails liberados: administráveis pela tela, invisíveis para o
-- resto. O gatilho de cadastro continua lendo por fora da RLS (security
-- definer), então quem não é admin nem precisa enxergar a tabela para se
-- cadastrar com um código válido.
drop policy if exists convites_admin on public.convites;
create policy convites_admin on public.convites
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists liberadas_admin on public.contas_liberadas;
create policy liberadas_admin on public.contas_liberadas
  for all using (public.eh_admin()) with check (public.eh_admin());

-- O cofre é seu, e só enquanto a conta não estiver bloqueada. O admin pode
-- APAGAR os dados de qualquer conta, e nada além disso: continua sendo texto
-- cifrado com uma chave que nunca esteve no servidor.
drop policy if exists own_vault on public.vaults;
create policy own_vault on public.vaults
  for all using (auth.uid() = user_id and not public.esta_bloqueada(auth.uid()))
  with check (auth.uid() = user_id and not public.esta_bloqueada(auth.uid()));

drop policy if exists vault_admin_apaga on public.vaults;
create policy vault_admin_apaga on public.vaults
  for delete using (public.eh_admin());

drop policy if exists own_wraps on public.vault_wraps;
create policy own_wraps on public.vault_wraps
  for all using (auth.uid() = user_id and not public.esta_bloqueada(auth.uid()))
  with check (auth.uid() = user_id and not public.esta_bloqueada(auth.uid()));

drop policy if exists wraps_admin_apaga on public.vault_wraps;
create policy wraps_admin_apaga on public.vault_wraps
  for delete using (public.eh_admin());

-- O espelho se mantém sozinho: toda conta criada aparece na lista, com o
-- convite que usou. Sem isto, a tela de admin só enxergaria quem tivesse
-- sincronizado alguma coisa.
create or replace function public.espelha_conta() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.contas (user_id, email, convite_usado)
  values (
    new.id,
    lower(new.email),
    nullif(upper(trim(coalesce(new.raw_user_meta_data ->> 'convite', ''))), '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists tg_espelha_conta on auth.users;
create trigger tg_espelha_conta after insert on auth.users
  for each row execute function public.espelha_conta();

-- Quem já tinha conta antes deste arquivo entra no espelho na mão, uma vez:
insert into public.contas (user_id, email)
select id, lower(email) from auth.users
on conflict (user_id) do nothing;
