-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다(공개 artifact).
-- 이 파일은 표 모양을 바꾸지 않으므로, 옮기는 세 표의 칸·색인·트리거 정의와 기록을 남겨 되돌린 뒤 같은지 대조한다.
select 'column' as kind,c.oid::regclass::text||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text as definition
  from pg_class c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
  where c.oid in (to_regclass('public.app_suborganization_updates'),to_regclass('public.app_org_status_rows'),to_regclass('public.app_weekly_org_lines'))
union all select 'index',i.indexrelid::regclass::text,pg_get_indexdef(i.indexrelid)
  from pg_index i where i.indrelid in (to_regclass('public.app_suborganization_updates'),to_regclass('public.app_org_status_rows'),to_regclass('public.app_weekly_org_lines'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname,t.tgenabled::text||':'||t.tgfoid::regprocedure::text
  from pg_trigger t where not t.tgisinternal and t.tgrelid in (to_regclass('public.app_suborganization_updates'),to_regclass('public.app_org_status_rows'),to_regclass('public.app_weekly_org_lines'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname,p.polcmd::text||':'||p.polroles::text
  from pg_policy p where p.polrelid in (to_regclass('public.app_suborganization_updates'),to_regclass('public.app_org_status_rows'),to_regclass('public.app_weekly_org_lines'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261109100000','20261109120000')
order by 1,2;
