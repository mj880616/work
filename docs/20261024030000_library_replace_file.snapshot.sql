-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows, no document text).
-- Schema snapshot of public.app_documents that gets the two new columns (columns, constraints, indexes, policies, triggers, grants).
with t as (select to_regclass('public.app_documents') as rel)
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
union all select 'constraint',c.conname,c.contype::text||':validated='||c.convalidated::text||':'||pg_get_constraintdef(c.oid) from t join pg_constraint c on c.conrelid=t.rel
union all select 'index',ic.relname,pg_get_indexdef(x.indexrelid) from t join pg_index x on x.indrelid=t.rel join pg_class ic on ic.oid=x.indexrelid
union all select 'policy',p.polname::text,p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') from t join pg_policy p on p.polrelid=t.rel
union all select 'trigger',g.tgname::text,g.tgenabled::text||':'||pg_get_triggerdef(g.oid) from t join pg_trigger g on g.tgrelid=t.rel and not g.tgisinternal
union all select 'owner RLS grants','app_documents',c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'none') from t join pg_class c on c.oid=t.rel
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261023120000','20261024030000')
order by 1,2;
