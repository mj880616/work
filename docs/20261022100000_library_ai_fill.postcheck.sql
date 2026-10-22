-- SELECT only. Works after apply (all 예, hashes equal to precheck) and after rollback (history and column absent).
with h as (
  select count(*) as n,count(*) filter(where name='library_ai_fill') as named from supabase_migrations.schema_migrations where version='20261022100000'
), c as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_documents') and attname='field_origin' and not attisdropped
)
select 'column and history agree' as item,case when (h.n=0 and c.n=0) or (h.n=1 and h.named=1 and c.n=1) then '예' else '아니오' end as value
  from h,c
union all select 'existing documents keep empty origin',case when (select n from c)=0 or not exists(select 1 from public.app_documents d where to_jsonb(d)->'field_origin' is distinct from '{}'::jsonb) then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public documents privilege',case when not has_table_privilege('anon','public.app_documents','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg(concat_ws('|',d.id,d.title,d.category,d.source,d.document_date,d.project_id,d.organization_id),E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),''))
union all select 'documents policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal;
