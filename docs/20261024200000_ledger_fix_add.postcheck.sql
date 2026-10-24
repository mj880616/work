-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (원장 표·정책·권한·다른 원장 함수 변화 없음, 기록 표·수정 요청 행 수 같음).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다.
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261024200000' and name='ledger_fix_add')=1 then '예' else '아니오' end as value
union all select 'fix function invoker, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)')
    and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'fix function has the add path',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_apply_ledger_fix(uuid,jsonb,boolean)') and prosrc like '%명진이 직접 기록%') then '예' else '아니오' end
union all select 'three helpers present',case when num_nonnulls(to_regprocedure('private.app_auto_ledger_insert(uuid,text,text,text,jsonb)'),to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)'),to_regprocedure('private.app_auto_ledger_log(uuid,uuid,text,text,uuid,uuid,text,uuid,text,jsonb,text)'))=3 then '예' else '아니오' end
union all select 'ledger records rows',(select count(*)::text from public.app_ledger_records)
union all select 'fix requests rows',(select count(*)::text from public.app_ledger_fix_requests)
union all select 'ledger tables policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname)
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%'),''))
union all select 'ledger tables owner RLS grants hash',md5(coalesce((select string_agg(relname||':'||relrowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname)
  from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%'),''))
union all select 'other ledger functions hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc),',' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and (p.proname like 'app\_auto\_ledger\_%' or p.proname='app_undo_ledger_fix')),''));
