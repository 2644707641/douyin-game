create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.game_saves (
  save_id uuid primary key,
  save_token uuid not null,
  owner_user_id uuid,
  storage_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.game_saves
  add column if not exists owner_user_id uuid;

alter table public.game_saves
  drop constraint if exists game_saves_owner_user_id_fkey;

create table if not exists public.game_accounts (
  user_id uuid primary key,
  display_name text not null default '无名',
  avatar_url text not null default '',
  province text not null default '未知',
  save_id uuid references public.game_saves(save_id) on delete set null,
  save_token uuid,
  best_star integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.game_accounts
  drop constraint if exists game_accounts_user_id_fkey;

create table if not exists public.game_account_credentials (
  user_id uuid primary key references public.game_accounts(user_id) on delete cascade,
  account_name text not null unique,
  password_hash text not null,
  session_token_hash text,
  session_updated_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists idx_game_accounts_save_id_unique
on public.game_accounts (save_id)
where save_id is not null;

create index if not exists idx_game_saves_owner_user_id
on public.game_saves (owner_user_id);

create index if not exists idx_game_accounts_best_star
on public.game_accounts (best_star desc, updated_at asc);

create index if not exists idx_game_accounts_province_best_star
on public.game_accounts (province, best_star desc, updated_at asc);

create unique index if not exists idx_game_account_credentials_session_token_hash
on public.game_account_credentials (session_token_hash)
where session_token_hash is not null;

create or replace function public.touch_game_saves_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.touch_game_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create or replace function public.touch_game_account_credentials_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists trg_touch_game_saves_updated_at on public.game_saves;

create trigger trg_touch_game_saves_updated_at
before update on public.game_saves
for each row
execute function public.touch_game_saves_updated_at();

drop trigger if exists trg_touch_game_accounts_updated_at on public.game_accounts;

create trigger trg_touch_game_accounts_updated_at
before update on public.game_accounts
for each row
execute function public.touch_game_accounts_updated_at();

drop trigger if exists trg_touch_game_account_credentials_updated_at on public.game_account_credentials;

create trigger trg_touch_game_account_credentials_updated_at
before update on public.game_account_credentials
for each row
execute function public.touch_game_account_credentials_updated_at();

create or replace function public.request_header(header_name text)
returns text
language sql
stable
as $$
  select coalesce(
    coalesce(current_setting('request.headers', true), '{}')::json ->> lower(header_name),
    ''
  );
$$;

create or replace function public.hash_game_session_token(p_token text)
returns text
language sql
immutable
as $$
  select case
    when p_token is null or btrim(p_token) = '' then null
    else encode(extensions.digest(p_token, 'sha256'), 'hex')
  end;
$$;

create or replace function public.current_game_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select gac.user_id
  from public.game_account_credentials gac
  where gac.session_token_hash = public.hash_game_session_token(public.request_header('x-game-session'))
  limit 1;
$$;

create or replace function public.register_game_account(
  p_account_name text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_name text := coalesce(btrim(p_account_name), '');
  v_password text := coalesce(p_password, '');
  v_user_id uuid := gen_random_uuid();
  v_session_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_account_name = '' then
    raise exception '账号不能为空';
  end if;

  if v_password = '' then
    raise exception '密码不能为空';
  end if;

  if exists (
    select 1
    from public.game_account_credentials
    where account_name = v_account_name
  ) then
    raise exception '账号已存在';
  end if;

  insert into public.game_accounts (
    user_id,
    display_name,
    avatar_url,
    province,
    save_id,
    save_token,
    best_star
  )
  values (
    v_user_id,
    v_account_name,
    '',
    '未知',
    null,
    null,
    0
  );

  insert into public.game_account_credentials (
    user_id,
    account_name,
    password_hash,
    session_token_hash,
    session_updated_at
  )
  values (
    v_user_id,
    v_account_name,
    extensions.crypt(v_password, extensions.gen_salt('bf')),
    public.hash_game_session_token(v_session_token),
    timezone('utc', now())
  );

  return jsonb_build_object(
    'user_id', v_user_id,
    'account_name', v_account_name,
    'session_token', v_session_token
  );
exception
  when unique_violation then
    raise exception '账号已存在';
end;
$$;

create or replace function public.login_game_account(
  p_account_name text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_name text := coalesce(btrim(p_account_name), '');
  v_password text := coalesce(p_password, '');
  v_user_id uuid;
  v_password_hash text;
  v_session_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if v_account_name = '' then
    raise exception '账号不能为空';
  end if;

  if v_password = '' then
    raise exception '密码不能为空';
  end if;

  select gac.user_id, gac.password_hash
    into v_user_id, v_password_hash
  from public.game_account_credentials gac
  where gac.account_name = v_account_name
  limit 1;

  if v_user_id is null or v_password_hash is null then
    raise exception '账号或密码错误';
  end if;

  if v_password_hash <> extensions.crypt(v_password, v_password_hash) then
    raise exception '账号或密码错误';
  end if;

  update public.game_account_credentials
  set session_token_hash = public.hash_game_session_token(v_session_token),
      session_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where user_id = v_user_id;

  return jsonb_build_object(
    'user_id', v_user_id,
    'account_name', v_account_name,
    'session_token', v_session_token
  );
end;
$$;

create or replace function public.logout_game_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_game_user_id();
  v_session_token_hash text :=
    public.hash_game_session_token(public.request_header('x-game-session'));
begin
  if v_user_id is null or v_session_token_hash is null then
    return jsonb_build_object('ok', true);
  end if;

  update public.game_account_credentials
  set session_token_hash = null,
      session_updated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where user_id = v_user_id
    and session_token_hash = v_session_token_hash;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.bind_game_account_save(
  p_save_id uuid,
  p_save_token uuid,
  p_display_name text default null,
  p_avatar_url text default null,
  p_province text default null,
  p_best_star integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := public.current_game_user_id();
  v_requested_token text := public.request_header('x-save-token');
  v_display_name text := coalesce(nullif(btrim(p_display_name), ''), '无名');
  v_avatar_url text := coalesce(p_avatar_url, '');
  v_province text := coalesce(nullif(btrim(p_province), ''), '未知');
  v_best_star integer := greatest(coalesce(p_best_star, 0), 0);
begin
  if v_user_id is null then
    raise exception '请先登录账号';
  end if;

  if p_save_id is null or p_save_token is null then
    raise exception '缺少存档身份';
  end if;

  if v_requested_token <> p_save_token::text then
    raise exception '存档令牌不匹配';
  end if;

  update public.game_saves
  set owner_user_id = null
  where owner_user_id = v_user_id
    and save_id <> p_save_id;

  update public.game_saves
  set owner_user_id = v_user_id
  where save_id = p_save_id
    and save_token = p_save_token;

  if not found then
    raise exception '存档不存在或令牌无效';
  end if;

  update public.game_accounts
  set save_id = null,
      save_token = null,
      updated_at = timezone('utc', now())
  where save_id = p_save_id
    and user_id <> v_user_id;

  insert into public.game_accounts (
    user_id,
    display_name,
    avatar_url,
    province,
    save_id,
    save_token,
    best_star
  )
  values (
    v_user_id,
    v_display_name,
    v_avatar_url,
    v_province,
    p_save_id,
    p_save_token,
    v_best_star
  )
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      province = excluded.province,
      save_id = excluded.save_id,
      save_token = excluded.save_token,
      best_star = excluded.best_star,
      updated_at = timezone('utc', now());

  return jsonb_build_object(
    'user_id', v_user_id,
    'save_id', p_save_id,
    'save_token', p_save_token,
    'best_star', v_best_star
  );
end;
$$;

create or replace function public.get_game_leaderboard(
  p_scope text default 'country',
  p_limit integer default 50,
  p_province text default null,
  p_user_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with filtered as (
    select
      ga.user_id,
      coalesce(nullif(btrim(ga.display_name), ''), '无名') as display_name,
      coalesce(ga.avatar_url, '') as avatar_url,
      coalesce(nullif(btrim(ga.province), ''), '未知') as province,
      greatest(coalesce(ga.best_star, 0), 0) as best_star,
      ga.updated_at
    from public.game_accounts ga
    where greatest(coalesce(ga.best_star, 0), 0) > 0
      and (
        lower(coalesce(p_scope, 'country')) <> 'province'
        or coalesce(nullif(btrim(ga.province), ''), '未知')
           = coalesce(nullif(btrim(p_province), ''), '未知')
      )
  ),
  ranked as (
    select
      f.user_id,
      row_number() over (
        order by f.best_star desc, f.updated_at asc, f.user_id asc
      ) as ranking,
      f.display_name,
      f.avatar_url,
      f.province,
      f.best_star
    from filtered f
  ),
  top_rows as (
    select *
    from ranked
    where ranking <= greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select jsonb_build_object(
    'rank',
    coalesce(
      (select ranking from ranked where user_id = p_user_id),
      -1
    ),
    'rankList',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'userId', tr.user_id,
            'rank', tr.ranking,
            'star', tr.best_star,
            'p', tr.province,
            'province', tr.province,
            'info', jsonb_build_object(
              'nk', tr.display_name,
              'av', tr.avatar_url
            )
          )
          order by tr.ranking
        )
        from top_rows tr
      ),
      '[]'::jsonb
    )
  );
$$;

alter table public.game_saves enable row level security;
alter table public.game_accounts enable row level security;
alter table public.game_account_credentials enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.game_saves to anon, authenticated;
grant select, insert, update on public.game_accounts to anon, authenticated;
revoke all on table public.game_account_credentials from anon, authenticated;

grant execute on function public.request_header(text) to anon, authenticated;
grant execute on function public.hash_game_session_token(text) to anon, authenticated;
grant execute on function public.current_game_user_id() to anon, authenticated;
grant execute on function public.register_game_account(text, text) to anon, authenticated;
grant execute on function public.login_game_account(text, text) to anon, authenticated;
grant execute on function public.logout_game_account() to anon, authenticated;
grant execute on function public.bind_game_account_save(uuid, uuid, text, text, text, integer) to anon, authenticated;
grant execute on function public.get_game_leaderboard(text, integer, text, uuid) to anon, authenticated;

drop policy if exists game_saves_select_own on public.game_saves;

create policy game_saves_select_own
on public.game_saves
for select
to anon, authenticated
using (
  save_token::text = public.request_header('x-save-token')
  or (public.current_game_user_id() is not null and owner_user_id = public.current_game_user_id())
);

drop policy if exists game_saves_insert_own on public.game_saves;

create policy game_saves_insert_own
on public.game_saves
for insert
to anon, authenticated
with check (
  save_token::text = public.request_header('x-save-token')
  or (public.current_game_user_id() is not null and owner_user_id = public.current_game_user_id())
);

drop policy if exists game_saves_update_own on public.game_saves;

create policy game_saves_update_own
on public.game_saves
for update
to anon, authenticated
using (
  save_token::text = public.request_header('x-save-token')
  or (public.current_game_user_id() is not null and owner_user_id = public.current_game_user_id())
)
with check (
  save_token::text = public.request_header('x-save-token')
  or (public.current_game_user_id() is not null and owner_user_id = public.current_game_user_id())
);

drop policy if exists game_accounts_select_own on public.game_accounts;

create policy game_accounts_select_own
on public.game_accounts
for select
to anon, authenticated
using (public.current_game_user_id() = user_id);

drop policy if exists game_accounts_insert_own on public.game_accounts;

create policy game_accounts_insert_own
on public.game_accounts
for insert
to anon, authenticated
with check (public.current_game_user_id() = user_id);

drop policy if exists game_accounts_update_own on public.game_accounts;

create policy game_accounts_update_own
on public.game_accounts
for update
to anon, authenticated
using (public.current_game_user_id() = user_id)
with check (public.current_game_user_id() = user_id);
