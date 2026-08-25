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
  criado_em   timestamptz not null default now(),
  primary key (user_id, wrap_id)
);

-- Para quem rodou a versão anterior deste schema, antes de o sync existir:
alter table public.vaults add column if not exists vault_id text;

alter table public.vaults      enable row level security;
alter table public.vault_wraps enable row level security;

drop policy if exists own_vault on public.vaults;
create policy own_vault on public.vaults
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists own_wraps on public.vault_wraps;
create policy own_wraps on public.vault_wraps
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
