-- SELECT only. Aggregates and hashes; no profile text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / new column 0 / RLS 예 / anon 아니오 / authenticated can update profiles 예 /
--   owner policies 예 / owner check function 예 / owner profile row 예. 그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: new column count = 0
-- expect: anon or public table privilege = 아니오
-- expect: profiles rows = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: triggers count = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261023150000' and name='profile_library_view')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261023180000') then '예' else '아니오' end
union all select 'new column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_profiles') and attname='view_prefs' and not attisdropped
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'authenticated can update profiles',case when has_table_privilege('authenticated','public.app_profiles','UPDATE') then '예' else '아니오' end
union all select 'owner policies only (current shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_owner_profileuser_id' and regexp_replace(with_check,'[\s()]','','g')='private.app_is_owner_profileuser_id')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and permissive='PERMISSIVE' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'owner check function (task12a body)',case when (select count(*) from pg_proc where pronamespace='private'::regnamespace and proname='app_is_owner_profile' and prosecdef
  and regexp_replace(prosrc,'\s','','g')='selectexists(select1frompublic.app_workspace_memberssubjectjoinpublic.app_workspace_membersowneronowner.workspace_id=subject.workspace_idandowner.role=''owner''andowner.user_id=(selectauth.uid())wheresubject.user_id=p_user)')=1 then '예' else '아니오' end
union all select 'owner profile row exists',case when exists(select 1 from public.app_profiles p join public.app_workspace_members m on m.user_id=p.user_id and m.role='owner') then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
