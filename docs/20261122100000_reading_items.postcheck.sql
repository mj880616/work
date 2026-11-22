-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·표 없음, 함수·검사는 이전 판).
with f as (
  select to_regprocedure('public.app_search_records(text,text[],integer,integer,text)') as fn, to_regclass('public.app_reading_items') as t,
    to_regclass('public.app_news_highlights') as h
), history as (
  select count(*) filter(where name='reading_items') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261122100000'
), hc as (
  select count(*) filter(where pg_get_constraintdef(c.oid)~'''reading''') as with_reading, count(*) as n
  from pg_constraint c, f where c.conrelid=f.h and c.conname='app_news_highlights_type_check' and c.contype='c'
    and pg_get_constraintdef(c.oid)~'''note''' and pg_get_constraintdef(c.oid)~'''telegram'''
)
select 'function, check, table and history agree' as item,case when f.fn is not null and hc.n=1 and (
  (history.n=0 and f.t is null and hc.with_reading=0 and exists(select 1 from pg_proc where oid=f.fn and md5(prosrc)='10498473a70dbfbe5e22d0361ae29745'))
  or (history.n=1 and history.named=1 and f.t is not null and hc.with_reading=1 and exists(select 1 from pg_proc where oid=f.fn and prosrc like '%''reading'' = any (v_kinds)%'))) then '예' else '아니오' end as ok
  from f,history,hc
union all select 'only one app_search_records',case when (select count(*) from pg_proc where proname='app_search_records' and pronamespace='public'::regnamespace)=1 then '예' else '아니오' end
union all select 'security invoker, stable, search_path empty',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and not prosecdef and proconfig=array['search_path=""'] and provolatile='s') then '예' else '아니오' end
union all select 'search: authenticated only',case when has_function_privilege('authenticated',(select fn from f),'execute')
  and not has_function_privilege('anon',(select fn from f),'execute') and not has_function_privilege('service_role',(select fn from f),'execute')
  and not exists(select 1 from pg_proc where oid=(select fn from f) and (proacl is null or proacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'search default kinds unchanged, never diary or raw text',case when exists(select 1 from pg_proc where oid=(select fn from f)
  and prosrc like '%v_all text[] := array[''update'', ''note'', ''work'', ''document'', ''meeting'', ''project'', ''organization'', ''milestone''];%'
  and prosrc like '%n.kind in (''basket'', ''note'', ''work'')%' and prosrc not like '%''diary''%' and prosrc not like '%app_call_personal%'
  and prosrc not like '%app_tg_personal%' and prosrc not like '%f.raw_text%') then '예' else '아니오' end
union all select 'highlights: RLS on, 1 policy for authenticated only',case when (select relrowsecurity from pg_class where oid=(select h from f))
  and (select count(*) from pg_policy where polrelid=(select h from f))=1
  and not exists(select 1 from pg_policy where polrelid=(select h from f) and not (polroles=array[to_regrole('authenticated')::oid])) then '예' else '아니오' end
union all select 'reading: RLS on, 1 owner policy for authenticated only, no trigger',case when (select t from f) is null or (
  (select relrowsecurity from pg_class where oid=(select t from f))
  and (select count(*) from pg_policy where polrelid=(select t from f))=1
  and not exists(select 1 from pg_policy where polrelid=(select t from f) and not (polroles=array[to_regrole('authenticated')::oid]))
  and exists(select 1 from pg_policy where polrelid=(select t from f) and pg_get_expr(polqual,polrelid) like '%app_is_workspace_owner(workspace_id)%'
    and pg_get_expr(polwithcheck,polrelid) like '%app_space_in_workspace(business_area_id, workspace_id)%')
  and not exists(select 1 from pg_trigger where tgrelid=(select t from f) and not tgisinternal)) then '예' else '아니오' end
union all select 'reading: anon and PUBLIC have nothing',case when (select t from f) is null or (
  not has_table_privilege('anon',(select t from f),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select t from f),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select t from f) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'reading: authenticated read delete, limited insert and update, no body',case when (select t from f) is null or (
  has_table_privilege('authenticated',(select t from f),'select') and has_table_privilege('authenticated',(select t from f),'delete')
  and has_column_privilege('authenticated',(select t from f),'url','insert') and has_column_privilege('authenticated',(select t from f),'read_at','update')
  and not has_column_privilege('authenticated',(select t from f),'body','insert') and not has_column_privilege('authenticated',(select t from f),'body','update')
  and not has_column_privilege('authenticated',(select t from f),'body_state','update') and not has_column_privilege('authenticated',(select t from f),'workspace_id','update')
  and not has_column_privilege('authenticated',(select t from f),'id','insert')
  and not has_table_privilege('authenticated',(select t from f),'truncate,references,trigger')) then '예' else '아니오' end
union all select 'reading: service_role reads and writes body columns only',case when (select t from f) is null or (
  has_table_privilege('service_role',(select t from f),'select') and has_column_privilege('service_role',(select t from f),'body','update')
  and not has_table_privilege('service_role',(select t from f),'insert,delete,truncate,references,trigger')
  and not has_column_privilege('service_role',(select t from f),'workspace_id','update') and not has_column_privilege('service_role',(select t from f),'url','update')
  and not has_column_privilege('service_role',(select t from f),'read_at','update')) then '예' else '아니오' end;
