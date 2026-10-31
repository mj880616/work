-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·칸이 함께 원래대로).
with t as (select to_regclass('public.app_push_devices') as d,to_regclass('public.app_push_log') as l,
  exists(select 1 from pg_attribute where attrelid='public.app_profiles'::regclass and not attisdropped and attname='notify_prefs') as c,
  exists(select 1 from pg_constraint where connamespace='public'::regnamespace and conname='app_profiles_notify_prefs_check') as k),
history as (select count(*) filter(where name='phone_push') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261101010000')
select 'tables, column and history agree' as item,case when
  (history.n=0 and t.d is null and t.l is null and not t.c and not t.k)
  or (history.n=1 and history.named=1 and t.d is not null and t.l is not null and t.c and t.k)
  then '예' else '아니오' end as ok
  from t,history
union all select 'RLS on and one authenticated owner policy per table',case when (select d from t) is null or (
  (select count(*) from pg_class where oid in ((select d from t),(select l from t)) and relrowsecurity)=2
  and (select count(*) from pg_policy where polrelid in ((select d from t),(select l from t))
       and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) ~ 'app_is_workspace_owner')=2
  and (select count(*) from pg_policy where polrelid in ((select d from t),(select l from t)))=2) then '예' else '아니오' end
union all select 'anon has nothing and no PUBLIC grant',case when (select d from t) is null or (not exists(
  select 1 from unnest(array[(select d from t),(select l from t)]) r(r)
  where has_table_privilege('anon',r.r,'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon',r.r,'select,insert,update,references'))
  and not exists(select 1 from pg_class where oid in ((select d from t),(select l from t)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated devices without token and delete, log read only',case when (select d from t) is null or (
  not has_column_privilege('authenticated',(select d from t),'fcm_token','select')
  and has_column_privilege('authenticated',(select d from t),'last_seen_at','select')
  and has_table_privilege('authenticated',(select d from t),'delete')
  and not has_table_privilege('authenticated',(select d from t),'insert,update,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select d from t),'insert,update')
  and has_table_privilege('authenticated',(select l from t),'select')
  and not has_table_privilege('authenticated',(select l from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select l from t),'insert,update')) then '예' else '아니오' end
union all select 'service_role: four privileges on new tables',case when (select d from t) is null or not exists(
  select 1 from unnest(array[(select d from t),(select l from t)]) r(r)
  where not has_table_privilege('service_role',r.r,'select,insert,update,delete') or has_table_privilege('service_role',r.r,'truncate,references,trigger')) then '예' else '아니오' end
union all select 'profiles boundary unchanged',case when (select relrowsecurity from pg_class where oid='public.app_profiles'::regclass)
  and not exists(select 1 from pg_class where oid='public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
  and (select count(*) from pg_policy where polrelid='public.app_profiles'::regclass)=2 then '예' else '아니오' end;
