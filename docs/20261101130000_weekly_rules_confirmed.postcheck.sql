-- SELECT only. Works after apply. No rule text, no draft content, no id: only yes/no, counts and hashes.
-- 'old rule lines'(후보 + 폐기 - 새로 넣은 폐기 1줄)·'old lines to retire'(폐기 - 1)·해시·행 수는 사전 확인의 같은 이름 값과 같아야 한다
-- (옛 줄은 하나도 지워지지 않았고, 다른 행·권한·정책·트리거·제약은 그대로).
-- expect: confirmed rules = 14
with op as (select f.workspace_id from public.app_operator_features f where f.feature = 'calls'),
t as (select q.id, q.draft -> 'rules' as rules from public.app_weekly_exec_requests q
  where q.workspace_id = (select workspace_id from op limit 1) and (q.draft -> 'rules') is not null
  order by q.week_start desc limit 1)
select 'migration recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261101130000' and name='weekly_rules_confirmed')=1 then '예' else '아니오' end as value
union all select 'rules row split',case when (select count(*) from t where (t.rules ->> 'v')='2' and jsonb_typeof(t.rules -> 'candidates')='array' and jsonb_typeof(t.rules -> 'retired')='array')=1 then '예' else '아니오' end
union all select 'only one split row',case when (select count(*) from public.app_weekly_exec_requests q where (q.draft -> 'rules' ->> 'v')='2')=1 then '예' else '아니오' end
union all select 'confirmed rules',(select coalesce(jsonb_array_length(t.rules -> 'lines'),0) from t)::text
union all select 'old rule lines',(select coalesce(jsonb_array_length(t.rules -> 'candidates'),0)+coalesce(jsonb_array_length(t.rules -> 'retired'),0)-1 from t)::text
union all select 'old lines to retire',(select coalesce(jsonb_array_length(t.rules -> 'retired'),0)-1 from t)::text
union all select 'rows with rules',(select count(*) from public.app_weekly_exec_requests q where (q.draft -> 'rules') is not null)::text
union all select 'weekly rows',(select count(*) from public.app_weekly_exec_requests)::text
union all select 'other rows rules hash',md5(coalesce(string_agg(q.id::text||':'||coalesce((q.draft -> 'rules')::text,''),',' order by q.id),''))
  from public.app_weekly_exec_requests q where q.id is distinct from (select id from t)
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_weekly_exec_requests') and relrowsecurity) then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_weekly_exec_requests','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_weekly_exec_requests') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_weekly_exec_requests')
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_weekly_exec_requests')
union all select 'column grants hash',md5(coalesce(string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname),'')) from pg_attribute where attrelid=to_regclass('public.app_weekly_exec_requests') and attnum>0 and not attisdropped
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_weekly_exec_requests')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_weekly_exec_requests') and not tgisinternal;
