-- SELECT only. Works after apply (all 예, documents rows/hashes equal to precheck) and after rollback (history, tables and functions absent).
-- The documents rows/hashes match precheck only right after apply (before the screen starts tidying).
with h as (
  select count(*) as n,count(*) filter(where name='library_auto_tidy') as named from supabase_migrations.schema_migrations where version='20261022212757'
), o as (
  select to_regclass('public.app_library_tidy_backups') as b,to_regclass('public.app_library_tidy_attempts') as a,
    to_regprocedure('public.app_library_auto_tidy_apply(uuid,jsonb)') as fa,to_regprocedure('public.app_library_auto_tidy_revert(uuid)') as fr
)
select 'objects and history agree' as item,case when (h.n=0 and o.b is null and o.a is null and o.fa is null and o.fr is null)
  or (h.n=1 and h.named=1 and o.b is not null and o.a is not null and o.fa is not null and o.fr is not null) then '예' else '아니오' end as value
  from h,o
union all select 'tidy tables RLS enabled',case when (select b from o) is null or (select count(*) from pg_class where oid in ((select b from o),(select a from o)) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'one authenticated owner policy each',case when (select b from o) is null or (
  (select count(*) from pg_policy where polrelid=(select b from o))=1 and (select count(*) from pg_policy where polrelid=(select a from o))=1
  and (select count(*) from pg_policy where polrelid in ((select b from o),(select a from o)) and polroles=array['authenticated'::regrole]::oid[]
       and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=2) then '예' else '아니오' end
union all select 'anon and service_role have no tidy table privilege',case when (select b from o) is null or (
  not has_table_privilege('anon',(select b from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select a from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select b from o),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select a from o),'select,insert,update,references')
  and not has_table_privilege('service_role',(select b from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select a from o),'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'no PUBLIC grant on tidy tables',case when (select b from o) is null or not exists(select 1 from pg_class where oid in ((select b from o),(select a from o)) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated cannot change backup values',case when (select b from o) is null or (
  not has_column_privilege('authenticated',(select b from o),'old_value','update')
  and not has_column_privilege('authenticated',(select b from o),'new_value','update')
  and not has_table_privilege('authenticated',(select b from o),'delete')
  and not has_table_privilege('authenticated',(select a from o),'update,delete')) then '예' else '아니오' end
union all select 'tidy functions invoker with fixed path',case when (select fa from o) is null or (select count(*) from pg_proc where oid in ((select fa from o),(select fr from o))
  and not prosecdef and proconfig=array['search_path=""']::text[])=2 then '예' else '아니오' end
union all select 'tidy functions authenticated only',case when (select fa from o) is null or (
  has_function_privilege('authenticated',(select fa from o),'execute') and has_function_privilege('authenticated',(select fr from o),'execute')
  and not has_function_privilege('anon',(select fa from o),'execute') and not has_function_privilege('anon',(select fr from o),'execute')
  and not has_function_privilege('service_role',(select fa from o),'execute') and not has_function_privilege('service_role',(select fr from o),'execute')) then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg(concat_ws('|',d.id,d.title,d.category,d.source,d.document_date,(to_jsonb(d)->'field_origin')::text),E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),''))
union all select 'documents policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal;
