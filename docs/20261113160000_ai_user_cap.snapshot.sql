-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다(앱 표를 읽지 않음, 허용 행 개수는 precheck가 본다).
-- 운영자 표의 검사 정의·권한·정책과 새 표·함수의 있음/없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_operator_features','public.app_workspace_ai_caps']) n
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_operator_features')
union all select 'table ACL',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid=to_regclass('public.app_operator_features')
union all select 'policy count',c.relname::text,(select count(*) from pg_policy p where p.polrelid=c.oid)::text
  from pg_class c where c.oid=to_regclass('public.app_operator_features')
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_ai_month_usage(uuid)','public.app_my_ai_month(uuid)','public.app_workspace_ai_month(uuid)']) n
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261113160000'
order by 1,2;
