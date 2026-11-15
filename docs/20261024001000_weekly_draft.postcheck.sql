-- SELECT only. Works after apply (record + 2 columns + check + new column grants) and after rollback/dry-run (none of them).
-- The count/hash/rows items must equal the precheck values of the same name (no policy, trigger, index, table grant or other column/constraint/column-grant change; no row added or removed).
with t as (select to_regclass('public.app_weekly_exec_requests') as rel),
history as (
  select count(*) as n,count(*) filter(where name='weekly_draft') as named from supabase_migrations.schema_migrations where version='20261024001000'
), cols as (
  select count(*) as n from pg_attribute where attrelid=(select rel from t) and not attisdropped
    and ((attname='draft' and atttypid='jsonb'::regtype) or (attname='draft_saved_at' and atttypid='timestamptz'::regtype))
), checks as (
  select count(*) as n from pg_constraint where connamespace='public'::regnamespace and contype='c' and convalidated and conname='app_weekly_exec_requests_draft_check'
)
select 'draft columns check and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0)
  or (history.n=1 and history.named=1 and cols.n=2 and checks.n=1) then '예' else '아니오' end as value
  from history,cols,checks
union all select 'every draft empty (or no column)',case when not exists(select 1 from public.app_weekly_exec_requests r
  where coalesce(to_jsonb(r)->'draft','null'::jsonb)<>'null'::jsonb or coalesce(to_jsonb(r)->'draft_saved_at','null'::jsonb)<>'null'::jsonb) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=(select rel from t) and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=(select rel from t))=1
  and exists(select 1 from pg_policies where schemaname='public' and tablename='app_weekly_exec_requests' and policyname='weekly_exec_requests_owner_all' and permissive='PERMISSIVE' and cmd='ALL' and roles=array['authenticated']::name[]) then '예' else '아니오' end
union all select 'no anon or public or service_role table or column privilege',case when not exists(select 1 from pg_class where oid=(select rel from t) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select rel from t) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not has_table_privilege('anon',(select rel from t),'select,insert,update,delete')
  and not has_any_column_privilege('anon',(select rel from t),'select,insert,update,references') then '예' else '아니오' end
union all select 'authenticated cannot delete or move a week',case when not has_table_privilege('authenticated',(select rel from t),'delete')
  and not has_column_privilege('authenticated',(select rel from t),'week_start','update')
  and not has_column_privilege('authenticated',(select rel from t),'workspace_id','update')
  and has_column_privilege('authenticated',(select rel from t),'items','update') then '예' else '아니오' end
union all select 'new column grants agree with history',case when
  (history.n=0 and not exists(select 1 from pg_attribute where attrelid=(select rel from t) and attname in ('draft','draft_saved_at') and not attisdropped))
  or (history.n=1 and has_column_privilege('authenticated',(select rel from t),'draft','insert') and has_column_privilege('authenticated',(select rel from t),'draft','update')
      and has_column_privilege('authenticated',(select rel from t),'draft_saved_at','insert') and has_column_privilege('authenticated',(select rel from t),'draft_saved_at','update')
      and not has_column_privilege('authenticated',(select rel from t),'draft','references')) then '예' else '아니오' end
  from history
union all select 'requests rows',count(*)::text from public.app_weekly_exec_requests
union all select 'other columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('draft','draft_saved_at')),''))
union all select 'other constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=(select rel from t) and c.conname<>'app_weekly_exec_requests_draft_check'),''))
union all select 'policies count',(select count(*) from pg_policy where polrelid=(select rel from t))::text
union all select 'policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t)),''))
union all select 'table privileges hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'other column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('draft','draft_saved_at')),''))
union all select 'triggers count',(select count(*) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal)::text
union all select 'triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''));
