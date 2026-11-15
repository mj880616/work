-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·권한·정책 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: telegram function absent = 예
-- expect: source kind check has six kinds = 예
-- expect: candidates rows = 기록
-- expect: candidates grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029120000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version='20261021075034' and name='todo_radar_candidates') or (version='20261024140000' and name='call_tg_feed'))=2 and to_regclass('public.app_todo_candidates') is not null and to_regclass('public.app_feed_items') is not null then '예' else '아니오' end
union all select 'telegram function absent',case when to_regprocedure('public.app_todo_candidate_from_telegram(uuid,text,text,text,date)') is null then '예' else '아니오' end
union all select 'source kind check has six kinds',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_todo_candidates') and conname='app_todo_candidates_source_kind_check' and pg_get_constraintdef(oid) like '%project_update%' and pg_get_constraintdef(oid) not like '%telegram%')=1 then '예' else '아니오' end
union all select 'candidates rows',(select count(*)::text from public.app_todo_candidates)
union all select 'candidates grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_todo_candidates')),'')
  ||coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attnum>0 and not a.attisdropped),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_todo_candidates')),''));
