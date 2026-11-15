-- SELECT only. Works after apply (record and fix table present, no value left that the fix rules would change)
-- and after rollback/dry-run (no record, no fix table). No text, title or id is shown: only yes/no, counts and hashes.
-- The fix table is only named through to_regclass (this file also runs after the rollback).
-- The count/hash items must equal the precheck values of the same name (only the listed text columns change; no grant, policy, trigger or constraint change; no row added or removed).
-- 적용 뒤 'fix agrees with history'가 아니오면 고친 뒤 옛 수집 함수가 깨진 글자를 또 넣은 것이다(Edge 배포를 먼저 한다).
with recursive t4(n) as (values ('public.app_news_items'), ('public.app_outside_posts'), ('public.app_outside_sentences'), ('public.app_feed_bodies')),
r(ord, pat, ch, flags) as (values
    (1, '&(amp;)*amp;', '&', 'gi'),
    (2, '&(amp;)*#38;', '&', 'gi'),
    (3, '&(amp;)*#038;', '&', 'gi'),
    (4, '&(amp;)*amp;', '&', 'gi'),
    (5, '&(amp;)*#38;', '&', 'gi'),
    (6, '&(amp;)*#038;', '&', 'gi'),
    (7, '&(amp;)*amp;', '&', 'gi'),
    (8, '&(amp;)*#38;', '&', 'gi'),
    (9, '&(amp;)*#038;', '&', 'gi'),
    (10, '&(amp;)*amp;', '&', 'gi'),
    (11, '&(amp;)*#38;', '&', 'gi'),
    (12, '&(amp;)*#038;', '&', 'gi'),
    (13, '&(amp;)*amp;', '&', 'gi'),
    (14, '&(amp;)*#38;', '&', 'gi'),
    (15, '&(amp;)*#038;', '&', 'gi'),
    (16, '&(amp;)*amp;', '&', 'gi'),
    (17, '&(amp;)*#38;', '&', 'gi'),
    (18, '&(amp;)*#038;', '&', 'gi'),
    (19, '&(amp;)*amp;', '&', 'gi'),
    (20, '&(amp;)*#38;', '&', 'gi'),
    (21, '&(amp;)*#038;', '&', 'gi'),
    (22, '&(amp;)*amp;', '&', 'gi'),
    (23, '&(amp;)*#38;', '&', 'gi'),
    (24, '&(amp;)*#038;', '&', 'gi'),
    (25, '&(amp;)*quot;', '"', 'gi'),
    (26, '&(amp;)*apos;', '''', 'gi'),
    (27, '&(amp;)*lt;', '<', 'gi'),
    (28, '&(amp;)*gt;', '>', 'gi'),
    (29, '&(amp;)*nbsp;', ' ', 'gi'),
    (30, '&(amp;)*middot;', '·', 'gi'),
    (31, '&(amp;)*hellip;', '…', 'gi'),
    (32, '&(amp;)*lsquo;', '‘', 'gi'),
    (33, '&(amp;)*rsquo;', '’', 'gi'),
    (34, '&(amp;)*ldquo;', '“', 'gi'),
    (35, '&(amp;)*rdquo;', '”', 'gi'),
    (36, '&(amp;)*ndash;', '–', 'gi'),
    (37, '&(amp;)*mdash;', '—', 'gi'),
    (38, '&(amp;)*laquo;', '«', 'gi'),
    (39, '&(amp;)*raquo;', '»', 'gi'),
    (40, '&(amp;)*bull;', '•', 'gi'),
    (41, '&(amp;)*#39;', '''', 'gi'),
    (42, '&(amp;)*#039;', '''', 'gi'),
    (43, '&(amp;)*#x27;', '''', 'gi'),
    (44, '&(amp;)*#34;', '"', 'gi'),
    (45, '&(amp;)*#034;', '"', 'gi'),
    (46, '&(amp;)*#x22;', '"', 'gi'),
    (47, '&(amp;)*#183;', '·', 'gi'),
    (48, '&(amp;)*#8216;', '‘', 'gi'),
    (49, '&(amp;)*#8217;', '’', 'gi'),
    (50, '&(amp;)*#8220;', '“', 'gi'),
    (51, '&(amp;)*#8221;', '”', 'gi'),
    (52, '&(amp;)*#8230;', '…', 'gi'),
    (53, '&(amp;)*#8211;', '–', 'gi'),
    (54, '&(amp;)*#8212;', '—', 'gi'),
    (55, '&(amp;)*#160;', ' ', 'gi'),
    (56, '(?<!&)(amp;)*#39;', '''', 'g'),
    (57, '(?<!&)(amp;)*#039;', '''', 'g'),
    (58, '(?<!&)(amp;)*#x27;', '''', 'g'),
    (59, '(?<!&)(amp;)*#34;', '"', 'g'),
    (60, '(?<!&)(amp;)*#034;', '"', 'g'),
    (61, '(?<!&)(amp;)*#x22;', '"', 'g'),
    (62, '(?<!&)(amp;)*#183;', '·', 'g'),
    (63, '(?<!&)(amp;)*#8216;', '‘', 'g'),
    (64, '(?<!&)(amp;)*#8217;', '’', 'g'),
    (65, '(?<!&)(amp;)*#8220;', '“', 'g'),
    (66, '(?<!&)(amp;)*#8221;', '”', 'g'),
    (67, '(?<!&)(amp;)*#8230;', '…', 'g'),
    (68, '(?<!&)(amp;)*#8211;', '–', 'g'),
    (69, '(?<!&)(amp;)*#8212;', '—', 'g'),
    (70, '(?<!&)(amp;)*#160;', ' ', 'g'),
    (71, '(?<!&)(amp;)*#38;', '&', 'g'),
    (72, '(?<!&)(amp;)*#038;', '&', 'g'),
    (73, '(?<![A-Za-z0-9&])(amp;)*quot;', '"', 'g'),
    (74, '(?<![A-Za-z0-9&])(amp;)*apos;', '''', 'g'),
    (75, '(?<![A-Za-z0-9&])(amp;)*lt;', '<', 'g'),
    (76, '(?<![A-Za-z0-9&])(amp;)*gt;', '>', 'g'),
    (77, '(?<![A-Za-z0-9&])(amp;)*nbsp;', ' ', 'g'),
    (78, '(?<![A-Za-z0-9&])(amp;)*middot;', '·', 'g'),
    (79, '(?<![A-Za-z0-9&])(amp;)*hellip;', '…', 'g'),
    (80, '(?<![A-Za-z0-9&])(amp;)*lsquo;', '‘', 'g'),
    (81, '(?<![A-Za-z0-9&])(amp;)*rsquo;', '’', 'g'),
    (82, '(?<![A-Za-z0-9&])(amp;)*ldquo;', '“', 'g'),
    (83, '(?<![A-Za-z0-9&])(amp;)*rdquo;', '”', 'g'),
    (84, '(?<![A-Za-z0-9&])(amp;)*ndash;', '–', 'g'),
    (85, '(?<![A-Za-z0-9&])(amp;)*mdash;', '—', 'g'),
    (86, '(?<![A-Za-z0-9&])(amp;)*laquo;', '«', 'g'),
    (87, '(?<![A-Za-z0-9&])(amp;)*raquo;', '»', 'g'),
    (88, '(?<![A-Za-z0-9&])(amp;)*bull;', '•', 'g'),
    (89, '(?<![A-Za-z0-9&])(amp;)*amp;', '&', 'g')
),
s(v) as (
  select v from public.app_news_items n cross join lateral (values (n.title), (n.title_ko), (n.summary), (n.body), (n.body_ko), (n.publisher)) x(v) where v ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select v from public.app_outside_posts p cross join lateral (values (p.title), (p.title_ko), (p.summary_ko)) x(v) where v ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select k.value #>> '{}' from public.app_outside_posts p cross join lateral jsonb_array_elements(case when jsonb_typeof(p.key_sentences) = 'array' then p.key_sentences else '[]'::jsonb end) e
    cross join lateral jsonb_each(case when jsonb_typeof(e) = 'object' then e else '{}'::jsonb end) k where jsonb_typeof(k.value) = 'string' and k.value #>> '{}' ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select t.text from public.app_outside_sentences t where t.text ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
  union select k.value #>> '{}' from public.app_feed_bodies b cross join lateral jsonb_array_elements(case when jsonb_typeof(b.blocks) = 'array' then b.blocks else '[]'::jsonb end) e
    cross join lateral jsonb_each(case when jsonb_typeof(e) = 'object' then e else '{}'::jsonb end) k
    where k.key in ('text', 'cap', 'alt') and jsonb_typeof(k.value) = 'string' and k.value #>> '{}' ~* '(quot|apos|amp|lt|gt|nbsp|middot|hellip|lsquo|rsquo|ldquo|rdquo|ndash|mdash|laquo|raquo|bull|#0?39|#x27|#0?34|#x22|#0?38|#183|#8216|#8217|#8220|#8221|#8230|#8211|#8212|#160);'
),
fx(v, step, f) as (
  select v, 0, v from s
  union all
  select fx.v, fx.step + 1, regexp_replace(fx.f, r.pat, r.ch, r.flags) from fx join r on r.ord = fx.step + 1
),
left_over as (select count(*) as n from fx where step = (select max(ord) from r) and f <> v),
t as (select to_regclass('public.app_feed_entity_fixes') as b),
h as (select count(*) filter (where name='feed_entity_text_fix') as named, count(*) as n from supabase_migrations.schema_migrations where version='20261108010000')
select 'fix agrees with history' as item,case
  when h.n=1 and h.named=1 and t.b is not null then case when (select n from left_over)=0 then '예' else '아니오' end
  when h.n=0 and t.b is null then '예' else '아니오' end as value
  from t,h
union all select 'fix table locked',case when (select b from t) is null or (
  exists(select 1 from pg_class where oid=(select b from t) and relrowsecurity)
  and not exists(select 1 from pg_policy where polrelid=(select b from t))
  and not has_table_privilege('anon',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role',(select b from t),'select,insert,update,delete,truncate,references,trigger')
  and not has_any_column_privilege('anon',(select b from t),'select,insert,update,references')
  and not has_any_column_privilege('authenticated',(select b from t),'select,insert,update,references')
  and not exists(select 1 from pg_class where oid=(select b from t) and relacl::text ~ '(^|[{,])=')) then '예' else '아니오' end
union all select 'RLS still enabled',case when (select count(*) from pg_class where oid in (select to_regclass(n) from t4) and relrowsecurity)=4 then '예' else '아니오' end
union all select 'no anon or public table privilege',case when (select case when exists(select 1 from t4 where has_table_privilege('anon',to_regclass(n),'select,insert,update,delete'))
  or exists(select 1 from pg_class where oid in (select to_regclass(n) from t4) and relacl::text ~ '(^|[{,])(anon)?=') then '예' else '아니오' end)='아니오' then '예' else '아니오' end
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
