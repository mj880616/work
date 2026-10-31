-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표 둘·notify_prefs 칸·검사 제약이 아직 없음을 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_push_devices','public.app_push_log']) n
union all select 'column','public.app_profiles.notify_prefs',coalesce((select format_type(atttypid,atttypmod) from pg_attribute
  where attrelid='public.app_profiles'::regclass and not attisdropped and attname='notify_prefs'),'absent')
union all select 'constraint','app_profiles_notify_prefs_check',coalesce((select 'present' from pg_constraint
  where connamespace='public'::regnamespace and conname='app_profiles_notify_prefs_check'),'absent')
union all select 'history',version,name from supabase_migrations.schema_migrations where version='20261101010000'
order by 1,2;
