-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no record text, no ledger ID.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 새 표 4개·새 함수 9개 없음, 원장 스키마(20261021082000)·후보 함수(20261021190000) 적용됨, 기록 표 RLS 켜짐·anon/service_role 권한 없음·소유자 정책 그대로,
--   감사 표 대상 CHECK는 옛 8개 목록(auto_runs 없음). 기존 원장 표 다섯의 정책·권한·트리거 해시와 기록 표 행 수는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new tables count = 0
-- expect: new public functions count = 0
-- expect: new private helpers count = 0
-- expect: ledger records rows = 기록
-- expect: ledger tables policies hash = 기록
-- expect: ledger tables owner RLS grants hash = 기록
-- expect: ledger tables column grants hash = 기록
-- expect: ledger tables triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261024120000') then '예' else '아니오' end as value
union all select 'ledger schema and candidates applied',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261021082000')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261021190000') then '예' else '아니오' end
union all select 'owner check function exists',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'five ledger tables present',case when num_nonnulls(to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))=5 then '예' else '아니오' end
union all select 'records table RLS on and no anon or service_role privilege',case when exists(select 1 from pg_class where oid=to_regclass('public.app_ledger_records') and relrowsecurity
  and coalesce(relacl::text,'') !~ '(^|[{,])(anon|service_role)?=') then '예' else '아니오' end
union all select 'records owner policy is authenticated owner-only',case when exists(select 1 from pg_policy where polrelid=to_regclass('public.app_ledger_records') and polname='ledger_records_owner_all' and polpermissive and polcmd='*'
    and polroles=array['authenticated'::regrole]::oid[] and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'audit target check is the original table list',case when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_ledger_audit') and conname='app_ledger_audit_target_check' and contype='c'
  and pg_get_constraintdef(oid) like '%imports%' and pg_get_constraintdef(oid) not like '%auto_runs%' and pg_get_constraintdef(oid) not like '%fix_requests%') then '예' else '아니오' end
union all select 'new tables count',(num_nonnulls(to_regclass('public.app_ledger_auto_runs'),to_regclass('public.app_ledger_auto_sources'),to_regclass('public.app_ledger_fix_requests'),to_regclass('public.app_ledger_record_changes')))::text
union all select 'new public functions count',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in ('app_auto_ledger_begin','app_auto_ledger_record','app_auto_ledger_undo','app_apply_ledger_fix','app_undo_ledger_fix'))::text
union all select 'new private helpers count',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'
  and p.proname in ('app_auto_ledger_personal','app_auto_ledger_source','app_auto_ledger_insert','app_auto_ledger_log'))::text
union all select 'ledger records rows',count(*)::text from public.app_ledger_records
union all select 'ledger tables policies hash',md5(coalesce(string_agg(c.relname||':'||p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname),''))
  from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))
union all select 'ledger tables owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit'))
union all select 'ledger tables column grants hash',md5(coalesce(string_agg(c.relname||'.'||a.attname||':'||a.attacl::text,',' order by c.relname,a.attname),''))
  from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit')) and a.attacl is not null and not a.attisdropped
union all select 'ledger tables triggers hash',md5(coalesce(string_agg(c.relname||':'||t.tgname||':'||t.tgenabled::text||':'||pg_get_triggerdef(t.oid),',' order by c.relname,t.tgname),''))
  from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in (to_regclass('public.app_ledger_records'),to_regclass('public.app_ledger_sources'),to_regclass('public.app_ledger_record_sources'),to_regclass('public.app_ledger_links'),to_regclass('public.app_ledger_audit')) and not t.tgisinternal;
