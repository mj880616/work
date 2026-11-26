-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·새 칸·좁히기 정책이 함께 없음).
with t as (select to_regclass('public.app_note_board_links') as f),
history as (select count(*) filter(where name='note_board_materials') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261127020000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select f from t) and attname in ('mat_note','mat_doc','mat_url') and not attisdropped),
chk as (select count(*) as n from pg_constraint where conrelid=(select f from t) and conname in ('app_note_board_links_material_check','app_note_board_links_url_check') and contype='c'),
pol as (select count(*) as n from pg_policy where polrelid=(select f from t) and polname='note_board_links_material_own' and polcmd='*' and not polpermissive and polroles=array[to_regrole('authenticated')::oid])
select 'new columns, checks, policy and history agree' as item,case when (history.n=0 and cols.n=0 and chk.n=0 and pol.n=0) or (history.n=1 and history.named=1 and cols.n=3 and chk.n=2 and pol.n=1) then '예' else '아니오' end as ok
  from history,cols,chk,pol
union all select 'links: RLS on, owner policy plus at most the narrowing policy, no triggers',case when (select f from t) is not null
  and (select relrowsecurity from pg_class where oid=(select f from t))
  and (select count(*) from pg_policy where polrelid=(select f from t))=1+(select n from pol)
  and exists(select 1 from pg_policy where polrelid=(select f from t) and polname='note_board_links_owner_all' and polcmd='*' and polpermissive and polroles=array[to_regrole('authenticated')::oid])
  and (select count(*) from pg_trigger where tgrelid=(select f from t) and not tgisinternal)=0 then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing',case when (select f from t) is not null and not (
  has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',(select f from t),'select,insert,update,references')
  or has_table_privilege('service_role',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('service_role',(select f from t),'select,insert,update,references')
  or exists(select 1 from pg_class where oid=(select f from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read delete, named columns only, new columns insert only',case when (select f from t) is not null
  and has_table_privilege('authenticated',(select f from t),'select') and has_table_privilege('authenticated',(select f from t),'delete')
  and not has_table_privilege('authenticated',(select f from t),'insert,update,truncate,references,trigger')
  and not has_column_privilege('authenticated',(select f from t),'id','insert') and not has_column_privilege('authenticated',(select f from t),'created_at','insert')
  and not has_column_privilege('authenticated',(select f from t),'workspace_id','update') and not has_column_privilege('authenticated',(select f from t),'board_id','update')
  and has_column_privilege('authenticated',(select f from t),'kind','insert') and not has_column_privilege('authenticated',(select f from t),'kind','update')
  and ((select n from cols)=0 or (has_column_privilege('authenticated',(select f from t),'mat_note','insert') and has_column_privilege('authenticated',(select f from t),'mat_doc','insert') and has_column_privilege('authenticated',(select f from t),'mat_url','insert')
    and not has_column_privilege('authenticated',(select f from t),'mat_note','update') and not has_column_privilege('authenticated',(select f from t),'mat_doc','update') and not has_column_privilege('authenticated',(select f from t),'mat_url','update'))) then '예' else '아니오' end;
