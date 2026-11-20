-- SELECT only. 카탈로그·migration 기록·권한만(기사 줄 수·제목·id·시각은 읽지 않음 — 수집기가 도는 동안에도 값이 바뀌지 않게).
-- 적용 전 기대: 앞 migration 기록 예 / 이번 기록 없음 예 / 새 함수 없음 예 / 지금 정리 함수 DEFINER·service_role만 예.
-- 'news prune body hash'는 지금(news_clipping 판) 함수 본문 해시(기록만). 사후 확인에서는 바뀐 본문이므로 비교하지 않는다.
-- expect: prerequisites recorded = 예
-- expect: new migration absent = 예
-- expect: outside prune absent = 예
-- expect: news prune definer service_role only = 예
-- expect: news prune body hash = 기록
-- expect: kept-source tables present = 예
-- expect: cascade keys hash = 기록
select 'prerequisites recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where (version,name) in
  (('20261101233000','news_clipping'),('20261115140000','news_for_all_refs'),('20261115150000','outside_for_all'),('20261115230000','news_user_save'),('20261119000000','news_hand_fill')))=5
  then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261120130000') then '예' else '아니오' end
union all select 'outside prune absent',case when to_regprocedure('public.app_outside_prune(timestamptz,integer)') is null then '예' else '아니오' end
union all select 'news prune definer service_role only',case when exists(select 1 from pg_proc where oid=to_regprocedure('public.app_news_prune(timestamptz,integer)')
  and prosecdef and proconfig=array['search_path=""'])
  and has_function_privilege('service_role','public.app_news_prune(timestamptz,integer)','execute')
  and not has_function_privilege('authenticated','public.app_news_prune(timestamptz,integer)','execute')
  and not has_function_privilege('anon','public.app_news_prune(timestamptz,integer)','execute') then '예' else '아니오' end
union all select 'news prune body hash',coalesce((select md5(prosrc) from pg_proc where oid=to_regprocedure('public.app_news_prune(timestamptz,integer)')),'없음')
union all select 'kept-source tables present',case when to_regclass('public.app_notes') is not null and to_regclass('public.app_news_highlights') is not null
  and to_regclass('public.app_news_marks') is not null and to_regclass('public.app_news_id_map') is not null and to_regclass('public.app_outside_article_marks') is not null
  and to_regclass('public.app_outside_marks') is not null and to_regclass('public.app_outside_id_map') is not null then '예' else '아니오' end
-- 지우는 표를 가리키는 외래 키(무엇이 같이 지워지는지)의 모양. 적용은 이것을 바꾸지 않는다.
union all select 'cascade keys hash',md5(coalesce(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),''))
  from pg_constraint where contype='f' and confrelid in (to_regclass('public.app_news_articles'),to_regclass('public.app_news_items'),
  to_regclass('public.app_outside_articles'),to_regclass('public.app_outside_posts'));
