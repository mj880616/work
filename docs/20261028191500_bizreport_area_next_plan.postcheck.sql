-- SELECT only. Works after apply (record + 2 columns + FK + CHECK + policy) and after rollback/dry-run (none of them).
-- The hash/count items must equal the precheck values of the same name (no grant, other policy, trigger, index or other column change; no row added or removed).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
with history as (
  select count(*) as n,count(*) filter(where name='bizreport_area_next_plan') as named from supabase_migrations.schema_migrations where version='20261028191500'
), cols as (
  select count(*) as n,count(*) filter(where not a.attnotnull and d.adbin is null
    and ((a.attname='business_area_id' and a.atttypid='uuid'::regtype) or (a.attname='next_plan' and a.atttypid='text'::regtype))) as good
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attname in ('business_area_id','next_plan') and not a.attisdropped
), cons as (
  select count(*) as n,count(*) filter(where convalidated and (
    (conname='app_meetings_business_area_id_fkey' and contype='f' and confrelid=to_regclass('public.app_spaces') and confdeltype='n'
      and pg_get_constraintdef(oid) ~ '^FOREIGN KEY \(business_area_id\) REFERENCES (public\.)?app_spaces\(id\) ON DELETE SET NULL$')
    or (conname='app_meetings_next_plan_check' and contype='c'
      and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g')='CHECKchar_lengthnext_plan<=1000'))) as good
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname in ('app_meetings_business_area_id_fkey','app_meetings_next_plan_check')
), pol as (
  select count(*) as n,count(*) filter(where not polpermissive and polcmd='*' and polroles=array['authenticated'::regrole]::oid[]
    and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='business_area_idISNULLORprivate.app_space_in_workspacebusiness_area_id,workspace_id'
    and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='business_area_idISNULLORprivate.app_space_in_workspacebusiness_area_id,workspace_id') as good
  from pg_policy where polrelid=to_regclass('public.app_meetings') and polname='app_meetings_business_area_ws'
)
select 'columns constraints policy and history agree' as item,case when
  (history.n=0 and cols.n=0 and cons.n=0 and pol.n=0)
  or (history.n=1 and history.named=1 and cols.n=2 and cols.good=2 and cons.n=2 and cons.good=2 and pol.n=1 and pol.good=1) then '예' else '아니오' end as value
  from history,cols,cons,pol
union all select 'new columns empty (or no columns)',case when not exists(select 1 from public.app_meetings m
  where to_jsonb(m)->>'business_area_id' is not null or to_jsonb(m)->>'next_plan' is not null) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'one permissive policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings') and polpermissive)=1 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_meetings','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'meetings rows',count(*)::text from public.app_meetings
union all select 'meetings with project rows',count(*) filter(where project_id is not null)::text from public.app_meetings
union all select 'projects rows',count(*)::text from public.app_spaces
union all select 'other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname not in ('business_area_id','next_plan')
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname not in ('app_meetings_business_area_id_fkey','app_meetings_next_plan_check')
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'other policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings') and polname<>'app_meetings_business_area_ws'
union all select 'triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal;
