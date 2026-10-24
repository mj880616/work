-- SELECT only. Works after apply (all 예, counts equal the precheck rows of the same source) and after rollback/dry-run (table and history absent).
-- No text is shown: only counts and yes/no.
with t as (select to_regclass('public.app_ed3_text_backups') as b),
history as (select count(*) filter(where name='ed3_text_backup') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261024190000')
select 'table and history agree' as item,case when
  (history.n=0 and t.b is null) or (history.n=1 and history.named=1 and t.b is not null) then '예' else '아니오' end as value
  from t,history
union all select 'RLS enabled',case when (select b from t) is null or exists(select 1 from pg_class where oid=(select b from t) and relrowsecurity) then '예' else '아니오' end
union all select 'one owner read policy',case when (select b from t) is null or (
  (select count(*) from pg_policy where polrelid=(select b from t) and polcmd='r' and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1
  and (select count(*) from pg_policy where polrelid=(select b from t))=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege',case when (select b from t) is null or (
  not has_table_privilege('anon',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select b from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant',case when (select b from t) is null or not exists(select 1 from pg_class where oid=(select b from t) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'nobody can read the text columns',case when (select b from t) is null or (
  not has_column_privilege('authenticated',(select b from t),'raw_text','select') and not has_column_privilege('authenticated',(select b from t),'metadata','select')
  and not has_column_privilege('service_role',(select b from t),'raw_text','select') and not has_column_privilege('anon',(select b from t),'raw_text','select')) then '예' else '아니오' end
union all select 'nobody can write',case when (select b from t) is null or (
  not has_table_privilege('authenticated',(select b from t),'insert,update,delete,truncate') and not has_any_column_privilege('authenticated',(select b from t),'insert,update')
  and not has_table_privilege('service_role',(select b from t),'select,insert,update,delete,truncate')) then '예' else '아니오' end
union all select 'backup rows per source',case when (select b from t) is null then 'absent' else (
  select coalesce(string_agg(source||'='||n,' / ' order by source),'0') from (select source,count(*)::text n from public.app_ed3_text_backups group by source) s) end;
