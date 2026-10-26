-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no row text.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 앞 단계(20261024140000) 적용됨, 새 표 둘·새 함수 넷 없음, 소유자 확인 함수 있음.
--   소식 표(app_feed_items)의 줄 수와 권한·정책 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: feed items rows = 기록
-- expect: feed table grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261026190000') then '예' else '아니오' end as value
union all select 'previous step applied (feed table)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024140000' and name='call_tg_feed')=1 and to_regclass('public.app_feed_items') is not null then '예' else '아니오' end
union all select 'new tables and functions absent',case when to_regclass('public.app_tg_senders') is null and to_regclass('public.app_tg_day_senders') is null and to_regprocedure('public.app_tg_senders_upsert(uuid,text,date,jsonb)') is null and to_regprocedure('public.app_tg_sender_set_name(text,date,text,text)') is null and to_regprocedure('public.app_tg_sender_merge(uuid,uuid)') is null and to_regprocedure('public.app_tg_sender_forget(uuid)') is null then '예' else '아니오' end
union all select 'workspace tables present',case when to_regclass('public.app_workspaces') is not null and to_regclass('public.app_workspace_members') is not null then '예' else '아니오' end
union all select 'owner check function exists (definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'feed items rows',(select count(*)::text from public.app_feed_items)
union all select 'feed table grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_feed_items')),'')
  ||coalesce((select string_agg(a.attname::text||':'||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_feed_items') and a.attnum>0 and not a.attisdropped and a.attacl is not null),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_feed_items')),''));
