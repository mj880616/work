-- SELECT only. pg_catalog·migration 기록·'user' 기사 개수만 읽는다. 적용 뒤 모두 예, 되돌린 뒤에도 모두 예(기록·검사·정책·함수가 함께 원래대로).
with a as (select to_regclass('public.app_news_articles') as r),
history as (select count(*) filter(where name='news_user_save') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261115230000'),
chk as (select count(*) filter(where pg_get_constraintdef(oid) ~ '''user''') as with_user,count(*) as n
  from pg_constraint where conrelid=(select r from a) and conname='app_news_articles_origin_check'),
pol as (select count(*) as n,count(*) filter(where policyname='news_articles_reader_select' and cmd='SELECT' and permissive='PERMISSIVE'
   and roles=array['authenticated']::name[] and qual ~ 'app_news_reader_ok') as reader,
  count(*) filter(where policyname='news_articles_reader_select' and qual ~ 'app_news_marked_by_me') as marked
  from pg_policies where schemaname='public' and tablename='app_news_articles'),
fn as (select to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') as save,to_regprocedure('private.app_news_marked_by_me(uuid)') as mine),
col as (select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_news_days') and attname='save_n' and not attisdropped),
rows as (select count(*) filter(where origin='user') as users from public.app_news_articles)
select 'origin check, policy, functions, column and history agree' as item,case when
  (history.n=0 and chk.n=1 and chk.with_user=0 and pol.n=2 and pol.reader=1 and pol.marked=0 and fn.save is null and fn.mine is null and col.n=0 and rows.users=0)
  or (history.n=1 and history.named=1 and chk.n=1 and chk.with_user=1 and pol.n=2 and pol.reader=1 and pol.marked=1 and fn.save is not null and fn.mine is not null and col.n=1)
  then '예' else '아니오' end as value
  from history,chk,pol,fn,col,rows
union all select 'articles: RLS on, no anon privilege, authenticated select only',case when (select relrowsecurity from pg_class where oid=(select r from a))
  and not has_table_privilege('anon',(select r from a),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated',(select r from a),'insert,update,delete,truncate,references,trigger')
  and not exists(select 1 from pg_class where oid=(select r from a) and relacl::text ~ '(^|[{,])=') then '예' else '아니오' end
union all select 'save function: service_role only',case when to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') is null
  or (not has_function_privilege('anon','public.app_news_user_save(uuid,text,text,jsonb)','execute')
   and not has_function_privilege('authenticated','public.app_news_user_save(uuid,text,text,jsonb)','execute')
   and has_function_privilege('service_role','public.app_news_user_save(uuid,text,text,jsonb)','execute')
   and (select prosecdef and proconfig is not null from pg_proc where oid='public.app_news_user_save(uuid,text,text,jsonb)'::regprocedure)) then '예' else '아니오' end
union all select 'marked function: authenticated only',case when to_regprocedure('private.app_news_marked_by_me(uuid)') is null
  or (not has_function_privilege('anon','private.app_news_marked_by_me(uuid)','execute')
   and has_function_privilege('authenticated','private.app_news_marked_by_me(uuid)','execute')
   and not exists(select 1 from pg_proc where oid='private.app_news_marked_by_me(uuid)'::regprocedure and (proacl is null or proacl::text ~ '(^|[{,])='))) then '예' else '아니오' end
union all select 'news days: no authenticated write',case when not has_table_privilege('authenticated','public.app_news_days','insert,update,delete')
  and not has_table_privilege('anon','public.app_news_days','select,insert,update,delete') then '예' else '아니오' end;
