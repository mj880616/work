-- SELECT only. pg_catalog와 migration 기록만 읽는다(행 값 없음). 적용 뒤 예/아니오 항목은 모두 예, 되돌린 뒤에도 모두 예(기록·칸·표·함수가 함께 없음).
-- 해시 4개는 사전 확인의 같은 이름 값과 같아야 한다(조직 기록의 기존 정책·표 권한·기존 칸 권한·기존 검사는 그대로).
with u as (select to_regclass('public.app_suborganization_updates') as p),
m as (select to_regclass('public.app_report_line_marks') as p),
s as (select to_regclass('public.app_report_snapshots') as p),
history as (select count(*) filter(where name='record_one_org') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261109100000'),
added as (select
  (select count(*) from pg_attribute,u where attrelid=u.p and not attisdropped and not attnotnull and attname in ('end_day','source_kind','source_id')) as cols,
  (select count(*) from pg_constraint,u where conrelid=u.p and contype='c' and convalidated and conname in ('app_suborganization_updates_end_day_check','app_suborganization_updates_source_check')) as checks,
  (select count(*) from pg_index where indrelid=(select p from u) and indexrelid in (to_regclass('public.app_suborganization_updates_source_once'),to_regclass('public.app_suborganization_updates_org_occurred_idx'))) as idx,
  (select count(*) from pg_trigger,u where tgrelid=u.p and tgname='app_suborganization_updates_source_guard' and not tgisinternal) as trg,
  (select count(*) from pg_proc where oid in (to_regprocedure('private.app_suborganization_updates_source_guard()'),to_regprocedure('private.app_report_line_marks_guard()'),to_regprocedure('private.app_report_snapshots_guard()'))
     and not prosecdef and proconfig=array['search_path=""']) as fns)
select 'history columns tables and functions agree' as item,case when
  (history.n=0 and added.cols=0 and added.checks=0 and added.idx=0 and added.trg=0 and added.fns=0 and (select p from m) is null and (select p from s) is null)
  or (history.n=1 and history.named=1 and added.cols=3 and added.checks=2 and added.idx=2 and added.trg=1 and added.fns=3 and (select p from m) is not null and (select p from s) is not null)
  then '예' else '아니오' end as value
  from history,added
union all select 'new tables: RLS on, 1 owner policy for authenticated only, 1 trigger',case when (select p from m) is null or (
  (select relrowsecurity from pg_class where oid=(select p from m)) and (select relrowsecurity from pg_class where oid=(select p from s))
  and (select count(*) from pg_policy where polrelid=(select p from m))=1 and (select count(*) from pg_policy where polrelid=(select p from s))=1
  and not exists(select 1 from pg_policy where polrelid in ((select p from m),(select p from s)) and not (polroles=array[to_regrole('authenticated')::oid]))
  and (select count(*) from pg_trigger where tgrelid=(select p from m) and not tgisinternal)=1
  and (select count(*) from pg_trigger where tgrelid=(select p from s) and not tgisinternal)=1) then '예' else '아니오' end
union all select 'new tables: anon PUBLIC service_role have nothing',case when (select p from m) is null or (
  not has_table_privilege('anon',(select p from m),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('anon',(select p from s),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select p from m),'select,insert,update,references')
  and not has_any_column_privilege('anon',(select p from s),'select,insert,update,references')
  and not has_table_privilege('service_role',(select p from m),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select p from s),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('service_role',(select p from m),'select,insert,update,references')
  and not has_any_column_privilege('service_role',(select p from s),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid in ((select p from m),(select p from s)) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'new tables: authenticated named columns only',case when (select p from m) is null or (
  has_table_privilege('authenticated',(select p from m),'select') and has_table_privilege('authenticated',(select p from m),'delete')
  and has_column_privilege('authenticated',(select p from m),'ref_key','insert') and not has_column_privilege('authenticated',(select p from m),'id','insert')
  and has_column_privilege('authenticated',(select p from m),'report_body','update') and has_column_privilege('authenticated',(select p from m),'choice','update')
  and not has_column_privilege('authenticated',(select p from m),'workspace_id','update') and not has_column_privilege('authenticated',(select p from m),'week_start','update')
  and not has_column_privilege('authenticated',(select p from m),'ref_key','update') and not has_column_privilege('authenticated',(select p from m),'updated_at','update')
  and has_table_privilege('authenticated',(select p from s),'select') and not has_table_privilege('authenticated',(select p from s),'delete')
  and has_column_privilege('authenticated',(select p from s),'rows','insert') and has_column_privilege('authenticated',(select p from s),'rows','update')
  and not has_column_privilege('authenticated',(select p from s),'confirmed_at','insert') and not has_column_privilege('authenticated',(select p from s),'confirmed_at','update')
  and not has_column_privilege('authenticated',(select p from s),'workspace_id','update') and not has_column_privilege('authenticated',(select p from s),'week_start','update')
  and not has_table_privilege('authenticated',(select p from m),'truncate,references,trigger')
  and not has_table_privilege('authenticated',(select p from s),'truncate,references,trigger')) then '예' else '아니오' end
union all select 'org records RLS on and no anon or PUBLIC',case when (select relrowsecurity from pg_class where oid=(select p from u))
  and not exists(select 1 from pg_class where oid=(select p from u) and relacl::text ~ '(^|[{,])(anon)?=')
  and not has_any_column_privilege('anon',(select p from u),'select,insert,update,references')
  and not exists(select 1 from pg_policy where polrelid=(select p from u) and (polroles @> array[0::oid] or polroles @> array[to_regrole('anon')::oid])) then '예' else '아니오' end
union all select 'org records policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polpermissive::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=(select p from u)
union all select 'org records table grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=(select p from u)
union all select 'org records old column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),''))
  from pg_attribute where attrelid=(select p from u) and attnum>0 and not attisdropped and attname not in ('end_day','source_kind','source_id')
union all select 'org records old constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=(select p from u) and conname not in ('app_suborganization_updates_end_day_check','app_suborganization_updates_source_check');
