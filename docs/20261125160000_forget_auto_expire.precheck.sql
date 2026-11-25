-- SELECT only. pg_catalog·cron 예약 표·migration 기록·후보 줄 개수만 읽는다(요청 글·근거·id·예약 명령 본문은 읽지 않음). Run before dry-run/apply.
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new column absent = 예
-- expect: new functions absent = 예
-- expect: pg_cron ready = 예
-- expect: cron timezone UTC = 예
-- expect: expire job absent = 예
-- expect: open candidates = 기록
-- expect: candidates policies hash = 기록
-- expect: candidates table grants hash = 기록
-- expect: candidates triggers hash = 기록
-- expect: other cron jobs hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261125120000' and name='todo_tg_auto_done')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261125160000') then '예' else '아니오' end
union all select 'new column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_todo_candidates') and attnum>0 and not attisdropped and attname in ('ask_direct','ask_from')) then '예' else '아니오' end
union all select 'new functions absent',case when to_regprocedure('public.app_todo_candidate_from_telegram_ask(uuid,text,text,text,date,timestamp with time zone,text,text,boolean,text)') is null
  and to_regprocedure('public.app_todo_tg_open_asks_peer(uuid,text)') is null and to_regprocedure('public.app_forget_auto_expire()') is null then '예' else '아니오' end
union all select 'pg_cron ready',case when to_regprocedure('cron.schedule(text,text,text)') is not null and to_regclass('cron.job') is not null then '예' else '아니오' end
union all select 'cron timezone UTC',case when coalesce(current_setting('cron.timezone',true),'') in ('GMT','UTC','Etc/UTC') then '예' else '아니오' end
union all select 'expire job absent',case when not exists(select 1 from cron.job where jobname='web2_forget_auto_expire') then '예' else '아니오' end
union all select 'open candidates',(select count(*) from public.app_todo_candidates where status='open')::text
union all select 'candidates policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_todo_candidates')
union all select 'candidates table grants hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')),'')
  ||'|'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attacl is not null),''))
union all select 'candidates triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_todo_candidates') and not tgisinternal
union all select 'other cron jobs hash',coalesce((select md5(string_agg(jobid::text||':'||jobname||':'||schedule||':'||active::text||':'||md5(command),',' order by jobid))
  from cron.job where jobname is distinct from 'web2_forget_auto_expire'),'none');
