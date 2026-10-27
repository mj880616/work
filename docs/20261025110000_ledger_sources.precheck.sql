-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no record text, no ledger ID.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 앞 단계(20261024120000) 적용됨, 바꿀 두 함수가 앞 단계 본문 그대로(md5)·INVOKER·search_path 빈칸·authenticated만 실행, 종류 CHECK는 여섯 종류, 새 표·칸·도우미 없음.
-- 원장 표·정책·다른 원장 함수·프로필 정책/권한 해시와 행 수는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: ledger records rows = 기록
-- expect: auto source rows = 기록
-- expect: ledger tables policies hash = 기록
-- expect: ledger tables owner RLS grants hash = 기록
-- expect: other ledger functions hash = 기록
-- expect: profiles policies hash = 기록
-- expect: profiles table RLS grants hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261025110000') then '예' else '아니오' end as value
union all select 'ledger auto record applied (20261024120000)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024120000' and name='ledger_auto_record')=1 then '예' else '아니오' end
union all select 'source helper keeps the earlier body',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') and md5(prosrc)='565acb9478f8e095f3b6f20e4acf6565') then '예' else '아니오' end
union all select 'record function keeps the earlier body',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)') and md5(prosrc)='6c4148b0b31ecfa0b6e1f3050fcc6118') then '예' else '아니오' end
union all select 'source helper invoker, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'record function invoker, empty search_path, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)') and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'kind check has six kinds only',case when (select count(*) from pg_constraint where conrelid='public.app_ledger_auto_sources'::regclass and conname='app_ledger_auto_sources_kind_check'
    and pg_get_constraintdef(oid) not like '%call%' and pg_get_constraintdef(oid) not like '%weekly_personal%' and pg_get_constraintdef(oid) not like '%calendar_ref%' and pg_get_constraintdef(oid) like '%project_update%')=1 then '예' else '아니오' end
union all select 'kind helper, guard, calendar table and profile column absent',case when to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') is null and to_regprocedure('private.app_calendar_work_ref_guard()') is null
    and to_regclass('public.app_calendar_work_refs') is null
    and not exists(select 1 from pg_attribute where attrelid='public.app_profiles'::regclass and not attisdropped and attname='ledger_calendar') then '예' else '아니오' end
union all select 'profiles shape (RLS on, no anon, authenticated write, two policies)',case when (select relrowsecurity from pg_class where oid='public.app_profiles'::regclass)
    and (select coalesce(relacl::text,'') !~ '(^|[{,])(anon)?=' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w' from pg_class where oid='public.app_profiles'::regclass)
    and (select count(*) from pg_policy where polrelid='public.app_profiles'::regclass)=2 then '예' else '아니오' end
union all select 'owner function and org read grants present',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
    and has_column_privilege('authenticated','public.app_suborganizations','id','select') and has_column_privilege('authenticated','public.app_suborganizations','workspace_id','select') then '예' else '아니오' end
union all select 'ledger records rows',(select count(*)::text from public.app_ledger_records)
union all select 'auto source rows',(select count(*)::text from public.app_ledger_auto_sources)
union all select 'ledger tables policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname)
  from pg_policy p join pg_class c on c.oid=p.polrelid where c.relnamespace='public'::regnamespace and c.relname like 'app\_ledger\_%'),''))
union all select 'ledger tables owner RLS grants hash',md5(coalesce((select string_agg(relname||':'||relrowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname)
  from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname like 'app\_ledger\_%'),''))
union all select 'other ledger functions hash',md5(coalesce((select string_agg(p.oid::regprocedure::text||':'||p.prosecdef::text||':'||coalesce(p.proacl::text,'')||':'||md5(p.prosrc),',' order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private')
    and ((p.proname like 'app\_auto\_ledger\_%' and p.proname not in('app_auto_ledger_source','app_auto_ledger_record','app_auto_ledger_source_kind_ok')) or p.proname in('app_undo_ledger_fix','app_apply_ledger_fix'))),''))
union all select 'profiles policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname)
  from pg_policy p where p.polrelid='public.app_profiles'::regclass),''))
union all select 'profiles table RLS grants hash',md5(coalesce((select relrowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid='public.app_profiles'::regclass),''));
