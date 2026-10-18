-- SELECT only. User saves schema snapshot of app_documents and app_workspaces before apply; no row values.
with t(rel) as (values (to_regclass('public.app_documents')),(to_regclass('public.app_workspaces')))
select t.rel::text as tbl,'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from t join pg_attribute a on a.attrelid=t.rel left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attnum>0 and not a.attisdropped
union all select t.rel::text,'constraint',conname,pg_get_constraintdef(c.oid) from t join pg_constraint c on c.conrelid=t.rel
union all select t.rel::text,'index',i.indexname,i.indexdef from t join pg_indexes i on i.schemaname='public' and i.tablename=split_part(t.rel::text,'.',2)
union all select t.rel::text,'policy',polname,polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'') from t join pg_policy p on p.polrelid=t.rel
union all select t.rel::text,'trigger',tgname,tgenabled::text from t join pg_trigger g on g.tgrelid=t.rel and not g.tgisinternal
union all select t.rel::text,'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none') from t join pg_class c on c.oid=t.rel
union all select 'functions','function',p.oid::regprocedure::text,coalesce(p.proacl::text,'default') from pg_proc p
  where p.pronamespace in ('public'::regnamespace,'private'::regnamespace) and p.proname like 'app\_document\_categor%'
order by 1,2,3;
