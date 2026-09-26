-- DRAFT ONLY. Not a migration; do not run in production.
-- Approval, local concurrency/role tests, current snapshot and a generated
-- migration filename/history INSERT are required before promotion.
-- This draft intentionally ends with ROLLBACK and has no migration version.
begin;

-- Existing service_role has no USAGE on private. Keep its schema privileges
-- unchanged: use a public-schema table with RLS and zero client privileges.
create table public.app_auth_handoff_consumptions (
  nonce uuid primary key,
  subject_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default clock_timestamp(),
  constraint app_auth_handoff_consumptions_expiry check (expires_at > consumed_at)
);
alter table public.app_auth_handoff_consumptions enable row level security;
revoke all on table public.app_auth_handoff_consumptions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.app_auth_handoff_consumptions to service_role;
create index app_auth_handoff_consumptions_expiry_idx
  on public.app_auth_handoff_consumptions (expires_at);

-- Authenticated clients cannot call this. The Edge must verify the sealed v2
-- payload (nonce, sub, iat, exp) before calling with service credentials.
-- Do not refresh or return a session unless this RPC returns exactly true.
-- No SECURITY DEFINER, owner IDs in source, bearer tokens, or refresh tokens.
create function public.app_consume_auth_handoff(
  p_nonce uuid, p_subject uuid, p_expires_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := clock_timestamp();
  v_inserted integer;
begin
  if p_nonce is null or p_subject is null or p_expires_at is null
     or not isfinite(p_expires_at)
     or p_expires_at <= v_now or p_expires_at > v_now + interval '5 minutes'
  then
    return false;
  end if;

  -- Expired nonces cannot become valid again. Keep one extra minute for skew.
  -- No network requests inside this database transaction.
  delete from public.app_auth_handoff_consumptions
    where expires_at < v_now - interval '1 minute';
  insert into public.app_auth_handoff_consumptions
    (nonce, subject_id, expires_at, consumed_at)
    values (p_nonce, p_subject, p_expires_at, v_now)
    on conflict (nonce) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted = 1;
end;
$function$;
revoke all on function public.app_consume_auth_handoff(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.app_consume_auth_handoff(uuid, uuid, timestamptz)
  to service_role;

-- At promotion only: insert one schema_migrations row immediately before COMMIT
-- using the version and name from the actual CLI-generated migration filename.
rollback;
