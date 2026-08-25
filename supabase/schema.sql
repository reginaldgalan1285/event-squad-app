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
