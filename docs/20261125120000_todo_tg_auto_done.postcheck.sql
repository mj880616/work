-- SELECT only. pg_catalog·migration 기록·후보 줄 개수만 읽는다(요청 글·근거·id는 읽지 않음). 적용 뒤 모두 예(해시·개수는 precheck와 같음).
-- 되돌린 뒤에도 'columns, functions and history agree'는 예(셋이 함께 없음).
-- expect: columns, functions and history agree = 예
-- expect: functions definer, empty search_path, service_role only = 예
-- expect: no new column write for authenticated = 예
-- expect: no anon or service_role table privileges = 예
-- expect: telegram candidates = 기록
-- expect: candidates policies hash = 기록
-- expect: candidates table grants hash = 기록
-- expect: candidates triggers hash = 기록
with t as (select to_regclass('public.app_todo_candidates') as r),
history as (select count(*) filter(where name='todo_tg_auto_done') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125120000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select r from t) and attnum>0 and not attisdropped and attname in ('ask_at','ask_ref','auto_done','auto_done_at')),
chk as (select count(*) as n from pg_constraint where conrelid=(select r from t) and conname in ('app_todo_candidates_ask_ref_check','app_todo_candidates_auto_done_check') and convalidated),
fns as (select count(*) as n from pg_proc where oid in (
  to_regprocedure('public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)'),
  to_regprocedure('public.app_todo_tg_open_asks(uuid,text)'),to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])')))
select 'columns, functions and history agree' as item,case when
  (history.n=0 and cols.n=0 and chk.n=0 and fns.n=0) or (history.n=1 and history.named=1 and cols.n=4 and chk.n=2 and fns.n=3) then '예' else '아니오' end as value
  from history,cols,chk,fns
union all select 'functions definer, empty search_path, service_role only',case when (select count(*) from pg_proc p where p.oid in (
  to_regprocedure('public.app_todo_candidate_from_telegram_at(uuid,text,text,text,date,timestamp with time zone,text,text)'),
  to_regprocedure('public.app_todo_tg_open_asks(uuid,text)'),to_regprocedure('public.app_todo_tg_auto_done(uuid,uuid[])'))
  and not (p.prosecdef and p.proconfig=array['search_path=""'] and coalesce(p.proacl::text,'') !~ '(^|[{,])='
   and has_function_privilege('service_role',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')))=0
  then '예' else '아니오' end
union all select 'no new column write for authenticated',case when (select count(*) from pg_attribute a where a.attrelid=(select r from t) and a.attnum>0 and not a.attisdropped
  and a.attname in ('ask_at','ask_ref','auto_done','auto_done_at')
  and (has_column_privilege('authenticated',(select r from t),a.attname,'update') or has_column_privilege('authenticated',(select r from t),a.attname,'insert')))=0 then '예' else '아니오' end
union all select 'no anon or service_role table privileges',case when not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select r from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'telegram candidates',(select count(*) from public.app_todo_candidates where source_kind='telegram')::text
union all select 'candidates policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_todo_candidates')
union all select 'candidates table grants hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')),'')
  ||'|'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attacl is not null),''))
union all select 'candidates triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_todo_candidates') and not tgisinternal;
