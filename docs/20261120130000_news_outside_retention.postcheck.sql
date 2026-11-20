-- SELECT only. 적용 뒤(기록 있음): 두 함수 DEFINER·search_path ''·service_role만, 외래 키 모양 그대로. 되돌린 뒤(기록 없음): 새 함수 없음.
-- 'cascade keys hash'는 precheck의 같은 이름 값과 같아야 한다(표·외래 키 변경 없음). 기사 줄 수·내용은 읽지 않는다.
with h as (select count(*) filter (where name='news_outside_retention') as named,count(*) as n from supabase_migrations.schema_migrations where version='20261120130000')
select 'functions agree with history' as item,case
  when h.n=1 and h.named=1 then case when (select count(*) from pg_proc p where p.oid in (to_regprocedure('public.app_news_prune(timestamptz,integer)'),to_regprocedure('public.app_outside_prune(timestamptz,integer)'))
      and p.prosecdef and p.proconfig=array['search_path=""'])=2 then '예' else '아니오' end
  when h.n=0 then case when to_regprocedure('public.app_outside_prune(timestamptz,integer)') is null then '예' else '아니오' end
  else '아니오' end as value
  from h
union all select 'service_role only',case when not exists(select 1 from pg_proc p where p.oid in (to_regprocedure('public.app_news_prune(timestamptz,integer)'),to_regprocedure('public.app_outside_prune(timestamptz,integer)'))
  and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute') or not has_function_privilege('service_role',p.oid,'execute')
       or p.proacl::text ~ '(^|[{,])(anon|authenticated)?=')) then '예' else '아니오' end
union all select 'cascade keys hash',md5(coalesce(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where contype='f' and confrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_news_items'),
  to_regclass('public.app_outside_articles'),to_regclass('public.app_outside_posts'));
