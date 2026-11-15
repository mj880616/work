-- SELECT only. Counts, yes/no and hashes; no text, title or id. Run before dry-run/apply (also the dry-run before/after comparison).
-- 적용 전 기대: prerequisite recorded 예 / new migration absent 예 / fix table absent 예 / RLS enabled 예 / anon or public table privilege 아니오.
-- 'values with entity words'는 표기 낱말(quot; 등)이 든 칸 수(바뀔 칸 수의 위 한도, 기록만). 실제로 고칠 수는 migration이 세고 20000개 넘으면 멈춘다.
-- 나머지 행 수·해시는 사후 확인과 같은 값이어야 한다(고치는 글자 칸 밖의 칸, 권한·정책·트리거·제약 변경 없음, 행 추가·삭제 없음).
-- expect: prerequisite recorded = 예
-- expect: new migration absent = 예
-- expect: fix table absent = 예
-- expect: RLS enabled = 예
-- expect: anon or public table privilege = 아니오
-- expect: values with entity words = 기록
-- expect: news rows = 기록
-- expect: outside rows = 기록
-- expect: sentences rows = 기록
-- expect: bodies rows = 기록
-- expect: news other columns hash = 기록
-- expect: outside other columns hash = 기록
-- expect: sentences keys hash = 기록
-- expect: bodies other columns hash = 기록
-- expect: constraints hash = 기록
-- expect: owner RLS grants hash = 기록
-- expect: column grants hash = 기록
-- expect: policies hash = 기록
-- expect: triggers hash = 기록
with t4(n) as (values ('public.app_news_items'), ('public.app_outside_posts'), ('public.app_outside_sentences'), ('public.app_feed_bodies'))
select 'prerequisite recorded' as item,case when (select count(*) from supabase_migrations.schema_migrations
  where (version,name) in (('20261031230000','outside_statements'),('20261101233000','news_clipping'),('20261106050000','feed_bodies')))=3 then '예' else '아니오' end as value
union all select 'new migration absent',case when not exists(select 1 from supabase_migrations.schema_migrations where version='20261108010000') then '예' else '아니오' end
union all select 'fix table absent',case when to_regclass('public.app_feed_entity_fixes') is null then '예' else '아니오' end
union all select 'RLS enabled',case when (select count(*) from pg_class where oid in (select to_regclass(n) from t4) and relrowsecurity)=4 then '예' else '아니오' end
union all select 'anon or public table privilege',(select case when exists(select 1 from t4 where has_table_privilege('anon',to_regclass(n),'select,insert,update,delete'))
  or exists(select 1 from pg_class where oid in (select to_regclass(n) from t4) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end)
union all select 'values with entity words',(select count(*) from (
  select 1 from public.app_news_items n cross join lateral (values (n.title), (n.title_ko), (n.summary), (n.body), (n.body_ko), (n.publisher)) x(v) where v ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union all select 1 from public.app_outside_posts p cross join lateral (values (p.title), (p.title_ko), (p.summary_ko), (p.key_sentences::text)) x(v) where v ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union all select 1 from public.app_outside_sentences t where t.text ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union all select 1 from public.app_feed_bodies b where b.blocks::text ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);') d)::text
union all select 'news rows',(select count(*) from public.app_news_items)::text
union all select 'outside rows',(select count(*) from public.app_outside_posts)::text
union all select 'sentences rows',(select count(*) from public.app_outside_sentences)::text
union all select 'bodies rows',(select count(*) from public.app_feed_bodies)::text
union all select 'news other columns hash',(select md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||lane||':'||url||':'||url_key||':'||coalesce(title_key,'')||':'||lang||':'||coalesce(source_key,'')||':'||state||':'||coalesce(body_kind,'')||':'||coalesce(translated_at::text,'')||':'||coalesce(published_at::text,''),',' order by id),'')) from public.app_news_items)
union all select 'outside other columns hash',(select md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||source_key||':'||kind||':'||lang||':'||url||':'||coalesce(author,'')||':'||coalesce(published_at::text,'')||':'||has_body::text||':'||jsonb_array_length(key_sentences)::text,',' order by id),'')) from public.app_outside_posts)
union all select 'sentences keys hash',(select md5(coalesce(string_agg(post_id::text||':'||idx::text||':'||workspace_id::text||':'||lang,',' order by post_id,idx),'')) from public.app_outside_sentences)
union all select 'bodies other columns hash',(select md5(coalesce(string_agg(id::text||':'||workspace_id::text||':'||coalesce(news_item_id::text,'')||':'||coalesce(outside_post_id::text,'')||':'||state||':'||coalesce(reason,'')||':'||coalesce(rule,'')||':'||chars::text||':'||images::text||':'||jsonb_path_query_array(blocks,'$[*].t')::text||':'||jsonb_path_query_array(blocks,'$[*].src')::text,',' order by id),'')) from public.app_feed_bodies)
union all select 'constraints hash',(select md5(coalesce(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),',' order by conrelid::regclass::text,conname),'')) from pg_constraint where conrelid in (select to_regclass(n) from t4))
union all select 'owner RLS grants hash',(select md5(coalesce(string_agg(relname||':'||relowner::text||':'||relrowsecurity::text||':'||relforcerowsecurity::text||':'||coalesce(relacl::text,''),',' order by relname),'')) from pg_class where oid in (select to_regclass(n) from t4))
union all select 'column grants hash',(select md5(coalesce(string_agg(attrelid::regclass::text||':'||attname||':'||coalesce(attacl::text,''),',' order by attrelid::regclass::text,attname),'')) from pg_attribute where attrelid in (select to_regclass(n) from t4) and attnum>0 and not attisdropped)
union all select 'policies hash',(select md5(coalesce(string_agg(polrelid::regclass::text||':'||polname::text||polcmd::text||polroles::text||coalesce(pg_get_expr(polqual,polrelid),'')||coalesce(pg_get_expr(polwithcheck,polrelid),''),',' order by polrelid::regclass::text,polname),'')) from pg_policy where polrelid in (select to_regclass(n) from t4))
union all select 'triggers hash',(select md5(coalesce(string_agg(tgrelid::regclass::text||':'||tgname||':'||tgenabled::text||':'||pg_get_triggerdef(oid),',' order by tgrelid::regclass::text,tgname),'')) from pg_trigger where tgrelid in (select to_regclass(n) from t4) and not tgisinternal);
