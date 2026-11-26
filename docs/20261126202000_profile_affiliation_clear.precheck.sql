-- SELECT only. Counts, yes/no and hashes; no name, affiliation or title text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 'profiles to clear'는 세 칸(소속·부서·직책) 중 하나라도 값이 있는 프로필 수, 'union names'·'department names'·'job titles'는 칸마다 값이 있는 프로필 수(기록만).
-- 'collab member titles'는 묶음 구성원 줄에 남은 직책 사본 수(이번에 바꾸지 않음, 기록만).
-- 나머지 행 수·해시는 사후 확인과 같은 값이어야 한다(이름·다른 칸·담당 표·권한·정책·트리거 그대로, 줄 추가·삭제 없음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: backup table absent = 예
-- expect: three columns nullable text = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: profiles to clear = 기록
-- expect: union names = 기록
-- expect: department names = 기록
-- expect: job titles = 기록
-- expect: collab member titles = 기록
-- expect: profile rows = 기록
-- expect: names hash = 기록
-- expect: other columns hash = 기록
-- expect: assignee rows = 기록
-- expect: profile workplace rows = 기록
-- expect: collab member rows = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
select 'prerequisite recorded' as item, case when (select count(*) from supabase_migrations.schema_migrations where version = '20261115223000' and name = 'profile_union_department') = 1 then '예' else '아니오' end as value
union all select 'new migration absent', case when not exists (select 1 from supabase_migrations.schema_migrations where version = '20261126202000') then '예' else '아니오' end
union all select 'backup table absent', case when to_regclass('public.app_cleanup_s71_40_profiles') is null then '예' else '아니오' end
union all select 'three columns nullable text', case when (select count(*) from pg_attribute where attrelid = to_regclass('public.app_profiles') and not attisdropped and not attnotnull
  and attname in ('union_name', 'department_name', 'job_title') and atttypid = 'text'::regtype) = 3 then '예' else '아니오' end
union all select 'RLS enabled', case when exists (select 1 from pg_class where oid = to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege', case when has_table_privilege('anon', 'public.app_profiles', 'select,insert,update,delete')
  or exists (select 1 from pg_class where oid = to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'profiles to clear', (select count(*) from public.app_profiles where union_name is not null or department_name is not null or job_title is not null)::text
union all select 'union names', (select count(*) from public.app_profiles where union_name is not null)::text
union all select 'department names', (select count(*) from public.app_profiles where department_name is not null)::text
union all select 'job titles', (select count(*) from public.app_profiles where job_title is not null)::text
union all select 'collab member titles', (select count(*) from public.app_collab_members where title is not null)::text
union all select 'profile rows', (select count(*) from public.app_profiles)::text
union all select 'names hash', md5(coalesce((select string_agg(user_id::text || ':' || coalesce(display_name, ''), ',' order by user_id) from public.app_profiles), ''))
union all select 'other columns hash', md5(coalesce((select string_agg(md5((to_jsonb(p) - 'union_name' - 'department_name' - 'job_title' - 'updated_at')::text), ',' order by p.user_id) from public.app_profiles p), ''))
union all select 'assignee rows', (select count(*) from public.app_suborganization_assignees)::text
union all select 'profile workplace rows', (select count(*) from public.app_profile_workplaces)::text
union all select 'collab member rows', (select count(*) from public.app_collab_members)::text
union all select 'policies hash', md5(coalesce(string_agg(polname::text || polcmd::text || polroles::text || polpermissive::text || coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''), ',' order by polname), ''))
  from pg_policy where polrelid = to_regclass('public.app_profiles')
union all select 'owner RLS grants hash', md5(coalesce(string_agg(relowner::text || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text || ':' || coalesce(relacl::text, ''), ''), ''))
  from pg_class where oid = to_regclass('public.app_profiles')
union all select 'column grants hash', md5(coalesce(string_agg(attname || ':' || coalesce(attacl::text, ''), ',' order by attname), '')) from pg_attribute where attrelid = to_regclass('public.app_profiles') and attnum > 0 and not attisdropped
union all select 'triggers hash', md5(coalesce(string_agg(tgname || ':' || tgenabled::text || ':' || pg_get_triggerdef(oid), ',' order by tgname), ''))
  from pg_trigger where tgrelid = to_regclass('public.app_profiles') and not tgisinternal;
