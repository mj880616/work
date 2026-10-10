-- SELECT only; one compact result. Detail/export: same-version snapshot.sql.
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
), result as (
  select 1 as ord, replace(id::regclass::text,'app_','') || '/' || kind as item,
         count(*)::text || ':' || md5(string_agg(def,E'\n' order by def)) as value
  from objects group by id,kind
  union all select 2,'rows (notes/links)',(select count(*) from public.app_notes)::text || '/' || (select count(*) from public.app_record_links)::text
  union all select 3,'raw violations (=0)',count(*)::text from public.app_notes where length(raw_text) not between 1 and 20000
  union all select 4,'target violations (=0)',count(*)::text from public.app_record_links where num_nonnulls(project_id,organization_id,meeting_id)<>1
  union all select 5,'missing prerequisites (=0)',(2-count(*))::text from supabase_migrations.schema_migrations where (version,name) in (('20260927103344','task_impl2_notes_record_links'),('20260928123601','task_meeting_followup_record_links'))
  union all select 6,'this version (=0)',count(*)::text from supabase_migrations.schema_migrations where version='20261010120000'
  union all select 7,'recent migrations',string_agg(version || ':' || name,E' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) m
)
select item,value from result order by ord,item;
