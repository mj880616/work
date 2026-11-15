-- SELECT only. Run before dry-run/apply (also the before/after comparison for postcheck). Aggregates and hashes; no row text.
-- 읽기 전용 역할(표 소유자 아님)에서 돈다: information_schema 대신 pg_catalog만 읽는다.
-- 적용 전 기대: 앞 단계(20261024140000, 20261025200000) 적용됨, 새 표 둘·새 함수 없음, 소유자 확인 함수 있음.
--   통화 두 표(업무 app_feed_items, 개인 app_call_personal)의 줄 수와 권한·정책 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: feed items rows = 기록
-- expect: call personal rows = 기록
-- expect: call tables grants policies hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261026120000') then '예' else '아니오' end as value
union all select 'previous steps applied (feed table, personal box)',case when (select count(*) from supabase_migrations.schema_migrations where version='20261024140000' and name='call_tg_feed')=1 and (select count(*) from supabase_migrations.schema_migrations where version='20261025200000' and name='call_personal_box')=1 and to_regclass('public.app_feed_items') is not null and to_regclass('public.app_call_personal') is not null then '예' else '아니오' end
union all select 'new tables and function absent',case when to_regclass('public.app_call_edits') is null and to_regclass('public.app_call_edit_history') is null and to_regprocedure('public.app_call_edit(uuid,jsonb)') is null then '예' else '아니오' end
union all select 'organizations table present',case when to_regclass('public.app_suborganizations') is not null then '예' else '아니오' end
union all select 'owner check function exists (definer)',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'feed items rows',(select count(*)::text from public.app_feed_items)
union all select 'call personal rows',(select count(*)::text from public.app_call_personal)
union all select 'call tables grants policies hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal')) ),'')
  ||coalesce((select string_agg(c.relname::text||'.'||a.attname::text||':'||a.attacl::text,',' order by c.relname,a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid where a.attrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal')) and a.attnum>0 and not a.attisdropped and a.attacl is not null),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid in(to_regclass('public.app_feed_items'),to_regclass('public.app_call_personal'))),''));
