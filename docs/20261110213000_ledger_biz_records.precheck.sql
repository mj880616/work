-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). pg_catalog·migration 기록과 행 수만 읽는다(기록 글·원장 ID 없음).
-- 적용 전 기대: 앞 단계 두 개(20261025110000 ledger_sources, 20261109110000 record_one_biz) 적용됨, 종류 도우미가 앞 단계 본문 그대로(md5)·INVOKER·immutable·search_path 빈칸·authenticated만 실행,
-- 처리 표 종류 CHECK는 아홉 종류(biz_record 없음), 출처·실행 기록 함수는 도우미를 부름, 사업 기록 표 있음.
-- 원장 표 정책·표 권한, 다른 원장 함수, 사업 기록 표 정책·권한 해시와 행 수는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: auto source rows = 기록
-- expect: ledger tables policies hash = 기록
-- expect: ledger tables owner RLS grants hash = 기록
-- expect: other ledger functions hash = 기록
-- expect: business records policies and grants hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261110213000') then '예' else '아니오' end as value
union all select 'ledger sources applied (20261025110000)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261025110000' and name='ledger_sources')=1 then '예' else '아니오' end
union all select 'record one biz applied (20261109110000)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261109110000' and name='record_one_biz')=1 then '예' else '아니오' end
union all select 'business records table present',case when to_regclass('public.app_business_records') is not null then '예' else '아니오' end
union all select 'kind helper keeps the earlier body',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') and md5(prosrc)='0fe4c85202f976473f769c57275326ed') then '예' else '아니오' end
union all select 'kind helper invoker, immutable, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') and not prosecdef and provolatile='i' and proconfig=array['search_path=""']
    and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'kind check has nine kinds, no biz_record',case when (select count(*) from pg_constraint where conrelid='public.app_ledger_auto_sources'::regclass and conname='app_ledger_auto_sources_kind_check'
    and pg_get_constraintdef(oid) like '%''calendar_ref''%' and pg_get_constraintdef(oid) like '%''project_update''%' and pg_get_constraintdef(oid) not like '%biz_record%')=1 then '예' else '아니오' end
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
