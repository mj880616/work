-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·권한·정책·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous steps applied = 예
-- expect: seen column and function absent = 예
-- expect: room days guard trigger and restrictive policy present = 예
-- expect: room days rows = 기록
-- expect: room days grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029170000') then '예' else '아니오' end as value
union all select 'previous steps applied',case when (select count(*) from supabase_migrations.schema_migrations where (version='20261027010000' and name='tg_room_day_group') or (version='20261029090000' and name='operator_features'))=2 and to_regclass('public.app_feed_room_days') is not null and to_regprocedure('private.app_feed_owner_workspace()') is not null and to_regprocedure('private.app_workspace_has_feature(uuid,text)') is not null then '예' else '아니오' end
union all select 'seen column and function absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_feed_room_days') and attname='seen_at' and not attisdropped) and to_regprocedure('public.app_feed_room_day_seen(text,date)') is null then '예' else '아니오' end
union all select 'room days guard trigger and restrictive policy present',case when (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_feed_room_days') and tgname='trg_op_feature_guard' and not tgisinternal and tgenabled<>'D')=1 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_feed_room_days') and polname='op_feature_read' and not polpermissive)=1 then '예' else '아니오' end
union all select 'room days rows',(select count(*)::text from public.app_feed_room_days)
union all select 'room days grants policies triggers hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_feed_room_days')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_feed_room_days')),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_feed_room_days') and not t.tgisinternal),''));
