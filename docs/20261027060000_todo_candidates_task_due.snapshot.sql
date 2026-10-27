-- SELECT only. Save before apply. Records the candidate table's column list and column privileges (no row values), the policies, and the history row.
select 'column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_todo_candidates') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname::text,pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=to_regclass('public.app_todo_candidates')
union all select 'policy',p.polname::text,p.polcmd::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from pg_policy p where p.polrelid=to_regclass('public.app_todo_candidates')
union all select 'table acl','public.app_todo_candidates',coalesce(c.relacl::text,'none') from pg_class c where c.oid=to_regclass('public.app_todo_candidates')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261027060000'
order by 1,2;
