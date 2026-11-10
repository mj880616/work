-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다. 긴 정의는 md5·length로만 남긴다.
-- 종류 도우미 정의·실행권, 처리 표 검사, 원장 처리 표 정책·권한과 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'kind helper' as kind,p.oid::regprocedure::text as name,md5(p.prosrc)||':'||p.prosecdef::text||':'||p.provolatile::text||':'||coalesce(p.proconfig::text,'')||':'||coalesce(p.proacl::text,'') as definition
  from pg_proc p where p.oid=to_regprocedure('private.app_auto_ledger_source_kind_ok(text)')
union all select 'auto sources constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))||':'||length(pg_get_constraintdef(c.oid))::text
  from pg_constraint c where c.conrelid=to_regclass('public.app_ledger_auto_sources')
union all select 'auto sources policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_ledger_auto_sources')
union all select 'auto sources table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_ledger_auto_sources')
union all select 'ledger function',p.oid::regprocedure::text,md5(p.prosrc)||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')
  from pg_proc p where p.oid in (to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)'),to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261110213000'
order by 1,2;
