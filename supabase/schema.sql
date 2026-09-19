-- ============================================================
-- Event Squad App — Supabase schema
-- Run this whole file in the Supabase SQL editor.
-- ============================================================

-- 1. EVENTS
-- One row per open-play session the host creates.
create table events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  sport text not null default 'Pickleball',
  title text not null,
  event_date timestamptz not null,
  location text,
  price_per_player numeric(10,2) not null default 0,
  max_players int,
  created_at timestamptz not null default now()
);

-- 2. EVENT_MEMBERS
-- Confirmed, logged-in players (the host is a member too, is_host = true).
-- Rows here are what count toward the paid total.
create table event_members (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (event_id, user_id)
);

-- 3. GUESTS
-- No-account players a confirmed member is bringing. Just a name,
-- tied to whichever member added them.
create table guests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references event_members(id) on delete cascade,
  name text not null,
  added_at timestamptz not null default now()
);

-- 4. PAYMENT_REQUESTS
-- A non-host player's request to join, from "Request to join" through
-- payment to host approval. guest_names is a plain array since these
-- guests aren't real rows yet — they only become `guests` rows once approved.
create table payment_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  guest_names text[] not null default '{}',
  -- coalesce handles an empty guest_names array, where array_length returns null
  player_count int generated always as (1 + coalesce(array_length(guest_names, 1), 0)) stored,
  amount numeric(10,2) not null,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'pending_approval', 'approved', 'declined')),
  payment_reference text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ============================================================
-- Approval helper: turns an approved request into a real member + guests
-- in one transaction, callable from the app as an RPC.
-- ============================================================
create or replace function approve_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req payment_requests%rowtype;
  new_member_id uuid;
  g text;
begin
  select * into req from payment_requests where id = request_id;

  if req.id is null then
    raise exception 'Request not found';
  end if;

  if req.status <> 'pending_approval' then
    raise exception 'Request is not pending approval';
  end if;

  -- caller must be the host of this request's event
  if not exists (
    select 1 from events e where e.id = req.event_id and e.host_id = auth.uid()
  ) then
    raise exception 'Only the host can approve requests';
  end if;

  insert into event_members (event_id, user_id, name, is_host)
  values (req.event_id, req.user_id, req.name, false)
  returning id into new_member_id;

  foreach g in array req.guest_names loop
    insert into guests (member_id, name) values (new_member_id, g);
  end loop;

  update payment_requests
  set status = 'approved', decided_at = now()
  where id = request_id;
end;
$$;

-- ============================================================
-- Row Level Security
-- ============================================================
alter table events enable row level security;
alter table event_members enable row level security;
alter table guests enable row level security;
alter table payment_requests enable row level security;

-- EVENTS: any signed-in player can browse events; only the host can create/edit/delete theirs.
create policy "events_select_authenticated" on events
  for select using (auth.role() = 'authenticated');

create policy "events_insert_own" on events
  for insert with check (host_id = auth.uid());

create policy "events_update_own" on events
  for update using (host_id = auth.uid());

create policy "events_delete_own" on events
  for delete using (host_id = auth.uid());

-- EVENT_MEMBERS: visible to any signed-in player (so totals/rosters are viewable).
-- Only the host can add themself directly; everyone else joins via approve_payment_request.
create policy "members_select_authenticated" on event_members
  for select using (auth.role() = 'authenticated');

create policy "members_insert_host_self" on event_members
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from events e where e.id = event_id and e.host_id = auth.uid())
  );

-- GUESTS: visible to any signed-in player; a member can only add guests under their own row.
create policy "guests_select_authenticated" on guests
  for select using (auth.role() = 'authenticated');

create policy "guests_insert_own_member" on guests
  for insert with check (
    exists (select 1 from event_members m where m.id = member_id and m.user_id = auth.uid())
  );

create policy "guests_delete_own_member" on guests
  for delete using (
    exists (select 1 from event_members m where m.id = member_id and m.user_id = auth.uid())
  );

-- PAYMENT_REQUESTS: a player sees/creates their own requests;
-- the host of the event can see and update (approve/decline) all requests for it.
create policy "requests_select_own_or_host" on payment_requests
  for select using (
    user_id = auth.uid()
    or exists (select 1 from events e where e.id = event_id and e.host_id = auth.uid())
  );

create policy "requests_insert_own" on payment_requests
  for insert with check (user_id = auth.uid());

