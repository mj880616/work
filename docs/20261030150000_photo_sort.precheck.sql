-- SELECT only. 집계·해시만 읽는다(사진 이름·프로필 글 없음). pg_catalog만 읽는다(information_schema 안 씀).
-- dry-run/apply 전에 돌린다(시험 적용 전후 비교에도 쓴다). 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / uploaded_at 칸 0 / 화면 기억 검사에 note_boards 있고 sort 값 없음 예 / 저장된 정렬 기준 0 /
--   두 표 RLS 예 / anon·PUBLIC 아니오 / 색인 표 정책·authenticated 권한 없음 예 / service_role 넷 예 / 프로필 정책 2개 예. 해시·행 수는 기록.
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: uploaded at column present = 0
-- expect: view prefs check without photo sort = 예
-- expect: saved photo sort keys = 0
-- expect: RLS enabled on two tables = 예
-- expect: anon or public table privilege = 아니오
-- expect: photo index has no policy and no client grant = 예
-- expect: service_role four privileges on photo index = 예
-- expect: two owner policies on profiles = 예
-- expect: profiles rows = 기록
-- expect: photo index constraints hash = 기록
-- expect: photo index indexes hash = 기록
-- expect: photo index grants hash = 기록
-- expect: photo index other columns hash = 기록
-- expect: profiles other constraints hash = 기록
-- expect: profiles policies hash = 기록
-- expect: profiles grants hash = 기록
-- expect: triggers hash = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations
  where (version='20261028220000' and name='photo_menu_index') or (version='20261030091000' and name='profile_view_prefs_note_boards'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261030150000') then '예' else '아니오' end
union all select 'uploaded at column present',(select count(*) from pg_attribute where attrelid=to_regclass('public.app_onedrive_photos') and not attisdropped and attname='uploaded_at')::text
union all select 'view prefs check without photo sort',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'note_boards' and pg_get_constraintdef(oid) ~ 'photo_view' and pg_get_constraintdef(oid) !~ 'taken_desc')=1 then '예' else '아니오' end
union all select 'saved photo sort keys',count(*)::text from public.app_profiles where view_prefs -> 'photo_view' ? 'sort'
union all select 'RLS enabled on two tables',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  or has_table_privilege('anon','public.app_onedrive_photos','select,insert,update,delete')
  or exists(select 1 from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_onedrive_photos')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'photo index has no policy and no client grant',case when not exists(select 1 from pg_policy where polrelid=to_regclass('public.app_onedrive_photos'))
  and not has_table_privilege('authenticated','public.app_onedrive_photos','select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated','public.app_onedrive_photos','select,insert,update,references') then '예' else '아니오' end
union all select 'service_role four privileges on photo index',case when
  (select bool_and(has_table_privilege('service_role','public.app_onedrive_photos',p)) from unnest(array['select','insert','update','delete']) p)
  and not has_table_privilege('service_role','public.app_onedrive_photos','truncate,references,trigger') then '예' else '아니오' end
union all select 'two owner policies on profiles',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[])
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
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
