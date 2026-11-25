-- SELECT only. Works after apply (record + new tables + one blog row) and after rollback/dry-run (no record + no new tables + no blog row).
-- The existing-table hash/count items must equal the precheck values of the same name (columns, policies, grants and triggers of
-- app_share_pages, app_notes and app_operator_features unchanged; no share page row added or removed).
-- After apply also: RLS on the three new tables, four authenticated policies each, no anon/PUBLIC privilege, service_role reads only, blog row = calls workspace.
with history as (
  select count(*) as n,count(*) filter(where name='blog_tables') as named from supabase_migrations.schema_migrations where version='20261125113100'
), present as (
  select count(*) as n from unnest(array['app_blogs','app_blog_boards','app_blog_posts']) t where to_regclass('public.'||t) is not null
)
select 'new tables and history agree' as item,case when (history.n=0 and present.n=0 and not exists(select 1 from public.app_operator_features where feature::text='blog'))
  or (history.n=1 and history.named=1 and present.n=3) then '예' else '아니오' end as value
  from history,present
union all select 'new tables RLS enabled',case when (select count(*) from pg_class where oid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts')) and not relrowsecurity)=0 then '예' else '아니오' end
union all select 'new tables four owner policies each',case when (select count(*) from pg_policy where polrelid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts')))
  =(select count(*) from pg_policy where polrelid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts')) and polroles=array['authenticated'::regrole]::oid[])
  and (select count(*) from pg_policy where polrelid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts')))
  =4*(select count(*) from unnest(array['app_blogs','app_blog_boards','app_blog_posts']) t where to_regclass('public.'||t) is not null) then '예' else '아니오' end
union all select 'new tables no anon or public privilege',case when not exists(select 1 from pg_class where oid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts')) and relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_attribute where attrelid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts')) and attacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'service_role reads only',case when not exists(select 1 from pg_class c where c.oid in (to_regclass('public.app_blogs'),to_regclass('public.app_blog_boards'),to_regclass('public.app_blog_posts'))
  and (has_table_privilege('service_role',c.oid,'insert,update,delete,truncate') or has_any_column_privilege('service_role',c.oid,'insert,update'))) then '예' else '아니오' end
union all select 'blog row on calls workspace',case when (select count(*) from public.app_operator_features where feature::text='blog')=0
  or ((select count(*) from public.app_operator_features where feature::text='blog')=1 and exists(select 1 from public.app_operator_features d join public.app_operator_features c
  on c.workspace_id=d.workspace_id and c.feature::text='calls' where d.feature::text='blog')) then '예' else '아니오' end
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features')) and attnum>0 and not attisdropped
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_notes'),to_regclass('public.app_operator_features')) and not tgisinternal;