create policy "requests_update_own_status" on payment_requests
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "requests_update_host_decision" on payment_requests
  for update using (
    exists (select 1 from events e where e.id = event_id and e.host_id = auth.uid())
  );

-- ============================================================
-- Helpful indexes
-- ============================================================
create index idx_event_members_event on event_members(event_id);
create index idx_guests_member on guests(member_id);
create index idx_payment_requests_event on payment_requests(event_id);
create index idx_payment_requests_status on payment_requests(status);

-- ============================================================
-- Migration: run this if you already applied schema.sql before
-- max_players was added to events.
-- ============================================================
-- alter table events add column max_players int;

-- ============================================================
-- Enable Realtime on these tables. Without this, postgres_changes
-- subscriptions in the app never fire, and other people's screens
-- (e.g. the host watching a player add a guest) won't update live
-- until they navigate away and back.
-- ============================================================
alter publication supabase_realtime add table events, event_members, guests, payment_requests;

-- ============================================================
-- PROFILES
-- One row per user, holding their payment QR + label so OTHER
-- players (not just the owner) can see it on the payment screen.
-- This has to be a public-readable table, not user_metadata,
-- because auth.users data isn't visible across users on the client.
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  payment_qr_url text,
  payment_label text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_authenticated" on profiles
  for select using (auth.role() = 'authenticated');

create policy "profiles_upsert_own" on profiles
  for insert with check (id = auth.uid());

create policy "profiles_update_own" on profiles
  for update using (id = auth.uid());

-- ============================================================
-- STORAGE: after running this file, also create a bucket:
-- Supabase dashboard -> Storage -> New bucket -> name it
-- "payment-qr" -> toggle "Public bucket" ON.
-- Then run this so people can only upload/replace their own QR:
-- ============================================================
create policy "qr_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-qr' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "qr_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'payment-qr' and (storage.foldername(name))[1] = auth.uid()::text);

-- Needed in addition to the insert/update policies above: upload with
-- upsert:true checks for an existing object first, which requires a
-- SELECT policy. "Public bucket" alone doesn't grant this.
create policy "qr_select_public" on storage.objects
  for select to public
  using (bucket_id = 'payment-qr');

-- ============================================================
-- Let a confirmed (non-host) player leave an event themselves,
-- and let a player withdraw their own still-pending join request.
-- Neither existed before — there was no way to undo either action.
-- ============================================================
create policy "members_delete_own" on event_members
  for delete using (user_id = auth.uid() and is_host = false);

create policy "requests_delete_own" on payment_requests
  for delete using (user_id = auth.uid() and status in ('awaiting_payment', 'pending_approval'));

-- ============================================================
-- Top-up payments: a confirmed non-host player adding MORE guests
-- after approval now goes through a payment request again, just
-- like their original join — this links that request to their
-- existing event_members row instead of creating a new one.
-- ============================================================
alter table payment_requests add column member_id uuid references event_members(id) on delete cascade;

-- Replaces the original insert policy: also makes sure a top-up
-- request can only target a member row the requester actually owns.
drop policy if exists "requests_insert_own" on payment_requests;
create policy "requests_insert_own" on payment_requests
  for insert with check (
    user_id = auth.uid()
    and (
      member_id is null
      or exists (select 1 from event_members m where m.id = member_id and m.user_id = auth.uid())
    )
  );

-- Replaces approve_payment_request: if member_id is set, this is a
-- top-up — add the guests to that existing member instead of
-- creating a new event_members row.
create or replace function approve_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req payment_requests%rowtype;
  new_member_id uuid;
  g text;
begin
  select * into req from payment_requests where id = request_id;

  if req.id is null then
    raise exception 'Request not found';
  end if;

  if req.status <> 'pending_approval' then
    raise exception 'Request is not pending approval';
  end if;

  if not exists (
    select 1 from events e where e.id = req.event_id and e.host_id = auth.uid()
  ) then
    raise exception 'Only the host can approve requests';
  end if;

  if req.member_id is not null then
    foreach g in array req.guest_names loop
      insert into guests (member_id, name) values (req.member_id, g);
    end loop;
  else
    insert into event_members (event_id, user_id, name, is_host)
    values (req.event_id, req.user_id, req.name, false)
    returning id into new_member_id;

    foreach g in array req.guest_names loop
      insert into guests (member_id, name) values (new_member_id, g);
    end loop;
  end if;

  update payment_requests
  set status = 'approved', decided_at = now()
  where id = request_id;
end;
$$;

