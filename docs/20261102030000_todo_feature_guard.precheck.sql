-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no row text, no ids.
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 앞 migration(운영자 허용 표·텔레그램 후보·텔레그램 방) 적용됨, 가드 함수·판정 함수 있음, 두 표에 새 정책·트리거 없음,
--   운영자(텔레그램 허용) 작업공간 밖의 텔레그램 후보 줄·텔레그램 방 줄이 0(아니면 트리거가 그 줄 수정까지 막으므로 멈춤).
--   줄 수·기존 정책·표 권한·기존 트리거·함수 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(새 정책·트리거 이름은 해시에서 뺌).
-- expect: telegram candidates outside operator workspace = 0
-- expect: ask rooms outside operator workspace = 0
-- expect: app_todo_candidates rows = 기록
-- expect: app_todo_candidates telegram rows = 기록
-- expect: app_todo_ask_rooms rows = 기록
-- expect: existing policies hash = 기록
-- expect: table grants and RLS hash = 기록
-- expect: existing triggers hash = 기록
-- expect: guard function hash = 기록
-- expect: feature check function hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261102030000') then '예' else '아니오' end as value
union all select 'previous steps applied (operator features, telegram candidates, ask rooms)',case when (select count(*) from supabase_migrations.schema_migrations where (version='20261029090000' and name='operator_features') or (version='20261029120000' and name='todo_candidates_telegram') or (version='20261029210000' and name='todo_mine_only'))=3 then '예' else '아니오' end
union all select 'six todo tables and allow table present',case when (select count(*) from pg_class where oid in(to_regclass('public.app_todo_candidates'),to_regclass('public.app_todo_ask_rooms'),to_regclass('public.app_todo_radar_state'),to_regclass('public.app_todo_not_mine'),to_regclass('public.app_todo_feedback'),to_regclass('public.app_todo_rules'),to_regclass('public.app_operator_features')))=7 then '예' else '아니오' end
union all select 'guard and feature check functions exist (definer)',case when (select count(*) from pg_proc where oid in(to_regprocedure('private.app_operator_feature_guard()'),to_regprocedure('private.app_workspace_has_feature(uuid,text)')) and prosecdef)=2 then '예' else '아니오' end
union all select 'new policies and triggers absent on two tables',case when not exists(select 1 from pg_policy where polname='op_feature_read' and polrelid in(to_regclass('public.app_todo_candidates'),to_regclass('public.app_todo_ask_rooms'))) and not exists(select 1 from pg_trigger where tgname='trg_op_feature_guard' and tgrelid in(to_regclass('public.app_todo_candidates'),to_regclass('public.app_todo_ask_rooms'))) then '예' else '아니오' end
union all select 'telegram candidates outside operator workspace',(select count(*)::text from public.app_todo_candidates c where c.source_kind='telegram' and not exists(select 1 from public.app_operator_features f where f.workspace_id=c.workspace_id and f.feature='telegram'))
union all select 'ask rooms outside operator workspace',(select count(*)::text from public.app_todo_ask_rooms r where not exists(select 1 from public.app_operator_features f where f.workspace_id=r.workspace_id and f.feature='telegram'))
union all select 'four other todo tables have no feature guard',case when not exists(select 1 from pg_policy where polname='op_feature_read' and polrelid in(to_regclass('public.app_todo_radar_state'),to_regclass('public.app_todo_not_mine'),to_regclass('public.app_todo_feedback'),to_regclass('public.app_todo_rules'))) and not exists(select 1 from pg_trigger where tgname='trg_op_feature_guard' and tgrelid in(to_regclass('public.app_todo_radar_state'),to_regclass('public.app_todo_not_mine'),to_regclass('public.app_todo_feedback'),to_regclass('public.app_todo_rules'))) then '예' else '아니오' end
union all select 'app_todo_candidates rows',(select count(*)::text from public.app_todo_candidates)
union all select 'app_todo_candidates telegram rows',(select count(*)::text from public.app_todo_candidates where source_kind='telegram')
union all select 'app_todo_ask_rooms rows',(select count(*)::text from public.app_todo_ask_rooms)
union all select 'existing policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in(to_regclass('public.app_todo_candidates'),to_regclass('public.app_todo_ask_rooms'),to_regclass('public.app_todo_radar_state'),to_regclass('public.app_todo_not_mine'),to_regclass('public.app_todo_feedback'),to_regclass('public.app_todo_rules')) and p.polname<>'op_feature_read'),''))
union all select 'table grants and RLS hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_todo_candidates'),to_regclass('public.app_todo_ask_rooms'),to_regclass('public.app_todo_radar_state'),to_regclass('public.app_todo_not_mine'),to_regclass('public.app_todo_feedback'),to_regclass('public.app_todo_rules'))),''))
union all select 'existing triggers hash',md5(coalesce((select string_agg(c.relname||':'||t.tgname::text||':'||t.tgenabled::text,',' order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in(to_regclass('public.app_todo_candidates'),to_regclass('public.app_todo_ask_rooms'),to_regclass('public.app_todo_radar_state'),to_regclass('public.app_todo_not_mine'),to_regclass('public.app_todo_feedback'),to_regclass('public.app_todo_rules')) and not t.tgisinternal and t.tgname<>'trg_op_feature_guard'),''))
union all select 'guard function hash',(select md5(p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||p.prosrc) from pg_proc p where p.oid=to_regprocedure('private.app_operator_feature_guard()'))
union all select 'feature check function hash',(select md5(p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||p.prosrc) from pg_proc p where p.oid=to_regprocedure('private.app_workspace_has_feature(uuid,text)'))
;
