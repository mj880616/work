-- SELECT only. Run after apply. 예/아니오 항목은 모두 예, 그 밖의 값은 아래 expect 줄 또는 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (기존 원장 표 다섯의 정책·권한·트리거 변화 없음, 기록 표 행 수 같음, 새 표는 비어 있음).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- expect: auto runs rows = 0
-- expect: auto sources rows = 0
-- expect: fix requests rows = 0
-- expect: record changes rows = 0
-- expect: new tables count = 4
-- expect: new public functions count = 5
-- expect: new private helpers count = 4
select 'history row present' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261024120000' and name='ledger_auto_record')=1 then '예' else '아니오' end as value
union all select 'four new tables: RLS on, no anon, public or service_role privilege',case when
  (select count(*) from pg_class where oid in (to_regclass('public.app_ledger_auto_runs'),to_regclass('public.app_ledger_auto_sources'),to_regclass('public.app_ledger_fix_requests'),to_regclass('public.app_ledger_record_changes')) and relrowsecurity and coalesce(relacl::text,'') !~ '(^|[{,])(anon|service_role)?=')=4
  and not exists(select 1 from pg_attribute where attrelid in (to_regclass('public.app_ledger_auto_runs'),to_regclass('public.app_ledger_auto_sources'),to_regclass('public.app_ledger_fix_requests'),to_regclass('public.app_ledger_record_changes')) and coalesce(attacl::text,'') ~ '(^|[{,])(anon|service_role)?=')
  and not has_table_privilege('anon','public.app_ledger_auto_runs','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_ledger_auto_sources','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_ledger_fix_requests','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_ledger_record_changes','select,insert,update,delete') then '예' else '아니오' end
union all select 'new tables: one owner policy each, authenticated only, nothing restrictive',case when
  (select count(*) from pg_policy where polrelid in (to_regclass('public.app_ledger_auto_runs'),to_regclass('public.app_ledger_auto_sources'),to_regclass('public.app_ledger_fix_requests'),to_regclass('public.app_ledger_record_changes')))=4
  and (select count(*) from pg_policy where polrelid in (to_regclass('public.app_ledger_auto_runs'),to_regclass('public.app_ledger_auto_sources'),to_regclass('public.app_ledger_fix_requests'),to_regclass('public.app_ledger_record_changes')) and polpermissive and polcmd='*' and polroles=array['authenticated'::regrole]::oid[]
    and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
    and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id')=4 then '예' else '아니오' end
union all select 'record changes is append only for authenticated',case when
  has_table_privilege('authenticated','public.app_ledger_record_changes','select,insert')
  and not has_table_privilege('authenticated','public.app_ledger_record_changes','update,delete,truncate,references,trigger')
  and not has_column_privilege('authenticated','public.app_ledger_record_changes','note','update')
  and not has_column_privilege('authenticated','public.app_ledger_record_changes','record_id','update')
  and not has_column_privilege('authenticated','public.app_ledger_record_changes','dedup_key','update') then '예' else '아니오' end
union all select 'runs, sources and fix requests cannot be deleted by authenticated',case when
  not has_table_privilege('authenticated','public.app_ledger_auto_runs','delete,truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_ledger_auto_sources','delete,truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_ledger_fix_requests','delete,truncate,references,trigger')
  and not has_column_privilege('authenticated','public.app_ledger_auto_runs','id','update')
  and not has_column_privilege('authenticated','public.app_ledger_auto_runs','workspace_id','update')
  and not has_column_privilege('authenticated','public.app_ledger_fix_requests','request','update') then '예' else '아니오' end
union all select 'one running run per workspace and unique dedup key',case when
  exists(select 1 from pg_indexes where schemaname='public' and indexname='app_ledger_auto_runs_one_running' and indexdef like '%UNIQUE%WHERE%status%running%')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='app_ledger_record_changes_dedup_key' and indexdef like '%UNIQUE%WHERE%dedup_key%IS NOT NULL%')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_ledger_record_changes') and conname='app_ledger_record_changes_route_check' and contype='c')
  and exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_ledger_auto_sources') and conname='app_ledger_auto_sources_kind_check' and contype='c') then '예' else '아니오' end
