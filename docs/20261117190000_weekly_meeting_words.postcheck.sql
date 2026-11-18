-- SELECT only. 20261117190000_weekly_meeting_words. Works after apply (record + empty default + operator words) and after rollback/dry-run (none of them).
-- The hash/count items must equal the precheck values of the same name (no grant, policy, trigger or index change; no row added or removed;
-- other people's own lists and the operator's existing kinds unchanged). 행 값은 읽지 않고 개수·md5만.
-- 적용 뒤: 운영자 아닌 행 중 옛 기본값 그대로인 행 0(빈 목록으로 비움). 되돌린 뒤에는 비운 행이 빈 목록으로 남는다(rollback 설명).
with history as (
  select count(*) as n,count(*) filter(where name='weekly_meeting_words') as named from supabase_migrations.schema_migrations where version='20261117190000'
), dflt as (
  select pg_get_expr(d.adbin,d.adrelid) as e from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_profiles') and a.attname='weekly_hidden_meeting_kinds' and not a.attisdropped
), words as (
  select count(*) filter(where p.weekly_hidden_meeting_kinds && array['*상집*','*중집*','*집행위*','*집행국*','*상무집행*','*중앙집행*']::text[]) as any_n,
    count(*) filter(where p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls')) and p.weekly_hidden_meeting_kinds @> array['*상집*','*중집*','*집행위*','*집행국*','*상무집행*','*중앙집행*']::text[]) as op_all
  from public.app_profiles p
), olddefault as (
  select count(*) as n from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and p.weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위']::text[]
), stray as (
  select count(*) as n from public.app_profiles p,unnest(p.weekly_hidden_meeting_kinds) k where k like '*%*'
)
select 'default words and history agree' as item,case when
  (history.n=0 and (select count(*) from dflt where e='ARRAY[''궤도집행국회의''::text, ''본부집행위''::text]')=1 and words.any_n=0 and stray.n=0)
  or (history.n=1 and history.named=1 and (select count(*) from dflt where e='''{}''::text[]')=1 and words.any_n=1 and words.op_all=1 and stray.n=6 and olddefault.n=0) then '예' else '아니오' end as value
  from history,words,stray,olddefault
union all select 'operator profiles',(select count(*) from public.app_profiles p where p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls')))::text
union all select 'operator list hash (without words)',(select md5(coalesce(string_agg(array_to_string(array(select k from unnest(p.weekly_hidden_meeting_kinds) with ordinality u(k,n) where k not like '*%*' order by n),','),'|'),'')) from public.app_profiles p where p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls')))
union all select 'non-operator profiles with the old default or an empty list',(select count(*) from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and (cardinality(p.weekly_hidden_meeting_kinds)=0 or p.weekly_hidden_meeting_kinds=array['궤도집행국회의','본부집행위']::text[]))::text
union all select 'non-operator profiles with another list',(select count(*) from public.app_profiles p where not (p.user_id in (select m.user_id from public.app_workspace_members m where m.role='owner' and m.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature='calls'))) and cardinality(p.weekly_hidden_meeting_kinds)>0 and p.weekly_hidden_meeting_kinds<>array['궤도집행국회의','본부집행위']::text[])::text
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity) then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'profiles rows',count(*)::text from public.app_profiles
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_profiles'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_profiles') and not tgisinternal;
