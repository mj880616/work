-- SELECT only. Works after apply (record + 2 columns + check + index + 4 functions + owner check with organization) and after rollback/dry-run (none of them).
-- Compare precheck hashes (rows, grants, triggers) separately.
with history as (
  select count(*) as n,count(*) filter(where name='doc_org_categories') as named from supabase_migrations.schema_migrations where version='20261018023753'
), cols as (
  select count(*) as n from pg_attribute where ((attrelid=to_regclass('public.app_documents') and attname='organization_id') or (attrelid=to_regclass('public.app_workspaces') and attname='document_categories')) and not attisdropped
), con as (
  select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_workspaces') and conname='app_workspaces_document_categories_check' and contype='c' and convalidated
), idx as (
  select count(*) as n from pg_indexes where schemaname='public' and tablename='app_documents' and indexname='app_documents_organization_idx'
), fns as (
  select count(*) as n,count(*) filter(where not prosecdef and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute')
    and coalesce(proacl::text,'') !~ '(^|[{,])=') as safe
  from pg_proc where pronamespace in('public'::regnamespace,'private'::regnamespace) and proname like 'app\_document\_categor%'
), pol as (
  select count(*) filter(where regexp_replace(with_check,'[\s()]','','g') like '%app_suborganizations%') as org,count(*) as n from pg_policies where schemaname='public' and tablename='app_documents' and policyname='task12a_owner_all'
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
)
select 'columns constraint index functions policy and history agree' as item,case when
  (history.n=0 and cols.n=0 and con.n=0 and idx.n=0 and fns.n=0 and pol.n=1 and pol.org=0)
  or (history.n=1 and history.named=1 and cols.n=2 and con.n=1 and idx.n=1 and fns.n=4 and fns.safe=4 and pol.n=1 and pol.org=1) then '예' else '아니오' end as ok
  from history,cols,con,idx,fns,pol
union all select 'no document linked to an organization yet',case when not exists(select 1 from public.app_documents d where to_jsonb(d)->>'organization_id' is not null) then '예' else '아니오' end
union all select 'every workspace has the default 7 or no list column',case when not exists(select 1 from public.app_workspaces w where to_jsonb(w) ? 'document_categories'
  and to_jsonb(w)->'document_categories' <> '["교섭","투쟁","교육","선전","정책","회의","기타"]'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled on both',case when (select count(*) from pg_class where oid in(to_regclass('public.app_documents'),to_regclass('public.app_workspaces')) and relrowsecurity)=2 then '예' else '아니오' end
union all select 'one owner policy on each',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_documents'))=1 and (select count(*) from pg_policy where polrelid=to_regclass('public.app_workspaces'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_documents','select,insert,update,delete') and not has_table_privilege('anon','public.app_workspaces','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid in(to_regclass('public.app_documents'),to_regclass('public.app_workspaces')) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end;
