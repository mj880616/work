-- SELECT only. pg_catalog·migration 기록·후보 줄 개수만 읽는다(요청 글·근거·id는 읽지 않음). Run before dry-run/apply.
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / 새 칸·새 함수 없음 예 / 기존 넣기 함수 예 / 상태 검사에 done 예 / 후보 표 정책 해시·권한 해시는 사후와 같음.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new columns absent = 예
-- expect: new functions absent = 예
-- expect: existing insert function = 예
-- expect: status check has done = 예
-- expect: telegram candidates = 기록
-- expect: candidates policies hash = 기록
-- expect: candidates table grants hash = 기록
-- expect: candidates triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261029120000' and name='todo_candidates_telegram') or (version='20261101180000' and name='todo_feedback'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125120000') then '예' else '아니오' end
union all select 'new columns absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_todo_candidates') and attnum>0 and not attisdropped and attname in ('ask_at','ask_ref','auto_done','auto_done_at')) then '예' else '아니오' end
union all select 'new functions absent',case when to_regprocedure('public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)') is null
  and to_regprocedure('public.app_todo_tg_open_asks(uuid,text)') is null and to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])') is null then '예' else '아니오' end
union all select 'existing insert function',case when to_regprocedure('public.app_todo_candidate_from_telegram(uuid,text,text,text,date)') is not null then '예' else '아니오' end
union all select 'status check has done',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_todo_candidates') and conname='app_todo_candidates_status_check' and pg_get_constraintdef(oid) ~ '''done''')=1 then '예' else '아니오' end
union all select 'telegram candidates',(select count(*) from public.app_todo_candidates where source_kind='telegram')::text
union all select 'candidates policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_todo_candidates')
union all select 'candidates table grants hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')),'')
  ||'|'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attacl is not null),''))
union all select 'candidates triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_todo_candidates') and not tgisinternal;
