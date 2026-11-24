-- SELECT only. Works after apply (record + new table) and after rollback/dry-run (no record + no new table).
-- The existing-table hash/count items must equal the precheck values of the same name (columns, constraints, policies, grants and
-- triggers of app_share_pages, app_share_page_links and app_notes unchanged; no share page or link row added or removed).
-- After apply also: RLS on the new table, one authenticated owner policy, no anon/PUBLIC privilege, service_role reads page_id·note_id only.
with history as (
  select count(*) as n,count(*) filter(where name='note_share_pages') as named from supabase_migrations.schema_migrations where version='20261124220000'
)
select 'new table and history agree' as item,case when (history.n=0 and to_regclass('public.app_note_share_pages') is null)
  or (history.n=1 and history.named=1 and to_regclass('public.app_note_share_pages') is not null) then '예' else '아니오' end as value
  from history
union all select 'new table RLS enabled',case when to_regclass('public.app_note_share_pages') is null
  or exists(select 1 from pg_class where oid=to_regclass('public.app_note_share_pages') and relrowsecurity) then '예' else '아니오' end
union all select 'new table one owner policy',case when to_regclass('public.app_note_share_pages') is null
  or ((select count(*) from pg_policy where polrelid=to_regclass('public.app_note_share_pages'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_note_share_pages') and polroles=array['authenticated'::regrole]::oid[])=1) then '예' else '아니오' end
union all select 'new table no anon or public privilege',case when to_regclass('public.app_note_share_pages') is null
  or (not exists(select 1 from pg_class where oid=to_regclass('public.app_note_share_pages') and relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_note_share_pages') and attacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'service_role reads two columns only',case when to_regclass('public.app_note_share_pages') is null
  or (has_column_privilege('service_role','public.app_note_share_pages','page_id','select')
  and has_column_privilege('service_role','public.app_note_share_pages','note_id','select')
  and not has_column_privilege('service_role','public.app_note_share_pages','workspace_id','select')
  and not has_table_privilege('service_role','public.app_note_share_pages','insert,update,delete')) then '예' else '아니오' end
union all select 'authenticated cannot update',case when to_regclass('public.app_note_share_pages') is null
  or not has_any_column_privilege('authenticated','public.app_note_share_pages','update') then '예' else '아니오' end
union all select 'share pages rows',count(*)::text from public.app_share_pages
union all select 'share links rows',count(*)::text from public.app_share_page_links
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'),to_regclass('public.app_notes')) and attnum>0 and not attisdropped
union all select 'existing tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'),to_regclass('public.app_notes'))
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'),to_regclass('public.app_notes'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'),to_regclass('public.app_notes'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_share_pages'),to_regclass('public.app_share_page_links'),to_regclass('public.app_notes')) and not tgisinternal;
