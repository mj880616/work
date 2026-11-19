-- SELECT only. Works after apply (record present, no archive-only row left) and after rollback/dry-run (no record).
-- No title, id or time value is shown: only yes/no, counts and hashes.
-- The count/hash items must equal the precheck values of the same name (only starred_at of archive-only rows changes; no grant, policy, trigger or constraint change; no row added or removed).
with h as (select count(*) filter (where name='outside_archive_to_star') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261119120000')
select 'move agrees with history' as item,case
  when h.n=1 and h.named=1 then case when exists(select 1 from public.app_outside_article_marks where archived_at is not null and starred_at is null) then '아니오' else '예' end
  when h.n=0 then '예' else '아니오' end as value
  from h
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_outside_article_marks') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_outside_article_marks','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_outside_article_marks') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
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
