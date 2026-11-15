-- SELECT only. Aggregates and hashes; no document text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / abandoned version absent 예 / new column 0 / RLS 예 / owner policy 예 / anon 아니오.
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261012100000' and name='basket_link_view_db')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261018032038') then '예' else '아니오' end
union all select 'abandoned version absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261018023753') then '예' else '아니오' end
union all select 'new column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_documents') and attname='organization_id' and not attisdropped
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relrowsecurity) then '예' else '아니오' end
union all select 'owner policy only (current shape)',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_documents'))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_documents' and policyname='task12a_owner_all' and cmd='ALL' and roles=array['authenticated']::name[]
    and regexp_replace(qual,'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id' and regexp_replace(with_check,'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id') then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_documents','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_documents') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents full-row hash',md5(coalesce(string_agg(to_jsonb(d)::text,E'\n' order by d.id),'')) from public.app_documents d
union all select 'columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attnum),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=to_regclass('public.app_documents') and a.attnum>0 and not a.attisdropped
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_documents')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_documents'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_documents')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_documents')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text,',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_documents') and not tgisinternal;
