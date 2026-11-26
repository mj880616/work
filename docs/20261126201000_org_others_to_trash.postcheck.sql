-- SELECT only. Run after apply (the backup table public.app_cleanup_s71_40_orgs must exist; the workflow's dry-run does not run this file).
-- No organization name, id or record text is shown: only yes/no, counts and hashes.
-- The count/hash items must equal the precheck values of the same name (assigned organizations, organization row count,
-- assignee rows, profile workplace rows, policies and triggers unchanged; only deleted_at of the backed-up organizations changes).
with h as (select count(*) filter (where name = 'org_others_to_trash') as named, count(*) as n from supabase_migrations.schema_migrations where version = '20261126201000'),
ws as (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram'),
assigned as (
  select o.id from public.app_suborganizations o
   where o.workspace_id in (select workspace_id from ws) and o.deleted_at is null
     and (exists (select 1 from public.app_suborganization_assignees x where x.organization_id = o.id)
          or exists (select 1 from public.app_profile_workplaces x where x.organization_id = o.id)))
select 'move agrees with history' as item, case
  when h.n = 1 and h.named = 1 then case
    when to_regclass('public.app_cleanup_s71_40_orgs') is null then '아니오'
    when (select count(*) from public.app_suborganizations o join public.app_cleanup_s71_40_orgs b on b.organization_id = o.id
          where o.deleted_at = b.moved_at) = (select count(*) from public.app_cleanup_s71_40_orgs) then '예' else '아니오' end
  when h.n = 0 then case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예' else '아니오' end
  else '아니오' end as value
  from h
union all select 'no assigned org moved', case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예'
  when exists (select 1 from public.app_cleanup_s71_40_orgs b where exists (select 1 from public.app_suborganization_assignees x where x.organization_id = b.organization_id)
    or exists (select 1 from public.app_profile_workplaces x where x.organization_id = b.organization_id)) then '아니오' else '예' end
union all select 'backup table closed', case when to_regclass('public.app_cleanup_s71_40_orgs') is null then '예'
  when exists (select 1 from pg_class where oid = to_regclass('public.app_cleanup_s71_40_orgs') and relrowsecurity)
   and not exists (select 1 from pg_policy where polrelid = to_regclass('public.app_cleanup_s71_40_orgs'))
   and not has_table_privilege('anon', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('authenticated', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('service_role', 'public.app_cleanup_s71_40_orgs', 'select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'RLS still enabled', case when exists (select 1 from pg_class where oid = to_regclass('public.app_suborganizations') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege', case when not has_table_privilege('anon', 'public.app_suborganizations', 'select,insert,update,delete')
  and not exists (select 1 from pg_class where oid = to_regclass('public.app_suborganizations') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'assigned orgs', (select count(*) from assigned)::text
union all select 'org rows', (select count(*) from public.app_suborganizations)::text
union all select 'assignee rows', (select count(*) from public.app_suborganization_assignees)::text
union all select 'profile workplace rows', (select count(*) from public.app_profile_workplaces)::text
union all select 'assigned orgs hash', md5(coalesce((select string_agg(id::text, ',' order by id) from assigned), ''))
union all select 'policies hash', md5(coalesce(string_agg(polname::text || polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname), ''))
  from pg_policy where polrelid = to_regclass('public.app_suborganizations')
union all select 'triggers hash', md5(coalesce(string_agg(tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid), ',' order by tgname), ''))
  from pg_trigger where tgrelid = to_regclass('public.app_suborganizations') and not tgisinternal;
