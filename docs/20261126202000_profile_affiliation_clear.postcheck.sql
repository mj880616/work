-- SELECT only. Run after apply (the backup table public.app_cleanup_s71_40_profiles must exist; the workflow's dry-run does not run this file).
-- No name, affiliation or title text is shown: only yes/no, counts and hashes.
-- The count/hash items must equal the precheck values of the same name (names, other columns, assignee/workplace/collab member rows,
-- policies, grants and triggers unchanged; no row added or removed; only the three columns are emptied).
with h as (select count(*) filter (where name = 'profile_affiliation_clear') as named, count(*) as n from supabase_migrations.schema_migrations where version = '20261126202000')
select 'clear agrees with history' as item, case
  when h.n = 1 and h.named = 1 and to_regclass('public.app_cleanup_s71_40_profiles') is not null then case
    when exists (select 1 from public.app_cleanup_s71_40_profiles b join public.app_profiles p on p.user_id = b.user_id
                 where p.union_name is not null or p.department_name is not null or p.job_title is not null) then '아니오'
    when exists (select 1 from public.app_cleanup_s71_40_profiles b where not exists (select 1 from public.app_profiles p where p.user_id = b.user_id)) then '아니오'
    else '예' end
  else '아니오' end as value
  from h
union all select 'backup table closed', case
  when exists (select 1 from pg_class where oid = to_regclass('public.app_cleanup_s71_40_profiles') and relrowsecurity)
   and not exists (select 1 from pg_policy where polrelid = to_regclass('public.app_cleanup_s71_40_profiles'))
   and not has_table_privilege('anon', 'public.app_cleanup_s71_40_profiles', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('authenticated', 'public.app_cleanup_s71_40_profiles', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('service_role', 'public.app_cleanup_s71_40_profiles', 'select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'RLS still enabled', case when exists (select 1 from pg_class where oid = to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege', case when not has_table_privilege('anon', 'public.app_profiles', 'select,insert,update,delete')
  and not exists (select 1 from pg_class where oid = to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'profile rows', (select count(*) from public.app_profiles)::text
union all select 'names hash', md5(coalesce((select string_agg(user_id::text || ':' || coalesce(display_name, ''), ',' order by user_id) from public.app_profiles), ''))
union all select 'other columns hash', md5(coalesce((select string_agg(md5((to_jsonb(p) - 'union_name' - 'department_name' - 'job_title' - 'updated_at')::text), ',' order by p.user_id) from public.app_profiles p), ''))
union all select 'collab member titles', (select count(*) from public.app_collab_members where title is not null)::text
union all select 'assignee rows', (select count(*) from public.app_suborganization_assignees)::text
union all select 'profile workplace rows', (select count(*) from public.app_profile_workplaces)::text
union all select 'collab member rows', (select count(*) from public.app_collab_members)::text
union all select 'policies hash', md5(coalesce(string_agg(polname::text || polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname), ''))
  from pg_policy where polrelid = to_regclass('public.app_profiles')
union all select 'owner RLS grants hash', md5(coalesce(string_agg(relowner::text || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text || ':' || coalesce(relacl::text, ''), ''), ''))
  from pg_class where oid = to_regclass('public.app_profiles')
union all select 'column grants hash', md5(coalesce(string_agg(attname || ':' || coalesce(attacl::text, ''), ',' order by attname), '')) from pg_attribute where attrelid = to_regclass('public.app_profiles') and attnum > 0 and not attisdropped
union all select 'triggers hash', md5(coalesce(string_agg(tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid), ',' order by tgname), ''))
  from pg_trigger where tgrelid = to_regclass('public.app_profiles') and not tgisinternal;
