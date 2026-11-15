-- SELECT only. Works after apply (all 예) and after rollback (history/table absent → first row 예, the rest 예 by absence).
with t as (
  select to_regclass('public.app_tg_personal_days') as p
), history as (
  select count(*) filter(where name='tg_personal_days') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261025030000'
)
select 'table and history agree' as item,case when
  (history.n=0 and t.p is null) or (history.n=1 and history.named=1 and t.p is not null) then '예' else '아니오' end as ok
  from t,history
union all select 'RLS enabled',case when (select p from t) is null or (select relrowsecurity from pg_class where oid=(select p from t)) then '예' else '아니오' end
union all select 'one authenticated owner policy',case when (select p from t) is null or (
  (select count(*) from pg_policy where polrelid=(select p from t))=1
  and (select count(*) from pg_policy where polrelid=(select p from t) and polroles=array['authenticated'::regrole]::oid[]
     and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%' and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select p from t) is null or (
  not has_table_privilege('anon',(select p from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select p from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select p from t) is null or not exists(select 1 from pg_class where oid=(select p from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated reads and pins/hides only',case when (select p from t) is null or (
  has_table_privilege('authenticated',(select p from t),'select')
  and not has_table_privilege('authenticated',(select p from t),'insert,delete,truncate')
  and has_column_privilege('authenticated',(select p from t),'pinned_at','update')
  and has_column_privilege('authenticated',(select p from t),'hidden_at','update')
  and not has_column_privilege('authenticated',(select p from t),'one_line','update')
  and not has_column_privilege('authenticated',(select p from t),'remember','update')
  and not has_column_privilege('authenticated',(select p from t),'workspace_id','update')) then '예' else '아니오' end
union all select 'service_role inserts and checks duplicates only',case when (select p from t) is null or (
  has_column_privilege('service_role',(select p from t),'one_line','insert')
  and not has_column_privilege('service_role',(select p from t),'pinned_at','insert')
  and not has_column_privilege('service_role',(select p from t),'hidden_at','insert')
  and not has_any_column_privilege('service_role',(select p from t),'update')
  and not has_table_privilege('service_role',(select p from t),'delete,truncate')
  and not has_column_privilege('service_role',(select p from t),'one_line','select')
  and not has_column_privilege('service_role',(select p from t),'remember','select')
  and has_column_privilege('service_role',(select p from t),'source_ref','select')) then '예' else '아니오' end
union all select 'no trigger, no raw text column',case when (select p from t) is null or (
  not exists(select 1 from pg_trigger where tgrelid=(select p from t) and not tgisinternal)
  and not exists(select 1 from pg_attribute where attrelid=(select p from t) and attnum>0 and not attisdropped and attname ~ '^raw')) then '예' else '아니오' end
union all select 'one room-day unique',case when (select p from t) is null or (
  exists(select 1 from pg_constraint where conrelid=(select p from t) and conname='app_tg_personal_days_source_ref_key' and contype='u')
  and exists(select 1 from pg_constraint where conrelid=(select p from t) and conname='app_tg_personal_days_room_day_key' and contype='u')) then '예' else '아니오' end;
