-- SELECT only. Aggregates and hashes; no profile text or photo keys. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: 앞 단계 기록 예 / 이번 기록 없음 예 / 화면 기억 검사에 photo_hint 있고 photo_sources 없음 예 / 두 출처 검사에 phone 없음 예 /
--   저장된 출처 0 / 폰 별표·앨범 0 / RLS 예 / anon 없음 예 / 정책 수 예. 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- read_only 요청은 표 소유자가 아닌 역할로 돈다. pg_constraint·pg_get_constraintdef로 읽는다(information_schema 안 씀).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: view prefs check without photo sources = 예
-- expect: source checks without phone = 예
-- expect: saved photo sources = 0
-- expect: phone rows = 0
-- expect: RLS enabled = 예
-- expect: no anon or public table privilege = 예
-- expect: policy counts = 예
-- expect: profiles rows = 기록
-- expect: stars rows = 기록
-- expect: album item rows = 기록
-- expect: view prefs check definition hash = 기록
-- expect: other constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261030190000' and name='profile_view_prefs_photo_hint') or (version='20261029150000' and name='photo_tags'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261030230000') then '예' else '아니오' end
union all select 'view prefs check without photo sources',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'photo_hint' and pg_get_constraintdef(oid) !~ 'photo_sources')=1 then '예' else '아니오' end
union all select 'source checks without phone',case when (select count(*) from pg_constraint where ((conrelid=to_regclass('public.app_diary_stars') and conname='app_diary_stars_source_check')
  or (conrelid=to_regclass('public.app_photo_tag_items') and conname='app_photo_tag_items_source_check')) and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'onedrive' and pg_get_constraintdef(oid) ~ 'upload' and pg_get_constraintdef(oid) !~ 'phone')=2 then '예' else '아니오' end
union all select 'saved photo sources',count(*)::text from public.app_profiles where view_prefs ? 'photo_sources'
union all select 'phone rows',((select count(*) from public.app_diary_stars where source='phone')+(select count(*) from public.app_photo_tag_items where source='phone'))::text
union all select 'RLS enabled',case when (select count(*) from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and relrowsecurity)=3 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_diary_stars','select,insert,update,delete')
  and not has_table_privilege('anon','public.app_photo_tag_items','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'policy counts',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_diary_stars'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_photo_tag_items'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[])
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'view prefs check definition hash',md5(coalesce(string_agg(pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check'
union all select 'other constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),'')) from pg_constraint where conrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and conname not in ('app_profiles_view_prefs_check','app_diary_stars_source_check','app_photo_tag_items_source_check')
union all select 'indexes hash',md5(coalesce(string_agg(tablename||'.'||indexname||':'||indexdef,',' order by tablename,indexname),'')) from pg_indexes where schemaname='public' and tablename in ('app_profiles','app_diary_stars','app_photo_tag_items')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items'))
union all select 'column grants hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||coalesce(attacl::text,''),',' order by attrelid::regclass::text,attname),'')) from pg_attribute where attrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items'))
union all select 'triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),'')) from pg_trigger where tgrelid in (to_regclass('public.app_profiles'),to_regclass('public.app_diary_stars'),to_regclass('public.app_photo_tag_items')) and not tgisinternal
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'stars rows',count(*)::text from public.app_diary_stars
union all select 'album item rows',count(*)::text from public.app_photo_tag_items;
