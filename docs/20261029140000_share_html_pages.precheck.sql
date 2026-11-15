-- SELECT only. Aggregates and hashes; no page title, HTML or link value. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / new tables absent 예 / link token hash unique 예 / owner check function 예.
--   그 밖의 해시·개수는 사후 확인과 같은 값이어야 한다(기록만: 기존 두 표의 칸·제약·정책·권한·트리거는 바뀌지 않는다).
-- 이 값이 다르면 적용하지 않고 멈춘다(권한·정책을 넓히지 않는다).
-- read_only 요청은 표 소유자가 아닌 역할로 돈다. 제약은 pg_constraint·pg_get_constraintdef로 읽는다(docs/ops-db-workflow.md 사전·사후 확인 절).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: new tables absent = 예
-- expect: link token hash unique = 예
-- expect: owner check function = 예
-- expect: share pages rows = 기록
-- expect: share links rows = 기록
-- expect: existing tables columns hash = 기록
-- expect: existing tables constraints hash = 기록
-- expect: existing tables policies hash = 기록
-- expect: existing tables grants hash = 기록
-- expect: existing tables triggers hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261020005000' and name='share_pages_links')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261029140000') then '예' else '아니오' end
union all select 'new tables absent',case when to_regclass('public.app_share_page_html') is null and to_regclass('public.app_share_page_slugs') is null then '예' else '아니오' end
union all select 'link token hash unique',case when (select count(*) from pg_constraint where conrelid=to_regclass('public.app_share_page_links') and conname='app_share_page_links_token_hash_key' and contype='u')=1 then '예' else '아니오' end
union all select 'owner check function',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'share links rows',count(*)::text from public.app_share_page_links
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links')) and attnum>0 and not attisdropped
union all select 'existing tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links')) and not tgisinternal;
