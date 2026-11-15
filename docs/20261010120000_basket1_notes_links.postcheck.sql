-- SELECT only. Immediate postcheck; first fill baseline from the PRECHECK capture.
with objects as (
  select a.attrelid as id, 'columns' as kind, a.attname || ':' || format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(d.adbin,d.adrelid),'') as def
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass) and a.attnum>0 and not a.attisdropped
  union all select conrelid,'constraints',conname || ':' || pg_get_constraintdef(oid) from pg_constraint where conrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  union all select indrelid,'indexes',indexrelid::regclass::text || ':' || pg_get_indexdef(indexrelid) from pg_index where indrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  union all select polrelid,'RLS/policy',polname || ':' || polcmd::text || ':' || polroles::regrole[]::text || ':' || pg_get_expr(polqual,polrelid) || ':' || pg_get_expr(polwithcheck,polrelid) from pg_policy where polrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  union all select oid,'RLS/policy',relrowsecurity::text || ':' || relforcerowsecurity::text from pg_class where oid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  union all select oid,'grants',coalesce(relacl::text,'NULL') from pg_class where oid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  union all select attrelid,'grants',attname || ':' || attacl::text from pg_attribute where attrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass) and attnum>0 and not attisdropped and attacl is not null
), expected(item,value) as (values
  ('notes/columns','10:92570166a91926b219ab06f410bbda75'),
  ('notes/constraints','5:efb1461965f6a63f89f4ed705c837151'),
  ('notes/RLS/policy','2:7723636ecf5420f1a0a7d2e8ae6dd743'),
  ('notes/indexes','1:28e71ef28b6e12383caea909b8f4b05c'),
  ('record_links/columns','14:72480eda617938f56552712baa614cbc'),
  ('record_links/constraints','14:8bf924ff685456ea86a3f383a57c326c'),
  ('record_links/RLS/policy','2:da64875d830671b050f3494f91f7bfb8'),
  ('record_links/indexes','8:11e23c4e0e7f774470ba67d996b6d94e')
), baseline(notes,links,notes_grants,links_grants) as (
  -- Replace all four NULLs with PRECHECK counts and full grants count:hash strings.
  values (null::bigint,null::bigint,null::text,null::text)
), actual as (
  select replace(id::regclass::text,'app_','') || '/' || kind as item,
         count(*)::text || ':' || md5(string_agg(def,E'\n' order by def)) as value
  from objects group by id,kind
), result as (
  select 1 ord,e.item,coalesce(a.value=e.value,false) ok from expected e left join actual a using(item)
  union all select 2,'notes/grants unchanged',coalesce((select value from actual where item='notes/grants')=notes_grants,false) from baseline
  union all select 2,'links/grants unchanged',coalesce((select value from actual where item='record_links/grants')=links_grants,false) from baseline
  union all select 3,'rows unchanged',coalesce((select count(*) from public.app_notes)=notes and (select count(*) from public.app_record_links)=links,false) from baseline
  union all select 4,'new values unused',not exists (select 1 from public.app_notes where attachments<>'[]'::jsonb or metadata<>'{}'::jsonb or archived_at is not null or not ai_export_allowed) and not exists (select 1 from public.app_record_links where document_id is not null)
  union all select 5,'migration exactly 1',(select count(*) from supabase_migrations.schema_migrations where version='20261010120000')=1 and exists (select 1 from supabase_migrations.schema_migrations where version='20261010120000' and name='basket1_notes_links')
)
select item,case when ok then '예' else '아니오' end as expected from result order by ord,item;
