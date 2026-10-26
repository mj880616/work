-- SELECT only. Save before apply. System catalogs, row counts and the migration history only (no folder names or document titles).
-- 바뀌는 것(정책 1개·함수 2개)의 지금 모양을 해시로 남긴다. 표·칸·권한은 이번에 바뀌지 않으므로 변경 전후 비교용 ACL도 함께 남긴다.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid in (to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('private.app_library_folder_lift()'))
union all select 'items policy',pol.polname::text,pol.polroles::text||':'||pol.polcmd::text||':'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'|'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
  from pg_policy pol where pol.polrelid=to_regclass('public.app_library_folder_items')
union all select 'folders policy',pol.polname::text,pol.polroles::text||':'||pol.polcmd::text||':'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'|'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
  from pg_policy pol where pol.polrelid=to_regclass('public.app_library_folders')
union all select 'table ACL',c.oid::regclass::text,coalesce(c.relacl::text,'none')||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text
  from pg_class c where c.oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items'))
union all select 'row count','public.app_library_folders',(select count(*)::text from public.app_library_folders)
union all select 'row count','public.app_library_folder_items',(select count(*)::text from public.app_library_folder_items)
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261022120000','20261026170000')
order by 1,2;
