-- SELECT only. Save before apply. System catalogs and the migration history only (no folder names or document titles).
-- 바뀌는 함수 3개의 지금 모양(invoker/definer·search_path·실행권·본문 해시)과 폴더 표 트리거·정책·ACL을 남긴다.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.oid in (to_regprocedure('private.app_library_folder_tree_guard()'),to_regprocedure('public.app_trash_restore(text,uuid)'),to_regprocedure('private.app_trash_library_folder_before_delete()'))
union all select 'trigger',t.tgname::text,t.tgfoid::regprocedure::text||':'||t.tgenabled::text
  from pg_trigger t where t.tgrelid=to_regclass('public.app_library_folders') and not t.tgisinternal
union all select 'folders policy',pol.polname::text,pol.polroles::text||':'||pol.polcmd::text||':'||pol.polpermissive::text||':'||md5(coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')||'|'||coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
  from pg_policy pol where pol.polrelid=to_regclass('public.app_library_folders')
union all select 'table ACL',c.oid::regclass::text,coalesce(c.relacl::text,'none')||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text
  from pg_class c where c.oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_library_folder_items'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261025180000','20261026170000','20261027050000','20261028113000')
order by 1,2;
