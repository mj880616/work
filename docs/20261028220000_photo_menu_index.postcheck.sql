-- SELECT only. pg_catalog만 읽는다. 적용 뒤(기록 + 새 칸·인덱스·photo_view 검사)와
-- 되돌린 뒤·시험 적용 뒤(기록 없음 + 새 칸·인덱스 없음 + photo_view 없는 검사) 모두 예가 나온다.
-- 해시·개수 항목은 precheck의 같은 이름 항목과 같아야 한다(권한·정책·트리거·기존 제약·기존 인덱스 변경 없음).
-- 색인 표 행 수는 비교하지 않는다(적용 중에도 지금 Edge가 색인을 받을 수 있다).
with history as (
  select count(*) as n,count(*) filter(where name='photo_menu_index') as named from supabase_migrations.schema_migrations where version='20261028220000'
), shape as (
  select (select count(*) from pg_attribute where attrelid=to_regclass('public.app_onedrive_photos') and not attisdropped
      and attname in ('kind','mime','size_bytes','width','height','duration_ms','sha1','lat','lon','screenshot','trashed_at','orig_parent_id'))
    +(select count(*) from pg_attribute where attrelid=to_regclass('public.app_onedrive_folders') and not attisdropped and attname='role') as cols,
    (select count(*) from pg_class where relname in ('app_onedrive_photos_recent_idx','app_onedrive_folders_trash_uidx') and relnamespace='public'::regnamespace) as idx,
    (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and convalidated) as checks,
    (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and pg_get_constraintdef(oid) ~ 'photo_view') as with_photo_view,
    (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and pg_get_constraintdef(oid) ~ 'diary_onedrive') as with_diary_onedrive
)
select 'schema and history agree' as item,case when shape.checks=1 and shape.with_diary_onedrive=1 and (
  (history.n=0 and shape.cols=0 and shape.idx=0 and shape.with_photo_view=0)
  or (history.n=1 and history.named=1 and shape.cols=13 and shape.idx=2 and shape.with_photo_view=1)) then '예' else '아니오' end as value
  from history,shape
union all select 'RLS still enabled on three tables',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos')) and relrowsecurity)=3 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_onedrive_photos','select,insert,update,delete') and not has_table_privilege('anon','public.app_onedrive_folders','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'index tables still have no policy and no client grant',case when not exists(select 1 from pg_policy where polrelid in (to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos')))
  and not has_table_privilege('authenticated','public.app_onedrive_photos','select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated','public.app_onedrive_folders','select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated','public.app_onedrive_photos','select,insert,update,references')
  and not has_any_column_privilege('authenticated','public.app_onedrive_folders','select,insert,update,references')
  and not exists(select 1 from pg_attribute where attrelid in (to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos')) and attacl is not null) then '예' else '아니오' end
union all select 'service_role still four privileges on index tables',case when
  (select bool_and(has_table_privilege('service_role','public.app_onedrive_photos',p) and has_table_privilege('service_role','public.app_onedrive_folders',p)) from unnest(array['select','insert','update','delete']) p)
  and not has_table_privilege('service_role','public.app_onedrive_photos','truncate,references,trigger')
  and not has_table_privilege('service_role','public.app_onedrive_folders','truncate,references,trigger') then '예' else '아니오' end
union all select 'two owner policies on profiles',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'index tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos'))
  and conname not in ('app_onedrive_photos_media_check','app_onedrive_photos_sha1_check','app_onedrive_photos_location_check','app_onedrive_photos_trash_check','app_onedrive_folders_role_check')
union all select 'index tables indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),''))
  from pg_indexes where schemaname='public' and tablename in ('app_onedrive_folders','app_onedrive_photos') and indexname not in ('app_onedrive_photos_recent_idx','app_onedrive_folders_trash_uidx')
union all select 'index tables grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos'))
union all select 'profiles other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname<>'app_profiles_view_prefs_check'
union all select 'profiles policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'profiles grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  ||md5(coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=to_regclass('public.app_profiles') and attnum>0 and not attisdropped),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||':'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_folders'),to_regclass('public.app_onedrive_photos')) and not tgisinternal;
