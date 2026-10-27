-- SELECT only. Save before apply. pg_catalog만 읽고 행 값은 읽지 않는다.
-- 연결 표의 칸·제약·권한 정의와 새 표가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_onedrive_connections','public.app_onedrive_folders','public.app_onedrive_photos']) n
union all select 'column',a.attname::text,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none')
  from pg_attribute a where a.attrelid=to_regclass('public.app_onedrive_connections') and a.attnum>0 and not a.attisdropped
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_onedrive_connections')
union all select 'table ACL',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid=to_regclass('public.app_onedrive_connections')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261028010000'
order by 1,2;
