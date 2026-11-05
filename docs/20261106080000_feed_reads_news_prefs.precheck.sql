-- SELECT only. Run before dry-run/apply (SQL Editor, phone path C). pg_catalog와 migration 기록, 프로필 두 칸 유무(예/아니오)만 읽는다(글·기사 행 수·행 값을 읽지 않음).
-- 적용 전 기대: 아래 여덟 항목 모두 예. 해시·recent migrations는 기록만(화면 기억 검사 해시는 snapshot의 md5와 같은 값).
-- expect: new migration absent = 예
-- expect: prerequisite migrations = 예
-- expect: new table and guard absent = 예
-- expect: owner check function and workspaces table = 예
-- expect: item tables with uuid id and workspace_id = 예
-- expect: view prefs check is the org order version = 예
-- expect: no saved news tab or font = 예
-- expect: profiles RLS on, two policies, no anon = 예
-- expect: view prefs check definition hash = 기록
-- expect: recent migrations = 기록
select 'new migration absent' as item,case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261106080000') then '예' else '아니오' end as value
union all select 'prerequisite migrations',case when exists(select 1 from supabase_migrations.schema_migrations where version='20261031230000' and name='outside_statements')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261101233000' and name='news_clipping')
  and exists(select 1 from supabase_migrations.schema_migrations where version='20261105131500' and name='profile_view_prefs_org_order')
  and not exists(select 1 from supabase_migrations.schema_migrations where version>'20261105131500' and name like 'profile_view_prefs%') then '예' else '아니오' end
union all select 'new table and guard absent',case when to_regclass('public.app_feed_reads') is null
  and to_regprocedure('private.app_feed_reads_scope_guard()') is null then '예' else '아니오' end
union all select 'owner check function and workspaces table',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
  and to_regclass('public.app_workspaces') is not null then '예' else '아니오' end
union all select 'item tables with uuid id and workspace_id',case when
  (select count(*) from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.conrelid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items')) and c.contype='p'
      and array_length(c.conkey,1)=1 and a.attname='id' and a.atttypid='uuid'::regtype)=2
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_outside_posts') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped)
  and exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_news_items') and attname='workspace_id' and atttypid='uuid'::regtype and not attisdropped)
  and has_table_privilege('authenticated','public.app_outside_posts','select') and has_table_privilege('authenticated','public.app_news_items','select')
  then '예' else '아니오' end
union all select 'view prefs check is the org order version',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check' and contype='c' and convalidated
  and pg_get_constraintdef(oid) ~ 'org_order' and pg_get_constraintdef(oid) ~ 'report_calendar' and pg_get_constraintdef(oid) ~ 'now_tab' and pg_get_constraintdef(oid) ~ 'photo_zoom'
  and pg_get_constraintdef(oid) !~ 'news_tab' and pg_get_constraintdef(oid) !~ 'news_font')=1 then '예' else '아니오' end
union all select 'no saved news tab or font',case when not exists(select 1 from public.app_profiles where view_prefs ? 'news_tab' or view_prefs ? 'news_font') then '예' else '아니오' end
union all select 'profiles RLS on, two policies, no anon',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity)
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'view prefs check definition hash',coalesce((select md5(pg_get_constraintdef(oid))||':length='||length(pg_get_constraintdef(oid)) from pg_constraint where conrelid=to_regclass('public.app_profiles') and conname='app_profiles_view_prefs_check'),'absent')
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r);