-- ============================================================
-- Let a member edit (rename) a guest under their own row.
-- ============================================================
create policy "guests_update_own_member" on guests
  for update using (
    exists (select 1 from event_members m where m.id = member_id and m.user_id = auth.uid())
  );

-- Replaces the original delete policy: previously any member could
-- delete their own guests. Now only the event's host can delete —
-- other members can rename (above) but not remove. Enforced here,
-- not just hidden in the UI, since a UI-only restriction is not real
-- security.
drop policy if exists "guests_delete_own_member" on guests;
create policy "guests_delete_host_only" on guests
  for delete using (
    exists (
      select 1 from event_members m
      join events e on e.id = m.event_id
      where m.id = guests.member_id and e.host_id = auth.uid()
    )
  );

-- ============================================================
-- Let the host lock the roster so confirmed/paid players can no
-- longer leave on their own. Defaults to allowed (true).
-- ============================================================
alter table events add column allow_leave boolean not null default true;

-- Replaces the original leave policy: now also checks the event's
-- allow_leave flag, enforced here (not just hidden in the UI) so
-- a locked roster can't be bypassed by calling the API directly.
drop policy if exists "members_delete_own" on event_members;
create policy "members_delete_own" on event_members
  for delete using (
    user_id = auth.uid()
    and is_host = false
    and exists (select 1 from events e where e.id = event_id and coalesce(e.allow_leave, true))
  );

-- ============================================================
-- Add a persistent display name to profiles, so players set it
-- once instead of retyping "your name" on every join/create form.
-- ============================================================
alter table profiles add column display_name text;

-- Preferred sport shown on the profile page, similar to the reference.
alter table profiles add column preferred_sport text;

