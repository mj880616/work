-- SELECT only. Works after apply (record + column + index + owner check with organization) and after rollback/dry-run (none of them).
-- Compare precheck hashes (rows, grants, triggers) separately.
with history as (
  select count(*) as n,count(*) filter(where name='doc_organization_link') as named from supabase_migrations.schema_migrations where version='20261018032038'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_documents') and attname='organization_id' and not attisdropped
), idx as (
  select count(*) as n from pg_indexes where schemaname='public' and tablename='app_documents' and indexname='app_documents_organization_idx'
), pol as (
  select count(*) filter(where regexp_replace(with_check,'[\s()]','','g') like '%app_suborganizations%') as org,count(*) as n from pg_policies where schemaname='public' and tablename='app_documents' and policyname='task12a_owner_all'
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
)
select 'column index policy and history agree' as item,case when
  (history.n=0 and cols.n=0 and idx.n=0 and pol.n=1 and pol.org=0)
  or (history.n=1 and history.named=1 and cols.n=1 and idx.n=1 and pol.n=1 and pol.org=1) then '예' else '아니오' end as ok
  from history,cols,idx,pol
union all select 'no document linked to an organization yet',case when not exists(select 1 from public.app_documents d where to_jsonb(d)->>'organization_id' is not null) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_documents'))=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_documents','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end;
