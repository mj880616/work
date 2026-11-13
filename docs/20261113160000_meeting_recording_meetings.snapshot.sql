-- SELECT only. Save before apply. pg_catalog과 migration 기록만 읽고 행 값은 읽지 않는다.
-- 새 표가 아직 없음과 이번 기록이 없음을 기록한다(되돌린 뒤 같은지 대조). 기존 표는 바꾸지 않으므로 RLS 켜짐·정책 수만 남긴다.
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_meeting_recording_meetings']) n
union all select 'existing table',c.relname::text,c.relrowsecurity::text||':'||(select count(*) from pg_policy p where p.polrelid=c.oid)::text
  from pg_class c where c.oid in (to_regclass('public.app_workspaces'),to_regclass('public.app_meetings'),to_regclass('public.app_meeting_recordings'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261113160000'
order by 1,2;
