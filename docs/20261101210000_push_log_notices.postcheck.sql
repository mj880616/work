-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·칸·검사가 함께 원래대로).
with c as (select
  exists(select 1 from pg_attribute where attrelid='public.app_push_log'::regclass and not attisdropped and attname='shown_at') as s,
  exists(select 1 from pg_attribute where attrelid='public.app_push_log'::regclass and not attisdropped and attname='opened_at') as o,
  exists(select 1 from pg_constraint where conrelid='public.app_push_log'::regclass and conname='app_push_log_shown_check') as k,
  exists(select 1 from pg_constraint where conrelid='public.app_push_log'::regclass and conname='app_push_log_status_check'
    and pg_get_constraintdef(oid) ~ '''shown''') as st,
  to_regclass('public.app_push_log_ws_sent_idx') is not null as i),
history as (select count(*) filter(where name='push_log_notices') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261101210000')
select 'columns, checks, index and history agree' as item,case when
  (history.n=0 and not c.s and not c.o and not c.k and not c.st and not c.i)
  or (history.n=1 and history.named=1 and c.s and c.o and c.k and c.st and c.i)
  then '예' else '아니오' end as ok
  from c,history
union all select 'RLS on and one authenticated owner read policy',case when (select relrowsecurity from pg_class where oid='public.app_push_log'::regclass)
  and (select count(*) from pg_policy where polrelid='public.app_push_log'::regclass)=1
  and (select count(*) from pg_policy where polrelid='public.app_push_log'::regclass and polcmd='r'
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=1 then '예' else '아니오' end
union all select 'anon nothing, no PUBLIC grant',case when not has_table_privilege('anon','public.app_push_log','select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid='public.app_push_log'::regclass and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated read only, service_role four',case when has_table_privilege('authenticated','public.app_push_log','select')
  and not has_table_privilege('authenticated','public.app_push_log','insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated','public.app_push_log','insert,update')
  and has_table_privilege('service_role','public.app_push_log','select,insert,update,delete')
  and not has_table_privilege('service_role','public.app_push_log','truncate,references,trigger') then '예' else '아니오' end;
