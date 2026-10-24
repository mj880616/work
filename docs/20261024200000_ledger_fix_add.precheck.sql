-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no record text, no ledger ID.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 앞 단계(20261024120000) 적용됨, 수정 요청 함수가 INVOKER·search_path 빈칸·authenticated만 실행·add 경로 없음, 도우미 셋 있음.
-- 원장 표·정책 해시와 행 수는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: ledger records rows = 기록
-- expect: fix requests rows = 기록
-- expect: ledger tables policies hash = 기록
-- expect: ledger tables owner RLS grants hash = 기록
-- expect: other ledger functions hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024200000') then '예' else '아니오' end as value
union all select 'ledger auto record applied (20261024120000)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024120000' and name='ledger_auto_record')=1 then '예' else '아니오' end
union all select 'fix function invoker, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)')
    and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'fix function has no add path yet',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)') and prosrc not like '%명진이 직접 기록%') then '예' else '아니오' end
union all select 'three helpers present',case when num_nonnulls(to_regprocedure('private.app_auto_ledger_insert(uuid,text,text,text,jsonb)'),to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)'),to_regprocedure('private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text)'))=3 then '예' else '아니오' end
union all select 'ledger records rows',(select count(*)::text from public.app_ledger_records)
union all select 'fix requests rows',(select count(*)::text from public.app_ledger_fix_requests)
union all select 'ledger tables policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname)
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%'),''))
union all select 'ledger tables owner RLS grants hash',md5(coalesce((select string_agg(relname||':'||relrowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname)
  from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%'),''))
union all select 'other ledger functions hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc),',' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and (p.proname like 'app\_auto\_ledger\_%' or p.proname='app_undo_ledger_fix')),''));
