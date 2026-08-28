-- ============================================================
--  Cairn — database setup
--  Paste this whole file into the Supabase SQL Editor and run it.
--  Safe to run more than once.
--
--  Every table is locked with row-level security: a signed-in
--  person can only ever read or write rows carrying their own
--  user id. There is no path, from the browser, to anyone else's
--  prayers — that is enforced by Postgres, not by the app.
-- ============================================================

-- ---------- prayers ----------
create table if not exists public.prayers (
  id            uuid primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  body          text not null default '',
  x             real not null default 10,
  y             real not null default 10,
  color         smallint not null default 1,
  status        text not null default 'active' check (status in ('active','answered')),
  created_at    timestamptz not null default now(),
  answered_at   timestamptz,
  answered_note text
);

-- ---------- journal ----------
create table if not exists public.journal_entries (
  id         uuid primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null default 'open' check (kind in ('open','gratitude')),
  title      text,
  body       text,
  items      jsonb not null default '[]'::jsonb,
  prompts    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- daily reading completions ----------
create table if not exists public.readings (
  id           uuid primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  day_key      text not null,
  reference    text,
  completed_at timestamptz,
  -- One completion per chapter, not per calendar day. See
  -- readings-by-chapter.sql for why, and for the migration.
  unique (user_id, reference)
);

-- ---------- feature suggestions ----------
create table if not exists public.suggestions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);

-- ---------- indexes ----------
create index if not exists prayers_user_status_idx  on public.prayers (user_id, status, created_at desc);
create index if not exists journal_user_idx         on public.journal_entries (user_id, created_at desc);
create index if not exists readings_user_idx        on public.readings (user_id, day_key desc);

-- ---------- row level security ----------
alter table public.prayers         enable row level security;
alter table public.journal_entries enable row level security;
alter table public.readings        enable row level security;
alter table public.suggestions     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['prayers','journal_entries','readings'] loop
    execute format('drop policy if exists "own rows select" on public.%I', t);
    execute format('drop policy if exists "own rows insert" on public.%I', t);
    execute format('drop policy if exists "own rows update" on public.%I', t);
    execute format('drop policy if exists "own rows delete" on public.%I', t);

    execute format($f$create policy "own rows select" on public.%I
      for select using (auth.uid() = user_id)$f$, t);
    execute format($f$create policy "own rows insert" on public.%I
      for insert with check (auth.uid() = user_id)$f$, t);
    execute format($f$create policy "own rows update" on public.%I
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id)$f$, t);
    execute format($f$create policy "own rows delete" on public.%I
      for delete using (auth.uid() = user_id)$f$, t);
  end loop;
end $$;

-- Suggestions: you may send them, but nobody can read them back
-- through the API. You read them in the Supabase table editor.
drop policy if exists "anyone signed in may suggest" on public.suggestions;
create policy "anyone signed in may suggest" on public.suggestions
  for insert with check (auth.uid() = user_id);

-- ---------- keep updated_at honest ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists journal_touch on public.journal_entries;
create trigger journal_touch before update on public.journal_entries
  for each row execute function public.touch_updated_at();
