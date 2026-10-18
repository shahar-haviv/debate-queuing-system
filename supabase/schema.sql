-- ============================================================================
--  Candidate Queue & Dispatch Management — Supabase schema
--  Run this whole file once in: Supabase Dashboard -> SQL Editor -> New query
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  create type public.room_type as enum ('Debate', 'Personal', 'General');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.task_assignment as enum ('Debate Interview', 'Personal Interview');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.allowed_admins (
  email text primary key
);

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  room_name    text not null,
  room_type    public.room_type not null default 'General',
  -- A room can host a panel: an ordered list of { name, phone } objects.
  -- Empty means "nobody in particular", which is why an empty panel can never
  -- raise a conflict of interest.
  interviewers jsonb not null default '[]'::jsonb
);

create table if not exists public.candidates (
  id                         uuid primary key default gen_random_uuid(),
  serial_number              text,
  name                       text not null,
  phone_number               text,
  planned_time               text,                                -- 'HH:MM'
  arrival_time               timestamptz,
  has_arrived                boolean not null default false,
  debate_interview_completed boolean not null default false,
  personal_interview_completed boolean not null default false,
  interviewer_constraints    text[] not null default '{}',  -- interviewers to keep away
  assigned_room              uuid references public.rooms (id) on delete set null,
  current_task_assignment    public.task_assignment,
  room_entry_time            timestamptz,                     -- when they entered the current room
  created_at                 timestamptz not null default now()
);

create index if not exists candidates_has_arrived_idx on public.candidates (has_arrived);
create index if not exists candidates_planned_time_idx on public.candidates (planned_time);
create index if not exists candidates_assigned_room_idx on public.candidates (assigned_room);

-- Full replica identity so realtime DELETE events carry the old row.
alter table public.candidates replica identity full;
alter table public.rooms replica identity full;

-- ---------------------------------------------------------------------------
-- 2b. Incremental upgrades
--     `create table if not exists` never alters a table that already exists, so
--     columns introduced after the first release are declared here too. Both
--     paths are idempotent, so this file stays safe to re-run at any time.
-- ---------------------------------------------------------------------------
alter table public.rooms      add column if not exists interviewers  jsonb not null default '[]'::jsonb;
alter table public.candidates add column if not exists room_entry_time   timestamptz;
alter table public.candidates add column if not exists interviewer_constraints text[] not null default '{}';

-- One-way migration from the first release, when a room could hold exactly one
-- interviewer in two flat columns. The pair is folded into the panel array, then
-- the old columns are dropped, so interviewers live in one place only.
--
-- Guarded on the old column existing, because this file is re-run on every
-- deploy: after the first pass the UPDATE would have nothing left to read.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'rooms'
       and column_name = 'interviewer_name'
  ) then
    update public.rooms
       set interviewers = jsonb_build_array(
             jsonb_build_object(
               'name',  trim(interviewer_name),
               'phone', nullif(trim(coalesce(interviewer_phone, '')), '')
             )
           )
     where interviewer_name is not null
       and trim(interviewer_name) <> ''
       and interviewers = '[]'::jsonb;   -- never clobber a panel that is already set

    alter table public.rooms drop column interviewer_name;
    alter table public.rooms drop column interviewer_phone;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Automation triggers
