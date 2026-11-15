-- SELECT only. SEC-옛표쓰기정리 적용 전 확인(SQL Editor, 폰 경로 C). 바꾸는 것 없음. information_schema를 읽지 않는다.
-- 이 표(main_upcoming_events)는 저장소 migration 밖에서 만들어져 정의·권한·정책 이름이 저장소에 없다. 이 결과로 실제 상태를 판단한다.
-- 적용 전 기대: new migration absent 예 / table exists 예 / no ALL policy 예 / write policies removable shape 예. 나머지는 캡처해 사후 확인과 비교한다.
-- 'write policies removable shape'가 아니오면 migration guard가 멈춘다(조건 있는 쓰기 정책·restrictive·다른 역할 대상). 그 경우 적용하지 않고 정의를 본다.
-- 행 값은 읽지 않는다(행 수만).
-- 승인형 DB workflow 기대값 형식(참고용, 이 migration은 workflow가 거절해 SQL Editor 경로):
-- expect: RLS enabled = 기록
-- expect: RLS forced = 기록
-- expect: anon can select = 기록
-- expect: authenticated can select = 기록
-- expect: anon can insert = 기록
-- expect: anon can update = 기록
-- expect: anon can delete = 기록
-- expect: anon can truncate = 기록
-- expect: authenticated can insert/update/delete = 기록
-- expect: write policies (insert/update/delete) = 기록
-- expect: read policies = 기록
-- expect: policy * = 기록
-- expect: columns = 기록
-- expect: triggers = 기록
-- expect: table acl = 기록
-- expect: row count = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029234500') then '예' else '아니오' end as value
union all select 'table exists',case when to_regclass('public.main_upcoming_events') is not null then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.main_upcoming_events') and relrowsecurity) then '예' else '아니오' end
union all select 'RLS forced',case when exists(select 1 from pg_class where oid=to_regclass('public.main_upcoming_events') and relforcerowsecurity) then '예' else '아니오' end
union all select 'anon can select',case when has_table_privilege('anon','public.main_upcoming_events','select') then '예' else '아니오' end
union all select 'authenticated can select',case when has_table_privilege('authenticated','public.main_upcoming_events','select') then '예' else '아니오' end
union all select 'anon can insert',case when has_table_privilege('anon','public.main_upcoming_events','insert') then '예' else '아니오' end
union all select 'anon can update',case when has_table_privilege('anon','public.main_upcoming_events','update') then '예' else '아니오' end
union all select 'anon can delete',case when has_table_privilege('anon','public.main_upcoming_events','delete') then '예' else '아니오' end
union all select 'anon can truncate',case when has_table_privilege('anon','public.main_upcoming_events','truncate') then '예' else '아니오' end
union all select 'authenticated can insert/update/delete',case when has_table_privilege('authenticated','public.main_upcoming_events','insert,update,delete') then '예' else '아니오' end
union all select 'no ALL policy',case when not exists(select 1 from pg_policies where schemaname='public' and tablename='main_upcoming_events' and cmd='ALL') then '예' else '아니오' end
union all select 'write policies removable shape',case when not exists(select 1 from pg_policies where schemaname='public' and tablename='main_upcoming_events' and cmd in ('INSERT','UPDATE','DELETE')
    and (permissive<>'PERMISSIVE' or coalesce(qual,'true')<>'true' or coalesce(with_check,'true')<>'true' or not (roles <@ array['public','anon','authenticated']::name[]))) then '예' else '아니오' end
union all select 'write policies (insert/update/delete)',count(*)::text from pg_policies where schemaname='public' and tablename='main_upcoming_events' and cmd in ('INSERT','UPDATE','DELETE')
union all select 'read policies',count(*)::text from pg_policies where schemaname='public' and tablename='main_upcoming_events' and cmd='SELECT'
union all select 'policy '||policyname,cmd||' '||permissive||' roles='||array_to_string(roles,',')||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-')
  from pg_policies where schemaname='public' and tablename='main_upcoming_events'
union all select 'columns',string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum)
  from pg_attribute a where a.attrelid=to_regclass('public.main_upcoming_events') and a.attnum>0 and not a.attisdropped
union all select 'triggers',coalesce(string_agg(tgname::text,', ' order by tgname),'')
  from pg_trigger where tgrelid=to_regclass('public.main_upcoming_events') and not tgisinternal
union all select 'table acl',coalesce((select relacl::text from pg_class where oid=to_regclass('public.main_upcoming_events')),'(default)')
union all select 'row count',(select count(*)::text from public.main_upcoming_events)
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
