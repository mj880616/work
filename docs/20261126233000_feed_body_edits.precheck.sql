-- SELECT only. Aggregates and hashes; no title, address or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisites recorded 예 / new migration absent 예 / new table absent 예 / article tables present 예 / owner check function 예.
-- 그 밖의 해시는 사후 확인과 같은 값이어야 한다(기록만: 공용 글 두 표의 칸·정책·표 권한·트리거는 바뀌지 않는다).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: new table absent = 예
-- expect: article tables present = 예
-- expect: owner check function = 예
-- expect: article columns hash = 기록
-- expect: article policies hash = 기록
-- expect: article table grants hash = 기록
-- expect: article triggers hash = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261115100000' and name='news_for_all') or (version='20261115150000' and name='outside_for_all'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261126233000') then '예' else '아니오' end
union all select 'new table absent',case when to_regclass('public.app_feed_body_edits') is null then '예' else '아니오' end
union all select 'article tables present',case when to_regclass('public.app_news_articles') is not null and to_regclass('public.app_outside_articles') is not null and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'article columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(attacl::text,''),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles')) and attnum>0 and not attisdropped
union all select 'article policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles'))
union all select 'article table grants hash',md5(coalesce(string_agg(relname||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles'))
union all select 'article triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles')) and not tgisinternal;
