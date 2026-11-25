-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·새 칸이 함께 없음).
with t as (select to_regclass('public.app_news_highlights') as f),
history as (select count(*) filter(where name='news_highlights_marks') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125113000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select f from t) and attname in ('mark_kind','mark_color') and not attisdropped)
select 'columns and history agree' as item,case when (history.n=0 and cols.n=0) or (history.n=1 and history.named=1 and cols.n=2) then '예' else '아니오' end as ok
  from history,cols
union all select 'highlights: RLS on, 1 owner policy for authenticated only, no triggers',case when (select f from t) is not null
  and (select relrowsecurity from pg_class where oid=(select f from t))
  and (select count(*) from pg_policy where polrelid=(select f from t))=1
  and exists(select 1 from pg_policy where polrelid=(select f from t) and polname='news_highlights_owner_all' and polcmd='*' and polroles=array[to_regrole('authenticated')::oid])
  and (select count(*) from pg_trigger where tgrelid=(select f from t) and not tgisinternal)=0 then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing',case when (select f from t) is not null and not (
  has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',(select f from t),'select,insert,update,references')
  or has_table_privilege('service_role',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('service_role',(select f from t),'select,insert,update,references')
  or exists(select 1 from pg_class where oid=(select f from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read delete, named columns only, workspace source quote fixed',case when (select f from t) is not null
  and has_table_privilege('authenticated',(select f from t),'select') and has_table_privilege('authenticated',(select f from t),'delete')
  and not has_table_privilege('authenticated',(select f from t),'insert,update,truncate,references,trigger')
  and not has_column_privilege('authenticated',(select f from t),'id','insert')
  and not has_column_privilege('authenticated',(select f from t),'workspace_id','update') and not has_column_privilege('authenticated',(select f from t),'source_id','update')
  and not has_column_privilege('authenticated',(select f from t),'quote','update')
  and has_column_privilege('authenticated',(select f from t),'memo','update')
  and ((select n from cols)=0 or (has_column_privilege('authenticated',(select f from t),'mark_kind','insert') and has_column_privilege('authenticated',(select f from t),'mark_color','insert')
    and has_column_privilege('authenticated',(select f from t),'mark_color','update') and not has_column_privilege('authenticated',(select f from t),'mark_kind','update'))) then '예' else '아니오' end;
