-- 供 build-ctx/html/js/cloud-save-config.js 使用的云存档表。
-- save_id 放在 URL query，save_token 放在 URL hash，并通过 x-save-token 请求头参与 RLS。

create table if not exists public.game_saves (
  save_id uuid primary key,
  save_token uuid not null,
  storage_map jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.touch_game_saves_updated_at()
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

alter table public.game_saves enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.game_saves to anon, authenticated;

drop policy if exists game_saves_select_own on public.game_saves;

create policy game_saves_select_own
on public.game_saves
for select
to anon, authenticated
using (save_token::text = public.request_header('x-save-token'));

drop policy if exists game_saves_insert_own on public.game_saves;

create policy game_saves_insert_own
on public.game_saves
for insert
to anon, authenticated
with check (save_token::text = public.request_header('x-save-token'));

drop policy if exists game_saves_update_own on public.game_saves;

create policy game_saves_update_own
on public.game_saves
for update
to anon, authenticated
using (save_token::text = public.request_header('x-save-token'))
with check (save_token::text = public.request_header('x-save-token'));
