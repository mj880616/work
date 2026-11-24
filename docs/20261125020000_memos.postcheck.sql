-- SELECT only. Works after apply (record + new table) and after rollback/dry-run (no record + no new table).
-- The existing-table count/hash items must equal the precheck values of the same name (columns, constraints, policies, grants and
-- triggers of app_notes and app_note_comments unchanged; no note comment row added or removed — the old table is kept as it is).
-- After apply also: RLS on the new table, four authenticated owner policies, no anon/PUBLIC/service_role privilege, update on body·updated_at only,
-- every old note comment copied (same id, note, workspace and text).
with history as (
  select count(*) as n,count(*) filter(where name='memos') as named from supabase_migrations.schema_migrations where version='20261125020000'
)
select 'new table and history agree' as item,case when (history.n=0 and to_regclass('public.app_memos') is null)
  or (history.n=1 and history.named=1 and to_regclass('public.app_memos') is not null) then '예' else '아니오' end as value
  from history
union all select 'new table RLS enabled',case when to_regclass('public.app_memos') is null
  or exists(select 1 from pg_class where oid=to_regclass('public.app_memos') and relrowsecurity) then '예' else '아니오' end
union all select 'new table four owner policies',case when to_regclass('public.app_memos') is null
  or ((select count(*) from pg_policy where polrelid=to_regclass('public.app_memos'))=4
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_memos') and polroles=array['authenticated'::regrole]::oid[])=4) then '예' else '아니오' end
union all select 'new table no anon public or server privilege',case when to_regclass('public.app_memos') is null
  or (not exists(select 1 from pg_class where oid=to_regclass('public.app_memos') and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_memos') and attacl::text ~ '(^|[{,])(anon|service_role)?=')) then '예' else '아니오' end
union all select 'authenticated updates text only',case when to_regclass('public.app_memos') is null
  or (has_column_privilege('authenticated','public.app_memos','body','update')
  and not has_column_privilege('authenticated','public.app_memos','target_type','update')
  and not has_column_privilege('authenticated','public.app_memos','target_id','update')
  and not has_column_privilege('authenticated','public.app_memos','workspace_id','update')
  and not has_column_privilege('authenticated','public.app_memos','target_title','update')) then '예' else '아니오' end
union all select 'old comments all copied',case when to_regclass('public.app_memos') is null
  or not exists(select 1 from public.app_note_comments c where not exists(select 1 from public.app_memos m
    where m.id=c.id and m.target_type='note' and m.target_id=c.note_id and m.workspace_id=c.workspace_id and m.body=c.body)) then '예' else '아니오' end
union all select 'note comments rows',count(*)::text from public.app_note_comments
union all select 'existing tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments')) and attnum>0 and not attisdropped
union all select 'existing tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments'))
union all select 'existing tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments'))
union all select 'existing tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments'))
union all select 'existing tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_notes'),to_regclass('public.app_note_comments')) and not tgisinternal;
