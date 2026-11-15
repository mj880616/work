-- SELECT only. 적용 전에 저장한다. 시스템 카탈로그와 migration 기록만 읽는다(앱 표의 행 값은 읽지 않는다).
-- app_onedrive_photos와 app_profiles의 칸·제약·인덱스·정책·트리거·권한 정의를 기록한다(되돌린 뒤 같은지 대조).
-- 화면 기억 검사(app_profiles_view_prefs_check)는 정의가 8천 자를 넘어(snapshot 한 값 상한 8192자) 해시·길이로 기록한다. 원문은 rollback 파일에 있다.
select 'column' as kind,a.attrelid::regclass::text||'.'||a.attname as name,format_type(a.atttypid,a.atttypmod)||':required='||a.attnotnull::text||':default='||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':acl='||coalesce(a.attacl::text,'none') as definition
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and a.attnum>0 and not a.attisdropped
union all select 'constraint',conrelid::regclass::text||'.'||conname,case when conname='app_profiles_view_prefs_check' then 'md5:'||md5(pg_get_constraintdef(oid))||':length='||length(pg_get_constraintdef(oid)) else pg_get_constraintdef(oid) end from pg_constraint
  where conrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos'))
union all select 'index',tablename||'.'||indexname,indexdef from pg_indexes where schemaname='public' and tablename in ('app_profiles','app_onedrive_photos')
union all select 'policy',polrelid::regclass::text||'.'||polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'')
  from pg_policy where polrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos'))
union all select 'trigger',tgrelid::regclass::text||'.'||tgname,tgenabled::text||':'||pg_get_triggerdef(oid) from pg_trigger
  where tgrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and not tgisinternal
union all select 'owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261028220000','20261030091000','20261030150000')
order by 1,2;
