-- SELECT only. pg_catalog·migration 기록·메모 종류별 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·검사·정책이 함께 원래대로).
-- 원문 표 해시 다섯 줄은 precheck의 같은 이름 값과 같아야 한다(원문 표는 바뀌지 않는다).
with o as (select to_regclass('public.app_memos') as r),
history as (select count(*) filter(where name='memos_more_targets') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261125060000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''document''' and pg_get_constraintdef(oid) ~ '''meeting''' and pg_get_constraintdef(oid) ~ '''org_record''' and pg_get_constraintdef(oid) ~ '''telegram''') as with_new,
  count(*) filter(where pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) ~ '''news''' and pg_get_constraintdef(oid) ~ '''outside''' and pg_get_constraintdef(oid) ~ '''reading''' and pg_get_constraintdef(oid) ~ '''brief''') as with_prev,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_memos_target_type_check'),
pol as (select count(*) filter(where pg_get_expr(polwithcheck,polrelid) ~ 'app_documents' and pg_get_expr(polwithcheck,polrelid) ~ 'app_feed_items' and pg_get_expr(polwithcheck,polrelid) ~ 'app_workspace_has_feature') as with_new,
  count(*) filter(where pg_get_expr(polwithcheck,polrelid) ~ 'app_notes') as with_note,count(*) as n
  from pg_policy where polrelid=(select r from o) and polname='memos_owner_insert' and polcmd='a' and polpermissive and polroles=array['authenticated'::regrole]::oid[]),
rows as (select count(*) filter(where target_type in ('document','meeting','org_record','telegram')) as fresh from public.app_memos)
select 'type check, insert policy and history agree' as item,case when
  (history.n=0 and chk.n=1 and chk.with_new=0 and chk.with_prev=1 and pol.n=1 and pol.with_new=0 and pol.with_note=1 and rows.fresh=0)
  or (history.n=1 and history.named=1 and chk.n=1 and chk.with_new=1 and chk.with_prev=1 and pol.n=1 and pol.with_new=1 and pol.with_note=1)
  then '예' else '아니오' end as value
  from history,chk,pol,rows
union all select 'memos: RLS on, four owner policies for authenticated',case when (select relrowsecurity from pg_class where oid=(select r from o))
  and (select count(*) from pg_policy where polrelid=(select r from o))=4
  and (select count(*) from pg_policy where polrelid=(select r from o) and polroles=array['authenticated'::regrole]::oid[])=4 then '예' else '아니오' end
union all select 'memos: no anon, service_role or PUBLIC privileges',case when
  not has_table_privilege('anon',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select r from o),'select,insert,update,references')
  and not has_table_privilege('service_role',(select r from o),'select,insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from o) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'memos: authenticated updates text only',case when
  has_column_privilege('authenticated',(select r from o),'body','update')
  and not has_column_privilege('authenticated',(select r from o),'target_type','update')
  and not has_column_privilege('authenticated',(select r from o),'target_id','update')
  and not has_column_privilege('authenticated',(select r from o),'workspace_id','update')
  and has_table_privilege('authenticated',(select r from o),'select,delete') then '예' else '아니오' end
union all select 'target tables columns hash',md5(coalesce(string_agg(attrelid::regclass::text||'.'||attname||':'||format_type(atttypid,atttypmod),',' order by attrelid::regclass::text,attname),''))
  from pg_attribute where attrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items')) and attnum>0 and not attisdropped
union all select 'target tables constraints hash',md5(coalesce(string_agg(conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where conrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items'))
union all select 'target tables policies hash',md5(coalesce(string_agg(polrelid::regclass::text||'.'||polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),''))
  from pg_policy where polrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items'))
union all select 'target tables grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items'))
union all select 'target tables triggers hash',md5(coalesce(string_agg(tgrelid::regclass::text||'.'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),''))
  from pg_trigger where tgrelid in (to_regclass('public.app_documents'),to_regclass('public.app_meetings'),to_regclass('public.app_suborganizations'),to_regclass('public.app_suborganization_updates'),to_regclass('public.app_feed_items')) and not tgisinternal;
