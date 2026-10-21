-- SELECT only. 적용 전 main_project_archive_state 구조·권한 snapshot. 결과를 캡처해 둔다(rollback 대조용). 행 값 없음.
select 'column' as kind,a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where a.attrelid=to_regclass('public.main_project_archive_state') and a.attnum>0 and not a.attisdropped
union all select 'constraint',conname,pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.main_project_archive_state')
union all select 'policy',polname,polcmd::text||polroles::regrole[]::text||':using='||coalesce(pg_get_expr(polqual,polrelid),'-')||':check='||coalesce(pg_get_expr(polwithcheck,polrelid),'-') from pg_policy where polrelid=to_regclass('public.main_project_archive_state')
union all select 'trigger',tgname,tgenabled::text||':'||tgfoid::regprocedure::text from pg_trigger where tgrelid=to_regclass('public.main_project_archive_state') and not tgisinternal
union all select 'owner RLS acl',relname,relowner::regrole::text||':rls='||relrowsecurity::text||':force='||relforcerowsecurity::text||':acl='||coalesce(relacl::text,'default') from pg_class where oid=to_regclass('public.main_project_archive_state')
union all select 'grant',grantee||':'||privilege_type,is_grantable from information_schema.role_table_grants where table_schema='public' and table_name='main_project_archive_state' and grantee in ('anon','authenticated','PUBLIC')
order by 1,2;
