-- SELECT only. pg_catalog·migration 기록·메모 종류별 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·검사·정책이 함께 원래대로).
-- 연결 표 해시 다섯 줄은 precheck의 같은 이름 값과 같아야 한다(연결 표는 바뀌지 않는다).
with o as (select to_regclass('public.app_memos') as r),
history as (select count(*) filter(where name='memos_record_link') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261127030000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''record_link''') as with_new,
  count(*) filter(where pg_get_constraintdef(oid) ~ '''note''' and pg_get_constraintdef(oid) ~ '''brief''' and pg_get_constraintdef(oid) ~ '''document''' and pg_get_constraintdef(oid) ~ '''org_record''' and pg_get_constraintdef(oid) ~ '''telegram''') as with_prev,count(*) as n
  from pg_constraint where conrelid=(select r from o) and conname='app_memos_target_type_check'),
pol as (select count(*) filter(where pg_get_expr(polwithcheck,polrelid) ~ 'app_record_links') as with_new,
  count(*) filter(where pg_get_expr(polwithcheck,polrelid) ~ 'app_notes' and pg_get_expr(polwithcheck,polrelid) ~ 'app_feed_items' and pg_get_expr(polwithcheck,polrelid) ~ 'app_workspace_has_feature') as with_prev,count(*) as n
  from pg_policy where polrelid=(select r from o) and polname='memos_owner_insert' and polcmd='a' and polpermissive and polroles=array['authenticated'::regrole]::oid[]),
rows as (select count(*) filter(where target_type='record_link') as fresh from public.app_memos)
select 'type check, insert policy and history agree' as item,case when
  (history.n=0 and chk.n=1 and chk.with_new=0 and chk.with_prev=1 and pol.n=1 and pol.with_new=0 and pol.with_prev=1 and rows.fresh=0)
  or (history.n=1 and history.named=1 and chk.n=1 and chk.with_new=1 and chk.with_prev=1 and pol.n=1 and pol.with_new=1 and pol.with_prev=1)
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
union all select 'link table columns hash',md5(coalesce(string_agg(attname||':'||format_type(atttypid,atttypmod),',' order by attname),''))
  from pg_attribute where attrelid=to_regclass('public.app_record_links') and attnum>0 and not attisdropped
union all select 'link table constraints hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),''))
  from pg_constraint where conrelid=to_regclass('public.app_record_links')
union all select 'link table policies hash',md5(coalesce(string_agg(polname||polcmd::text||polroles::text||polpermissive::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_record_links')
union all select 'link table grants hash',md5(coalesce(string_agg(c.relname||':'||c.relrowsecurity::text||':'||coalesce(c.relacl::text,'')||':'||coalesce((select string_agg(a.attname||'='||a.attacl::text,',' order by a.attname) from pg_attribute a where a.attrelid=c.oid and a.attacl is not null),''),',' order by c.relname),''))
  from pg_class c where c.oid=to_regclass('public.app_record_links')
union all select 'link table triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),''))
  from pg_trigger where tgrelid=to_regclass('public.app_record_links') and not tgisinternal;
