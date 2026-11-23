-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·글 상자 표·새 칸이 함께 없음).
with t as (select to_regclass('public.app_note_board_texts') as f, to_regclass('public.app_note_board_links') as l),
history as (select count(*) filter(where name='note_board_texts') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261123120000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select l from t) and attname in ('from_text','to_text','bend_x','bend_y') and not attisdropped)
select 'table, columns and history agree' as item,case when (history.n=0 and t.f is null and cols.n=0) or (history.n=1 and history.named=1 and t.f is not null and cols.n=4) then '예' else '아니오' end as ok
  from t,history,cols
union all select 'links: 1 owner policy for authenticated only, RLS on, no triggers',case when (select l from t) is not null
  and (select relrowsecurity from pg_class where oid=(select l from t))
  and (select count(*) from pg_policy where polrelid=(select l from t))=1
  and exists(select 1 from pg_policy where polrelid=(select l from t) and polname='note_board_links_owner_all' and polcmd='*' and polroles=array[to_regrole('authenticated')::oid])
  and (select count(*) from pg_trigger where tgrelid=(select l from t) and not tgisinternal)=0 then '예' else '아니오' end
union all select 'texts: RLS on, 1 owner policy for authenticated only, no triggers',case when (select f from t) is null or (
  (select relrowsecurity from pg_class where oid=(select f from t))
  and (select count(*) from pg_policy where polrelid=(select f from t))=1
  and not exists(select 1 from pg_policy where polrelid=(select f from t) and not (polroles=array[to_regrole('authenticated')::oid]))
  and (select count(*) from pg_trigger where tgrelid=(select f from t) and not tgisinternal)=0) then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing on both tables',case when not exists(select 1 from t,unnest(array[t.f,t.l]) x(r) where x.r is not null and (
  has_table_privilege('anon',x.r,'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',x.r,'select,insert,update,references')
  or has_table_privilege('service_role',x.r,'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('service_role',x.r,'select,insert,update,references')
  or exists(select 1 from pg_class where oid=x.r and relacl::text ~ '(^|[{,])='))) then '예' else '아니오' end
union all select 'authenticated: read delete, named columns only, workspace and board fixed',case when not exists(select 1 from t,unnest(array[t.f,t.l]) x(r) where x.r is not null and (
  not has_table_privilege('authenticated',x.r,'select') or not has_table_privilege('authenticated',x.r,'delete')
  or has_table_privilege('authenticated',x.r,'insert,update,truncate,references,trigger')
  or has_column_privilege('authenticated',x.r,'id','insert') or has_column_privilege('authenticated',x.r,'created_at','insert')
  or has_column_privilege('authenticated',x.r,'workspace_id','update') or has_column_privilege('authenticated',x.r,'board_id','update')))
  and ((select f from t) is null or (has_column_privilege('authenticated',(select f from t),'body','insert') and has_column_privilege('authenticated',(select f from t),'y','update')
    and has_column_privilege('authenticated',(select l from t),'to_text','insert') and has_column_privilege('authenticated',(select l from t),'bend_x','update'))) then '예' else '아니오' end;
