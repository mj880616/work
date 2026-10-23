-- SELECT only. Works after apply (all 예, documents/backups rows·hashes equal to precheck) and after rollback (history, table and functions absent).
-- The rows/hashes match precheck only right after apply (before the screen starts classifying).
with h as (
  select count(*) as n,count(*) filter(where name='library_ai_classify') as named from supabase_migrations.schema_migrations where version='20261023120000'
), o as (
  select to_regclass('public.app_library_classify_attempts') as a,
    to_regprocedure('public.app_library_classify_apply(uuid,jsonb)') as fa,to_regprocedure('public.app_library_classify_revert(uuid)') as fr,
    to_regprocedure('public.app_library_classify_revert_since(timestamptz)') as fs
), c as (
  select (select pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_documents') and conname='app_documents_field_origin_check') as origin_def,
    (select pg_get_constraintdef(oid) from pg_constraint where conrelid=to_regclass('public.app_library_tidy_backups') and conname='app_library_tidy_backups_field_check') as backup_def
)
select 'objects and history agree' as item,case when (h.n=0 and o.a is null and o.fa is null and o.fr is null and o.fs is null)
  or (h.n=1 and h.named=1 and o.a is not null and o.fa is not null and o.fr is not null and o.fs is not null) then '예' else '아니오' end as value
  from h,o
union all select 'check constraints match history',case when (select n from h)=1 and (select origin_def from c) like '%organization_id%' and (select backup_def from c) like '%organization_id%'
  or (select n from h)=0 and (select origin_def from c) not like '%organization_id%' and (select backup_def from c) not like '%organization_id%' then '예' else '아니오' end
union all select 'classify table RLS enabled',case when (select a from o) is null or exists(select 1 from pg_class where oid=(select a from o) and relrowsecurity) then '예' else '아니오' end
union all select 'one authenticated owner policy',case when (select a from o) is null or (
  (select count(*) from pg_policy where polrelid=(select a from o))=1
  and (select count(*) from pg_policy where polrelid=(select a from o) and polroles=array['authenticated'::regrole]::oid[]
       and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%')=1) then '예' else '아니오' end
union all select 'anon and service_role have no classify table privilege',case when (select a from o) is null or (
  not has_table_privilege('anon',(select a from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select a from o),'select,insert,update,references')
  and not has_table_privilege('service_role',(select a from o),'select,insert,update,delete,truncate,references,trigger')) then '예' else '아니오' end
union all select 'no PUBLIC grant on classify table',case when (select a from o) is null or not exists(select 1 from pg_class where oid=(select a from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'authenticated cannot delete attempts',case when (select a from o) is null or (
  not has_table_privilege('authenticated',(select a from o),'delete')
  and not has_column_privilege('authenticated',(select a from o),'document_id','update')
  and not has_column_privilege('authenticated',(select a from o),'workspace_id','update')) then '예' else '아니오' end
union all select 'classify functions invoker with fixed path',case when (select fa from o) is null or (select count(*) from pg_proc where oid in ((select fa from o),(select fr from o),(select fs from o))
  and not prosecdef and proconfig=array['search_path=""']::text[])=3 then '예' else '아니오' end
union all select 'classify functions authenticated only',case when (select fa from o) is null or (
  has_function_privilege('authenticated',(select fa from o),'execute') and has_function_privilege('authenticated',(select fr from o),'execute')
  and has_function_privilege('authenticated',(select fs from o),'execute')
  and not has_function_privilege('anon',(select fa from o),'execute') and not has_function_privilege('anon',(select fr from o),'execute')
  and not has_function_privilege('anon',(select fs from o),'execute')
  and not has_function_privilege('service_role',(select fa from o),'execute') and not has_function_privilege('service_role',(select fr from o),'execute')
  and not has_function_privilege('service_role',(select fs from o),'execute')) then '예' else '아니오' end
union all select 'documents RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg(concat_ws('|',d.id,d.title,d.category,d.source,d.document_date,d.project_id,d.organization_id,(to_jsonb(d)->'field_origin')::text),E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_documents')),''))
union all select 'documents policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'documents triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal
union all select 'tidy backups rows',count(*)::text from public.app_library_tidy_backups
union all select 'tidy backups values hash',md5(coalesce(string_agg(concat_ws('|',b.id,b.field,b.old_value,b.new_value,b.reverted_at),E'\n' order by b.id),'')) from public.app_library_tidy_backups b;
