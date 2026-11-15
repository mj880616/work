-- SELECT only. Works after apply (record + check accepting already_tasked) and after rollback/dry-run (no record + check without it).
-- The hash/count items must equal the precheck values of the same name (no grant, policy or constraint change besides the outcome check; no row added or removed).
with history as (
  select count(*) as n,count(*) filter(where name='todo_feedback_already_tasked') as named from supabase_migrations.schema_migrations where version='20261103210000'
), checks as (
  select count(*) filter(where c.convalidated) as valid,count(*) as n,
    count(*) filter(where pg_get_constraintdef(c.oid) ~ 'already_tasked') as with_new,
    count(*) filter(where pg_get_constraintdef(c.oid) ~ 'not_mine' and pg_get_constraintdef(c.oid) ~ 'dismissed') as with_old
  from pg_constraint c where c.conrelid=to_regclass('public.app_todo_feedback') and c.conname='app_todo_feedback_outcome_check'
)
select 'outcome check and history agree' as item,case when checks.n=1 and checks.valid=1 and checks.with_old=1 and (
  (history.n=0 and checks.with_new=0) or (history.n=1 and history.named=1 and checks.with_new=1)) then '예' else '아니오' end as value
  from history,checks
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_todo_feedback') and relrowsecurity) then '예' else '아니오' end
union all select 'one owner policy',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_todo_feedback'))=1 then '예' else '아니오' end
union all select 'no anon or service role privilege',case when not has_table_privilege('anon','public.app_todo_feedback','select,insert,update,delete') and not has_table_privilege('service_role','public.app_todo_feedback','select,insert,update,delete') then '예' else '아니오' end
union all select 'feedback rows',count(*)::text from public.app_todo_feedback
union all select 'other constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint where conrelid=to_regclass('public.app_todo_feedback') and conname<>'app_todo_feedback_outcome_check'
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),'')) from pg_policy where polrelid=to_regclass('public.app_todo_feedback')
union all select 'grants hash',md5(coalesce((select relacl::text from pg_class where oid=to_regclass('public.app_todo_feedback')),'')||coalesce((select string_agg(attname||':'||coalesce(attacl::text,''),',' order by attname) from pg_attribute where attrelid=to_regclass('public.app_todo_feedback') and attnum>0 and not attisdropped),''));
