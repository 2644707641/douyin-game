-- 云存档、账号绑定、排行榜所需的 Supabase SQL。
-- save_id 放在 URL query，save_token 放在 URL hash，并通过 x-save-token 请求头参与云存档鉴权。

create table if not exists public.game_saves (
  save_id uuid primary key,
  save_token uuid not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  storage_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.game_saves
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

create table if not exists public.game_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '无名',
  avatar_url text not null default '',
  province text not null default '未知',
  save_id uuid references public.game_saves(save_id) on delete set null,
  save_token uuid,
  best_star integer not null default 0,
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
  v_user_id uuid := auth.uid();
  v_requested_token text := public.request_header('x-save-token');
  v_display_name text := coalesce(nullif(btrim(p_display_name), ''), '无名');
  v_avatar_url text := coalesce(p_avatar_url, '');
  v_province text := coalesce(nullif(btrim(p_province), ''), '未知');
  v_best_star integer := greatest(coalesce(p_best_star, 0), 0);
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_save_id is null or p_save_token is null then
    raise exception 'missing save identity';
  end if;

  if v_requested_token <> p_save_token::text then
    raise exception 'save token mismatch';
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
    raise exception 'save not found or token invalid';
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

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.game_saves to anon, authenticated;
grant select, insert, update on public.game_accounts to authenticated;
grant execute on function public.request_header(text) to anon, authenticated;
grant execute on function public.bind_game_account_save(uuid, uuid, text, text, text, integer) to authenticated;
grant execute on function public.get_game_leaderboard(text, integer, text, uuid) to anon, authenticated;

drop policy if exists game_saves_select_own on public.game_saves;

create policy game_saves_select_own
on public.game_saves
for select
to anon, authenticated
using (
  save_token::text = public.request_header('x-save-token')
  or (auth.uid() is not null and owner_user_id = auth.uid())
);

drop policy if exists game_saves_insert_own on public.game_saves;

create policy game_saves_insert_own
on public.game_saves
for insert
to anon, authenticated
with check (
  save_token::text = public.request_header('x-save-token')
  or (auth.uid() is not null and owner_user_id = auth.uid())
);

drop policy if exists game_saves_update_own on public.game_saves;

create policy game_saves_update_own
on public.game_saves
for update
to anon, authenticated
using (
  save_token::text = public.request_header('x-save-token')
  or (auth.uid() is not null and owner_user_id = auth.uid())
)
with check (
  save_token::text = public.request_header('x-save-token')
  or (auth.uid() is not null and owner_user_id = auth.uid())
);

drop policy if exists game_accounts_select_own on public.game_accounts;

create policy game_accounts_select_own
on public.game_accounts
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists game_accounts_insert_own on public.game_accounts;

create policy game_accounts_insert_own
on public.game_accounts
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists game_accounts_update_own on public.game_accounts;

create policy game_accounts_update_own
on public.game_accounts
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
