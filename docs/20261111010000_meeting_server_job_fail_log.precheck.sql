-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록만 읽는다(행 값 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 해시 5개는 기록만 하고 사후 확인에서 같아야 한다.
-- expect: server jobs policies hash = 기록
-- expect: server jobs table grants hash = 기록
-- expect: server jobs old column grants hash = 기록
-- expect: server jobs old constraints hash = 기록
-- expect: server jobs old triggers hash = 기록
with u as (select to_regclass('public.app_meeting_server_jobs') as p)
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261111010000') then '예' else '아니오' end as value
union all select 'server jobs table',case when (select p from u) is not null then '예' else '아니오' end
union all select 'server jobs fail_log absent',case when not exists(select 1 from pg_attribute,u where attrelid=u.p and attname='fail_log' and not attisdropped)
  and not exists(select 1 from pg_constraint where conrelid=(select p from u) and conname='app_meeting_server_jobs_fail_log_check')
  and to_regprocedure('private.app_meeting_server_jobs_fail_log()') is null
  and not exists(select 1 from pg_trigger where tgrelid=(select p from u) and tgname='app_meeting_server_jobs_fail_log') then '예' else '아니오' end
union all select 'private schema',case when exists(select 1 from pg_namespace where nspname='private') then '예' else '아니오' end
union all select 'server jobs RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select p from u))
  and not exists(select 1 from pg_class where oid=(select p from u) and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_any_column_privilege('anon',(select p from u),'select,insert,update,references')
  and not exists(select 1 from pg_policy where polrelid=(select p from u) and (polroles @> array[0::oid] or polroles @> array[to_regrole('anon')::oid])) then '예' else '아니오' end
union all select 'server jobs authenticated read only',case when has_table_privilege('authenticated',(select p from u),'select')
  and not has_table_privilege('authenticated',(select p from u),'insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'server jobs policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select p from u)
union all select 'server jobs table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select p from u)
union all select 'server jobs old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select p from u) and attnum>0 and not attisdropped and attname<>'fail_log'
union all select 'server jobs old constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select p from u) and conname<>'app_meeting_server_jobs_fail_log_check'
union all select 'server jobs old triggers hash',md5(coalesce(string_agg(tgname||':'||pg_get_triggerdef(oid)||':'||tgenabled::text,',' order by tgname),''))
  from pg_trigger where tgrelid=(select p from u) and not tgisinternal and tgname<>'app_meeting_server_jobs_fail_log';
