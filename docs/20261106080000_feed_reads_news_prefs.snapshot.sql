-- SELECT only. Save before apply. pg_catalog와 migration 기록만 읽고 앱 표 행은 읽지 않는다.
-- 새 표·트리거 함수가 아직 없음, 화면 기억 검사 정의(8천 자를 넘어 md5·길이로 — 원문은 rollback 파일), 프로필 표의 정책·권한,
-- 이 표가 가리키는 두 글 표의 정책·트리거 개수·권한 해시(바뀌지 않아야 함)를 기록한다(되돌린 뒤 같은지 대조).
select 'table' as kind,n as name,coalesce(to_regclass(n)::text,'absent') as definition
  from unnest(array['public.app_feed_reads','public.app_outside_posts','public.app_news_items','public.app_profiles']) n
union all select 'function',n,coalesce(to_regprocedure(n)::text,'absent')
  from unnest(array['private.app_feed_reads_scope_guard()','private.app_is_workspace_owner(uuid)']) n
union all select 'profiles constraint',conname,case when conname='app_profiles_view_prefs_check' then 'md5:'||md5(pg_get_constraintdef(oid))||':length='||length(pg_get_constraintdef(oid)) else pg_get_constraintdef(oid) end
  from pg_constraint where conrelid=to_regclass('public.app_profiles')
union all select 'profiles policy',polname,polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),'')
  from pg_policy where polrelid=to_regclass('public.app_profiles')
union all select 'profiles owner RLS grants',relname,relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'none')
  from pg_class where oid=to_regclass('public.app_profiles')
union all select 'item table policies',c.relname::text,(select count(*) from pg_policy p where p.polrelid=c.oid)::text
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'))
union all select 'item table triggers',c.relname::text,(select count(*) from pg_trigger g where g.tgrelid=c.oid and not g.tgisinternal)::text
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'))
union all select 'item table ACL md5',c.relname::text,md5(coalesce(c.relacl::text,'none'))
  from pg_class c where c.oid in (to_regclass('public.app_outside_posts'),to_regclass('public.app_news_items'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261105131500','20261106080000')
order by 1,2;