union all select 'audit target check has the original list plus auto_runs and fix_requests',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_ledger_audit')
  and conname='app_ledger_audit_target_check' and contype='c' and pg_get_constraintdef(oid) like '%imports%' and pg_get_constraintdef(oid) like '%candidates%'
  and pg_get_constraintdef(oid) like '%auto_runs%' and pg_get_constraintdef(oid) like '%fix_requests%') then '예' else '아니오' end
union all select 'nine functions: invoker, empty search_path, authenticated only',case when
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname in ('app_auto_ledger_begin','app_auto_ledger_record','app_auto_ledger_undo','app_apply_ledger_fix','app_undo_ledger_fix','app_auto_ledger_personal','app_auto_ledger_source','app_auto_ledger_insert','app_auto_ledger_log')
    and not p.prosecdef and p.proconfig=array['search_path=""'] and p.proacl is not null and p.proacl::text !~ '(^|[{,])(anon|service_role)?=')=9
  and has_function_privilege('authenticated','public.app_auto_ledger_begin(uuid)','execute')
  and has_function_privilege('authenticated','public.app_auto_ledger_record(uuid,jsonb)','execute')
  and has_function_privilege('authenticated','public.app_auto_ledger_undo(uuid)','execute')
  and has_function_privilege('authenticated','public.app_apply_ledger_fix(uuid,jsonb,boolean)','execute')
  and has_function_privilege('authenticated','public.app_undo_ledger_fix(uuid)','execute')
  and not has_function_privilege('anon','public.app_auto_ledger_begin(uuid)','execute')
  and not has_function_privilege('anon','public.app_auto_ledger_record(uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.app_auto_ledger_undo(uuid)','execute')
  and not has_function_privilege('anon','public.app_apply_ledger_fix(uuid,jsonb,boolean)','execute')
  and not has_function_privilege('anon','public.app_undo_ledger_fix(uuid)','execute') then '예' else '아니오' end
union all select 'records table RLS on and no anon or service_role privilege',case when exists(select 1 from pg_class where oid=to_regclass('public.app_ledger_records') and relrowsecurity
  and coalesce(relacl::text,'') !~ '(^|[{,])(anon|service_role)?=') then '예' else '아니오' end
union all select 'new tables count',(num_nonnulls(to_regclass('public.app_ledger_auto_runs'),to_regclass('public.app_ledger_auto_sources'),to_regclass('public.app_ledger_fix_requests'),to_regclass('public.app_ledger_record_changes')))::text
union all select 'new public functions count',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('app_auto_ledger_begin','app_auto_ledger_record','app_auto_ledger_undo','app_apply_ledger_fix','app_undo_ledger_fix'))::text
union all select 'new private helpers count',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in ('app_auto_ledger_personal','app_auto_ledger_source','app_auto_ledger_insert','app_auto_ledger_log'))::text
union all select 'auto runs rows',count(*)::text from public.app_ledger_auto_runs
union all select 'auto sources rows',count(*)::text from public.app_ledger_auto_sources
union all select 'fix requests rows',count(*)::text from public.app_ledger_fix_requests
union all select 'record changes rows',count(*)::text from public.app_ledger_record_changes
union all select 'ledger records rows',count(*)::text from public.app_ledger_records
union all select 'ledger tables policies hash',md5(coalesce(string_agg(c.relname||':'||p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname),''))
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))
union all select 'ledger tables owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))
union all select 'ledger tables column grants hash',md5(coalesce(string_agg(c.relname||'.'||a.attname||':'||a.attacl::text,',' order by c.relname,a.attname),''))
  from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit')) and a.attacl is not null and not a.attisdropped
union all select 'ledger tables triggers hash',md5(coalesce(string_agg(c.relname||':'||t.tgname||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid),',' order by c.relname,t.tgname),''))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit')) and not t.tgisinternal;
