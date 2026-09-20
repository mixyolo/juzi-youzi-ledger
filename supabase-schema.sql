create extension if not exists pgcrypto with schema extensions;

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  invite_hash text not null unique,
  invite_expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('dai', 'yang')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

-- A person may use the same role on more than one trusted device.
alter table public.household_members
  drop constraint if exists household_members_household_id_role_key;

create table if not exists public.ledger_documents (
  household_id uuid primary key references public.households(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.ledger_documents enable row level security;

create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = p_household_id and user_id = auth.uid()
  );
$$;

drop policy if exists "members can read their ledger" on public.ledger_documents;
create policy "members can read their ledger"
on public.ledger_documents for select
to authenticated
using (public.is_household_member(household_id));

create or replace function public.get_my_household()
returns table (household_id uuid, member_role text, ledger_state jsonb, ledger_revision bigint, member_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select m.household_id, m.role, d.state, d.revision,
    (select count(distinct c.role) from public.household_members c where c.household_id = m.household_id)
  from public.household_members m
  join public.ledger_documents d on d.household_id = m.household_id
  where m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.create_household(p_role text, p_state jsonb)
returns table (household_id uuid, invite_code text, ledger_state jsonb, ledger_revision bigint, member_count bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_household_id uuid;
  v_invite_code text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_role not in ('dai', 'yang') then raise exception 'INVALID_ROLE'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then raise exception 'ALREADY_JOINED'; end if;
  if jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 1000000 then raise exception 'INVALID_STATE'; end if;

  loop
    v_invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    begin
      insert into public.households (invite_hash)
      values (encode(digest(v_invite_code, 'sha256'), 'hex'))
      returning id into v_household_id;
      exit;
    exception when unique_violation then null;
    end;
  end loop;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), p_role);
  insert into public.ledger_documents (household_id, state, updated_by)
  values (v_household_id, p_state, auth.uid());

  return query select v_household_id, v_invite_code, p_state, 0::bigint, 1::bigint;
end;
$$;

create or replace function public.join_household(p_invite_code text, p_role text)
returns table (household_id uuid, member_role text, ledger_state jsonb, ledger_revision bigint, member_count bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_household_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_role not in ('dai', 'yang') then raise exception 'INVALID_ROLE'; end if;
  if exists (select 1 from public.household_members where user_id = auth.uid()) then raise exception 'ALREADY_JOINED'; end if;

  select h.id into v_household_id
  from public.households h
  where h.invite_hash = encode(digest(upper(trim(p_invite_code)), 'sha256'), 'hex')
    and h.invite_expires_at > now()
  for update;

  if v_household_id is null then raise exception 'INVALID_OR_EXPIRED_INVITE'; end if;
  if (select count(*) from public.household_members where household_id = v_household_id) >= 6 then raise exception 'HOUSEHOLD_DEVICE_LIMIT'; end if;

  insert into public.household_members (household_id, user_id, role)
  values (v_household_id, auth.uid(), p_role);

  return query
    select d.household_id, p_role, d.state, d.revision,
      (select count(distinct m.role) from public.household_members m where m.household_id = v_household_id)
    from public.ledger_documents d where d.household_id = v_household_id;
end;
$$;

create or replace function public.set_household_state(p_household_id uuid, p_state jsonb, p_expected_revision bigint)
returns table (ledger_state jsonb, ledger_revision bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then raise exception 'NOT_A_MEMBER'; end if;
  if jsonb_typeof(p_state) <> 'object' or octet_length(p_state::text) > 1000000 then raise exception 'INVALID_STATE'; end if;

  return query
  update public.ledger_documents
  set state = p_state, revision = revision + 1, updated_at = now(), updated_by = auth.uid()
  where household_id = p_household_id and revision = p_expected_revision
  returning state, revision;

  if not found then raise exception 'REVISION_CONFLICT'; end if;
end;
$$;

revoke all on public.households, public.household_members, public.ledger_documents from anon, authenticated;
grant select on public.ledger_documents to authenticated;
revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.get_my_household() from public, anon;
revoke all on function public.create_household(text, jsonb) from public, anon;
revoke all on function public.join_household(text, text) from public, anon;
revoke all on function public.set_household_state(uuid, jsonb, bigint) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.get_my_household() to authenticated;
grant execute on function public.create_household(text, jsonb) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.set_household_state(uuid, jsonb, bigint) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.ledger_documents;
exception
  when duplicate_object then null;
end $$;
