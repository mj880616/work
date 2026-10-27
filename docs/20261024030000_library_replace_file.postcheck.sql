-- SELECT only. Works after apply (record + 2 columns + 1 check) and after rollback/dry-run (none of them).
-- The count/hash/rows items must equal the precheck values of the same name (no grant, policy, trigger, index or other column/constraint change; no row added or removed; no existing value changed).
with t as (select to_regclass('public.app_documents') as rel),
history as (
  select count(*) as n,count(*) filter(where name='library_replace_file') as named from supabase_migrations.schema_migrations where version='20261024030000'
), cols as (
  select count(*) as n from t join pg_attribute a on a.attrelid=t.rel and not a.attisdropped
    and ((a.attname='previous_files' and a.atttypid='jsonb'::regtype and a.attnotnull) or (a.attname='reclassify_needed' and a.atttypid='boolean'::regtype and a.attnotnull))
), checks as (
  select count(*) as n from pg_constraint where conrelid=(select rel from t) and conname='app_documents_previous_files_check' and contype='c' and convalidated
)
select 'columns check and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0)
  or (history.n=1 and history.named=1 and cols.n=2 and checks.n=1) then '예' else '아니오' end as value
  from history,cols,checks
union all select 'every new column at its starting value (or no column)',case when
  not exists(select 1 from public.app_documents d where coalesce(to_jsonb(d)->'previous_files','[]'::jsonb)<>'[]'::jsonb or coalesce(to_jsonb(d)->'reclassify_needed','false'::jsonb)<>'false'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from t join pg_class c on c.oid=t.rel and c.relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not exists(select 1 from t join pg_class c on c.oid=t.rel where c.relacl::text ~ '(^|[{,])(anon)?=')
  and not exists(select 1 from t where has_table_privilege('anon',t.rel,'select') or has_table_privilege('anon',t.rel,'insert') or has_table_privilege('anon',t.rel,'update') or has_table_privilege('anon',t.rel,'delete')) then '예' else '아니오' end
union all select 'no anon or public policy',case when not exists(select 1 from t join pg_policy p on p.polrelid=t.rel where 0::oid=any(p.polroles) or 'anon'::regrole::oid=any(p.polroles)) then '예' else '아니오' end
union all select 'authenticated can read and update',case when exists(select 1 from t where has_table_privilege('authenticated',t.rel,'select') and has_table_privilege('authenticated',t.rel,'update')) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=(select rel from t))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_documents' and policyname='task12a_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'documents rows',count(*)::text from public.app_documents
union all select 'documents values hash',md5(coalesce(string_agg((to_jsonb(d)-'previous_files'-'reclassify_needed')::text,E'\n' order by d.id),'')) from public.app_documents d
union all select 'documents columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname)
  from t join pg_attribute a on a.attrelid=t.rel and a.attnum>0 and not a.attisdropped and a.attname not in ('previous_files','reclassify_needed') left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum),''))
union all select 'documents constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=(select rel from t) and c.conname<>'app_documents_previous_files_check'),''))
union all select 'documents policies count',(select count(*) from pg_policy where polrelid=(select rel from t))::text
union all select 'documents policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t)),''))
union all select 'documents owner RLS grants hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'documents column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('previous_files','reclassify_needed')),''))
union all select 'documents triggers count',(select count(*) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal)::text
union all select 'documents triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'documents indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''));
