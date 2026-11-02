-- SELECT only. Save before apply. System catalogs and the migration history only (no post titles or sentences).
-- 바뀌는 함수 하나의 지금 모양(invoker/definer·search_path·실행권·본문 해시)과 두 표의 ACL·RLS·정책을 남긴다.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='app_outside_search'
union all select 'policy',pol.polrelid::regclass::text||'.'||pol.polname::text,pol.polroles::text||':'||pol.polcmd::text||':'||pol.polpermissive::text||':'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'|'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
  from pg_policy pol where pol.polrelid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'))
union all select 'table ACL',c.oid::regclass::text,coalesce(c.relacl::text,'none')||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_outside_sentences'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261031230000','20261102150000')
order by 1,2;
