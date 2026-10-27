-- SELECT only. 적용 뒤(모두 예) 또는 rollback 뒤(history recorded·writes revoked = 아니오) 실행.
-- policies·rows·row count는 precheck 캡처와 같아야 한다.
-- 승인형 DB workflow 판정(DB-승인형확장): 예/아니오 항목은 예, 그 밖의 항목은 precheck 같은 이름 값과 같아야 한다. table acl은 이번 변경으로 바뀌므로 기록만.
-- expect: table acl = 기록
select 'history recorded' as item,case when exists(select 1 from supabase_migrations.schema_migrations where version='20261021200000' and name='web1_archive_state_readonly') then '예' else '아니오' end as ok
union all select 'writes revoked (anon·authenticated)',case when not has_table_privilege('anon','public.main_project_archive_state','insert')
  and not has_table_privilege('anon','public.main_project_archive_state','update') and not has_table_privilege('anon','public.main_project_archive_state','delete')
  and not has_table_privilege('anon','public.main_project_archive_state','truncate') and not has_table_privilege('authenticated','public.main_project_archive_state','insert')
  and not has_table_privilege('authenticated','public.main_project_archive_state','update') and not has_table_privilege('authenticated','public.main_project_archive_state','delete')
  and not has_table_privilege('authenticated','public.main_project_archive_state','truncate') then '예' else '아니오' end
union all select 'anon can still select',case when has_table_privilege('anon','public.main_project_archive_state','select') then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.main_project_archive_state') and relrowsecurity) then '예' else '아니오' end
union all select 'policy '||policyname,cmd||' roles='||array_to_string(roles,',')||' using='||coalesce(qual,'-')||' check='||coalesce(with_check,'-')
  from pg_policies where schemaname='public' and tablename='main_project_archive_state'
union all select 'table acl',coalesce((select relacl::text from pg_class where oid=to_regclass('public.main_project_archive_state')),'(default)')
union all select 'row count',(select count(*)::text from public.main_project_archive_state)
union all select 'rows (card:archived:updated)',(select string_agg(card_key||':'||archived::text||':'||coalesce(updated_at::text,'-'),' / ' order by card_key) from public.main_project_archive_state);
