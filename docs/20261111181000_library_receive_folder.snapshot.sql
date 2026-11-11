-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 행 값은 읽지 않는다. 긴 정의는 md5·length로만 남긴다.
-- 프로필 표의 칸·검사·색인·정책·권한, 자료 표의 트리거, 폴더·연결 표의 정책·권한, 이번 칸·함수·트리거가 아직 없음, 이번 기록 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'profiles column' as kind,a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'') as definition
  from pg_attribute a where a.attrelid=to_regclass('public.app_profiles') and a.attnum>0 and not a.attisdropped
union all select 'profiles constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))||':'||length(pg_get_constraintdef(c.oid))::text
  from pg_constraint c where c.conrelid=to_regclass('public.app_profiles')
union all select 'profiles index',i.indexrelid::regclass::text,md5(pg_get_indexdef(i.indexrelid))||':'||length(pg_get_indexdef(i.indexrelid))::text
  from pg_index i where i.indrelid=to_regclass('public.app_profiles')
union all select 'profiles policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_profiles')
union all select 'profiles table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_profiles')
union all select 'documents trigger',t.tgname::text,md5(pg_get_triggerdef(t.oid))||':'||t.tgenabled::text
  from pg_trigger t where t.tgrelid=to_regclass('public.app_documents') and not t.tgisinternal
union all select 'documents table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_documents')
union all select 'folders policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_library_folders')
union all select 'folders table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_library_folders')
union all select 'folder items policy',p.polname::text,md5(p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
  from pg_policy p where p.polrelid=to_regclass('public.app_library_folder_items')
union all select 'folder items table',c.relname::text,c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'')
  from pg_class c where c.oid=to_regclass('public.app_library_folder_items')
union all select 'function','private.app_documents_receive_folder()',coalesce(to_regprocedure('private.app_documents_receive_folder()')::text,'absent')
union all select 'index','public.app_profiles_library_receive_folder_idx',coalesce(to_regclass('public.app_profiles_library_receive_folder_idx')::text,'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261025180000','20261111181000')
order by 1,2;
