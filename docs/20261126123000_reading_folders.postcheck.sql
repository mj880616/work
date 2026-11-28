-- SELECT only. Works after apply (record + new table + new column) and after rollback/dry-run (no record, no new table, no new column).
-- The hash items must equal the precheck values of the same name (existing columns other than folder_id, constraints other than the new folder key,
-- policies, table-level grants and triggers of app_reading_items unchanged).
-- After apply also: RLS on the new table, one authenticated owner policy, no anon/PUBLIC/service_role privilege, update on parent_id·name·sort_order only,
-- parent key on (parent_id, workspace_id), tree guard and lift triggers on the new table calling invoker functions with fixed search_path and no execute grant,
-- folder key on (folder_id, workspace_id) with on delete set null (folder_id), authenticated may update folder_id but no other new privilege on it.
with history as (
  select count(*) as n,count(*) filter(where name='reading_folders') as named from supabase_migrations.schema_migrations where version='20261126123000'
), col as (
  select exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attname='folder_id' and not attisdropped) as has
)
select 'new table column and history agree' as item,case when (history.n=0 and to_regclass('public.app_reading_folders') is null and not col.has
    and to_regprocedure('private.app_reading_folder_tree_guard()') is null and to_regprocedure('private.app_reading_folder_lift()') is null)
  or (history.n=1 and history.named=1 and to_regclass('public.app_reading_folders') is not null and col.has
    and to_regprocedure('private.app_reading_folder_tree_guard()') is not null and to_regprocedure('private.app_reading_folder_lift()') is not null) then '예' else '아니오' end as value
  from history, col
union all select 'new table RLS enabled',case when to_regclass('public.app_reading_folders') is null then '예' when exists(select 1 from pg_class where oid=to_regclass('public.app_reading_folders') and relrowsecurity) then '예' else '아니오' end
union all select 'new table one owner policy',case when to_regclass('public.app_reading_folders') is null then '예' when ((select count(*) from pg_policy where polrelid=to_regclass('public.app_reading_folders'))=1
  and (select count(*) from pg_policy where polrelid=to_regclass('public.app_reading_folders') and polroles=array['authenticated'::regrole]::oid[] and polcmd='*' and polpermissive
    and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%' and pg_get_expr(polwithcheck,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1) then '예' else '아니오' end
union all select 'new table no anon public or server privilege',case when to_regclass('public.app_reading_folders') is null then '예' when (not exists(select 1 from pg_class where oid=to_regclass('public.app_reading_folders') and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_reading_folders') and attacl::text ~ '(^|[{,])(anon|service_role)?=')) then '예' else '아니오' end
union all select 'authenticated updates parent name and order only',case when to_regclass('public.app_reading_folders') is null then '예' when (has_column_privilege('authenticated','public.app_reading_folders','parent_id','update')
  and has_column_privilege('authenticated','public.app_reading_folders','name','update')
  and has_column_privilege('authenticated','public.app_reading_folders','sort_order','update')
  and not has_column_privilege('authenticated','public.app_reading_folders','workspace_id','update')
  and not has_column_privilege('authenticated','public.app_reading_folders','id','update')
  and not has_column_privilege('authenticated','public.app_reading_folders','created_at','update')) then '예' else '아니오' end
union all select 'parent key same workspace',case when to_regclass('public.app_reading_folders') is null then '예' when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_reading_folders') and conname='app_reading_folders_parent_fkey' and contype='f' and confrelid=to_regclass('public.app_reading_folders')
    and pg_get_constraintdef(oid) ~* 'FOREIGN KEY \(parent_id, workspace_id\) REFERENCES (public\.)?app_reading_folders\(id, workspace_id\) ON DELETE CASCADE') then '예' else '아니오' end
union all select 'tree triggers on new table only',case when to_regclass('public.app_reading_folders') is null then '예' when (select count(*) from pg_trigger t where t.tgrelid=to_regclass('public.app_reading_folders') and not t.tgisinternal and t.tgenabled='O'
    and ((t.tgname='app_reading_folders_tree_guard' and t.tgfoid=to_regprocedure('private.app_reading_folder_tree_guard()'))
      or (t.tgname='app_reading_folders_lift_on_delete' and t.tgfoid=to_regprocedure('private.app_reading_folder_lift()'))))=2
  and (select count(*) from pg_trigger t where t.tgrelid=to_regclass('public.app_reading_folders') and not t.tgisinternal)=2 then '예' else '아니오' end
union all select 'tree functions invoker fixed path no execute grant',case when to_regclass('public.app_reading_folders') is null then '예' when (select count(*) from pg_proc p where p.oid in (to_regprocedure('private.app_reading_folder_tree_guard()'),to_regprocedure('private.app_reading_folder_lift()'))
    and not p.prosecdef and 'search_path=""'=any(p.proconfig)
    and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute'))=2 then '예' else '아니오' end
union all select 'folder key same workspace set null',case when not (select has from col) then '예' when exists(select 1 from pg_constraint where conrelid=to_regclass('public.app_reading_items') and conname='app_reading_items_folder_fkey' and contype='f' and confrelid=to_regclass('public.app_reading_folders')
    and pg_get_constraintdef(oid) ~* 'FOREIGN KEY \(folder_id, workspace_id\) REFERENCES (public\.)?app_reading_folders\(id, workspace_id\) ON DELETE SET NULL \(folder_id\)') then '예' else '아니오' end
union all select 'folder column update only for authenticated',case when not (select has from col) then '예' when (has_column_privilege('authenticated','public.app_reading_items','folder_id','update')
  and not exists(select 1 from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attname='folder_id' and attacl::text ~ '(^|[{,])(anon|service_role)?=')
  and (select attacl::text from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attname='folder_id') ~ '^\{authenticated=w/[a-z_]+\}$') then '예' else '아니오' end
union all select 'reading columns hash',md5(coalesce(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=to_regclass('public.app_reading_items') and attnum>0 and not attisdropped and attname<>'folder_id'
union all select 'reading constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_reading_items') and conname<>'app_reading_items_folder_fkey'
union all select 'reading policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_reading_items')
union all select 'reading table grants hash',md5(coalesce((select relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,'') from pg_class where oid=to_regclass('public.app_reading_items')),''))
union all select 'reading triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_reading_items') and not tgisinternal;
