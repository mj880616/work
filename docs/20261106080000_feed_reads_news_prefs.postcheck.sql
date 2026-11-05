-- SELECT only. pg_catalog와 migration 기록만 읽는다(새 표·프로필의 행 값·행 수를 읽지 않음). 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표·함수·검사가 함께 원래대로).
-- expect: table, guard and history agree = 예
-- expect: RLS on, owner select/insert/delete policies for authenticated = 예
-- expect: no anon, PUBLIC or service_role privileges = 예
-- expect: authenticated select, column insert, delete, no update = 예
-- expect: guard: invoker, empty search_path, nobody executes, one trigger = 예
-- expect: cascade with the item and workspace, one row per item = 예
-- expect: view prefs check and history agree = 예
-- expect: profiles RLS on, two policies, no anon = 예
-- expect: no other DB function names the new table = 예
with t as (select to_regclass('public.app_feed_reads') as r,to_regprocedure('private.app_feed_reads_scope_guard()') as g),
history as (select count(*) filter(where name='feed_reads_news_prefs') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261106080000'),
checks as (select count(*) filter(where c.convalidated) as valid,count(*) as n,
    count(*) filter(where pg_get_constraintdef(c.oid) ~ 'news_tab' and pg_get_constraintdef(c.oid) ~ 'news_font') as with_new,
    count(*) filter(where pg_get_constraintdef(c.oid) !~ 'news_tab' and pg_get_constraintdef(c.oid) !~ 'news_font') as without_new,
    count(*) filter(where pg_get_constraintdef(c.oid) ~ 'org_order' and pg_get_constraintdef(c.oid) ~ 'report_calendar' and pg_get_constraintdef(c.oid) ~ 'now_tab'
      and pg_get_constraintdef(c.oid) ~ 'photo_zoom' and pg_get_constraintdef(c.oid) ~ 'note_sort' and pg_get_constraintdef(c.oid) ~ 'files_two') as with_old
  from pg_constraint c where c.conrelid=to_regclass('public.app_profiles') and c.conname='app_profiles_view_prefs_check')
select 'table, guard and history agree' as item,case when
  (history.n=0 and t.r is null and t.g is null)
  or (history.n=1 and history.named=1 and t.r is not null and t.g is not null)
  then '예' else '아니오' end as value
  from t,history
union all select 'RLS on, owner select/insert/delete policies for authenticated',case when (select r from t) is null or (
  (select relrowsecurity and not relforcerowsecurity from pg_class where oid=(select r from t))
  and (select count(*) from pg_policy where polrelid=(select r from t))=3
  and (select count(*) from pg_policy where polrelid=(select r from t) and polpermissive and polroles=array['authenticated'::regrole]::oid[]
       and polcmd in ('r','a','d') and coalesce(pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid)) ~ 'app_is_workspace_owner')=3
  and (select count(distinct polcmd) from pg_policy where polrelid=(select r from t))=3) then '예' else '아니오' end
union all select 'no anon, PUBLIC or service_role privileges',case when (select r from t) is null or (
  not exists(select 1 from pg_class where oid=(select r from t) and coalesce(relacl::text,'') ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select r from t) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not has_table_privilege('anon',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from t),'select,insert,update,references')
  and not has_table_privilege('service_role',(select r from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select r from t),'select,insert,update,references')) then '예' else '아니오' end
union all select 'authenticated select, column insert, delete, no update',case when (select r from t) is null or (
  has_table_privilege('authenticated',(select r from t),'select')
  and has_table_privilege('authenticated',(select r from t),'delete')
  and not has_table_privilege('authenticated',(select r from t),'insert,update,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select r from t),'update,references')
  and has_column_privilege('authenticated',(select r from t),'workspace_id','insert')
  and has_column_privilege('authenticated',(select r from t),'outside_post_id','insert')
  and has_column_privilege('authenticated',(select r from t),'news_item_id','insert')
  and not has_column_privilege('authenticated',(select r from t),'id','insert')
  and not has_column_privilege('authenticated',(select r from t),'read_at','insert')) then '예' else '아니오' end
union all select 'guard: invoker, empty search_path, nobody executes, one trigger',case when (select g from t) is null or (
  (select not prosecdef and proconfig=array['search_path=""'] from pg_proc where oid=(select g from t))
  and not has_function_privilege('authenticated',(select g from t),'execute')
  and not has_function_privilege('anon',(select g from t),'execute')
  and not has_function_privilege('service_role',(select g from t),'execute')
  and (select count(*) from pg_trigger where tgrelid=(select r from t) and not tgisinternal and tgfoid=(select g from t))=1
  and (select count(*) from pg_trigger where tgrelid=(select r from t) and not tgisinternal)=1) then '예' else '아니오' end
union all select 'cascade with the item and workspace, one row per item',case when (select r from t) is null or (
  (select count(*) from pg_constraint where conrelid=(select r from t) and contype='f' and confdeltype='c'
     and confrelid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'),to_regclass('public.app_workspaces')))=3
  and (select count(*) from pg_constraint where conrelid=(select r from t) and contype='u')=2
  and (select count(*) from pg_constraint where conrelid=(select r from t) and contype='c')=1) then '예' else '아니오' end
union all select 'view prefs check and history agree',case when checks.n=1 and checks.valid=1 and checks.with_old=1 and (
  (history.n=0 and checks.without_new=1) or (history.n=1 and history.named=1 and checks.with_new=1)) then '예' else '아니오' end
  from history,checks
union all select 'profiles RLS on, two policies, no anon',case when exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relrowsecurity)
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_profiles'))=2
  and not has_table_privilege('anon','public.app_profiles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'no other DB function names the new table',case when not exists(select 1 from pg_proc
  where prosrc ~ 'app_feed_reads' and oid<>coalesce((select g from t),0)) then '예' else '아니오' end;
