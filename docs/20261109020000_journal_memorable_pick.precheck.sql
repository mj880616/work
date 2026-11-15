-- SELECT only. Run before dry-run/apply. 읽기 전용 역할에서 돈다(카탈로그·기록·줄 수만 읽음, 줄 내용 없음).
-- 적용 전 기대: 예/아니오 항목은 모두 예. 줄 수·기존 소식 표 권한·정책·트리거 해시는 기록만 하고 사후 확인에서 같은 값이어야 한다.
-- expect: new migration absent = 예
-- expect: previous step applied = 예
-- expect: picks table absent = 예
-- expect: memorable rows = 기록
-- expect: memorable suggested rows = 기록
-- expect: memorable grants policies triggers hash = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261109020000') then '예' else '아니오' end as value
union all select 'previous step applied',case when (select count(*) from supabase_migrations.schema_migrations where version='20261103230000' and name='journal_memorable')=1 and to_regclass('public.app_journal_memorable') is not null and (select count(*) from pg_policy where polrelid=to_regclass('public.app_journal_memorable'))=2 then '예' else '아니오' end
union all select 'picks table absent',case when to_regclass('public.app_journal_memorable_picks') is null then '예' else '아니오' end
union all select 'memorable rows',(select count(*)::text from public.app_journal_memorable)
union all select 'memorable suggested rows',(select count(*)::text from public.app_journal_memorable where status='suggested')
union all select 'memorable grants policies triggers hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,''),',' order by c.relname) from pg_class c where c.oid=to_regclass('public.app_journal_memorable')),'')
  ||coalesce((select string_agg(a.attname::text||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=to_regclass('public.app_journal_memorable') and a.attnum>0 and not a.attisdropped),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_journal_memorable')),'')
  ||coalesce((select string_agg(t.tgname::text||':'||t.tgenabled::text||':'||t.tgfoid::regproc::text,',' order by t.tgname) from pg_trigger t where t.tgrelid=to_regclass('public.app_journal_memorable') and not t.tgisinternal),''));
