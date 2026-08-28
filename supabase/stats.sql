-- ============================================================
--  Cairn — the numbers, for whoever runs it
--
--  Counts only. This function can tell you that eleven prayers
--  were written last week; it cannot tell you, and deliberately
--  never returns, what any of them said. No bodies, no titles,
--  no journal text, no names, no email addresses. The one thing
--  a prayer app must never do is read the prayers.
--
--  Safe to run more than once.
-- ============================================================

create table if not exists public.app_owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.app_owners enable row level security;
-- No policy at all: nobody reaches this table from the browser.
-- Only the security definer function below consults it.

insert into public.app_owners (user_id)
select id from auth.users where email = 'gabrielnicholsokc@gmail.com'
on conflict do nothing;

create or replace function public.app_stats()
returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare out jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.app_owners where user_id = auth.uid()) then
    raise exception 'not permitted';
  end if;

  with last_touch as (
    select u.id,
           u.created_at,
           u.last_sign_in_at,
           greatest(
             coalesce((select max(created_at)   from public.prayers p         where p.user_id = u.id), 'epoch'),
             coalesce((select max(answered_at)  from public.prayers p         where p.user_id = u.id), 'epoch'),
             coalesce((select max(created_at)   from public.journal_entries j where j.user_id = u.id), 'epoch'),
             coalesce((select max(completed_at) from public.readings r        where r.user_id = u.id), 'epoch')
           ) as last_wrote
    from auth.users u
  ),
  answered as (
    select extract(epoch from (answered_at - created_at)) / 86400.0 as days
    from public.prayers
    where status = 'answered' and answered_at is not null
  ),
  days as (
    select generate_series(current_date - 29, current_date, interval '1 day')::date as d
  )
  select jsonb_build_object(
    'generated_at', now(),

    'people', jsonb_build_object(
      'total',        (select count(*) from auth.users),
      'new_today',    (select count(*) from auth.users where created_at >= current_date),
      'new_7d',       (select count(*) from auth.users where created_at > now() - interval '7 days'),
      'new_30d',      (select count(*) from auth.users where created_at > now() - interval '30 days'),
      'active_today', (select count(*) from last_touch where last_wrote >= current_date),
      'active_7d',    (select count(*) from last_touch where last_wrote > now() - interval '7 days'),
      'active_30d',   (select count(*) from last_touch where last_wrote > now() - interval '30 days'),
      'came_back',    (select count(*) from last_touch where last_sign_in_at > created_at + interval '1 day'),
      'never_wrote',  (select count(*) from last_touch where last_wrote = 'epoch'),
      -- of everyone who joined more than a week ago, how many are still here
      'kept_after_a_week', (select count(*) from last_touch
                              where created_at < now() - interval '7 days'
                                and last_wrote > now() - interval '7 days'),
      'joined_over_a_week_ago', (select count(*) from last_touch where created_at < now() - interval '7 days')
    ),

    'prayers', jsonb_build_object(
      'total',       (select count(*) from public.prayers),
      'on_walls',    (select count(*) from public.prayers where status = 'active'),
      'answered',    (select count(*) from public.prayers where status = 'answered'),
      'added_7d',    (select count(*) from public.prayers where created_at > now() - interval '7 days'),
      'answered_7d', (select count(*) from public.prayers where answered_at > now() - interval '7 days'),
      'per_person',  (select round(count(*)::numeric / greatest(count(distinct user_id), 1), 1) from public.prayers),
      'median_days_to_answer', (select round(percentile_cont(0.5) within group (order by days)::numeric, 1) from answered),
      'longest_wait_days',     (select round(max(days)::numeric, 1) from answered)
    ),

    'journal', jsonb_build_object(
      'total',     (select count(*) from public.journal_entries),
      'thankful',  (select count(*) from public.journal_entries where kind = 'gratitude'),
      'open',      (select count(*) from public.journal_entries where kind = 'open'),
      'added_7d',  (select count(*) from public.journal_entries where created_at > now() - interval '7 days')
    ),

    'reading', jsonb_build_object(
      'chapters',      (select count(*) from public.readings where completed_at is not null),
      'chapters_7d',   (select count(*) from public.readings where completed_at > now() - interval '7 days'),
      'readers',       (select count(distinct user_id) from public.readings where completed_at is not null),
      'furthest_along',(select max(c) from (select count(*) c from public.readings where completed_at is not null group by user_id) x)
    ),

    'circles', jsonb_build_object(
      'total',            (select count(*) from public.circles),
      'members',          (select count(*) from public.circle_members),
      'shared_prayers',   (select count(*) from public.prayer_circles),
      'prayers_prayed',   (select count(*) from public.intercessions),
      'prayers_prayed_7d',(select count(*) from public.intercessions where created_at > now() - interval '7 days')
    ),

    'email', jsonb_build_object(
      'reachable',   (select count(*) from public.email_prefs where paused = false and email is not null),
      'paused',      (select count(*) from public.email_prefs where paused = true),
      'wants_remember', (select count(*) from public.email_prefs where remember and not paused),
      'wants_checkin',  (select count(*) from public.email_prefs where checkin  and not paused),
      'wants_reading',  (select count(*) from public.email_prefs where reading  and not paused)
    ),

    'ideas', (select count(*) from public.suggestions),

    -- thirty days of shape, so trends are visible rather than guessed
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', d,
        'signups',  (select count(*) from auth.users            where created_at::date   = d),
        'prayers',  (select count(*) from public.prayers        where created_at::date   = d),
        'answered', (select count(*) from public.prayers        where answered_at::date  = d),
        'journal',  (select count(*) from public.journal_entries where created_at::date  = d),
        'chapters', (select count(*) from public.readings       where completed_at::date = d),
        'prayed_for',(select count(*) from public.intercessions where created_at::date   = d)
      ) order by d)
      from days
    )
  ) into out;

  return out;
end $$;

revoke all on function public.app_stats() from public;
grant execute on function public.app_stats() to authenticated;
