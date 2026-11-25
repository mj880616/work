-- SELECT only. pg_catalog·cron 예약 표·migration 기록만 읽는다(요청 글·근거·id·예약 명령 본문은 읽지 않음). 적용 뒤 모두 예, 해시는 precheck와 같음.
-- 되돌린 뒤에도 'column, functions, job and history agree'는 예(넷이 함께 없음).
-- expect: column, functions, job and history agree = 예
-- expect: functions definer, empty search_path, no anon or authenticated = 예
-- expect: no new column write for authenticated = 예
-- expect: no anon table privileges = 예
-- expect: candidates policies hash = 기록
-- expect: candidates table grants hash = 기록
-- expect: candidates triggers hash = 기록
-- expect: other cron jobs hash = 기록
with t as (select to_regclass('public.app_todo_candidates') as r),
history as (select count(*) filter(where name='forget_auto_expire') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125160000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select r from t) and attnum>0 and not attisdropped and attname in ('ask_direct','ask_from')),
fns as (select count(*) as n from pg_proc where oid in (
  to_regprocedure('public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)'),
  to_regprocedure('public.app_todo_tg_open_asks_peer(uuid,text)'),to_regprocedure('public.app_forget_auto_expire()'))),
job as (select count(*) as n from cron.job where jobname='web2_forget_auto_expire' and schedule='13 15 * * *' and active
  and md5(command)=md5('select public.app_forget_auto_expire()'))
select 'column, functions, job and history agree' as item,case when
  (history.n=0 and cols.n=0 and fns.n=0 and job.n=0) or (history.n=1 and history.named=1 and cols.n=2 and fns.n=3 and job.n=1) then '예' else '아니오' end as value
  from history,cols,fns,job
union all select 'functions definer, empty search_path, no anon or authenticated',case when (select count(*) from pg_proc p where p.oid in (
  to_regprocedure('public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)'),
  to_regprocedure('public.app_todo_tg_open_asks_peer(uuid,text)'),to_regprocedure('public.app_forget_auto_expire()'))
  and not (p.prosecdef and p.proconfig=array['search_path=""'] and coalesce(p.proacl::text,'') !~ '(^|[{,])='
   and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute')))=0
  then '예' else '아니오' end
union all select 'no new column write for authenticated',case when (select count(*) from pg_attribute a where a.attrelid=(select r from t) and a.attnum>0 and not a.attisdropped
  and a.attname in ('ask_direct','ask_from')
  and (has_column_privilege('authenticated',(select r from t),a.attname,'update') or has_column_privilege('authenticated',(select r from t),a.attname,'insert')))=0 then '예' else '아니오' end
union all select 'no anon table privileges',case when not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'candidates policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_todo_candidates')
union all select 'candidates table grants hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')),'')
  ||'|'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attacl is not null),''))
union all select 'candidates triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_todo_candidates') and not tgisinternal
union all select 'other cron jobs hash',coalesce((select md5(string_agg(jobid::text||':'||jobname||':'||schedule||':'||active::text||':'||md5(command),',' order by jobid))
  from cron.job where jobname is distinct from 'web2_forget_auto_expire'),'none');
