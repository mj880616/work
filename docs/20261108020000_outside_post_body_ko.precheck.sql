-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·권한·정책·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous step applied = 예
-- expect: body_ko column and check absent = 예
-- expect: posts RLS on, no anon privilege, no authenticated write = 예
-- expect: posts rows = 기록
-- expect: foreign posts rows = 기록
-- expect: posts grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261108020000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261031230000' and name='outside_statements')=1 and to_regclass('public.app_outside_posts') is not null then '예' else '아니오' end
union all select 'body_ko column and check absent',case when not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attname='body_ko' and not attisdropped) and not exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_outside_posts') and conname='app_outside_posts_body_ko_check') then '예' else '아니오' end
union all select 'posts RLS on, no anon privilege, no authenticated write',case when exists(select 1 from pg_class where oid=to_regclass('public.app_outside_posts') and relrowsecurity) and not has_any_column_privilege('anon','public.app_outside_posts','select,insert,update,references') and not has_any_column_privilege('authenticated','public.app_outside_posts','insert,update') and not has_table_privilege('authenticated','public.app_outside_posts','delete') then '예' else '아니오' end
union all select 'posts rows',(select count(*)::text from public.app_outside_posts)
union all select 'foreign posts rows',(select count(*)::text from public.app_outside_posts where lang='en')
union all select 'posts grants policies triggers hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_outside_posts')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_outside_posts')),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_outside_posts') and not t.tgisinternal),''));
