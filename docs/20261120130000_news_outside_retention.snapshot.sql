-- SELECT only. 적용 전에 저장. 시스템 카탈로그와 migration 기록만(앱 표 줄은 읽지 않음).
-- 정리 함수 둘의 정의(본문 해시·DEFINER·search_path·실행권)와 지우는 표를 가리키는 외래 키 모양.
select 'function' as kind,p.oid::regprocedure::text as name,p.prosecdef::text||':'||coalesce(p.proconfig::text,'none')||':'||coalesce(p.proacl::text,'none')||':'||md5(p.prosrc) as definition
  from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('app_news_prune','app_outside_prune')
union all select 'foreign key',conrelid::regclass::text||'.'||conname,pg_get_constraintdef(oid) from pg_constraint
  where contype='f' and confrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_news_items'),to_regclass('public.app_outside_articles'),to_regclass('public.app_outside_posts'))
union all select 'history',version,name from supabase_migrations.schema_migrations where version in ('20261101233000','20261119000000','20261120130000')
order by 1,2;
