-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·권한·정책·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous step applied = 예
-- expect: title_tried_at column absent = 예
-- expect: items RLS on, no anon privilege, no authenticated insert/delete or title update = 예
-- expect: items rows = 기록
-- expect: foreign items rows = 기록
-- expect: items grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261108140000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261101233000' and name='news_clipping')=1 and to_regclass('public.app_news_items') is not null then '예' else '아니오' end
union all select 'title_tried_at column absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_items') and attname='title_tried_at' and not attisdropped) then '예' else '아니오' end
union all select 'items RLS on, no anon privilege, no authenticated insert/delete or title update',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_items') and relrowsecurity) and not has_any_column_privilege('anon','public.app_news_items','select,insert,update,references') and not has_table_privilege('authenticated','public.app_news_items','insert,update,delete') and not has_column_privilege('authenticated','public.app_news_items','title','update') then '예' else '아니오' end
union all select 'items rows',(select count(*)::text from public.app_news_items)
union all select 'foreign items rows',(select count(*)::text from public.app_news_items where lang<>'ko')
union all select 'items grants policies triggers hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_news_items')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_news_items')),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_news_items') and not t.tgisinternal),''));
