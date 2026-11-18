-- SELECT only. 20261117190000_weekly_meeting_words. Aggregates and hashes; no profile or meeting text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / old default 예 / word entries 0 / operator profiles 1 / operator list has room 예 /
--   RLS 예 / anon 아니오 / authenticated can update profiles 예 / owner policies 예. 그 밖의 개수·해시는 사후 확인과 같은 값이어야 한다(기록만).
-- 'non-operator profiles with the old default list' = 이번에 빈 목록으로 비울 다른 사람 행 수(명진 결정 11/17 "비워"). 행 값은 읽지 않고 개수만 센다.
-- 'operator list hash (without words)'는 운영자 행의 지금 목록(단어 항목 제외)의 md5 — 적용 뒤에도 같아야 한다(기존 항목 그대로).
-- expect: word entries = 0
-- expect: operator profiles = 1
-- expect: recent migrations = 기록
-- expect: anon or public table privilege = 아니오
-- expect: profiles rows = 기록
-- expect: non-operator profiles with the old default list = 기록
-- expect: non-operator profiles with an empty list = 기록
-- expect: non-operator profiles with another list = 기록
-- expect: non-operator profiles with the old default or an empty list = 기록
-- expect: operator list hash (without words) = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: triggers count = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261022090000' and name='weekly_report_meeting_kinds')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261117190000') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'old default (two kinds)',case when exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_profiles') and a.attname='weekly_hidden_meeting_kinds' and not a.attisdropped
    and pg_get_expr(d.adbin,d.adrelid)='ARRAY[''궤도집행국회의''::text, ''본부집행위''::text]') then '예' else '아니오' end
union all select 'word entries',(select count(*) from public.app_profiles p,unnest(p.weekly_hidden_meeting_kinds) k where k like '*%*')::text
union all select 'operator profiles',(select count(*) from public.app_profiles p where p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls')))::text
union all select 'operator list has room',case when (select count(*) from public.app_profiles p where p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls')) and cardinality(p.weekly_hidden_meeting_kinds)<=94)=1 then '예' else '아니오' end
union all select 'operator list hash (without words)',(select md5(coalesce(string_agg(array_to_string(array(select k from unnest(p.weekly_hidden_meeting_kinds) with ordinality u(k,n) where k not like '*%*' order by n),','),'|'),'')) from public.app_profiles p where p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls')))
union all select 'non-operator profiles with the old default list',(select count(*) from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and p.weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위']::text[])::text
union all select 'non-operator profiles with an empty list',(select count(*) from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and cardinality(p.weekly_hidden_meeting_kinds)=0)::text
union all select 'non-operator profiles with the old default or an empty list',(select count(*) from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and (cardinality(p.weekly_hidden_meeting_kinds)=0 or p.weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위']::text[]))::text
union all select 'non-operator profiles with another list',(select count(*) from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and cardinality(p.weekly_hidden_meeting_kinds)>0 and p.weekly_hidden_meeting_kinds<>array['궤도집행국회의','본부집행위']::text[])::text
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'authenticated can update profiles',case when has_table_privilege('authenticated','public.app_profiles','UPDATE') then '예' else '아니오' end
union all select 'owner policies only (current shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_owner_profileuser_id' and regexp_replace(with_check,'[\s()]','','g')='private.app_is_owner_profileuser_id')
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_profiles' and policyname='task12a_profile_self_select' and permissive='PERMISSIVE' and cmd='SELECT' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
