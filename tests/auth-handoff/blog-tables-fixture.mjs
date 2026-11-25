// Synthetic prerequisites for BLOG ① (20261125113100_blog_tables). No production connection.
// Run after basket4-fixture and 20261020005000_share_pages_links: the operator feature table and helpers as production has them
// (same bodies as 20261029090000_operator_features, key list as of 20261121090000_nojo_words_feature), the note table as far as
// the migration reads it, and the two prerequisite history rows. WS_A (OWNER) is the operator (calls), WS_B (STRANGER) is not.
import {WS_A} from './basket4-fixture.mjs';
export const blogPrerequisites = `
 create table public.app_operator_features (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  feature text not null,
  created_at timestamptz not null default now(),
  constraint app_operator_features_pkey primary key (workspace_id, feature),
  constraint app_operator_features_feature_check check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words')));
 alter table public.app_operator_features enable row level security;
 revoke all on table public.app_operator_features from public, anon, authenticated, service_role;
 create function private.app_workspace_has_feature(p_workspace uuid, p_feature text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_workspace is not null and p_feature is not null and private.app_is_workspace_owner(p_workspace)
     and exists (select 1 from public.app_operator_features f where f.workspace_id = p_workspace and f.feature = p_feature) $$;
 create function public.app_my_features() returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.array_agg(distinct f.feature order by f.feature), '{}'::text[])
    from public.app_operator_features f where private.app_is_workspace_owner(f.workspace_id) $$;
 create function public.app_operator_feature_workspace(p_feature text) returns uuid language sql stable security definer set search_path = '' as $$
  select case when pg_catalog.count(*) = 1 then pg_catalog.min(f.workspace_id::text)::uuid end
    from public.app_operator_features f where f.feature = p_feature $$;
 revoke all on function private.app_workspace_has_feature(uuid, text), public.app_my_features(), public.app_operator_feature_workspace(text) from public, anon, authenticated, service_role;
 grant execute on function private.app_workspace_has_feature(uuid, text), public.app_my_features() to authenticated;
 grant execute on function public.app_operator_feature_workspace(text) to service_role;
 insert into public.app_operator_features (workspace_id, feature) values ('${WS_A}', 'calls'), ('${WS_A}', 'telegram'), ('${WS_A}', 'arsenal');
 create table public.app_notes(id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  kind text not null default 'note', title text, raw_text text not null default '', doc jsonb, deleted_at timestamptz, archived_at timestamptz);
 alter table public.app_notes enable row level security;
 revoke all on table public.app_notes from public, anon, authenticated, service_role;
 grant select, insert, update, delete on table public.app_notes to authenticated;
 grant select on table public.app_notes to service_role;
 create policy notes_owner_all on public.app_notes for all to authenticated
  using (private.app_is_workspace_owner(workspace_id)) with check (private.app_is_workspace_owner(workspace_id));
 insert into supabase_migrations.schema_migrations (version, name) values ('20261121090000', 'nojo_words_feature'), ('20261027050000', 'trash_share_pages_db');`;
