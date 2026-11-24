-- SELECT only. pg_catalog·migration 기록·brief 밑줄 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·검사가 함께 원래대로).
with o as (select to_regclass('public.app_news_highlights') as r),
history as (select count(*) filter(where name='news_highlights_brief') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125010000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''brief''') as with_brief,
  count(*) filter(where pg_get_constraintdef(oid) ~ '''news''' and pg_get_constraintdef(oid) ~ '''outside''' and pg_get_constraintdef(oid) ~ '''telegram''' and pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) ~ '''reading''') as with_prev,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_news_highlights_type_check'),
rows as (select count(*) filter(where source_type='brief') as briefs from public.app_news_highlights)
select 'type check and history agree' as item,case when
  (history.n=0 and chk.n=1 and chk.with_brief=0 and chk.with_prev=1 and rows.briefs=0)
  or (history.n=1 and history.named=1 and chk.n=1 and chk.with_brief=1 and chk.with_prev=1)
  then '예' else '아니오' end as ok
  from history,chk,rows
union all select 'highlights: RLS on, one owner policy for authenticated',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and (select count(*) from pg_policy where polrelid=(select r from o))=1
  and (select count(*) from pg_policy where polrelid=(select r from o) and polroles=array['authenticated'::regrole]::oid[])=1 then '예' else '아니오' end
union all select 'highlights: no anon, service_role or PUBLIC privileges',case when
  not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from o),'select,insert,update,references')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'highlights: authenticated insert listed columns, update memo only',case when
  not has_table_privilege('authenticated',(select r from o),'insert,update,truncate,references,trigger')
  and has_table_privilege('authenticated',(select r from o),'select,delete')
  and has_column_privilege('authenticated',(select r from o),'source_type','insert')
  and not has_column_privilege('authenticated',(select r from o),'source_type','update')
  and has_column_privilege('authenticated',(select r from o),'memo','update') then '예' else '아니오' end;