--
--    The business rules live on the server so they hold even when a client
--    misbehaves or rows are edited straight through the REST API.
--
--      Rule 1  Arrival is a precondition. While has_arrived is false the
--              candidate cannot hold a room, a task or interview results —
--              those are wiped. This is what makes un-ticking "Arrived" a
--              clean reset instead of a half-cleared row.
--      Rule 2  Ticking "has arrived" stamps the server clock into arrival_time.
--      Rule 3  Completing either interview releases the room + task instantly.
--      Rule 4  A task without a room is normalised away so the two columns can
--              never disagree.
--      Rule 5  room_entry_time is owned by the server. It starts the moment a
--              candidate is put in a room, restarts if they are moved to a
--              different room, and is cleared as soon as they leave one — so it
--              always measures time in the room they are standing in now.
--      Rule 6  The task follows the room's type: a Debate room means a Debate
--              Interview, a Personal room a Personal Interview. A General room
--              is the one thing the database cannot infer, so there the task
--              stays whatever the admin chose. Changing a room's type re-derives
--              it for everyone standing in that room.
--      Rule 7  Conflict of interest. A candidate may name interviewers who must
--              not interview them. A room can hold a whole panel, so the test is
--              against every interviewer standing in it: one match is enough to
--              disqualify the room. Putting them there is refused outright, so
--              the restriction still holds for a client that ignores the
--              disabled options. Both lists are tidied on the way in — trimmed,
--              de-duplicated, blanks dropped.
-- ---------------------------------------------------------------------------
-- Rule 7 needs the panel in a predictable shape, so it is tidied on the way into
-- the table rather than trusted from the client: blank names dropped, entries
-- collapsed when they differ only in case or surrounding space, phones kept as
-- text (or null). A bare string is accepted as a name, so a client that sends
-- ["daniel"] is understood rather than silently ignored.
create or replace function public.normalize_interviewers(list jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(
           jsonb_agg(
             jsonb_build_object('name', cleaned.name, 'phone', cleaned.phone)
             order by cleaned.name
           ),
           '[]'::jsonb
         )
    from (
      select distinct on (lower(panel.name))
             panel.name,
             panel.phone
        from jsonb_array_elements(
               case when jsonb_typeof(list) = 'array' then list else '[]'::jsonb end
             ) as entry
        cross join lateral (
          select case when jsonb_typeof(entry) = 'string' then trim(entry #>> '{}')
                      else trim(entry ->> 'name')
                 end as name,
                 case when jsonb_typeof(entry) = 'string' then null
                      else nullif(trim(coalesce(entry ->> 'phone', '')), '')
                 end as phone
        ) panel
       where coalesce(panel.name, '') <> ''
       order by lower(panel.name)
    ) cleaned;
$$;

-- The interviewers to blame, by name, from the room's panel. Empty when the room
-- is fine. Names are compared trimmed and case-insensitively ("Dana" and "dana "
-- are one person).
create or replace function public.conflicting_interviewers(target_room uuid, constraints text[])
returns text[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct panel.name order by panel.name), '{}'::text[])
    from public.rooms room
    cross join lateral jsonb_array_elements(coalesce(room.interviewers, '[]'::jsonb)) as entry
    cross join lateral (
      select nullif(
               trim(case when jsonb_typeof(entry) = 'string' then entry #>> '{}'
                         else entry ->> 'name' end),
               ''
             ) as name
    ) panel
   where room.id = target_room
     and panel.name is not null
     and lower(panel.name) in (
           select lower(trim(entry_name))
             from unnest(coalesce(constraints, '{}'::text[])) as entry_name
            where trim(entry_name) <> ''
         );
$$;

-- Rule 7 in one place: is this room off-limits for this candidate? A room with
-- nobody recorded can never conflict — there is no one to object to.
create or replace function public.has_interviewer_conflict(target_room uuid, constraints text[])
returns boolean
language sql
stable
set search_path = public
as $$
  select public.conflicting_interviewers(target_room, constraints) <> '{}'::text[];
$$;

-- The same rule stated as a refusal. Raising rather than returning a flag means
-- a conflicting assignment cannot be quietly committed by any client, whatever
-- the UI chose to offer.
create or replace function public.assert_no_interviewer_conflict(target_room uuid, constraints text[])
returns void
language plpgsql
set search_path = public
as $$
declare
  conflict_names text[];
begin
  conflict_names := public.conflicting_interviewers(target_room, constraints);

  if coalesce(array_length(conflict_names, 1), 0) = 0 then
    return;
  end if;

  raise exception 'Conflict of interest: interviewer "%" is on this candidate''s restricted list.',
                  array_to_string(conflict_names, ', ')
    using errcode = 'check_violation';
end $$;

-- Tidies a restricted-interviewer list: trims, drops blanks and collapses
-- entries that differ only in case or surrounding space.
create or replace function public.normalize_constraints(list text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(name order by name), '{}')
    from (
      select distinct on (lower(trim(entry))) trim(entry) as name
        from unnest(coalesce(list, '{}'::text[])) as entry
       where trim(entry) <> ''
       order by lower(trim(entry))
    ) cleaned;
$$;

-- ---------------------------------------------------------------------------
-- Rule 6 in one place: the interview a room's type implies. A General room
-- implies nothing, so this returns null and the caller keeps whatever was
-- chosen by hand instead of overwriting it.
create or replace function public.task_for_room(target_room uuid)
returns public.task_assignment
language sql
stable
set search_path = public
as $$
  select case room.room_type
           when 'Debate'::public.room_type   then 'Debate Interview'::public.task_assignment
           when 'Personal'::public.room_type then 'Personal Interview'::public.task_assignment
           else null
         end
    from public.rooms room
   where room.id = target_room;
$$;

create or replace function public.handle_candidate_changes()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  derived_task public.task_assignment;
begin
  -- Rule 7 — the restricted list is tidied on every write, whoever sent it.
  new.interviewer_constraints := public.normalize_constraints(new.interviewer_constraints);

  if new.has_arrived is not true then
    -- Rule 1 — also covers un-ticking "Arrived", which resets the candidate.
    new.arrival_time := null;
    new.assigned_room := null;
    new.current_task_assignment := null;
    new.room_entry_time := null;
    new.debate_interview_completed := false;
    new.personal_interview_completed := false;
    return new;
  end if;

  -- Rule 2 — stamp the arrival time once, from the server clock.
  if coalesce(old.has_arrived, false) = false then
    new.arrival_time := coalesce(new.arrival_time, now());
  end if;

  -- Rule 3 — completing either interview releases the room immediately.
  if (new.debate_interview_completed is true
        and coalesce(old.debate_interview_completed, false) = false)
     or (new.personal_interview_completed is true
        and coalesce(old.personal_interview_completed, false) = false)
  then
    new.assigned_room := null;
    new.current_task_assignment := null;
  end if;

  -- Rule 4 — a task without a room is meaningless.
  if new.assigned_room is null then
    new.current_task_assignment := null;
  end if;

  -- Rule 5 — the in-room clock. Derived entirely on the server, so a client can
  -- never backdate it or keep a stale one alive after a release.
  if new.assigned_room is null then
    new.room_entry_time := null;                 -- released: stop the clock
  elsif new.assigned_room is distinct from old.assigned_room then
    new.room_entry_time := now();                -- assigned, or moved rooms
  elsif old.room_entry_time is null then
    new.room_entry_time := now();                -- row predates the clock
  else
    new.room_entry_time := old.room_entry_time;  -- unchanged: ignore the client
  end if;

  -- Rule 6 — the task follows the room's type. A General room tells us nothing,
  -- so there we leave the admin's choice alone.
  if new.assigned_room is not null then
    derived_task := public.task_for_room(new.assigned_room);
    if derived_task is not null then
      new.current_task_assignment := derived_task;
    end if;
  end if;

  -- Rule 7 — and never hand them to an interviewer they named as off-limits.
  if new.assigned_room is distinct from old.assigned_room then
    perform public.assert_no_interviewer_conflict(new.assigned_room, new.interviewer_constraints);
  end if;

  return new;
end $$;

drop trigger if exists candidates_before_update on public.candidates;
create trigger candidates_before_update
  before update on public.candidates
  for each row execute function public.handle_candidate_changes();

-- A candidate inserted already marked as arrived still gets a server-side
-- stamp, and one inserted without arrival can never carry dispatch state.
create or replace function public.handle_candidate_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  derived_task public.task_assignment;
begin
  -- Rule 7 — the restricted list is tidied on the way in too.
  new.interviewer_constraints := public.normalize_constraints(new.interviewer_constraints);

  if new.has_arrived is not true then
    new.arrival_time := null;
    new.assigned_room := null;
    new.current_task_assignment := null;
    new.room_entry_time := null;
    new.debate_interview_completed := false;
    new.personal_interview_completed := false;
  else
    new.arrival_time := coalesce(new.arrival_time, now());
    -- Rule 5 — a row inserted straight into a room starts its clock now.
    new.room_entry_time := case
      when new.assigned_room is null then null
      else coalesce(new.room_entry_time, now())
    end;
    -- Rule 6 — and its task follows the room's type.
    if new.assigned_room is not null then
      derived_task := public.task_for_room(new.assigned_room);
      if derived_task is not null then
        new.current_task_assignment := derived_task;
      end if;
    end if;
  end if;

  -- Rule 7 — a row inserted already sitting with a conflicting interviewer is
  -- refused outright rather than quietly accepted.
  perform public.assert_no_interviewer_conflict(new.assigned_room, new.interviewer_constraints);

  return new;
end $$;

drop trigger if exists candidates_before_insert on public.candidates;
create trigger candidates_before_insert
  before insert on public.candidates
  for each row execute function public.handle_candidate_insert();

-- A room's panel is tidied on the way into the table, whoever sent it, so the
-- array can never hold blank names or the same person twice. Rule 7 then only
-- ever has to compare clean names.
create or replace function public.handle_room_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.interviewers := public.normalize_interviewers(new.interviewers);
  return new;
end $$;

drop trigger if exists rooms_before_write on public.rooms;
create trigger rooms_before_write
  before insert or update on public.rooms
  for each row execute function public.handle_room_before_write();

-- Changing a room's type changes what the people inside it are there for, so
-- their task is re-derived to match (Rule 6). This has to be an AFTER trigger:
-- a BEFORE trigger would still see the room's *old* type when it re-reads the
-- table, and would therefore re-derive the old task straight back.
create or replace function public.handle_room_changes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.room_type is distinct from old.room_type then
    update public.candidates
       set current_task_assignment = coalesce(public.task_for_room(new.id), current_task_assignment)
     where assigned_room = new.id;
  end if;
  return new;
end $$;

drop trigger if exists rooms_after_update on public.rooms;
create trigger rooms_after_update
  after update on public.rooms
  for each row execute function public.handle_room_changes();

-- Deleting a room must not leave candidates holding a dangling task. The
-- foreign key already nulls assigned_room, so the paired task is cleared here.
create or replace function public.handle_room_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update public.candidates
     set current_task_assignment = null
   where assigned_room = old.id
     and current_task_assignment is not null;
  return old;
end $$;

drop trigger if exists rooms_before_delete on public.rooms;
create trigger rooms_before_delete
  before delete on public.rooms
  for each row execute function public.handle_room_delete();

-- Anyone already sitting in a room when the clock was introduced starts their
-- timer now, so no card is left without one. After this the trigger owns the
-- column and the `is null` guard makes a re-run a no-op.
update public.candidates
   set room_entry_time = now()
 where assigned_room is not null
   and room_entry_time is null;

-- Bring any pre-existing rows in line with Rule 6 — the task always matches the
-- room's type. A no-op on a fresh install and on every later run.
update public.candidates c
   set current_task_assignment = public.task_for_room(c.assigned_room)
 where c.assigned_room is not null
   and public.task_for_room(c.assigned_room) is not null;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
--    - Anonymous visitors may only READ candidates/rooms (needed for the
--      public /candidate/:id page and its realtime subscription).
--    - Authenticated users whose email is in allowed_admins get full write.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.allowed_admins a
    where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.allowed_admins enable row level security;
alter table public.rooms          enable row level security;
alter table public.candidates     enable row level security;

-- allowed_admins: a signed-in user may read only their own row (used to verify access)
drop policy if exists "Admins read own admin row" on public.allowed_admins;
create policy "Admins read own admin row"
  on public.allowed_admins for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- rooms: anyone may read; admins may write
drop policy if exists "Anyone reads rooms" on public.rooms;
create policy "Anyone reads rooms"
  on public.rooms for select
  to anon, authenticated
  using (true);

-- …but anonymous readers get only the three columns a candidate's own screen
-- needs. Row-level security cannot hide a column, so this is enforced with
-- column privileges instead: the public page already selects exactly these, and
-- now a curious candidate calling the REST API directly cannot harvest who is
-- interviewing whom — a whole panel is only one column away, so this grant is
-- also what keeps `interviewers` off the wire.
-- Admins keep full access.
--
-- This is the one deliberate restriction in the file. To lift it:
--   grant select on public.rooms to anon;
revoke select on public.rooms from anon;
grant select (id, room_name, room_type) on public.rooms to anon;

drop policy if exists "Admins manage rooms" on public.rooms;
create policy "Admins manage rooms"
  on public.rooms for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- candidates: anyone may read; admins may write
drop policy if exists "Anyone reads candidates" on public.candidates;
create policy "Anyone reads candidates"
  on public.candidates for select
  to anon, authenticated
  using (true);

drop policy if exists "Admins manage candidates" on public.candidates;
create policy "Admins manage candidates"
  on public.candidates for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.candidates;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Seed data
-- ---------------------------------------------------------------------------
-- Admin allow-list. The matching auth user is created by `npm run db:push`,
-- or manually via Dashboard -> Authentication -> Users -> Add user.
insert into public.allowed_admins (email)
values ('idc.debate@gmail.com')
on conflict (email) do nothing;

-- Default rooms, inserted only when the table is empty.
insert into public.rooms (room_name, room_type)
select v.room_name, v.room_type::public.room_type
from (values
  ('A206', 'Debate'),
  ('A207', 'Debate'),
  ('A320', 'Debate'),
  ('CL05', 'Personal'),
  ('SL101', 'Personal'),
  ('SL103', 'Personal'),
  ('PEB30', 'Personal')
) as v(room_name, room_type)
where not exists (select 1 from public.rooms);
