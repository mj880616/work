-- SELECT only. Save before apply. System catalogs and the migration history only (no app table rows).
-- 4천 자가 넘는 검사 정의(app_profiles_view_prefs_check 등)는 snapshot 한 값 상한(8192자) 때문에 해시·길이로 기록한다. 이 migration은 그 검사를 바꾸지 않는다.
select 'column' as kind,c.relname||'.'||a.attname::text as name,format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname::text,case when length(pg_get_constraintdef(oid))>4000 then 'md5:'||md5(pg_get_constraintdef(oid))||':length='||length(pg_get_constraintdef(oid)) else pg_get_constraintdef(oid) end from pg_constraint where conrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
union all select 'table',c.relname::text,c.relrowsecurity::text||':'||coalesce(c.relacl::text,'none') from pg_class c where c.oid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
union all select 'policy',p.polrelid::regclass::text||'.'||p.polname::text,p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'') from pg_policy p where p.polrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
union all select 'trigger',t.tgrelid::regclass::text||'.'||t.tgname::text,t.tgenabled::text||':'||t.tgfoid::regproc::text from pg_trigger t where t.tgrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles')) and not t.tgisinternal
union all select 'history',version,name from supabase_migrations.schema_migrations where version in('20261124203000','20261125193000')
union all select 'index',c.relname::text,pg_get_indexdef(c.oid) from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid in (to_regclass('public.app_library_folders'),to_regclass('public.app_profiles'))
order by 1,2;
