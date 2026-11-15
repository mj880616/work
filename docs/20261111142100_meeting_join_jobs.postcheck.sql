-- SELECT only. pg_catalog과 migration 기록만 읽는다. 적용 뒤 예/아니오 항목은 모두 예(되돌린 뒤에도 예 — 기록·표·함수가 함께 없음).
-- 해시 두 항목은 precheck의 같은 이름 값과 같아야 한다(기존 표의 RLS·정책·권한 그대로).
with t as (select to_regclass('public.app_meeting_join_jobs') as j,
  to_regprocedure('public.app_meeting_join_apply(uuid)') as fa,to_regprocedure('public.app_meeting_join_undo(uuid,text)') as fu),
history as (select count(*) filter(where name='meeting_join_jobs') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261111142100')
select 'table, functions and history agree' as item,case when
  (history.n=0 and t.j is null and t.fa is null and t.fu is null) or (history.n=1 and history.named=1 and t.j is not null and t.fa is not null and t.fu is not null) then '예' else '아니오' end as value
  from t,history
union all select 'RLS on, 1 owner read policy for authenticated only',case when (select j from t) is null or (
  (select relrowsecurity from pg_class where oid=(select j from t))
  and (select count(*) from pg_policy where polrelid=(select j from t))=1
  and not exists(select 1 from pg_policy where polrelid=(select j from t) and not (polroles=array[to_regrole('authenticated')::oid] and polcmd='r'))) then '예' else '아니오' end
union all select 'anon and PUBLIC have nothing on the table',case when (select j from t) is null or (
  not has_table_privilege('anon',(select j from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select j from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select j from t) and relacl::text ~ '(^|[{,])=')
  and not exists(select 1 from pg_attribute where attrelid=(select j from t) and attacl::text ~ '(^|[{,])(anon)?=')) then '예' else '아니오' end
union all select 'authenticated: read only',case when (select j from t) is null or (
  has_table_privilege('authenticated',(select j from t),'select')
  and not has_table_privilege('authenticated',(select j from t),'insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('authenticated',(select j from t),'insert,update,references')) then '예' else '아니오' end
union all select 'service_role: read + listed column insert/update, no delete',case when (select j from t) is null or (
  has_table_privilege('service_role',(select j from t),'select')
  and not has_table_privilege('service_role',(select j from t),'insert,update,delete,truncate,references,trigger')
  and has_column_privilege('service_role',(select j from t),'target_meeting_id','insert')
  and has_column_privilege('service_role',(select j from t),'before_notes','insert')
  and not has_column_privilege('service_role',(select j from t),'id','insert')
  and has_column_privilege('service_role',(select j from t),'lease_until','update')
  and has_column_privilege('service_role',(select j from t),'result_text','update')) then '예' else '아니오' end
union all select 'service_role cannot write before text, source or apply/undo record columns',case when (select j from t) is null or (
  (select count(*) from pg_attribute a where a.attrelid=(select j from t) and not a.attisdropped
     and a.attname in('workspace_id','created_by','mode','target_meeting_id','source_job_id','source_meeting_id','source_text','source_record_jobs',
       'source_result_sha','source_notes_sha','before_result','before_notes','applied_at','moved','kept_result','undone_at','id','created_at')
     and has_column_privilege('service_role',a.attrelid,a.attname,'update'))=0
  and (select count(*) from pg_attribute a where a.attrelid=(select j from t) and not a.attisdropped
     and a.attname in('applied_at','moved','kept_result','undone_at','id','created_at')
     and has_column_privilege('service_role',a.attrelid,a.attname,'insert'))=0) then '예' else '아니오' end
union all select 'three one-at-a-time partial unique indexes',case when (select j from t) is null or (
  select count(*) from pg_index where indrelid=(select j from t) and indisunique and indpred is not null)=3 then '예' else '아니오' end
union all select 'functions: definer, empty search_path, service_role only',case when (select fa from t) is null or (
  select count(*) from pg_proc where oid in((select fa from t),(select fu from t))
    and prosecdef and proconfig=array['search_path=""']
    and has_function_privilege('service_role',oid,'execute')
    and not has_function_privilege('authenticated',oid,'execute')
    and not has_function_privilege('anon',oid,'execute')
    and not exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0))=2 then '예' else '아니오' end
union all select 'existing tables RLS policies grants hash',md5(coalesce((select string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(p.polname::text||p.polcmd::text||p.polroles::text||p.polpermissive::text||coalesce(pg_get_expr(p.polqual,p.polrelid),'')||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''),',' order by p.polname) from pg_policy p where p.polrelid=c.oid),''),';' order by c.relname)
  from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname in('app_meetings','app_documents','app_record_links','app_meeting_server_jobs','app_meeting_transcribe_jobs','app_workspace_members')),''))
union all select 'existing tables column grants hash',md5(coalesce((select string_agg(c.relname||'.'||a.attname||':'||a.attacl::text,',' order by c.relname,a.attname)
  from pg_attribute a join pg_class c on c.oid=a.attrelid where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attacl is not null and not a.attisdropped
    and c.relname in('app_meetings','app_documents','app_record_links','app_meeting_server_jobs','app_meeting_transcribe_jobs','app_workspace_members')),''));
