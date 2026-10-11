// Synthetic prerequisite fixture copied from BASKET-1; no production connection.
export const OWNER = '20000000-0000-4000-8000-000000000001';
export const STRANGER = '20000000-0000-4000-8000-000000000002';
export const WS_A = '21000000-0000-4000-8000-000000000001';
export const WS_B = '21000000-0000-4000-8000-000000000002';
export const PROJECT_A = '22000000-0000-4000-8000-000000000001';
export const PROJECT_A2 = '22000000-0000-4000-8000-000000000002';
export const PROJECT_B = '22000000-0000-4000-8000-000000000003';
export const ORG_A = '23000000-0000-4000-8000-000000000001';
export const ORG_B = '23000000-0000-4000-8000-000000000002';
export const MEETING_A = '25000000-0000-4000-8000-000000000001';
export const MEETING_B = '25000000-0000-4000-8000-000000000002';

export const fixture = `
  create role anon nologin;
  create role authenticated nologin;
  create role public_probe nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Hosted default ACL: every new public table grants ALL to anon/authenticated/service_role.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key, statements text[], name text);
  create schema auth;
  create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create table public.app_workspaces(id uuid primary key, slug text, name text);
  create table public.app_workspace_members(workspace_id uuid references public.app_workspaces(id), user_id uuid, role text);
  create table public.app_spaces(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id));
  create table public.app_suborganizations(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), name text, created_by uuid);
  create table public.app_meetings(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text, created_by uuid);
  create schema private;
  grant usage on schema private to authenticated, service_role;
  -- Same bodies as existing local regression fixture; no production query here.
  create function private.app_is_workspace_owner(p_workspace uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select exists (select 1 from public.app_workspace_members wm
      where wm.workspace_id = p_workspace and wm.user_id = (select auth.uid()) and wm.role = 'owner') $$;
  create function private.app_space_in_workspace(p_space uuid, p_workspace uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select p_space is null or exists (select 1 from public.app_spaces s
      where s.id = p_space and s.workspace_id = p_workspace) $$;
  create function private.app_meeting_in_workspace(p_meeting uuid, p_workspace uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select p_meeting is null or exists (select 1 from public.app_meetings m
      where m.id = p_meeting and m.workspace_id = p_workspace) $$;
  revoke all on function private.app_is_workspace_owner(uuid), private.app_space_in_workspace(uuid,uuid) from public;
  grant execute on function private.app_is_workspace_owner(uuid), private.app_space_in_workspace(uuid,uuid) to authenticated, service_role;
  revoke all on function private.app_meeting_in_workspace(uuid,uuid) from public;
  grant execute on function private.app_meeting_in_workspace(uuid,uuid) to authenticated, service_role;
  alter table public.app_suborganizations enable row level security;
  create policy task12a_owner_all on public.app_suborganizations for all to authenticated
    using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  revoke all on public.app_workspaces, public.app_workspace_members, public.app_spaces from anon, authenticated;
  insert into public.app_workspaces values ('${WS_A}'), ('${WS_B}');
  insert into public.app_workspace_members values ('${WS_A}', '${OWNER}', 'owner'), ('${WS_B}', '${STRANGER}', 'owner');
  insert into public.app_spaces values ('${PROJECT_A}', '${WS_A}'), ('${PROJECT_A2}', '${WS_A}'), ('${PROJECT_B}', '${WS_B}');
  insert into public.app_suborganizations values ('${ORG_A}', '${WS_A}'), ('${ORG_B}', '${WS_B}');
  insert into public.app_meetings values ('${MEETING_A}', '${WS_A}'), ('${MEETING_B}', '${WS_B}');
`;
