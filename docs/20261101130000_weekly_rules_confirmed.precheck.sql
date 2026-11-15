-- SELECT only. Counts, yes/no and hashes; no rule text, no draft content, no id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 대상 행 = 'calls' 운영자 작업공간에서 규칙 칸(draft -> 'rules')이 있는 가장 나중 주의 행 하나.
-- 'old rule lines'는 지금 규칙 줄 수(후보로 되돌릴 줄 + 폐기로 옮길 줄), 'old lines to retire'는 그중 '정책·연구·제외' 뜻의 줄 수.
-- 'other rows rules hash'는 대상 행이 아닌 모든 행의 규칙 칸 해시(사후에도 같아야 함: 다른 작업공간·다른 주는 그대로).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: operator workspace single = 예
-- expect: rules row found = 예
-- expect: no split rules yet = 예
-- expect: old rule lines = 0~40
-- expect: old lines to retire = 기록
-- expect: rows with rules = 기록
-- expect: weekly rows = 기록
-- expect: other rows rules hash = 기록
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: constraints hash = 기록
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: triggers hash = 기록
with op as (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'),
t as (select q.id, q.draft -> 'rules' as rules from public.app_weekly_exec_requests q
  where q.workspace_id = (select workspace_id from op limit 1) and (q.draft -> 'rules') is not null
  order by q.week_start desc limit 1),
l as (select btrim(case jsonb_typeof(e.v) when 'string' then e.v #>> '{}' else e.v ->> 'text' end) as txt
  from t cross join lateral jsonb_array_elements(case when jsonb_typeof(t.rules -> 'lines') = 'array' then t.rules -> 'lines' else '[]'::jsonb end) e(v))
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version='20261024001000' and name='weekly_draft') or (version='20261029090000' and name='operator_features'))=2 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261101130000') then '예' else '아니오' end
union all select 'operator workspace single',case when (select count(distinct workspace_id) from op)=1 then '예' else '아니오' end
union all select 'rules row found',case when (select count(*) from t)=1 then '예' else '아니오' end
union all select 'no split rules yet',case when not exists(select 1 from public.app_weekly_exec_requests q where (q.draft -> 'rules' ->> 'v')='2') then '예' else '아니오' end
union all select 'old rule lines',(select count(*) from l where coalesce(l.txt,'')<>'')::text
union all select 'old lines to retire',(select count(*) from l where coalesce(l.txt,'')<>'' and l.txt ~ '정책' and l.txt ~ '연구' and l.txt ~ '(제외|빼)')::text
union all select 'rows with rules',(select count(*) from public.app_weekly_exec_requests q where (q.draft -> 'rules') is not null)::text
union all select 'weekly rows',(select count(*) from public.app_weekly_exec_requests)::text
union all select 'other rows rules hash',md5(coalesce(string_agg(q.id::text||':'||coalesce((q.draft -> 'rules')::text,''),',' order by q.id),''))
  from public.app_weekly_exec_requests q where q.id is distinct from (select id from t)
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_weekly_exec_requests') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_weekly_exec_requests','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_weekly_exec_requests') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_weekly_exec_requests')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_weekly_exec_requests')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_weekly_exec_requests') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_weekly_exec_requests')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_weekly_exec_requests') and not tgisinternal;
