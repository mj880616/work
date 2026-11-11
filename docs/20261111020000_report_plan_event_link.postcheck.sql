-- SELECT only. Works after apply (record + new table + two link columns + three checks + one index) and after rollback/dry-run (none of them).
-- 예/아니오 항목은 모두 예. The hash/count items must equal the precheck values of the same name
-- (no grant, other column, other constraint, other index, policy or trigger change on app_meetings; app_workspaces grants and policies unchanged).
-- 읽기 전용 역할에서 돈다: information_schema 대신 pg_catalog만 읽는다(#978).
with history as (
  select count(*) as n,count(*) filter(where name='report_plan_event_link') as named from supabase_migrations.schema_migrations where version='20261111020000'
), plans as (
  select (to_regclass('public.app_calendar_report_plans') is not null)::int as n
), col as (
  select count(*) as n,count(*) filter(where a.atttypid='text'::regtype and not a.attnotnull and not a.atthasdef and a.attacl is null) as good
  from pg_attribute a
  where a.attrelid=to_regclass('public.app_meetings') and a.attname in ('google_calendar_id','google_event_id') and not a.attisdropped
), chk as (
  select count(*) as n,count(*) filter(where contype='c' and convalidated) as good
  from pg_constraint where conrelid=to_regclass('public.app_meetings')
    and conname in ('app_meetings_google_link_pair_check','app_meetings_google_event_id_check','app_meetings_google_calendar_id_check')
), idx as (
  select count(*) as n,count(*) filter(where i.indisvalid and not i.indisunique and i.indpred is not null) as good
  from pg_index i where i.indexrelid=to_regclass('public.app_meetings_google_event_idx') and i.indrelid=to_regclass('public.app_meetings')
)
select 'plans table, link columns, checks, index and history agree' as item,case when (history.n=0 and plans.n=0 and col.n=0 and chk.n=0 and idx.n=0)
    or (history.n=1 and history.named=1 and plans.n=1 and col.n=2 and col.good=2 and chk.n=3 and chk.good=3 and idx.n=1 and idx.good=1) then '예' else '아니오' end as value
  from history,plans,col,chk,idx
union all select 'report plans: RLS on, one authenticated owner policy, no trigger',case when to_regclass('public.app_calendar_report_plans') is null then '예'
  when exists(select 1 from pg_class where oid=to_regclass('public.app_calendar_report_plans') and relrowsecurity)
    and (select count(*) from pg_policy where polrelid=to_regclass('public.app_calendar_report_plans'))=1
    and exists(select 1 from pg_policy where polrelid=to_regclass('public.app_calendar_report_plans') and polname='calendar_report_plans_owner_all' and polpermissive and polcmd='*'
      and polroles=array[to_regrole('authenticated')::oid]
      and regexp_replace(pg_get_expr(polqual,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id'
      and regexp_replace(pg_get_expr(polwithcheck,polrelid),'[\s()]','','g')='private.app_is_workspace_ownerworkspace_id')
    and (select count(*) from pg_trigger where tgrelid=to_regclass('public.app_calendar_report_plans') and not tgisinternal)=0 then '예' else '아니오' end
union all select 'report plans: no anon/service_role, select and delete, value columns only',case when to_regclass('public.app_calendar_report_plans') is null then '예'
  when not has_any_column_privilege('anon',to_regclass('public.app_calendar_report_plans'),'select,insert,update,references')
    and not has_table_privilege('anon',to_regclass('public.app_calendar_report_plans'),'select,insert,update,delete')
    and not has_any_column_privilege('service_role',to_regclass('public.app_calendar_report_plans'),'select,insert,update,references')
    and not has_table_privilege('service_role',to_regclass('public.app_calendar_report_plans'),'select,insert,update,delete')
    and not exists(select 1 from pg_class where oid=to_regclass('public.app_calendar_report_plans') and relacl::text ~ '(^|[{,])(anon)?=')
    and has_table_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'select')
    and has_table_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'delete')
    and not has_table_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'insert,update,truncate')
    and has_column_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'google_event_id','insert')
    and has_column_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'state','insert,update')
    and not has_column_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'created_at','insert,update')
    and not has_column_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'workspace_id','update')
    and not has_column_privilege('authenticated',to_regclass('public.app_calendar_report_plans'),'google_event_id','update') then '예' else '아니오' end
union all select 'owner check function present',case when exists(select 1 from pg_proc where oid=to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then '예' else '아니오' end
union all select 'meetings RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relrowsecurity) then '예' else '아니오' end
union all select 'one permissive owner policy on meetings',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_meetings') and polpermissive)=1 then '예' else '아니오' end
union all select 'no anon or public privilege on meetings',case when not has_table_privilege('anon',to_regclass('public.app_meetings'),'select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_meetings') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'meetings other columns hash',md5(coalesce(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),'none')||':'||coalesce(a.attacl::text,'none'),',' order by a.attname),''))
  from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.app_meetings') and a.attnum>0 and not a.attisdropped and a.attname not in ('google_calendar_id','google_event_id')
union all select 'meetings other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_meetings') and conname not in ('app_meetings_google_link_pair_check','app_meetings_google_event_id_check','app_meetings_google_calendar_id_check')
union all select 'meetings other indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes where schemaname='public' and tablename='app_meetings' and indexname<>'app_meetings_google_event_idx'
union all select 'meetings owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_meetings')
union all select 'meetings policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_meetings')
union all select 'meetings triggers count',count(*)::text from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'meetings triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_meetings') and not tgisinternal
union all select 'workspaces grants policies hash',md5(coalesce((select c.relrowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=to_regclass('public.app_workspaces')),'')
  ||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polpermissive::text||p.polroles::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=to_regclass('public.app_workspaces')),''));
