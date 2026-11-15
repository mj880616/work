-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다. 긴 정의는 md5·length로만 남긴다(값 8192자 이하).
-- 조직 기록 표의 칸·검사·색인·트리거·정책·권한 모양, 새 표·함수가 아직 없음, 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'org column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_suborganization_updates') and a.attnum>0 and not a.attisdropped
union all select 'org constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))||':'||length(pg_get_constraintdef(c.oid))::text
  from pg_constraint c where c.conrelid=to_regclass('public.app_suborganization_updates')
union all select 'org index',i.indexrelid::regclass::text,md5(pg_get_indexdef(i.indexrelid))||':'||length(pg_get_indexdef(i.indexrelid))::text
  from pg_index i where i.indrelid=to_regclass('public.app_suborganization_updates')
union all select 'org trigger',t.tgname::text,md5(pg_get_triggerdef(t.oid))||':'||t.tgenabled::text
  from pg_trigger t where t.tgrelid=to_regclass('public.app_suborganization_updates') and not t.tgisinternal
union all select 'org policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_suborganization_updates')
union all select 'org table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_suborganization_updates')
union all select 'new table','public.app_report_line_marks',coalesce(to_regclass('public.app_report_line_marks')::text,'absent')
union all select 'new table','public.app_report_snapshots',coalesce(to_regclass('public.app_report_snapshots')::text,'absent')
union all select 'function','private.app_suborganization_updates_source_guard()',coalesce(to_regprocedure('private.app_suborganization_updates_source_guard()')::text,'absent')
union all select 'function','private.app_report_line_marks_guard()',coalesce(to_regprocedure('private.app_report_line_marks_guard()')::text,'absent')
union all select 'function','private.app_report_snapshots_guard()',coalesce(to_regprocedure('private.app_report_snapshots_guard()')::text,'absent')
union all select 'owner function',p.oid::regprocedure::text,p.prosecdef::text
  from pg_proc p where p.oid=to_regprocedure('private.app_is_workspace_owner(uuid)')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261109100000'
order by 1,2;
