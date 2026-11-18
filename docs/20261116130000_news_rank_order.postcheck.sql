-- SELECT only. 20261116130000_news_rank_order. Works after apply (record + 2 columns + CHECK + index) and after rollback/dry-run (none of them).
-- The hash items must equal the precheck values of the same name (no grant, policy, trigger, old index or old check change).
-- 값 확인은 행 내용 없이 개수 조건만: 등급은 1~3 또는 빈 값, 서울 날짜는 빈 값이거나 그 줄을 받은 날(서울)과 같다(적용 뒤 수집이 넣은 줄 포함).
with history as (
  select count(*) as n,count(*) filter(where name='news_rank_order') as named from supabase_migrations.schema_migrations where version='20261116130000'
), cols as (
  select count(*) as n from pg_attribute where attrelid=to_regclass('public.app_news_articles') and attname in ('news_rank','kst_day') and not attisdropped
), checks as (
  select count(*) as n from pg_constraint where conrelid=to_regclass('public.app_news_articles') and conname='app_news_articles_news_rank_check' and convalidated
), idx as (
  select count(*) as n from pg_indexes where schemaname='public' and tablename='app_news_articles' and indexname='app_news_articles_day_rank_idx'
)
select 'columns check index and history agree' as item,case when
  (history.n=0 and cols.n=0 and checks.n=0 and idx.n=0)
  or (history.n=1 and history.named=1 and cols.n=2 and checks.n=1 and idx.n=1) then '예' else '아니오' end as value
  from history,cols,checks,idx
union all select 'rank and day values in shape (or no column)',case when not exists(select 1 from public.app_news_articles a
  where (jsonb_typeof(to_jsonb(a)->'news_rank')='number' and (to_jsonb(a)->>'news_rank')::int not between 1 and 3)
     or (jsonb_typeof(to_jsonb(a)->'kst_day')='string' and (to_jsonb(a)->>'kst_day')::date <> (a.created_at at time zone 'Asia/Seoul')::date)) then '예' else '아니오' end
union all select 'RLS still enabled',case when exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relrowsecurity) then '예' else '아니오' end
union all select 'two reader policies',case when (select count(*) from pg_policy where polrelid=to_regclass('public.app_news_articles'))=2 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when not has_table_privilege('anon','public.app_news_articles','select,insert,update,delete')
  and not exists(select 1 from pg_class where oid=to_regclass('public.app_news_articles') and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end
union all select 'authenticated still read only',case when not has_table_privilege('authenticated','public.app_news_articles','insert,update,delete')
  and not has_any_column_privilege('authenticated','public.app_news_articles','insert,update') then '예' else '아니오' end
union all select 'old indexes hash',md5(coalesce(string_agg(indexname||':'||indexdef,',' order by indexname),'')) from pg_indexes
  where schemaname='public' and tablename='app_news_articles' and indexname<>'app_news_articles_day_rank_idx'
union all select 'old checks hash',md5(coalesce(string_agg(conname||':'||pg_get_constraintdef(oid),',' order by conname),'')) from pg_constraint
  where conrelid=to_regclass('public.app_news_articles') and conname<>'app_news_articles_news_rank_check'
union all select 'owner RLS grants hash',md5(coalesce(string_agg(relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),''),''))
  from pg_class where oid=to_regclass('public.app_news_articles')
union all select 'policies hash',md5(coalesce(string_agg(polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polname),''))
  from pg_policy where polrelid=to_regclass('public.app_news_articles')
union all select 'triggers hash',md5(coalesce(string_agg(tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgname),'')) from pg_trigger where tgrelid=to_regclass('public.app_news_articles') and not tgisinternal;
