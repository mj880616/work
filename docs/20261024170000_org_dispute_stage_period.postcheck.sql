-- SELECT only. Works after apply (record + end_date column + check + column grants + restrictive update policy) and after rollback (none of them).
-- 예/아니오 항목은 모두 예. 행 수·해시 항목은 precheck의 같은 이름 항목과 같은 값이어야 한다
-- (다른 칸·검사·정책·표 권한·다른 칸 권한·트리거·색인 변화 없음, 줄이 늘거나 줄지 않음).
with t as (select to_regclass('public.app_suborganization_dispute_stages') as rel),
history as (
  select count(*) as n,count(*) filter(where name='org_dispute_stage_period') as named from supabase_migrations.schema_migrations where version='20261024170000'
), cols as (
  select count(*) as n from pg_attribute where attrelid=(select rel from t) and attname='end_date' and atttypid='date'::regtype and not attnotnull and not attisdropped
), checks as (
  select count(*) as n from pg_constraint where conrelid=(select rel from t) and contype='c' and convalidated and conname='app_suborganization_dispute_stages_end_date_check'
    and regexp_replace(pg_get_constraintdef(oid),'[\s()]','','g') = 'CHECKend_dateISNULLORend_date>=stage_date'
), pol as (
  select count(*) as n from pg_policy where polrelid=(select rel from t) and polname='dispute_stage_history_stage_ws_update' and not polpermissive and polcmd='w'
    and polroles=array['authenticated'::regrole]::oid[] and polqual is null and polwithcheck is not null
)
select 'end date column check policy and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0 and pol.n=0)
  or (history.n=1 and history.named=1 and cols.n=1 and checks.n=1 and pol.n=1) then '예' else '아니오' end as value
  from history,cols,checks,pol
union all select 'column grants agree with history',case when
  (history.n=0 and not has_any_column_privilege('authenticated',(select rel from t),'update'))
  or (history.n=1 and has_column_privilege('authenticated',(select rel from t),'end_date','insert')
      and has_column_privilege('authenticated',(select rel from t),'stage_id','update') and has_column_privilege('authenticated',(select rel from t),'stage_name','update')
      and has_column_privilege('authenticated',(select rel from t),'stage_date','update') and has_column_privilege('authenticated',(select rel from t),'end_date','update')
      and not has_column_privilege('authenticated',(select rel from t),'organization_id','update') and not has_column_privilege('authenticated',(select rel from t),'created_by','update')
      and not has_column_privilege('authenticated',(select rel from t),'created_at','update') and not has_column_privilege('authenticated',(select rel from t),'id','update')
      and not has_column_privilege('authenticated',(select rel from t),'end_date','references')) then '예' else '아니오' end
  from history
union all select 'RLS enabled on history',case when exists(select 1 from pg_class where oid=(select rel from t) and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public or service_role privilege on history',case when not exists(select 1 from pg_class where oid=(select rel from t) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not exists(select 1 from pg_attribute where attrelid=(select rel from t) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
  and not has_table_privilege('anon',(select rel from t),'select,insert,update,delete')
  and not has_any_column_privilege('anon',(select rel from t),'select,insert,update,references') then '예' else '아니오' end
union all select 'history policies authenticated only',case when not exists(select 1 from pg_policy where polrelid=(select rel from t) and polroles<>array['authenticated'::regrole]::oid[]) then '예' else '아니오' end
union all select 'history rows',count(*)::text from public.app_suborganization_dispute_stages
union all select 'stage rows',count(*)::text from public.app_dispute_stages
union all select 'history other columns hash',md5(coalesce((select string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''),',' order by a.attname) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname<>'end_date'),''))
union all select 'history other constraints hash',md5(coalesce((select string_agg(c.conname||':'||pg_get_constraintdef(c.oid),',' order by c.conname) from pg_constraint c where c.conrelid=(select rel from t) and c.conname<>'app_suborganization_dispute_stages_end_date_check'),''))
union all select 'history other policies hash',md5(coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=(select rel from t) and p.polname<>'dispute_stage_history_stage_ws_update'),''))
union all select 'history table privileges hash',md5(coalesce((select c.relowner::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text||':'||coalesce(c.relacl::text,'') from pg_class c where c.oid=(select rel from t)),''))
union all select 'history other column grants hash',md5(coalesce((select string_agg(a.attname||':'||coalesce(a.attacl::text,''),',' order by a.attname) from pg_attribute a where a.attrelid=(select rel from t) and a.attnum>0 and not a.attisdropped and a.attname not in ('end_date','stage_id','stage_name','stage_date')),''))
union all select 'history triggers hash',md5(coalesce((select string_agg(g.tgname||':'||g.tgenabled::text||':'||pg_get_triggerdef(g.oid),',' order by g.tgname) from pg_trigger g where g.tgrelid=(select rel from t) and not g.tgisinternal),''))
union all select 'history indexes hash',md5(coalesce((select string_agg(ic.relname||':'||pg_get_indexdef(x.indexrelid),',' order by ic.relname) from pg_index x join pg_class ic on ic.oid=x.indexrelid where x.indrelid=(select rel from t)),''));
