// Synthetic prerequisites for the record-one DB tests (O-2 record_one_org, B-1 record_one_biz). No production connection.
// 운영 모양을 흉내 낸 앞선 표: 조직 기록은 표 단위 권한(칸 단위 아님)·조직 owner 정책·created_at 기본값.
import {OWNER,STRANGER,WS_A,WS_B,ORG_A,ORG_B} from './basket4-fixture.mjs';
export const UPD_A='24000000-0000-4000-8000-000000000001',UPD_B='24000000-0000-4000-8000-000000000002';
export const FEED_A='26000000-0000-4000-8000-000000000001',FEED_B='26000000-0000-4000-8000-000000000002';
export const MEM_A='27000000-0000-4000-8000-000000000001',NOTE_A='28000000-0000-4000-8000-000000000001',NOTE_B='28000000-0000-4000-8000-000000000002';
export const DOC_A='29000000-0000-4000-8000-000000000001',DOC_B='29000000-0000-4000-8000-000000000002';
export const OLD='2f000000-0000-4000-8000-000000000001';

const owned=t=>`
  alter table public.${t} enable row level security;
  revoke all on public.${t} from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.${t} to authenticated;
  create policy synthetic_owner on public.${t} for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));`;
export const prerequisites=`
  revoke all on public.app_suborganizations from public, anon;
  grant select on public.app_suborganizations to authenticated;
  insert into auth.users values ('${OWNER}'), ('${STRANGER}');
  create function private.app_is_owner_organization(p_org uuid) returns boolean
    language sql stable security definer set search_path = pg_catalog, public as $$
    select exists (select 1 from public.app_suborganizations o where o.id = p_org and private.app_is_workspace_owner(o.workspace_id)) $$;
  revoke all on function private.app_is_owner_organization(uuid) from public;
  grant execute on function private.app_is_owner_organization(uuid) to authenticated, service_role;
  create table public.app_suborganization_updates(id uuid primary key default gen_random_uuid(), workspace_id uuid, organization_id uuid not null references public.app_suborganizations(id) on delete cascade,
    raw_text text not null, detail_text text, occurred_at timestamptz not null default now(), created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz default now());
  alter table public.app_suborganization_updates enable row level security;
  revoke all on public.app_suborganization_updates from public, anon, authenticated, service_role;
  grant select, insert, update, delete on public.app_suborganization_updates to authenticated;
  create policy task12a_owner_all on public.app_suborganization_updates for all to authenticated
    using (private.app_is_owner_organization(organization_id)) with check (private.app_is_owner_organization(organization_id));
  create table public.app_documents(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text);
  create table public.app_feed_items(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), title text);
  create table public.app_journal_memorable(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), line text);
  create table public.app_notes(id uuid primary key, workspace_id uuid not null references public.app_workspaces(id), raw_text text);
  ${['app_documents','app_feed_items','app_journal_memorable','app_notes'].map(owned).join('')}
  alter table public.app_meetings enable row level security;
  create policy synthetic_owner on public.app_meetings for all to authenticated using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
  insert into public.app_suborganization_updates(id, workspace_id, organization_id, raw_text, occurred_at) values
    ('${OLD}', '${WS_A}', '${ORG_A}', '옛 기록', '2026-10-01T12:00:00+09:00'),
    ('${UPD_A}', '${WS_A}', '${ORG_A}', '합성 조직 기록', '2026-11-03T12:00:00+09:00'),
    ('${UPD_B}', '${WS_B}', '${ORG_B}', '남의 조직 기록', '2026-11-03T12:00:00+09:00');
  insert into public.app_documents values ('${DOC_A}', '${WS_A}', '개인 확정본'), ('${DOC_B}', '${WS_B}', '남의 자료');
  insert into public.app_feed_items values ('${FEED_A}', '${WS_A}', '통화'), ('${FEED_B}', '${WS_B}', '남의 통화');
  insert into public.app_journal_memorable values ('${MEM_A}', '${WS_A}', '소식');
  insert into public.app_notes values ('${NOTE_A}', '${WS_A}', '업데이트'), ('${NOTE_B}', '${WS_B}', '남의 업데이트');
  create role supabase_read_only_user login bypassrls;
  grant pg_read_all_data to supabase_read_only_user;
  grant authenticated to postgres;`;
