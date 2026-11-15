-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(pg_catalog만 읽음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 소식 표의 줄 수·권한·정책 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous step applied = 예
-- expect: context function absent = 예
-- expect: feed items rows = 기록
-- expect: feed items grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261028030000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024140000' and name='call_tg_feed')=1 and to_regclass('public.app_feed_items') is not null then '예' else '아니오' end
union all select 'context function absent',case when to_regprocedure('public.app_feed_room_day_context(uuid,text,date)') is null then '예' else '아니오' end
union all select 'feed items rows',(select count(*)::text from public.app_feed_items)
union all select 'feed items grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_feed_items')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_feed_items')),''));
