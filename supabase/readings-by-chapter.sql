-- ============================================================
--  Cairn — the reading plan stops being a calendar
--
--  The plan always advanced by chapters finished, not by dates,
--  but the table said otherwise: one completion per user per day.
--  That quietly made it impossible to read two chapters in one
--  evening, or to catch up after missing a week.
--
--  A completion now belongs to a chapter. You finish each one
--  once, whenever you get to it. The day is still recorded,
--  because the streak counts days you showed up, but it is no
--  longer a limit on how much you may read.
--
--  Safe to run more than once.
-- ============================================================

-- Collapse any duplicates first, keeping the earliest completion
-- of each chapter, or the constraint below cannot be created.
delete from public.readings a
using public.readings b
where a.user_id = b.user_id
  and a.reference = b.reference
  and a.reference is not null
  and (
    coalesce(a.completed_at, 'infinity'::timestamptz) > coalesce(b.completed_at, 'infinity'::timestamptz)
    or (a.completed_at is not distinct from b.completed_at and a.id > b.id)
  );

alter table public.readings drop constraint if exists readings_user_id_day_key_key;
alter table public.readings drop constraint if exists readings_user_reference_key;

alter table public.readings
  add constraint readings_user_reference_key unique (user_id, reference);

-- The streak still reads by day, so keep that index useful.
create index if not exists readings_user_day_idx on public.readings (user_id, day_key desc);
