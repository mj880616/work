-- SELECT only. 적용 뒤(모두 예) 또는 rollback 뒤(history recorded·writes revoked·no write policy = 아니오) 실행. information_schema를 읽지 않는다.
-- read policies·read policy 줄·anon/authenticated can select·columns·row count는 precheck 캡처와 같아야 한다.
-- 'restore statements recorded'는 precheck의 write policies 수와 같아야 한다(rollback이 되살릴 문장 수).
-- expect: table acl = 기록
-- expect: restore statements recorded = 기록
select 'history recorded' as item,case when exists(select 1 from supabase_migrations.schema_migrations where version='20261029234500' and name='web1_upcoming_events_readonly') then '예' else '아니오' end as value
union all select 'writes revoked (anon·authenticated)',case when not exists(select 1 from unnest(array['anon','authenticated']) r
    where has_table_privilege(r,'public.main_upcoming_events','insert') or has_table_privilege(r,'public.main_upcoming_events','update')
       or has_table_privilege(r,'public.main_upcoming_events','delete') or has_table_privilege(r,'public.main_upcoming_events','truncate')) then '예' else '아니오' end
union all select 'no write policy',case when not exists(select 1 from pg_policies where schemaname='public' and tablename='main_upcoming_events' and cmd in ('INSERT','UPDATE','DELETE','ALL')) then '예' else '아니오' end
union all select 'restore statements recorded',coalesce((select (coalesce(array_length(statements,1),1)-1)::text from supabase_migrations.schema_migrations where version='20261029234500'),'-')
union all select 'anon can select',case when has_table_privilege('anon','public.main_upcoming_events','select') then '예' else '아니오' end
union all select 'authenticated can select',case when has_table_privilege('authenticated','public.main_upcoming_events','select') then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.main_upcoming_events') and relrowsecurity) then '예' else '아니오' end
union all select 'read policies',count(*)::text from pg_policies where schemaname='public' and tablename='main_upcoming_events' and cmd='SELECT'
union all select 'policy '||policyname,cmd||' '||permissive||' roles='||array_to_string(roles,',')||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-')
  from pg_policies where schemaname='public' and tablename='main_upcoming_events'
union all select 'columns',string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum)
  from pg_attribute a where a.attrelid=to_regclass('public.main_upcoming_events') and a.attnum>0 and not a.attisdropped
union all select 'table acl',coalesce((select relacl::text from pg_class where oid=to_regclass('public.main_upcoming_events')),'(default)')
union all select 'row count',(select count(*)::text from public.main_upcoming_events);
