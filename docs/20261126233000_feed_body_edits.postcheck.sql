-- SELECT only. Works after apply (record + new table) and after rollback/dry-run (no record, no new table).
-- The hash items must equal the precheck values of the same name (columns, policies, table-level grants and triggers of the two shared article tables unchanged).
-- After apply also: RLS on the new table, one authenticated owner policy, no anon/PUBLIC/service_role privilege,
-- authenticated insert on workspace_id·news_article_id·outside_article_id·blocks·edited_at only, update on blocks·edited_at only, exactly-one-article check.
with history as (
  select count(*) as n,count(*) filter(where name='feed_body_edits') as named from supabase_migrations.schema_migrations where version='20261126233000'
), t as (select to_regclass('public.app_feed_body_edits') as rel)
select 'new table and history agree' as item,case when (history.n=0 and t.rel is null) or (history.n=1 and history.named=1 and t.rel is not null) then '예' else '아니오' end as value
  from history, t
union all select 'new table RLS enabled',case when (select rel from t) is null then '예' when exists(select 1 from pg_class where oid=(select rel from t) and relrowsecurity) then '예' else '아니오' end
union all select 'new table one owner policy',case when (select rel from t) is null then '예' when ((select count(*) from pg_policy where polrelid=(select rel from t))=1
  and (select count(*) from pg_policy where polrelid=(select rel from t) and polroles=array['authenticated'::regrole]::oid[] and polcmd='*' and polpermissive
    and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%' and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1) then '예' else '아니오' end
union all select 'new table no anon public or server privilege',case when (select rel from t) is null then '예' when (not exists(select 1 from pg_class where oid=(select rel from t) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select rel from t) and attacl::text ~ '(^|[{,])(anon|service_role)?=')) then '예' else '아니오' end
union all select 'authenticated insert and update columns only',case when (select rel from t) is null then '예' when (
  has_column_privilege('authenticated','public.app_feed_body_edits','blocks','update') and has_column_privilege('authenticated','public.app_feed_body_edits','edited_at','update')
  and not has_column_privilege('authenticated','public.app_feed_body_edits','workspace_id','update') and not has_column_privilege('authenticated','public.app_feed_body_edits','news_article_id','update')
  and not has_column_privilege('authenticated','public.app_feed_body_edits','outside_article_id','update') and not has_column_privilege('authenticated','public.app_feed_body_edits','id','update')
  and has_column_privilege('authenticated','public.app_feed_body_edits','workspace_id','insert') and has_column_privilege('authenticated','public.app_feed_body_edits','blocks','insert')
  and not has_column_privilege('authenticated','public.app_feed_body_edits','id','insert')
  and has_table_privilege('authenticated','public.app_feed_body_edits','select') and has_table_privilege('authenticated','public.app_feed_body_edits','delete')
  and not has_table_privilege('authenticated','public.app_feed_body_edits','truncate')) then '예' else '아니오' end
union all select 'exactly one article check',case when (select rel from t) is null then '예' when exists(select 1 from pg_constraint where conrelid=(select rel from t) and conname='app_feed_body_edits_one_article' and contype='c'
  and pg_get_constraintdef(oid) ~* 'num_nonnulls\(news_article_id, outside_article_id\) = 1') then '예' else '아니오' end
union all select 'article columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(attacl::text,''),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles')) and attnum>0 and not attisdropped
union all select 'article policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles'))
union all select 'article table grants hash',md5(coalesce(string_agg(relname||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),''))
  from pg_class where oid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles'))
union all select 'article triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_outside_articles')) and not tgisinternal;
