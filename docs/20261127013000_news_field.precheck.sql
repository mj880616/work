-- SELECT only. 20261127013000_news_field. Aggregates and hashes only; no article text. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite 예 / new migration absent 예 / new column 0 / new check 0 / RLS 예 / anon 아니오 /
--   authenticated read only 예 / service_role can write 예 / two reader policies 예. 그 밖의 해시는 사후 확인과 같은 값이어야 한다(기록만).
-- 기사 수는 수집이 언제든 줄을 넣으므로 비교하지 않는다. 해시는 표 권한·정책·트리거와 색인·기존 검사만 본다(새 검사는 이름으로 빼고 셈).
-- expect: new column count = 0
-- expect: new check count = 0
-- expect: recent migrations = 기록
-- expect: anon or public table privilege = 아니오
-- expect: policies hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: triggers hash = 기록
-- expect: indexes hash = 기록
-- expect: old checks hash = 기록
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations where version='20261116130000' and name='news_rank_order')=1 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261127013000') then '예' else '아니오' end
union all select 'recent migrations',(select string_agg(version||':'||name,' / ' order by version desc) from (select version,name from supabase_migrations.schema_migrations order by version desc limit 3) r)
union all select 'new column count',count(*)::text from pg_attribute where attrelid=to_regclass('public.app_news_articles') and attname='news_field' and not attisdropped
union all select 'new check count',(select count(*) from pg_constraint where conrelid=to_regclass('public.app_news_articles') and conname='app_news_articles_news_field_check')::text
union all select 'RLS enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relrowsecurity) then '예' else '아니오' end
union all select 'anon or public table privilege',case when has_table_privilege('anon','public.app_news_articles','select,insert,update,delete')
  or exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'authenticated read only',case when has_table_privilege('authenticated','public.app_news_articles','select')
  and not has_table_privilege('authenticated','public.app_news_articles','insert,update,delete')
  and not has_any_column_privilege('authenticated','public.app_news_articles','insert,update') then '예' else '아니오' end
union all select 'service_role can write',case when has_table_privilege('service_role','public.app_news_articles','insert,update') then '예' else '아니오' end
union all select 'two reader policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_articles'))=2
  and (select count(*) from pg_policies where schemaname='public' and tablename='app_news_articles' and policyname in ('news_articles_reader_select','news_articles_scrap_operator_select')
    and cmd='SELECT' and permissive='PERMISSIVE' and roles=array['authenticated']::name[])=2 then '예' else '아니오' end
union all select 'indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes
  where schemaname='public' and tablename='app_news_articles'
union all select 'old checks hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint
  where conrelid=to_regclass('public.app_news_articles') and conname<>'app_news_articles_news_field_check'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_news_articles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_news_articles')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_news_articles') and not tgisinternal;