-- ============================================================
-- Auto-create a profiles row for every new signup, so the People
-- directory shows everyone who's signed up — not just people who
-- happened to visit Settings or Profile first.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: create rows for anyone who already signed up before this
-- trigger existed.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- ============================================================
-- Pull the name entered at signup (passed as auth metadata) into
-- the new profile row automatically. Replaces handle_new_user —
-- works even for accounts still pending email confirmation, since
-- metadata is set at signup time, before any session exists.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(trim(new.raw_user_meta_data->>'display_name'), ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ============================================================
-- Profile photo. Same pattern as the payment-qr bucket earlier:
-- after running this, also create a bucket in the Supabase
-- dashboard -> Storage -> New bucket -> name it "avatars" ->
-- toggle "Public bucket" ON.
-- ============================================================
alter table profiles add column avatar_url text;

create policy "avatar_upload_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatar_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Needed for upsert:true uploads, same reason as payment-qr earlier —
-- the existence check before overwrite requires its own SELECT policy.
create policy "avatar_select_public" on storage.objects
  for select to public
  using (bucket_id = 'avatars');

-- ============================================================
-- Optional Google Maps link for an event's location, shown as a
-- clickable link instead of (or alongside) the plain text address.
-- ============================================================
alter table events add column location_map_url text;

-- ============================================================
-- End time and a free-text description for the event.
-- ============================================================
alter table events add column end_time timestamptz;
alter table events add column description text;

-- ============================================================
-- Fix: join-type payment_requests (member_id was null) had no link
-- to the event_members row they created, so when that member later
-- left, the payment record was orphaned instead of being cleaned up
-- the same way top-up payments already are via cascade delete.
-- This retroactively links a join request to the member row it
-- creates, so a future "leave" correctly removes that payment
-- history too — same behavior top-ups already had.
-- ============================================================
create or replace function approve_payment_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  req payment_requests%rowtype;
  new_member_id uuid;
  g text;
begin
  select * into req from payment_requests where id = request_id;

  if req.id is null then
    raise exception 'Request not found';
  end if;

  if req.status <> 'pending_approval' then
    raise exception 'Request is not pending approval';
  end if;

  if not exists (
    select 1 from events e where e.id = req.event_id and e.host_id = auth.uid()
  ) then
    raise exception 'Only the host can approve requests';
  end if;

  if req.member_id is not null then
    foreach g in array req.guest_names loop
      insert into guests (member_id, name) values (req.member_id, g);
    end loop;

    update payment_requests
    set status = 'approved', decided_at = now()
    where id = request_id;
  else
    insert into event_members (event_id, user_id, name, is_host)
    values (req.event_id, req.user_id, req.name, false)
    returning id into new_member_id;

    foreach g in array req.guest_names loop
      insert into guests (member_id, name) values (new_member_id, g);
    end loop;

    -- Link this join request to the member row it created, so it now
    -- cascades away with the membership if the player later leaves —
    -- same as top-up requests already do.
    update payment_requests
    set status = 'approved', decided_at = now(), member_id = new_member_id
    where id = request_id;
  end if;
end;
$$;

-- One-time cleanup: remove orphaned join-payment records left over
-- from BEFORE this fix — approved joins for people who left and are
-- no longer actually members of that event.
delete from payment_requests
where status = 'approved'
  and member_id is null
  and not exists (
    select 1 from event_members m
    where m.event_id = payment_requests.event_id
      and m.user_id = payment_requests.user_id
  );

-- ============================================================
-- Corrected cleanup — the earlier delete only checked whether the
-- user was a member of the event AT ALL, which doesn't distinguish
-- which specific past join created their CURRENT membership. Since
-- event_members has a unique (event_id, user_id) constraint, only
-- one join can ever be "current" per user per event — any other
-- approved join-type payment for that same user+event is provably
-- stale (it could only exist if they'd left in between). This keeps
-- just the most recent one and removes the rest.
-- ============================================================
delete from payment_requests pr
where pr.status = 'approved'
  and pr.member_id is null
  and exists (
    select 1 from payment_requests pr2
    where pr2.event_id = pr.event_id
      and pr2.user_id = pr.user_id
      and pr2.member_id is null
      and pr2.status = 'approved'
      and pr2.decided_at > pr.decided_at
  );

-- ============================================================
-- Corrected cleanup: the previous delete only caught players who
-- left and never rejoined. It missed the leave-then-rejoin case
-- (like Jomer's) because they DO have a current membership — just
-- not the one their oldest orphaned join payment was for. This
-- version instead keeps only the most recent join-type payment per
-- person per event, and also still removes anyone with zero current
-- membership at all.
-- ============================================================
delete from payment_requests pr
where pr.status = 'approved'
  and pr.member_id is null
  and (
    exists (
      select 1 from payment_requests pr2
      where pr2.event_id = pr.event_id
        and pr2.user_id = pr.user_id
        and pr2.status = 'approved'
        and pr2.member_id is null
        and pr2.decided_at > pr.decided_at
    )
    or not exists (
      select 1 from event_members m
      where m.event_id = pr.event_id
        and m.user_id = pr.user_id
    )
  );

-- ============================================================
-- Allow anonymous (not signed in) visitors to VIEW events, the
-- roster, and guest lists — browsing no longer requires an account.
-- Every insert/update/delete policy is untouched: joining, paying,
-- hosting, and editing anything still requires being signed in,
-- exactly as before. Only read access is being widened here.
-- ============================================================
drop policy if exists "events_select_authenticated" on events;
create policy "events_select_public" on events
  for select using (true);

drop policy if exists "members_select_authenticated" on event_members;
create policy "members_select_public" on event_members
  for select using (true);

drop policy if exists "guests_select_authenticated" on guests;
create policy "guests_select_public" on guests
  for select using (true);

-- ============================================================
-- TOURNAMENT MODE — round robin and single-elimination bracket
-- play, scoped to one event. Deliberately its own lightweight
-- roster (tournament_teams) rather than reusing event_members —
-- a tournament often includes people who never went through the
-- paid-join flow (e.g. walk-ins added just for bracket play), and
-- coupling it to the payment system would make it far more rigid.
-- Read is public (same as events); only the event's host can
-- create/edit anything here.
-- ============================================================
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null default 'Tournament',
  format text not null check (format in ('round_robin', 'single_elim')),
  match_type text not null default 'doubles' check (match_type in ('singles', 'doubles')),
  scoring_mode text not null default 'score' check (scoring_mode in ('score', 'winloss')),
  default_match_minutes int not null default 15,
  status text not null default 'setup' check (status in ('setup', 'in_progress', 'completed')),
  created_at timestamptz not null default now()
);

create table tournament_courts (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  label text not null,
  gender_restriction text not null default 'any' check (gender_restriction in ('any', 'men', 'women', 'mixed')),
  level_restriction text,
  match_type text not null default 'any' check (match_type in ('any', 'singles', 'doubles')),
  created_at timestamptz not null default now()
);

create table tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  player1_name text not null,
  player2_name text,
  gender text check (gender in ('men', 'women', 'mixed')),
  level text,
  created_at timestamptz not null default now()
);

create table tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round_number int not null,
  match_index int not null default 0,
  court_id uuid references tournament_courts(id) on delete set null,
  team1_id uuid references tournament_teams(id) on delete cascade,
  team2_id uuid references tournament_teams(id) on delete cascade,
  team1_score int,
  team2_score int,
  winner_team_id uuid references tournament_teams(id),
  is_tie boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled', 'in_progress', 'completed', 'bye')),
  match_minutes int,
  started_at timestamptz,
  next_match_id uuid references tournament_matches(id) on delete set null,
  next_match_slot int,
  created_at timestamptz not null default now()
);

