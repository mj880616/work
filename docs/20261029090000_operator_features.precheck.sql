-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no row text, no ids.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 통화·텔레그램 migration이 모두 적용됨, 통화·텔레그램 표 12개 있음, 새 표·새 함수 넷 없음, 소유자 확인 함수 있음,
--   통화·텔레그램 자료가 든 작업공간이 정확히 1개이고 그 작업공간의 owner 행이 정확히 1개(이게 아니면 허용 행을 고를 수 없어 멈춤).
--   표 12개의 줄 수·기존 정책·권한·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다(새 정책·트리거 이름은 해시에서 뺌).
-- expect: app_feed_items rows = 기록
-- expect: app_feed_days rows = 기록
-- expect: app_call_personal rows = 기록
-- expect: app_call_edits rows = 기록
-- expect: app_call_edit_history rows = 기록
-- expect: app_tg_senders rows = 기록
-- expect: app_tg_day_senders rows = 기록
-- expect: app_feed_folders rows = 기록
-- expect: app_feed_rooms rows = 기록
-- expect: app_feed_room_days rows = 기록
-- expect: app_feed_summary_edits rows = 기록
-- expect: app_feed_summary_edit_history rows = 기록
-- expect: existing policies hash = 기록
-- expect: table grants and RLS hash = 기록
-- expect: existing triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029090000') then '예' else '아니오' end as value
union all select 'previous steps applied (summary edit, room day context)',case when (select count(*) from supabase_migrations.schema_migrations where (version='20261027200000' and name='tg_summary_edit') or (version='20261028030000' and name='tg_room_day_context'))=2 then '예' else '아니오' end
union all select 'twelve call and telegram tables present',case when (select count(*) from pg_class where oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'),to_regclass('public.app_call_personal'),to_regclass('public.app_call_edits'),to_regclass('public.app_call_edit_history'),to_regclass('public.app_tg_senders'),to_regclass('public.app_tg_day_senders'),to_regclass('public.app_feed_folders'),to_regclass('public.app_feed_rooms'),to_regclass('public.app_feed_room_days'),to_regclass('public.app_feed_summary_edits'),to_regclass('public.app_feed_summary_edit_history')))=12 then '예' else '아니오' end
union all select 'new table and functions absent',case when to_regclass('public.app_operator_features') is null and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is null and to_regprocedure('public.app_my_features()') is null and to_regprocedure('public.app_operator_feature_workspace(text)') is null and to_regprocedure('private.app_operator_feature_guard()') is null then '예' else '아니오' end
union all select 'owner check function exists (definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'call and telegram data in exactly one workspace',case when (select count(*) from (select workspace_id from public.app_feed_items union select workspace_id from public.app_feed_days union select workspace_id from public.app_call_personal) s)=1 then '예' else '아니오' end
union all select 'that workspace has exactly one owner row',case when (select count(*) from public.app_workspace_members m where m.role='owner' and m.workspace_id=(select s.workspace_id from (select workspace_id from public.app_feed_items union select workspace_id from public.app_feed_days union select workspace_id from public.app_call_personal) s limit 1))=1 then '예' else '아니오' end
union all select 'app_feed_items rows',(select count(*)::text from public.app_feed_items)
union all select 'app_feed_days rows',(select count(*)::text from public.app_feed_days)
union all select 'app_call_personal rows',(select count(*)::text from public.app_call_personal)
union all select 'app_call_edits rows',(select count(*)::text from public.app_call_edits)
union all select 'app_call_edit_history rows',(select count(*)::text from public.app_call_edit_history)
union all select 'app_tg_senders rows',(select count(*)::text from public.app_tg_senders)
union all select 'app_tg_day_senders rows',(select count(*)::text from public.app_tg_day_senders)
union all select 'app_feed_folders rows',(select count(*)::text from public.app_feed_folders)
union all select 'app_feed_rooms rows',(select count(*)::text from public.app_feed_rooms)
union all select 'app_feed_room_days rows',(select count(*)::text from public.app_feed_room_days)
union all select 'app_feed_summary_edits rows',(select count(*)::text from public.app_feed_summary_edits)
union all select 'app_feed_summary_edit_history rows',(select count(*)::text from public.app_feed_summary_edit_history)
union all select 'existing policies hash',md5(coalesce((select string_agg(c.relname||':'||p.polname::text||':'||p.polcmd::text||':'||p.polpermissive::text||':'||p.polroles::text||':'||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by c.relname,p.polname) from pg_policy p join pg_class c on c.oid=p.polrelid where p.polrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'),to_regclass('public.app_call_personal'),to_regclass('public.app_call_edits'),to_regclass('public.app_call_edit_history'),to_regclass('public.app_tg_senders'),to_regclass('public.app_tg_day_senders'),to_regclass('public.app_feed_folders'),to_regclass('public.app_feed_rooms'),to_regclass('public.app_feed_room_days'),to_regclass('public.app_feed_summary_edits'),to_regclass('public.app_feed_summary_edit_history')) and p.polname<>'op_feature_read'),''))
union all select 'table grants and RLS hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'),to_regclass('public.app_call_personal'),to_regclass('public.app_call_edits'),to_regclass('public.app_call_edit_history'),to_regclass('public.app_tg_senders'),to_regclass('public.app_tg_day_senders'),to_regclass('public.app_feed_folders'),to_regclass('public.app_feed_rooms'),to_regclass('public.app_feed_room_days'),to_regclass('public.app_feed_summary_edits'),to_regclass('public.app_feed_summary_edit_history'))),''))
union all select 'existing triggers hash',md5(coalesce((select string_agg(c.relname||':'||t.tgname::text||':'||t.tgenabled::text,',' order by c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_feed_days'),to_regclass('public.app_call_personal'),to_regclass('public.app_call_edits'),to_regclass('public.app_call_edit_history'),to_regclass('public.app_tg_senders'),to_regclass('public.app_tg_day_senders'),to_regclass('public.app_feed_folders'),to_regclass('public.app_feed_rooms'),to_regclass('public.app_feed_room_days'),to_regclass('public.app_feed_summary_edits'),to_regclass('public.app_feed_summary_edit_history')) and not t.tgisinternal and t.tgname<>'trg_op_feature_guard'),''));
