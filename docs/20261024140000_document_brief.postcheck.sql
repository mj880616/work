-- SELECT only. Works after apply (record + brief check) and after rollback/dry-run (no record + no brief check).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger, index or other constraint change; no row added or removed).
with history as (
  select count(*) as n,count(*) filter(where name='document_brief') as named from supabase_migrations.schema_migrations where version='20261024140000'
), checks as (
  select count(*) as n,count(*) filter(where contype='c' and convalidated) as valid
  from pg_constraint where conrelid=to_regclass('public.app_document_ai_index') and conname='app_document_ai_index_brief_check'
)
select 'brief check and history agree' as item,case when (history.n=0 and checks.n=0) or (history.n=1 and history.named=1 and checks.n=1 and checks.valid=1) then '예' else '아니오' end as value
  from history,checks
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_document_ai_index') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy still',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_document_ai_index'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_document_ai_index','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_document_ai_index') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'index rows',count(*)::text from public.app_document_ai_index
union all select 'old shape rows',count(*)::text from public.app_document_ai_index where content_hash is not null and left(content_hash,3)<>'b1:'
union all select 'columns definition hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.app_document_ai_index') and a.attnum>0 and not a.attisdropped
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_document_ai_index') and conname<>'app_document_ai_index_brief_check'
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_document_ai_index'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_document_ai_index')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_document_ai_index') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_document_ai_index')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_document_ai_index') and not tgisinternal;
