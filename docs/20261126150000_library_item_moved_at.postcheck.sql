-- SELECT only. Works after apply (record + column, invoker function without execute grants, enabled trigger)
-- and after rollback/dry-run (no record and none of them). pg_catalog와 migration 기록만 읽는다.
-- The hash items must equal the precheck values of the same name (no grant, policy, old column grant or old trigger change).
with i as (select to_regclass('public.app_library_folder_items') as r),
     history as (
  select count(*) as n,count(*) filter(where name='library_item_moved_at') as named from supabase_migrations.schema_migrations where version='20261126150000'
), parts as (
  select
    (select count(*) from pg_attribute where attrelid=(select r from i) and not attisdropped and attname='moved_at' and atttypid='timestamptz'::regtype and attnotnull and attacl is null) as col,
    (select count(*) from pg_attribute where attrelid=(select r from i) and not attisdropped and attname='moved_at') as col_any,
    (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_items_moved_at()') and not prosecdef and proconfig=array['search_path=""']
       and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute')
       and not has_function_privilege('service_role',oid,'execute')) as fn,
    (select count(*) from pg_proc where oid=to_regprocedure('private.app_library_folder_items_moved_at()')) as fn_any,
    (select count(*) from pg_trigger where tgrelid=(select r from i) and tgname='app_library_folder_items_moved_at' and tgenabled='O'
       and tgfoid=to_regprocedure('private.app_library_folder_items_moved_at()')) as trg,
    (select count(*) from pg_trigger where tgrelid=(select r from i) and tgname='app_library_folder_items_moved_at') as trg_any
)
select 'moved_at parts and history agree' as item,case when
  (history.n=0 and parts.col_any=0 and parts.fn_any=0 and parts.trg_any=0)
  or (history.n=1 and history.named=1 and parts.col=1 and parts.col_any=1 and parts.fn=1 and parts.fn_any=1 and parts.trg=1 and parts.trg_any=1)
  then '예' else '아니오' end as value from history,parts
union all select 'folder items RLS still on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select r from i))
  and not exists(select 1 from pg_class where oid=(select r from i) and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_table_privilege('anon','public.app_library_folder_items','select,insert,update,delete') then '예' else '아니오' end
union all select 'folder items insert update by column only',case when not has_table_privilege('authenticated','public.app_library_folder_items','insert')
  and not has_table_privilege('authenticated','public.app_library_folder_items','update') then '예' else '아니오' end
union all select 'one policy',case when (select count(*) from pg_policy where polrelid=(select r from i))=1 then '예' else '아니오' end
union all select 'folder items policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from i)
union all select 'folder items table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from i)
union all select 'folder items old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select r from i) and attnum>0 and not attisdropped and attname<>'moved_at'
union all select 'folder items old triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=(select r from i) and not tgisinternal and tgname<>'app_library_folder_items_moved_at';
