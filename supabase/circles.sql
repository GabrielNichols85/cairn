-- ============================================================
--  Cairn, prayer circles
--
--  Additive only. This script creates new tables and widens ONE
--  existing policy. It never drops or alters a column, so no
--  existing prayer, journal entry or reading is touched.
--
--  Safe to run more than once.
-- ============================================================

-- ---------- circles ----------
create table if not exists public.circles (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 60),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  join_token   text not null unique default encode(gen_random_bytes(12), 'hex'),
  token_revoked boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.circle_members (
  circle_id  uuid not null references public.circles(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','member')),
  joined_at  timestamptz not null default now(),
  primary key (circle_id, user_id)
);

-- A prayer is shared if a row exists here. One source of truth,
-- so there is no flag that can drift out of step with reality.
create table if not exists public.prayer_circles (
  prayer_id uuid not null references public.prayers(id) on delete cascade,
  circle_id uuid not null references public.circles(id) on delete cascade,
  shared_at timestamptz not null default now(),
  primary key (prayer_id, circle_id)
);

-- One row per person per prayer per day. Counts are derived from
-- these rows, never from a counter column, so the number a
-- grieving person reads is always true.
create table if not exists public.intercessions (
  id         uuid primary key default gen_random_uuid(),
  prayer_id  uuid not null references public.prayers(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  prayed_on  date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now(),
  unique (prayer_id, user_id, prayed_on)
);

create index if not exists circle_members_user_idx   on public.circle_members (user_id, circle_id);
create index if not exists prayer_circles_prayer_idx on public.prayer_circles (prayer_id);
create index if not exists prayer_circles_circle_idx on public.prayer_circles (circle_id, shared_at desc);
create index if not exists intercessions_prayer_idx  on public.intercessions (prayer_id);
create index if not exists intercessions_user_idx    on public.intercessions (user_id, prayed_on);

-- ============================================================
--  Helpers, SECURITY DEFINER
--
--  A policy on circle_members that queries circle_members
--  recurses forever. These functions break that loop, and they
--  are the only place that reads those tables unfiltered.
-- ============================================================

create or replace function public.is_circle_member(cid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.circle_members where circle_id = cid and user_id = uid);
$$;

create or replace function public.can_see_prayer(pid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.prayer_circles pc
    join public.circle_members cm on cm.circle_id = pc.circle_id
    where pc.prayer_id = pid and cm.user_id = uid
  );
$$;

-- Look at an invite before committing to it.
create or replace function public.circle_preview(p_token text)
returns table (name text, member_count int)
language sql security definer stable set search_path = public as $$
  select c.name, (select count(*)::int from public.circle_members m where m.circle_id = c.id)
  from public.circles c
  where c.join_token = p_token and c.token_revoked = false;
$$;

-- Joining needs to read a circle you are not yet a member of.
create or replace function public.join_circle(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.circles%rowtype;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into c from public.circles
    where join_token = p_token and token_revoked = false;
  if not found then raise exception 'invalid_invite'; end if;
  insert into public.circle_members (circle_id, user_id, role)
    values (c.id, auth.uid(), 'member')
    on conflict (circle_id, user_id) do nothing;
  return c.id;
end $$;

-- Creating a circle should also make you its first member.
create or replace function public.create_circle(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  insert into public.circles (name, owner_id) values (trim(p_name), auth.uid())
    returning id into new_id;
  insert into public.circle_members (circle_id, user_id, role)
    values (new_id, auth.uid(), 'owner');
  return new_id;
end $$;

-- ============================================================
--  Row level security
-- ============================================================

alter table public.circles        enable row level security;
alter table public.circle_members enable row level security;
alter table public.prayer_circles enable row level security;
alter table public.intercessions  enable row level security;

-- ---------- circles ----------
drop policy if exists "members read circle"  on public.circles;
drop policy if exists "owner updates circle" on public.circles;
drop policy if exists "owner deletes circle" on public.circles;

create policy "members read circle" on public.circles
  for select using (public.is_circle_member(id, auth.uid()));
create policy "owner updates circle" on public.circles
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner deletes circle" on public.circles
  for delete using (owner_id = auth.uid());

-- ---------- membership ----------
drop policy if exists "members read roster"   on public.circle_members;
drop policy if exists "leave circle"          on public.circle_members;
drop policy if exists "owner removes members" on public.circle_members;

create policy "members read roster" on public.circle_members
  for select using (public.is_circle_member(circle_id, auth.uid()));
create policy "leave circle" on public.circle_members
  for delete using (user_id = auth.uid());
create policy "owner removes members" on public.circle_members
  for delete using (
    exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

-- ---------- sharing ----------
drop policy if exists "see shares in my circles" on public.prayer_circles;
drop policy if exists "author shares own prayer" on public.prayer_circles;
drop policy if exists "author unshares"          on public.prayer_circles;

create policy "see shares in my circles" on public.prayer_circles
  for select using (public.is_circle_member(circle_id, auth.uid()));

-- You may only share a prayer you wrote, and only into a circle you belong to.
create policy "author shares own prayer" on public.prayer_circles
  for insert with check (
    public.is_circle_member(circle_id, auth.uid())
    and exists (select 1 from public.prayers p where p.id = prayer_id and p.user_id = auth.uid())
  );
create policy "author unshares" on public.prayer_circles
  for delete using (
    exists (select 1 from public.prayers p where p.id = prayer_id and p.user_id = auth.uid())
  );

-- ---------- intercessions ----------
drop policy if exists "see prayers for visible" on public.intercessions;
drop policy if exists "record own prayer"       on public.intercessions;
drop policy if exists "undo own prayer"         on public.intercessions;

-- You can see who prayed only for prayers you are allowed to read.
create policy "see prayers for visible" on public.intercessions
  for select using (
    exists (
      select 1 from public.prayers p
      where p.id = prayer_id
        and (p.user_id = auth.uid() or public.can_see_prayer(p.id, auth.uid()))
    )
  );

-- You may only record praying for something shared with you.
create policy "record own prayer" on public.intercessions
  for insert with check (
    user_id = auth.uid() and public.can_see_prayer(prayer_id, auth.uid())
  );
create policy "undo own prayer" on public.intercessions
  for delete using (user_id = auth.uid());

-- ============================================================
--  The one existing policy that widens
--
--  Before: you see your own prayers.
--  After:  you see your own prayers, plus prayers other people
--          have deliberately shared into a circle you belong to.
--
--  Nothing becomes visible until somebody shares it. With no
--  shares, this behaves exactly as before.
-- ============================================================

drop policy if exists "own rows select" on public.prayers;
create policy "own rows select" on public.prayers
  for select using (
    user_id = auth.uid()
    or public.can_see_prayer(id, auth.uid())
  );

-- ============================================================
--  Profiles
--
--  auth.users is not readable from the browser, so circle mates
--  would otherwise be anonymous ids. This mirrors just a name and
--  a photo, readable only by people who share a circle with you.
-- ============================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  updated_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

create or replace function public.shares_a_circle(a uuid, b uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
    from public.circle_members m1
    join public.circle_members m2 on m1.circle_id = m2.circle_id
    where m1.user_id = a and m2.user_id = b
  );
$$;

drop policy if exists "read visible profiles" on public.profiles;
drop policy if exists "write own profile"    on public.profiles;
drop policy if exists "update own profile"   on public.profiles;

create policy "read visible profiles" on public.profiles
  for select using (id = auth.uid() or public.shares_a_circle(auth.uid(), id));
create policy "write own profile" on public.profiles
  for insert with check (id = auth.uid());
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
