-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 아래 expect 줄 또는 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (담당조직 표의 행 수·정책·권한·트리거 변화 없음, 새 표는 비어 있음).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- expect: dispute stage rows = 0
-- expect: dispute history rows = 0
-- expect: dispute stages policies = 2
-- expect: dispute history policies = 2
select 'history, tables, columns, constraints, policies and function agree' as item,case when
  (select count(*) from supabase_migrations.schema_migrations where version='20261024100000' and name='org_dispute_stage_db')=1
  and to_regclass('public.app_dispute_stages') is not null and to_regclass('public.app_suborganization_dispute_stages') is not null
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_dispute_stages') and conname='app_dispute_stages_flags_check' and contype='c')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_dispute_stages') and conname='app_dispute_stages_default_check' and contype='c')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_dispute_stages') and conname='app_dispute_stages_name_unique' and contype='u')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='app_dispute_stages_one_default' and indexdef like '%UNIQUE%WHERE%is_default%')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_suborganization_dispute_stages') and contype='f'
    and confrelid=to_regclass('public.app_dispute_stages') and confdeltype='n')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_suborganization_dispute_stages') and contype='f'
    and confrelid=to_regclass('public.app_suborganizations') and confdeltype='c')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_dispute_stages') and polname='dispute_stages_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_dispute_stages') and polname='dispute_stages_keep_default_and_used' and not polpermissive and polcmd='d'
    and polroles=array['authenticated'::regrole]::oid[])
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_suborganization_dispute_stages') and polname='dispute_stage_history_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_owner_organizationorganization_id')
  and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_suborganization_dispute_stages') and polname='dispute_stage_history_stage_ws' and not polpermissive and polcmd='a'
    and polroles=array['authenticated'::regrole]::oid[])
  and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_dispute_stage_delete(uuid,boolean)') and not prosecdef and proconfig=array['search_path=""'])
  then '예' else '아니오' end as value
union all select 'function executable by authenticated only',case when has_function_privilege('authenticated','public.app_dispute_stage_delete(uuid,boolean)','execute')
  and not has_function_privilege('anon','public.app_dispute_stage_delete(uuid,boolean)','execute')
  and not exists(select 1 from pg_proc where oid=to_regprocedure('public.app_dispute_stage_delete(uuid,boolean)') and (proacl is null or proacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'new tables: RLS on, no anon, public or service_role privilege, no truncate',case when
  (select count(*) from pg_class where oid in (to_regclass('public.app_dispute_stages'),to_regclass('public.app_suborganization_dispute_stages'))
    and relrowsecurity and coalesce(relacl::text,'') !~ '(^|[{,])(anon|service_role)?=')=2
  and not has_table_privilege('anon','public.app_dispute_stages','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_suborganization_dispute_stages','select,insert,update,delete')
  and not has_table_privilege('authenticated','public.app_dispute_stages','truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_suborganization_dispute_stages','truncate,references,trigger,update')
  and not exists(select 1 from pg_attribute where attrelid in (to_regclass('public.app_dispute_stages'),to_regclass('public.app_suborganization_dispute_stages'))
    and coalesce(attacl::text,'') ~ '(^|[{,])(anon|service_role)?=') then '예' else '아니오' end
union all select 'stage default flag and id cannot be edited by authenticated',case when
  not has_column_privilege('authenticated','public.app_dispute_stages','is_default','update')
  and not has_column_privilege('authenticated','public.app_dispute_stages','id','update')
  and not has_column_privilege('authenticated','public.app_dispute_stages','workspace_id','update') then '예' else '아니오' end
union all select 'RLS enabled on suborganizations',case when exists(select 1 from pg_class where oid=to_regclass('public.app_suborganizations') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege on suborganizations',case when not has_table_privilege('anon','public.app_suborganizations','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_suborganizations') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'dispute stages policies',count(*)::text from pg_policy where polrelid=to_regclass('public.app_dispute_stages')
union all select 'dispute history policies',count(*)::text from pg_policy where polrelid=to_regclass('public.app_suborganization_dispute_stages')
union all select 'dispute stage rows',count(*)::text from public.app_dispute_stages
union all select 'dispute history rows',count(*)::text from public.app_suborganization_dispute_stages
union all select 'suborganizations rows',count(*)::text from public.app_suborganizations
union all select 'suborganizations policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_suborganizations')
union all select 'suborganizations owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid=to_regclass('public.app_suborganizations')
union all select 'suborganizations triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_suborganizations') and not tgisinternal;