alter table tournaments enable row level security;
alter table tournament_courts enable row level security;
alter table tournament_teams enable row level security;
alter table tournament_matches enable row level security;

create policy "tournaments_select_public" on tournaments for select using (true);
create policy "tcourts_select_public" on tournament_courts for select using (true);
create policy "tteams_select_public" on tournament_teams for select using (true);
create policy "tmatches_select_public" on tournament_matches for select using (true);

create policy "tournaments_write_host" on tournaments for all
  using (exists (select 1 from events e where e.id = event_id and e.host_id = auth.uid()))
  with check (exists (select 1 from events e where e.id = event_id and e.host_id = auth.uid()));

create policy "tcourts_write_host" on tournament_courts for all
  using (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()))
  with check (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()));

create policy "tteams_write_host" on tournament_teams for all
  using (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()))
  with check (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()));

create policy "tmatches_write_host" on tournament_matches for all
  using (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()))
  with check (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()));

create index idx_tmatches_tournament on tournament_matches(tournament_id);
create index idx_tteams_tournament on tournament_teams(tournament_id);
create index idx_tcourts_tournament on tournament_courts(tournament_id);

-- ============================================================
-- Pools (round robin split into multiple independent groups) and
-- a toggle to disable the match countdown timer entirely.
-- ============================================================
alter table tournaments add column num_pools int not null default 1;
alter table tournaments add column timer_enabled boolean not null default true;
alter table tournament_teams add column pool_number int not null default 1;
alter table tournament_matches add column pool_number int not null default 1;

-- ============================================================
-- Playoffs after round robin: top N finishers from each pool (or
-- overall, if only one pool) advance into a single-elimination
-- bracket. advance_count = 0 means no playoff stage. Matches now
-- carry a stage so group-stage and playoff-stage matches can share
-- the same table but be displayed/scheduled separately.
-- ============================================================
alter table tournaments add column advance_count int not null default 0;
alter table tournament_matches add column stage text not null default 'group' check (stage in ('group', 'playoff'));

-- ============================================================
-- Open play / mixer mode: instead of pre-formed fixed teams,
-- individual players get dynamically paired each round, with
-- partners and opponents rotating round to round. Late arrivals
-- can be added anytime and get prioritized in future rounds until
-- their total games played catches up to everyone else's.
-- ============================================================
alter table tournaments add column fixed_partners boolean not null default true;

create table tournament_players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  gender text check (gender in ('men', 'women', 'mixed')),
  level text,
  active boolean not null default true,
  joined_at timestamptz not null default now()
);

alter table tournament_players enable row level security;

create policy "tplayers_select_public" on tournament_players for select using (true);
create policy "tplayers_write_host" on tournament_players for all
  using (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()))
  with check (exists (select 1 from tournaments t join events e on e.id = t.event_id where t.id = tournament_id and e.host_id = auth.uid()));

-- Links an (ephemeral, open-play) team back to the two individual
-- players in it, so games-played and standings can be tracked per
-- PERSON even though they get a new "team" row every round.
alter table tournament_teams add column player1_id uuid references tournament_players(id) on delete cascade;
alter table tournament_teams add column player2_id uuid references tournament_players(id) on delete cascade;

create index idx_tplayers_tournament on tournament_players(tournament_id);

-- ============================================================
-- Optional constraint for open-play doubles: whenever a woman is
-- included in a pairing, she's partnered with a man rather than
-- another woman, whenever the round's players make that possible.
-- ============================================================
alter table tournaments add column require_mixed_doubles boolean not null default false;

-- ============================================================
-- Named skill levels for a tournament (e.g. "Beginner", "2.5",
-- "Open") instead of free-typing a level string everywhere it's used
-- (teams, players, court restrictions). Empty array means the level
-- fields stay free-text, for tournaments that never set this up.
-- ============================================================
alter table tournaments add column level_names text[] not null default '{}';
