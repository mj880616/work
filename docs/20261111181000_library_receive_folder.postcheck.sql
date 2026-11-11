-- SELECT only. Works after apply (record + column, FK, index, definer function without execute grants, enabled trigger)
-- and after rollback/dry-run (no record and none of them). pg_catalog와 migration 기록만 읽는다.
-- The hash items must equal the precheck values of the same name (no grant, policy, old column, old constraint or old trigger change).
with p as (select to_regclass('public.app_profiles') as r),
     d as (select to_regclass('public.app_documents') as r),
     f as (select to_regclass('public.app_library_folders') as r),
     i as (select to_regclass('public.app_library_folder_items') as r),
     history as (
  select count(*) as n,count(*) filter(where name='library_receive_folder') as named from supabase_migrations.schema_migrations where version='20261111181000'
), parts as (
  select
    (select count(*) from pg_attribute where attrelid=(select r from p) and not attisdropped and attname='library_receive_folder' and atttypid='uuid'::regtype and not attnotnull) as col,
    (select count(*) from pg_constraint where conrelid=(select r from p) and conname='app_profiles_library_receive_folder_fkey' and contype='f'
       and confrelid=(select r from f) and confdeltype='n' and convalidated) as fk,
    (select count(*) from pg_index where indexrelid=to_regclass('public.app_profiles_library_receive_folder_idx') and indrelid=(select r from p)) as idx,
    (select count(*) from pg_proc where oid=to_regprocedure('private.app_documents_receive_folder()') and prosecdef and proconfig=array['search_path=""']
       and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('authenticated',oid,'execute')
       and not has_function_privilege('service_role',oid,'execute')) as fn,
    (select count(*) from pg_proc where oid=to_regprocedure('private.app_documents_receive_folder()')) as fn_any,
    (select count(*) from pg_trigger where tgrelid=(select r from d) and tgname='app_documents_receive_folder' and tgenabled='O'
       and tgfoid=to_regprocedure('private.app_documents_receive_folder()')) as trg,
    (select count(*) from pg_trigger where tgrelid=(select r from d) and tgname='app_documents_receive_folder') as trg_any
)
select 'receive folder parts and history agree' as item,case when
  (history.n=0 and parts.col=0 and parts.fk=0 and parts.idx=0 and parts.fn_any=0 and parts.trg_any=0)
  or (history.n=1 and history.named=1 and parts.col=1 and parts.fk=1 and parts.idx=1 and parts.fn=1 and parts.fn_any=1 and parts.trg=1 and parts.trg_any=1)
  then '예' else '아니오' end as value from history,parts
union all select 'profiles RLS still on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select r from p))
  and not exists(select 1 from pg_class where oid=(select r from p) and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_table_privilege('anon','public.app_profiles','select,insert,update,delete') then '예' else '아니오' end
union all select 'two owner policies',case when (select count(*) from pg_policy where polrelid=(select r from p))=2 then '예' else '아니오' end
union all select 'folder item document tables RLS and no anon or PUBLIC',case when not exists(select 1 from pg_class where oid in ((select r from f),(select r from i),(select r from d))
  and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'documents old triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=(select r from d) and not tgisinternal and tgname<>'app_documents_receive_folder'
union all select 'profiles policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from p)
union all select 'profiles table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from p)
union all select 'profiles old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select r from p) and attnum>0 and not attisdropped and attname<>'library_receive_folder'
union all select 'profiles old constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select r from p) and conname<>'app_profiles_library_receive_folder_fkey'
union all select 'folder items policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from i)
union all select 'folder items table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from i)
union all select 'folders policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select r from f)
union all select 'folders table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select r from f);
