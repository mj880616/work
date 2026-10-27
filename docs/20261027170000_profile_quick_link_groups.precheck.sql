-- SELECT only. Aggregates and hashes; no profile text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / new column count 0 / links check old shape 예 / custom link groups saved 0 /
--   RLS 예 / anon 아니오 / two owner policies 예. 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- read_only 요청은 표 소유자가 아닌 역할로 돈다. 검사 조건은 pg_constraint·pg_get_constraintdef로 읽는다(docs/ops-db-workflow.md 사전·사후 확인 절).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new column count = 0
-- expect: links check old shape = 예
-- expect: custom link groups saved = 0
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: two owner policies = 예
-- expect: profiles rows = 기록
-- expect: saved link lists = 기록
-- expect: other constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261022163000' and name='profile_quick_links')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261027170000') then '예' else '아니오' end
union all select 'new column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='quick_link_groups' and not attisdropped
union all select 'links check old shape',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_quick_links_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'work' and pg_get_constraintdef(oid) !~ 'a-z0-9')=1 then '예' else '아니오' end
union all select 'custom link groups saved',count(*)::text from public.app_profiles where quick_links is not null and jsonb_path_exists(quick_links,'lax $[*] ? (!(@.group == "work" || @.group == "org"))')
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[])
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'saved link lists',count(*)::text from public.app_profiles where quick_links is not null
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname not in ('app_profiles_quick_links_check','app_profiles_quick_link_groups_check','app_profiles_quick_links_group_ref_check')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_profiles') and attnum>0 and not attisdropped and attname<>'quick_link_groups'
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
