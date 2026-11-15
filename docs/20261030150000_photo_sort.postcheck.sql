-- SELECT only. pg_catalog만 읽는다(information_schema 안 씀). 적용 뒤(기록 + uploaded_at 칸 + sort를 받는 검사)와
-- 되돌린 뒤·시험 적용 뒤(기록 없음 + 칸 없음 + sort 없는 검사) 모두 예가 나온다.
-- 해시·개수 항목은 precheck의 같은 이름 항목과 같아야 한다(권한·정책·트리거·제약·인덱스·다른 칸 변경 없음, 프로필 행 그대로).
-- 색인 표 행 수는 비교하지 않는다(적용 중에도 지금 Edge가 색인을 받을 수 있다).
with history as (
  select count(*) as n,count(*) filter(where name='photo_sort') as named from supabase_migrations.schema_migrations where version='20261030150000'
), shape as (
  select (select count(*) from pg_attribute where attrelid=to_regclass('public.app_onedrive_photos') and not attisdropped and attname='uploaded_at'
      and atttypid='timestamptz'::regtype and not attnotnull) as cols,
    (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and convalidated) as checks,
    (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and pg_get_constraintdef(oid) ~ 'taken_desc') as with_sort,
    (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and pg_get_constraintdef(oid) ~ 'note_boards') as with_note_boards
)
select 'schema and history agree' as item,case when shape.checks=1 and shape.with_note_boards=1 and (
  (history.n=0 and shape.cols=0 and shape.with_sort=0)
  or (history.n=1 and history.named=1 and shape.cols=1 and shape.with_sort=1)) then '예' else '아니오' end as value
  from history,shape
union all select 'RLS still enabled on two tables',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_onedrive_photos','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'photo index still has no policy and no client grant',case when not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_onedrive_photos'))
  and not has_table_privilege('authenticated','public.app_onedrive_photos','select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated','public.app_onedrive_photos','select,insert,update,references')
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_onedrive_photos') and attacl is not null) then '예' else '아니오' end
union all select 'service_role still four privileges on photo index',case when
  (select bool_and(has_table_privilege('service_role','public.app_onedrive_photos',p)) from unnest(array['select','insert','update','delete']) p)
  and not has_table_privilege('service_role','public.app_onedrive_photos','truncate,references,trigger') then '예' else '아니오' end
union all select 'two owner policies on profiles',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'photo index constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_onedrive_photos')
union all select 'photo index indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),''))
  from pg_indexes where schemaname='public' and tablename='app_onedrive_photos'
union all select 'photo index grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_onedrive_photos')
union all select 'photo index other columns hash',md5(coalesce(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=to_regclass('public.app_onedrive_photos') and attnum>0 and not attisdropped and attname<>'uploaded_at'
union all select 'profiles other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname<>'app_profiles_view_prefs_check'
union all select 'profiles policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'profiles grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  ||md5(coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=to_regclass('public.app_profiles') and attnum>0 and not attisdropped),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||':'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and not tgisinternal;
