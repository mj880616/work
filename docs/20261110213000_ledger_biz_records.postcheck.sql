-- SELECT only. Run after apply. pg_catalog·migration 기록과 행 수만 읽는다.
-- 예/아니오 항목은 모두 예. 행 수·해시 항목은 precheck의 같은 이름 값과 같아야 한다(원장 표 정책·권한, 다른 원장 함수, 사업 기록 표 정책·권한 그대로).
select 'new migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261110213000' and name='ledger_biz_records')=1 then '예' else '아니오' end as value
union all select 'kind helper has ten kinds with biz_record',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source_kind_ok(text)')
    and prosrc like '%''biz_record''%' and prosrc like '%''calendar_ref''%' and prosrc like '%''basket''%' and prosrc like '%''project_update''%' and prosrc not like '%telegram%') then '예' else '아니오' end
union all select 'kind helper invoker, immutable, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') and not prosecdef and provolatile='i' and proconfig=array['search_path=""']
    and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'kind check has ten kinds with biz_record',case when (select count(*) from pg_constraint where conrelid='public.app_ledger_auto_sources'::regclass and conname='app_ledger_auto_sources_kind_check' and convalidated
    and pg_get_constraintdef(oid) like '%''calendar_ref''%' and pg_get_constraintdef(oid) like '%''project_update''%' and pg_get_constraintdef(oid) like '%''biz_record''%')=1 then '예' else '아니오' end
union all select 'source and record functions call the kind helper',case when (select count(*) from pg_proc where oid in (to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)'),to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)'))
    and not prosecdef and prosrc like '%app_auto_ledger_source_kind_ok%')=2 then '예' else '아니오' end
union all select 'auto source rows',(select count(*)::text from public.app_ledger_auto_sources)
union all select 'ledger tables policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname)
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%'),''))
union all select 'ledger tables owner RLS grants hash',md5(coalesce((select string_agg(relname||':'||relrowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname)
  from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%'),''))
union all select 'other ledger functions hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc),',' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
    and p.proname like 'app\_auto\_ledger\_%' and p.proname<>'app_auto_ledger_source_kind_ok'),''))
union all select 'business records policies and grants hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname)
  from pg_policy p where p.polrelid=to_regclass('public.app_business_records')),'')||':'||coalesce((select relrowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_business_records')),''));
