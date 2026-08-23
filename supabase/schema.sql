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
