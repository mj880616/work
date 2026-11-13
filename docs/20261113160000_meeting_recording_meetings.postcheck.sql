-- SELECT only. pg_catalog과 migration 기록만 읽는다. 적용 뒤 예/아니오 항목은 모두 예(되돌린 뒤에도 예 — 기록·표가 함께 없음).
-- 해시 두 항목은 precheck의 같은 이름 값과 같아야 한다(기존 표의 RLS·정책·권한 그대로).
with t as (select to_regclass('public.app_meeting_recording_meetings') as r),
history as (select count(*) filter(where name='meeting_recording_meetings') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261113160000')
select 'table and history agree' as item,case when (history.n=0 and t.r is null) or (history.n=1 and history.named=1 and t.r is not null) then '예' else '아니오' end as value
  from t,history
union all select 'RLS on, no policies',case when (select r from t) is null or ((select relrowsecurity from pg_class where oid=(select r from t))
  and (select count(*) from pg_policy where polrelid=(select r from t))=0) then '예' else '아니오' end
union all select 'anon, PUBLIC and authenticated have nothing on the table',case when (select r from t) is null or (
  not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')
  and not has_table_privilege('authenticated',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select r from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select r from t) and relacl::text ~ '(^|[{,])(anon|authenticated)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select r from t) and attacl::text ~ '(^|[{,])(anon|authenticated)?=')) then '예' else '아니오' end
union all select 'service_role: read + 4-column insert, no update or delete',case when (select r from t) is null or (
  has_table_privilege('service_role',(select r from t),'select')
  and not has_table_privilege('service_role',(select r from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select r from t),'update')
  and has_column_privilege('service_role',(select r from t),'session_id','insert')
  and has_column_privilege('service_role',(select r from t),'workspace_id','insert')
  and has_column_privilege('service_role',(select r from t),'created_by','insert')
  and has_column_privilege('service_role',(select r from t),'meeting_id','insert')
  and not has_column_privilege('service_role',(select r from t),'created_at','insert')) then '예' else '아니오' end
union all select 'meeting and workspace references cascade',case when (select r from t) is null or (select count(*) from pg_constraint
  where conrelid=(select r from t) and contype='f' and confdeltype='c' and confrelid in (to_regclass('public.app_meetings'),to_regclass('public.app_workspaces')))=2 then '예' else '아니오' end
union all select 'existing tables RLS policies grants hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=c.oid),''),';' order by c.relname)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in('app_workspaces','app_meetings','app_meeting_recordings')),''))
union all select 'existing tables column grants hash',md5(coalesce((select string_agg(c.relname||'.'||a.attname||':'||a.attacl::text,',' order by c.relname,a.attname)
  from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attacl is not null and not a.attisdropped
    and c.relname in('app_workspaces','app_meetings','app_meeting_recordings')),''));
