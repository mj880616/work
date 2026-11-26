-- SELECT only. 20261126100000_drive_connection_clients 적용 전(시험 적용 전후 비교에도 씀). 카탈로그·migration 기록·줄 수만 읽는다(연결 행 내용·토큰은 읽지 않음).
-- 기대: 이번 기록·새 표 없음, 앞 단계(작업공간 Drive 연결 표) 있음·RLS 켬. 줄 수·권한·정책 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous step applied = 예
-- expect: new table absent = 예
-- expect: drive connections RLS on and no anon or authenticated privilege = 예
-- expect: drive connections rows = 기록
-- expect: drive connections grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261126100000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261104233000' and name='workspace_drive_connections')=1 and to_regclass('public.app_drive_connections') is not null then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_drive_connection_clients') is null then '예' else '아니오' end
union all select 'drive connections RLS on and no anon or authenticated privilege',case when (select relrowsecurity from pg_class where oid=to_regclass('public.app_drive_connections')) and not has_any_column_privilege('anon','public.app_drive_connections','select,insert,update,references') and not has_any_column_privilege('authenticated','public.app_drive_connections','select,insert,update,references') then '예' else '아니오' end
union all select 'drive connections rows',(select count(*)::text from public.app_drive_connections)
union all select 'drive connections grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_drive_connections')),'')
  ||coalesce((select string_agg(a.attname::text||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_drive_connections') and a.attnum>0 and not a.attisdropped),'')
  ||coalesce((select string_agg(p.polname::text,',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_drive_connections')),''));
