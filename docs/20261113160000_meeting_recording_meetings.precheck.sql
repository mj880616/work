-- SELECT only. Run before dry-run/apply (승인형 DB workflow 또는 SQL Editor, 폰 경로 C). 집계·예/아니오·해시만, 행 값 없음. pg_catalog과 migration 기록만 읽는다.
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시·recent migrations는 기록만 하고, 해시는 postcheck의 같은 이름 값과 같아야 한다(기존 표 RLS·정책·권한 그대로).
-- expect: recent migrations = 기록
-- expect: existing tables RLS policies grants hash = 기록
-- expect: existing tables column grants hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261113160000') then '예' else '아니오' end as value
union all select 'workspaces, meetings and recordings tables',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_meetings') is not null and to_regclass('public.app_meeting_recordings') is not null then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_meeting_recording_meetings') is null then '예' else '아니오' end
union all select 'existing tables RLS policies grants hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=c.oid),''),';' order by c.relname)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in('app_workspaces','app_meetings','app_meeting_recordings')),''))
union all select 'existing tables column grants hash',md5(coalesce((select string_agg(c.relname||'.'||a.attname||':'||a.attacl::text,',' order by c.relname,a.attname)
  from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attacl is not null and not a.attisdropped
    and c.relname in('app_workspaces','app_meetings','app_meeting_recordings')),''))
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
