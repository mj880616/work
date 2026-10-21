-- SELECT only. SEC-Web1첫페이지 적용 전 확인(SQL Editor, 폰 경로 C). 바꾸는 것 없음.
-- 이 표(main_project_archive_state)는 저장소 migration 밖에서 만들어져 정의·권한이 저장소에 없다. 이 결과로 실제 상태를 판단한다.
-- 핵심 판정: "anon can insert/update/delete" 중 하나라도 '예'이고, RLS가 꺼져 있거나 anon 쓰기를 통과시키는 정책이 있으면
--   로그인 없이 누구나 카드 보관 상태를 바꿀 수 있다(실제 위험). 행 값은 카드 이름·보관 여부뿐이라 민감정보가 아니다.
-- 적용 전 기대: new migration absent 예 / table exists 예 / anon can select 예. 나머지는 캡처해 사후 확인과 비교한다.
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261021200000') then '예' else '아니오' end as value
union all select 'table exists',case when to_regclass('public.main_project_archive_state') is not null then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.main_project_archive_state') and relrowsecurity) then '예' else '아니오' end
union all select 'RLS forced',case when exists(select 1 from pg_class where oid=to_regclass('public.main_project_archive_state') and relforcerowsecurity) then '예' else '아니오' end
union all select 'anon can select',case when has_table_privilege('anon','public.main_project_archive_state','select') then '예' else '아니오' end
union all select 'anon can insert',case when has_table_privilege('anon','public.main_project_archive_state','insert') then '예' else '아니오' end
union all select 'anon can update',case when has_table_privilege('anon','public.main_project_archive_state','update') then '예' else '아니오' end
union all select 'anon can delete',case when has_table_privilege('anon','public.main_project_archive_state','delete') then '예' else '아니오' end
union all select 'anon can truncate',case when has_table_privilege('anon','public.main_project_archive_state','truncate') then '예' else '아니오' end
union all select 'authenticated can insert/update/delete',case when has_table_privilege('authenticated','public.main_project_archive_state','insert,update,delete') then '예' else '아니오' end
union all select 'anon write policies (insert/update/delete/all)',count(*)::text from pg_policies
  where schemaname='public' and tablename='main_project_archive_state' and cmd in ('INSERT','UPDATE','DELETE','ALL') and (roles && array['anon','public']::name[])
union all select 'policy '||policyname,cmd||' roles='||array_to_string(roles,',')||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-')
  from pg_policies where schemaname='public' and tablename='main_project_archive_state'
union all select 'columns',string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod),', ' order by a.attnum)
  from pg_attribute a where a.attrelid=to_regclass('public.main_project_archive_state') and a.attnum>0 and not a.attisdropped
union all select 'triggers',coalesce(string_agg(tgname::text,', ' order by tgname),'')
  from pg_trigger where tgrelid=to_regclass('public.main_project_archive_state') and not tgisinternal
union all select 'table acl',coalesce((select relacl::text from pg_class where oid=to_regclass('public.main_project_archive_state')),'(default)')
union all select 'row count',(select count(*)::text from public.main_project_archive_state)
union all select 'rows (card:archived:updated)',(select string_agg(card_key||':'||archived::text||':'||coalesce(updated_at::text,'-'),' / ' order by card_key) from public.main_project_archive_state)
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
