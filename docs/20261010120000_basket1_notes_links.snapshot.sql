-- SELECT only. Save/export before applying; contains schema definitions, no note text.
select 'column' as kind, a.attrelid::regclass::text as object, a.attname as name,
       format_type(a.atttypid,a.atttypmod) || ' not_null=' || a.attnotnull::text ||
       ' default=' || coalesce(pg_get_expr(d.adbin,d.adrelid),'NULL') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  and a.attnum>0 and not a.attisdropped
union all
select 'constraint', conrelid::regclass::text, conname, pg_get_constraintdef(oid)
from pg_constraint where conrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
union all
select 'index', tablename, indexname, indexdef from pg_indexes
where schemaname='public' and tablename in ('app_notes','app_record_links')
union all
select 'policy', polrelid::regclass::text, polname,
       polcmd::text || ' roles=' || polroles::regrole[]::text ||
       ' using=' || pg_get_expr(polqual,polrelid) || ' check=' || pg_get_expr(polwithcheck,polrelid)
from pg_policy where polrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
union all
select 'RLS/grant', relname, 'table', 'RLS=' || relrowsecurity::text || ' force=' || relforcerowsecurity::text || ' ACL=' || coalesce(relacl::text,'NULL')
from pg_class where oid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
union all
select 'column grant', attrelid::regclass::text, attname, attacl::text
from pg_attribute where attrelid in ('public.app_notes'::regclass,'public.app_record_links'::regclass)
  and attnum>0 and not attisdropped and attacl is not null
order by 1,2,3;
