-- SELECT only. Counts and hashes; no title, id or time value. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / RLS enabled 예 / anon or public table privilege 아니오 / star equals archive rows 0.
-- 'archive only rows to move'는 별표로 옮길 줄 수(보관만 있고 별표 없음), 'starred rows'는 별표 줄 수(기록만, 적용 뒤 늘어나는 것이 정상이라 사후 확인에는 없음).
-- 나머지 행 수·해시는 사후 확인과 같은 값이어야 한다(starred_at 밖의 칸, 권한·정책·트리거·제약 변경 없음, 행 추가·삭제 없음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: star equals archive rows = 0
-- expect: archive only rows to move = 기록
-- expect: starred rows = 기록
-- expect: marks rows = 기록
-- expect: archived rows = 기록
-- expect: other columns hash = 기록
-- expect: constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261115150000' and name='outside_for_all')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261119120000') then '예' else '아니오' end
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_outside_article_marks') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_outside_article_marks','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_outside_article_marks') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'star equals archive rows',(select count(*) from public.app_outside_article_marks where archived_at is not null and starred_at=archived_at)::text
union all select 'archive only rows to move',(select count(*) from public.app_outside_article_marks where archived_at is not null and starred_at is null)::text
union all select 'starred rows',(select count(*) from public.app_outside_article_marks where starred_at is not null)::text
union all select 'marks rows',(select count(*) from public.app_outside_article_marks)::text
union all select 'archived rows',(select count(*) from public.app_outside_article_marks where archived_at is not null)::text
union all select 'other columns hash',md5(coalesce(string_agg(workspace_id::text||':'||article_id::text||':'||coalesce(archived_at::text,'')||':'||coalesce(dismissed_at::text,'')||':'||created_at::text||':'||updated_at::text,',' order by workspace_id,article_id),'')) from public.app_outside_article_marks
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_outside_article_marks')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_outside_article_marks')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_outside_article_marks') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_outside_article_marks')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_outside_article_marks') and not tgisinternal;
