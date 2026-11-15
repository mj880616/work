-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 표·함수가 아직 없음과 이번 기록이 없음을 기록한다(되돌린 뒤 같은지 대조). 기존 표(app_spaces 등)는 바꾸지 않으므로 정의를 읽지 않는다.
select 'table' as kind,'public.app_business_records' as name,coalesce(to_regclass('public.app_business_records')::text,'absent') as definition
union all select 'table','public.app_business_now',coalesce(to_regclass('public.app_business_now')::text,'absent')
union all select 'function','private.app_business_records_guard()',coalesce(to_regprocedure('private.app_business_records_guard()')::text,'absent')
union all select 'function','private.app_business_now_guard()',coalesce(to_regprocedure('private.app_business_now_guard()')::text,'absent')
union all select 'owner function',p.oid::regprocedure::text,p.prosecdef::text
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261109100000','20261109110000')
order by 1,2;
