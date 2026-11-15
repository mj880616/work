-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (원장 표·정책·권한·다른 원장 함수·프로필 정책/권한 변화 없음, 원장 기록·처리 표 행 수 같음).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다.
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261025110000' and name='ledger_sources')=1 then '예' else '아니오' end as value
union all select 'source helper uses the kind helper, invoker, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) and exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source(uuid,jsonb)') and prosrc like '%app_auto_ledger_source_kind_ok%' and prosrc not like '%''project_update''%') then '예' else '아니오' end
union all select 'record function uses the kind helper, invoker, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)') and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) and exists(select 1 from pg_proc where oid=to_regprocedure('public.app_auto_ledger_record(uuid,jsonb)') and prosrc like '%app_auto_ledger_source_kind_ok%' and prosrc not like '%''project_update''%') then '예' else '아니오' end
union all select 'kind helper invoker, authenticated only',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_auto_ledger_source_kind_ok(text)') and not prosecdef and proconfig=array['search_path=""'] and has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0)) then '예' else '아니오' end
union all select 'kind check has nine kinds',case when (select count(*) from pg_constraint where conrelid='public.app_ledger_auto_sources'::regclass and conname='app_ledger_auto_sources_kind_check'
    and pg_get_constraintdef(oid) like '%''call''%' and pg_get_constraintdef(oid) like '%''weekly_personal''%' and pg_get_constraintdef(oid) like '%''calendar_ref''%'
    and pg_get_constraintdef(oid) like '%''basket''%' and pg_get_constraintdef(oid) like '%''project_update''%')=1 then '예' else '아니오' end
union all select 'calendar table RLS on, one authenticated owner policy, no anon or service_role',case when (select relrowsecurity from pg_class where oid='public.app_calendar_work_refs'::regclass)
    and (select coalesce(relacl::text,'') !~ '(^|[{,])(anon)?=' from pg_class where oid='public.app_calendar_work_refs'::regclass)
    and not has_any_column_privilege('anon','public.app_calendar_work_refs','select,insert,update')
    and not has_any_column_privilege('service_role','public.app_calendar_work_refs','select,insert,update')
    and not has_table_privilege('service_role','public.app_calendar_work_refs','delete')
    and (select count(*) from pg_policy where polrelid='public.app_calendar_work_refs'::regclass and polroles=array['authenticated'::regrole]::oid[])=1
    and (select count(*) from pg_policy where polrelid='public.app_calendar_work_refs'::regclass)=1 then '예' else '아니오' end
union all select 'calendar table guard trigger present, guard has no execute grants',case when (select count(*) from pg_trigger where tgrelid='public.app_calendar_work_refs'::regclass and not tgisinternal)=1
    and exists(select 1 from pg_proc where oid=to_regprocedure('private.app_calendar_work_ref_guard()') and not prosecdef and proconfig=array['search_path=""'])
    and not has_function_privilege('authenticated','private.app_calendar_work_ref_guard()','execute')
    and not has_function_privilege('service_role','private.app_calendar_work_ref_guard()','execute') then '예' else '아니오' end
union all select 'calendar table starts empty',case when not exists(select 1 from public.app_calendar_work_refs) then '예' else '아니오' end
union all select 'profile column present, not null, default empty object',case when exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.app_profiles'::regclass and a.attname='ledger_calendar' and a.attnotnull and not a.attisdropped and pg_get_expr(d.adbin,d.adrelid) like '''{}''::jsonb%')
    and exists(select 1 from pg_constraint where conrelid='public.app_profiles'::regclass and conname='app_profiles_ledger_calendar_check') then '예' else '아니오' end
union all select 'profiles shape (RLS on, no anon, authenticated write, two policies)',case when (select relrowsecurity from pg_class where oid='public.app_profiles'::regclass)
    and (select coalesce(relacl::text,'') !~ '(^|[{,])(anon)?=' and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w' from pg_class where oid='public.app_profiles'::regclass)
    and (select count(*) from pg_policy where polrelid='public.app_profiles'::regclass)=2 then '예' else '아니오' end
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
