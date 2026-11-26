-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다. 긴 정의는 md5·length로만 남긴다.
-- 연결 표의 칸·색인·정책·권한·트리거, 이번 함수가 아직 없음, 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'folder items column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_library_folder_items') and a.attnum>0 and not a.attisdropped
union all select 'folder items index',i.indexrelid::regclass::text,md5(pg_get_indexdef(i.indexrelid))||':'||length(pg_get_indexdef(i.indexrelid))::text
  from pg_index i where i.indrelid=to_regclass('public.app_library_folder_items')
union all select 'folder items policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_library_folder_items')
union all select 'folder items table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_library_folder_items')
union all select 'folder items trigger',t.tgname::text,md5(pg_get_triggerdef(t.oid))||':'||t.tgenabled::text
  from pg_trigger t where t.tgrelid=to_regclass('public.app_library_folder_items') and not t.tgisinternal
union all select 'function','private.app_library_folder_items_moved_at()',coalesce(to_regprocedure('private.app_library_folder_items_moved_at()')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261126150000'
order by 1,2;
