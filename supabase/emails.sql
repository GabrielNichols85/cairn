-- ============================================================
--  Cairn — email preferences
--  Paste this whole file into the Supabase SQL Editor and run it.
--  Safe to run more than once.
--
--  Everyone gets a row the moment they sign up. The row carries
--  one switch per kind of email, a cadence for the check in, and
--  a long random token that lets somebody turn an email off from
--  their inbox without signing in to anything.
--
--  Nothing here is readable by other people. The only way to
--  reach a row without being its owner is through the two token
--  functions at the bottom, and a token is unguessable.
-- ============================================================

create table if not exists public.email_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,

  -- kept in step with the account so the sender never has to read
  -- the auth tables to address an envelope
  email      text,
  name       text,

  -- an IANA zone, like 'America/Chicago'. The sender uses it to
  -- pick a decent hour of the morning rather than mailing at 3am.
  timezone   text,

  -- one switch per kind of email
  remember   boolean not null default true,   -- "a year ago today, this was answered"
  checkin    boolean not null default true,   -- the gentle look back
  reading    boolean not null default false,  -- the daily nudge, off unless asked for
  product    boolean not null default true,   -- a short note when something new ships

  -- how often the check in comes
  checkin_every text not null default 'weekly'
    check (checkin_every in ('weekly','biweekly','monthly')),

  -- one switch above them all
  paused     boolean not null default false,

  -- what has already gone out, so nothing is sent twice
  welcomed_at      timestamptz,
  last_remember_at timestamptz,
  last_checkin_at  timestamptz,
  last_reading_at  timestamptz,

  -- the unsubscribe key. 64 hex characters, from the same source
  -- Postgres uses for uuids.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_prefs_token_idx on public.email_prefs (token);

alter table public.email_prefs enable row level security;

drop policy if exists "read own email prefs"   on public.email_prefs;
drop policy if exists "insert own email prefs" on public.email_prefs;
drop policy if exists "update own email prefs" on public.email_prefs;

create policy "read own email prefs" on public.email_prefs
  for select using (user_id = auth.uid());
create policy "insert own email prefs" on public.email_prefs
  for insert with check (user_id = auth.uid());
create policy "update own email prefs" on public.email_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- deliberately no delete policy: the row goes when the account goes.

drop trigger if exists email_prefs_touch on public.email_prefs;
create trigger email_prefs_touch before update on public.email_prefs
  for each row execute function public.touch_updated_at();


-- ============================================================
--  Give every new account a row automatically.
--  Without this, somebody who signs up and never opens Settings
--  would be invisible to the sender.
-- ============================================================
create or replace function public.handle_new_user_email_prefs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.email_prefs (user_id, email, name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_email_prefs on auth.users;
create trigger on_auth_user_created_email_prefs
  after insert on auth.users
  for each row execute function public.handle_new_user_email_prefs();

-- Back fill anybody who signed up before today.
insert into public.email_prefs (user_id, email, name)
select u.id,
       u.email,
       coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name')
from auth.users u
on conflict (user_id) do nothing;


-- ============================================================
--  Making sure a row exists for the person asking, and handing
--  it back. The client calls this on load instead of guessing.
-- ============================================================
create or replace function public.my_email_prefs(p_email text default null, p_name text default null, p_timezone text default null)
returns public.email_prefs
language plpgsql security definer set search_path = public as $$
declare r public.email_prefs;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  insert into public.email_prefs (user_id, email, name, timezone)
  values (auth.uid(), p_email, p_name, p_timezone)
  on conflict (user_id) do update
    set email    = coalesce(excluded.email,    public.email_prefs.email),
        name     = coalesce(excluded.name,     public.email_prefs.name),
        timezone = coalesce(excluded.timezone, public.email_prefs.timezone)
  returning * into r;

  return r;
end $$;


-- ============================================================
--  The two token functions. These are how an unsubscribe link
--  in an email works for somebody who is not signed in, on a
--  phone, six months from now.
--
--  They are security definer, so they see past row level
--  security, but they can only ever be pointed at one row and
--  only by somebody holding that row's token.
-- ============================================================

-- What the unsubscribe page shows. Never returns the full address.
create or replace function public.email_prefs_by_token(p_token text)
returns table (
  masked_email  text,
  remember      boolean,
  checkin       boolean,
  reading       boolean,
  product       boolean,
  checkin_every text,
  paused        boolean
)
language sql security definer stable set search_path = public as $$
  select
    case
      when p.email is null then null
      else left(split_part(p.email, '@', 1), 2) || '***@' || split_part(p.email, '@', 2)
    end,
    p.remember, p.checkin, p.reading, p.product, p.checkin_every, p.paused
  from public.email_prefs p
  where p.token = p_token
    and length(p_token) >= 32;
$$;

-- Turning things off from an inbox. 'all' pauses everything.
create or replace function public.email_unsubscribe(p_token text, p_kind text default 'all')
returns boolean
language plpgsql security definer set search_path = public as $$
declare hit int;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;

  update public.email_prefs set
    paused   = case when p_kind = 'all'      then true  else paused   end,
    remember = case when p_kind = 'remember' then false else remember end,
    checkin  = case when p_kind = 'checkin'  then false else checkin  end,
    reading  = case when p_kind = 'reading'  then false else reading  end,
    product  = case when p_kind = 'product'  then false else product  end
  where token = p_token;

  get diagnostics hit = row_count;
  return hit > 0;
end $$;

-- Flipping one switch from an emailed link, in either direction.
-- Holding a token lets you change one row and nothing else, and a
-- token only ever arrives in the inbox it belongs to. The 'on'
-- direction exists so that an unsubscribe made by mistake can be
-- undone from the same page, in the same breath.
create or replace function public.email_prefs_set_by_token(p_token text, p_kind text, p_on boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare hit int;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  if p_kind not in ('remember','checkin','reading','product','all') then
    return false;
  end if;

  update public.email_prefs set
    paused   = case when p_kind = 'all'      then not p_on else paused   end,
    remember = case when p_kind = 'remember' then p_on     else remember end,
    checkin  = case when p_kind = 'checkin'  then p_on     else checkin  end,
    reading  = case when p_kind = 'reading'  then p_on     else reading  end,
    product  = case when p_kind = 'product'  then p_on     else product  end
  where token = p_token;

  get diagnostics hit = row_count;
  return hit > 0;
end $$;

-- Somebody who unsubscribed by mistake, from the same link.
create or replace function public.email_resubscribe(p_token text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare hit int;
begin
  if p_token is null or length(p_token) < 32 then
    return false;
  end if;
  update public.email_prefs set paused = false where token = p_token;
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

revoke all on function public.email_prefs_by_token(text) from public;
revoke all on function public.email_unsubscribe(text, text)  from public;
revoke all on function public.email_resubscribe(text)        from public;
grant execute on function public.email_prefs_by_token(text) to anon, authenticated;
grant execute on function public.email_unsubscribe(text, text)  to anon, authenticated;
grant execute on function public.email_resubscribe(text)        to anon, authenticated;
revoke all on function public.email_prefs_set_by_token(text, text, boolean) from public;
grant execute on function public.email_prefs_set_by_token(text, text, boolean) to anon, authenticated;
grant execute on function public.my_email_prefs(text, text, text) to authenticated;


-- ============================================================
--  Feature suggestions: mark the ones already forwarded, so the
--  nightly job can email new ideas without repeating itself.
-- ============================================================
alter table public.suggestions add column if not exists notified_at timestamptz;
create index if not exists suggestions_unnotified_idx
  on public.suggestions (created_at) where notified_at is null;
