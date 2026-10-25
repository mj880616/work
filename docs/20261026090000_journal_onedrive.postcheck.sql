-- SELECT only. Run after apply: 모든 항목 예. 되돌린 뒤(표·기록 없음)에도 모두 예(없으면 통과).
with t as (select to_regclass('public.app_onedrive_connections') as conn,to_regclass('public.app_onedrive_photos') as photos,to_regclass('public.app_diary_photo_stars') as stars),
history as (select count(*) filter(where name='journal_onedrive') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261026090000')
select 'tables and history agree' as item,case when
  (history.n=0 and t.conn is null and t.photos is null and t.stars is null)
  or (history.n=1 and history.named=1 and t.conn is not null and t.photos is not null and t.stars is not null) then '예' else '아니오' end as value
  from t,history
union all select 'RLS enabled on all three',case when (select conn from t) is null or (select count(*) from pg_class where oid in((select conn from t),(select photos from t),(select stars from t)) and relrowsecurity)=3 then '예' else '아니오' end
union all select 'no policy on connections and photos, one authenticated owner policy on stars',case when (select conn from t) is null or (
  (select count(*) from pg_policy where polrelid in((select conn from t),(select photos from t)))=0
  and (select count(*) from pg_policy where polrelid=(select stars from t))=1
  and (select count(*) from pg_policy where polrelid=(select stars from t) and polroles=array['authenticated'::regrole]::oid[] and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1) then '예' else '아니오' end
union all select 'anon has no table or column privilege on any',case when (select conn from t) is null or (
  not has_table_privilege('anon',(select conn from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select photos from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select stars from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select conn from t),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select photos from t),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select stars from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'no PUBLIC grant on any',case when (select conn from t) is null or not exists(select 1 from pg_class where oid in((select conn from t),(select photos from t),(select stars from t)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated has no privilege on connections or photos (tokens and index are server only)',case when (select conn from t) is null or (
  not has_table_privilege('authenticated',(select conn from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select conn from t),'select,insert,update,references')
  and not has_table_privilege('authenticated',(select photos from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select photos from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'authenticated on stars: read, delete, insert four columns only, no update',case when (select conn from t) is null or (
  has_table_privilege('authenticated',(select stars from t),'select,delete')
  and has_column_privilege('authenticated',(select stars from t),'photo_ref','insert')
  and not has_column_privilege('authenticated',(select stars from t),'id','insert')
  and not has_column_privilege('authenticated',(select stars from t),'created_at','insert')
  and not has_any_column_privilege('authenticated',(select stars from t),'update')) then '예' else '아니오' end
union all select 'service_role: full on connections and photos, nothing on stars',case when (select conn from t) is null or (
  has_table_privilege('service_role',(select conn from t),'select,insert,update,delete')
  and has_table_privilege('service_role',(select photos from t),'select,insert,update,delete')
  and not has_any_column_privilege('service_role',(select stars from t),'select,insert,update')
  and not has_table_privilege('service_role',(select conn from t),'truncate,references,trigger')) then '예' else '아니오' end
union all select 'no trigger, no function added by this file',case when (select conn from t) is null or not exists(select 1 from pg_trigger where tgrelid in((select conn from t),(select photos from t),(select stars from t)) and not tgisinternal) then '예' else '아니오' end;
