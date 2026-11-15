-- SELECT only. Save before apply. pg_catalog만 읽고 행 값은 읽지 않는다(앱 표를 읽지 않음, 허용 행 개수는 precheck가 본다).
-- 운영자 표의 검사 정의·권한과 새 표가 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_operator_features','public.app_gdrive_sync','public.app_gdrive_folders','public.app_gdrive_photos']) n
union all select 'constraint',c.conname::text,md5(pg_get_constraintdef(c.oid))
  from pg_constraint c where c.conrelid=to_regclass('public.app_operator_features')
union all select 'table ACL',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none')
  from pg_class c where c.oid=to_regclass('public.app_operator_features')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261031120000'
order by 1,2;
