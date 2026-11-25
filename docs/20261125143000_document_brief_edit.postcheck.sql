-- SELECT only. pg_catalog만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·칸·함수가 함께 없음).
with f as (select to_regprocedure('public.app_document_brief_edit(uuid,jsonb)') as p),
cols as (select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_document_briefs') and attname in ('edited','edited_at') and not attisdropped),
history as (select count(*) filter(where name='document_brief_edit') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125143000')
select 'function columns and history agree' as item,case when
  (history.n=0 and f.p is null and cols.n=0) or (history.n=1 and history.named=1 and f.p is not null and cols.n=2) then '예' else '아니오' end as ok
  from f,cols,history
union all select 'function definer, empty search_path, returns timestamptz',case when (select p from f) is null or exists(
  select 1 from pg_proc where oid=(select p from f) and prosecdef and proconfig=array['search_path=""'] and prorettype='timestamptz'::regtype) then '예' else '아니오' end
union all select 'only authenticated executes',case when (select p from f) is null or (
  has_function_privilege('authenticated',(select p from f),'execute')
  and not has_function_privilege('anon',(select p from f),'execute')
  and not has_function_privilege('service_role',(select p from f),'execute')) then '예' else '아니오' end
union all select 'briefs table grants unchanged (authenticated read only, anon nothing)',case when
  has_table_privilege('authenticated','public.app_document_briefs','select')
  and not has_table_privilege('authenticated','public.app_document_briefs','insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated','public.app_document_briefs','insert,update')
  and not has_table_privilege('anon','public.app_document_briefs','select,insert,update,delete,truncate,references,trigger') then '예' else '아니오' end
union all select 'service_role cannot write edited columns',case when not has_table_privilege('service_role','public.app_document_briefs','insert,update')
  and not exists(select 1 from pg_attribute a where a.attrelid='public.app_document_briefs'::regclass and a.attname in ('edited','edited_at')
    and not a.attisdropped and a.attacl::text ~ 'service_role=[a-zA-Z*]*[aw]') then '예' else '아니오' end
union all select 'briefs table still 1 policy and RLS on',case when (select count(*) from pg_policy where polrelid='public.app_document_briefs'::regclass)=1
  and (select relrowsecurity from pg_class where oid='public.app_document_briefs'::regclass) then '예' else '아니오' end;
