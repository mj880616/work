-- SELECT only. pg_catalog와 migration 기록만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·새 칸·새 검사·좁히기 정책이 함께 없음).
with t as (select to_regclass('public.app_note_board_texts') as f),
history as (select count(*) filter(where name='note_board_branch_all') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261126230000'),
cols as (select count(*) as n from pg_attribute where attrelid=(select f from t) and attname='parent_note' and not attisdropped),
one as (select count(*) as n from pg_constraint where conrelid=(select f from t) and conname='app_note_board_texts_parent_one_check' and contype='c'),
narrow as (select count(*) as n from pg_policy where polrelid=(select f from t) and polname='note_board_texts_parent_note_own' and polcmd='*' and not polpermissive and polroles=array[to_regrole('authenticated')::oid])
select 'column, check, narrowing policy and history agree' as item,case when (history.n=0 and cols.n=0 and one.n=0 and narrow.n=0) or (history.n=1 and history.named=1 and cols.n=1 and one.n=1 and narrow.n=1) then '예' else '아니오' end as ok
  from history,cols,one,narrow
union all select 'texts: RLS on, owner policy for authenticated only (+ narrowing after apply), no triggers',case when (select f from t) is not null
  and (select relrowsecurity from pg_class where oid=(select f from t))
  and (select count(*) from pg_policy where polrelid=(select f from t))=1+(select n from narrow)
  and exists(select 1 from pg_policy where polrelid=(select f from t) and polname='note_board_texts_owner_all' and polcmd='*' and polpermissive and polroles=array[to_regrole('authenticated')::oid])
  and (select count(*) from pg_trigger where tgrelid=(select f from t) and not tgisinternal)=0 then '예' else '아니오' end
union all select 'decor check present',case when exists(select 1 from pg_constraint where conrelid=(select f from t) and conname='app_note_board_texts_decor_check' and contype='c') then '예' else '아니오' end
union all select 'anon PUBLIC service_role have nothing',case when (select f from t) is not null and not (
  has_table_privilege('anon',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('anon',(select f from t),'select,insert,update,references')
  or has_table_privilege('service_role',(select f from t),'select,insert,update,delete,truncate,references,trigger')
  or has_any_column_privilege('service_role',(select f from t),'select,insert,update,references')
  or exists(select 1 from pg_class where oid=(select f from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'authenticated: read delete, named columns only, workspace and board fixed',case when (select f from t) is not null
  and has_table_privilege('authenticated',(select f from t),'select') and has_table_privilege('authenticated',(select f from t),'delete')
  and not has_table_privilege('authenticated',(select f from t),'insert,update,truncate,references,trigger')
  and not has_column_privilege('authenticated',(select f from t),'id','insert') and not has_column_privilege('authenticated',(select f from t),'created_at','insert')
  and not has_column_privilege('authenticated',(select f from t),'workspace_id','update') and not has_column_privilege('authenticated',(select f from t),'board_id','update')
  and has_column_privilege('authenticated',(select f from t),'ink','update')
  and ((select n from cols)=0 or (has_column_privilege('authenticated',(select f from t),'parent_note','insert') and has_column_privilege('authenticated',(select f from t),'parent_note','update'))) then '예' else '아니오' end;
