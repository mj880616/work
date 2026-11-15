begin;
-- S62-12d NEWS-모두에게열기 E2 보충 DB. 설계: docs/design/news-for-all.md 13절. 앞 단계: D2 20261115140000_news_for_all_refs(#2636, 운영 적용).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- [사실] D2 적용 뒤 수집기(E1)가 옛 표(app_news_items)에 넣은 새 줄은 지도(app_news_id_map)에 없다(#2636 커맨드센터 댓글). 화면이 옛 표에 쓰는
-- 읽음(app_feed_reads)·반응(app_now_signals), ai-assist가 쓰는 한 건 자세히(app_now_details)도 D2 뒤 줄은 사람별 새 표에 없다.
-- 그래서 서버 전용 보충 함수를 하나 더하고, 적용 때 한 번 불러 그 사이 빠진 줄을 채운다. 뒤로는 news-feed prune 단계가 실행마다 부른다(E2 Edge).
--  public.app_news_refs_sync(p_limit integer) returns jsonb — SECURITY DEFINER, 빈 search_path, 실행 권한 service_role만.
--   1) 옛 표에만 있는 주소 → 공용 기사(D1·D2와 같은 규칙: 대표 줄 = 운영자 작업공간 줄 → 먼저 생긴 줄 → id 순, 채널 스크랩만 있던 주소는 'tg_scrap',
--      대표 줄 id가 이미 쓰였으면 새 id). 텔레그램에서 오는 새 길이 아니다 — 옛 표 줄(이미 운영자·매체 수집분)을 같은 규칙으로 옮길 뿐.
--   2) 지도에 없는 옛 줄 → 같은 주소 공용 기사로 지도 1줄(작업공간 그대로).
--   3) 공용 본문 블록이 없는 기사 → 대표 옛 블록 1줄(옛 id = 기사 id 줄 → 최근 추출). 이미 있는 공용 블록은 고치지 않는다.
--   4) 읽음·5) 한 건 자세히(새 표 것보다 새로 만든 것만 고침)·6) 반응(같은 id) — 옛 줄과 같은 작업공간 것만(지도 작업공간 = 옛 줄 작업공간 조건).
--   모든 넣기는 겹치면 무시(on conflict do nothing / 자세히만 더 새것으로 고침) → 여러 번 불러도 같다. 단계마다 p_limit(1~100000)줄까지.
--   돌려주는 값: 단계마다 넣은 줄 수({articles, map, bodies, reads, details, signals})뿐(줄 내용 없음).
-- 안 하는 것: 기존 표·칸·정책·권한·트리거·외래 키·함수 변경, 기존 줄 변경·삭제(공용 자세히 줄을 더 새 옛 줄로 고치는 것만 예외), anon·PUBLIC·authenticated 권한,
--   RLS 끄기, rtw_* 객체, 사회운동 글(D1b 별도). 표를 잠그지 않는다(수집기와 경주하지 않게 사후 확인은 '적용 시각 1분 전까지 생긴 줄' 기준).
set local statement_timeout = '120s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115140000' and name = 'news_for_all_refs') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115100000' and name = 'news_for_all') <> 1
     or to_regclass('public.app_news_items') is null
     or to_regclass('public.app_news_articles') is null
     or to_regclass('public.app_news_id_map') is null
     or to_regclass('public.app_news_article_bodies') is null
     or to_regclass('public.app_news_reads') is null
     or to_regclass('public.app_news_now_details') is null
     or to_regclass('public.app_news_now_signals') is null
     or to_regclass('public.app_operator_features') is null
     or to_regprocedure('public.app_news_refs_sync(integer)') is not null
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_news_articles') and relrowsecurity)
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_id_map', 'select,insert,update,references') then
    raise exception 'NEWS_REFS_SYNC_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 거절 오류(고정): 22023 NEWSREFS_ARGS.
create function public.app_news_refs_sync(p_limit integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_articles integer := 0;
  v_map integer := 0;
  v_bodies integer := 0;
  v_reads integer := 0;
  v_details integer := 0;
  v_signals integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100000 then
    raise exception using errcode = '22023', message = 'NEWSREFS_ARGS';
  end if;

  -- 1) 옛 표에만 있는 주소 → 공용 기사(D2 7-1과 같은 규칙).
  insert into public.app_news_articles (id, origin, lane, url, url_key, title, title_key, lang, publisher, source_key,
    published_at, scrapped_at, fetched_at, state, summary, body, body_kind, title_ko, body_ko, translated_at, title_tried_at, created_at, updated_at)
  select case when exists (select 1 from public.app_news_articles x where x.id = r.id) then gen_random_uuid() else r.id end,
         case when exists (select 1 from public.app_news_items o where o.url_key = r.url_key and o.lane <> 'channel') then 'site' else 'tg_scrap' end,
         r.lane, r.url, r.url_key, r.title, r.title_key, r.lang, r.publisher, r.source_key,
         r.published_at, r.scrapped_at, r.fetched_at, r.state, r.summary, r.body, r.body_kind, r.title_ko, r.body_ko, r.translated_at, r.title_tried_at,
         r.created_at, r.updated_at
    from (select distinct on (i.url_key) i.*
            from public.app_news_items i
           where not exists (select 1 from public.app_news_articles a where a.url_key = i.url_key)
           order by i.url_key,
                    (i.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')) desc,
                    i.created_at, i.id
           limit p_limit) r
  on conflict do nothing;
  get diagnostics v_articles = row_count;

  -- 2) 지도에 없는 옛 줄 → 같은 주소 공용 기사.
  insert into public.app_news_id_map (old_id, workspace_id, article_id)
  select i.id, i.workspace_id, a.id
    from public.app_news_items i
    join public.app_news_articles a on a.url_key = i.url_key
   where not exists (select 1 from public.app_news_id_map m where m.old_id = i.id)
   order by i.created_at, i.id
   limit p_limit
  on conflict do nothing;
  get diagnostics v_map = row_count;

  -- 3) 공용 본문 블록이 없는 기사 → 대표 옛 블록(옛 id = 기사 id 줄 → 최근 추출 → 먼저 생긴 줄).
  insert into public.app_news_article_bodies (article_id, blocks, state, reason, rule, chars, images, extracted_at, created_at, updated_at)
  select x.article_id, x.blocks, x.state, x.reason, x.rule, x.chars, x.images, x.extracted_at, x.created_at, x.updated_at
    from (select distinct on (m.article_id) m.article_id, b.blocks, b.state, b.reason, b.rule, b.chars, b.images, b.extracted_at, b.created_at, b.updated_at
            from public.app_feed_bodies b
            join public.app_news_id_map m on m.old_id = b.news_item_id and m.workspace_id = b.workspace_id
           where b.news_item_id is not null
             and not exists (select 1 from public.app_news_article_bodies n where n.article_id = m.article_id)
           order by m.article_id, (b.news_item_id = m.article_id) desc, b.extracted_at desc, b.created_at, b.id) x
   limit p_limit
  on conflict do nothing;
  get diagnostics v_bodies = row_count;

  -- 4) 읽음: 작업공간마다(같은 기사 여러 줄이면 먼저 읽은 시각). 옛 줄과 같은 작업공간만.
  insert into public.app_news_reads (workspace_id, article_id, read_at)
  select r.workspace_id, m.article_id, min(r.read_at)
    from public.app_feed_reads r
    join public.app_news_id_map m on m.old_id = r.news_item_id and m.workspace_id = r.workspace_id
   where r.news_item_id is not null
     and not exists (select 1 from public.app_news_reads n where n.workspace_id = r.workspace_id and n.article_id = m.article_id)
   group by r.workspace_id, m.article_id
   limit p_limit
  on conflict do nothing;
  get diagnostics v_reads = row_count;

  -- 5) 한 건 자세히: 작업공간마다 최근 만든 것. 새 표 줄보다 새로 만든 옛 줄만 넣거나 고친다.
  insert into public.app_news_now_details (workspace_id, article_id, level, summary, key_sentences, relevance, implications, related,
    interests_key, generated_at, context_at, created_at, updated_at)
  select x.workspace_id, x.article_id, x.level, x.summary, x.key_sentences, x.relevance, x.implications, x.related,
         x.interests_key, x.generated_at, x.context_at, x.created_at, x.updated_at
    from (select distinct on (d.workspace_id, m.article_id) d.workspace_id, m.article_id, d.level, d.summary, d.key_sentences, d.relevance, d.implications,
                 d.related, d.interests_key, d.generated_at, d.context_at, d.created_at, d.updated_at
            from public.app_now_details d
            join public.app_news_id_map m on m.old_id = d.news_item_id and m.workspace_id = d.workspace_id
           where d.news_item_id is not null
           order by d.workspace_id, m.article_id, d.generated_at desc, d.id) x
   where not exists (select 1 from public.app_news_now_details n
                      where n.workspace_id = x.workspace_id and n.article_id = x.article_id and n.generated_at >= x.generated_at)
   limit p_limit
  on conflict (workspace_id, article_id) do update
     set level = excluded.level, summary = excluded.summary, key_sentences = excluded.key_sentences, relevance = excluded.relevance,
         implications = excluded.implications, related = excluded.related, interests_key = excluded.interests_key,
         generated_at = excluded.generated_at, context_at = excluded.context_at, updated_at = excluded.updated_at
   where public.app_news_now_details.generated_at < excluded.generated_at;
  get diagnostics v_details = row_count;

  -- 6) 반응: 같은 id 그대로(옛 줄과 같은 작업공간만).
  insert into public.app_news_now_signals (id, workspace_id, article_id, action, created_at)
  select s.id, s.workspace_id, m.article_id, s.action, s.created_at
    from public.app_now_signals s
    join public.app_news_id_map m on m.old_id = s.news_item_id and m.workspace_id = s.workspace_id
   where s.news_item_id is not null
     and not exists (select 1 from public.app_news_now_signals n where n.id = s.id)
   order by s.created_at, s.id
   limit p_limit
  on conflict do nothing;
  get diagnostics v_signals = row_count;

  return pg_catalog.jsonb_build_object('articles', v_articles, 'map', v_map, 'bodies', v_bodies, 'reads', v_reads,
    'details', v_details, 'signals', v_signals);
end
$$;
revoke all on function public.app_news_refs_sync(integer) from public, anon, authenticated, service_role;
grant execute on function public.app_news_refs_sync(integer) to service_role;

-- 적용 때 한 번: D2 뒤 쌓인 줄을 채운다. 승인형 workflow 규칙이 migration 안 함수 호출을 받지 않으므로 함수와 같은 넣기를 상한 없이 그대로 쓴다
-- (위 함수 본문 1~6과 같은 SQL — 고칠 때 둘 다 고친다. 시험이 두 곳의 SQL이 같은지 본다).
-- 1) 옛 표에만 있는 주소 → 공용 기사(D2 7-1과 같은 규칙).
insert into public.app_news_articles (id, origin, lane, url, url_key, title, title_key, lang, publisher, source_key,
  published_at, scrapped_at, fetched_at, state, summary, body, body_kind, title_ko, body_ko, translated_at, title_tried_at, created_at, updated_at)
select case when exists (select 1 from public.app_news_articles x where x.id = r.id) then gen_random_uuid() else r.id end,
       case when exists (select 1 from public.app_news_items o where o.url_key = r.url_key and o.lane <> 'channel') then 'site' else 'tg_scrap' end,
       r.lane, r.url, r.url_key, r.title, r.title_key, r.lang, r.publisher, r.source_key,
       r.published_at, r.scrapped_at, r.fetched_at, r.state, r.summary, r.body, r.body_kind, r.title_ko, r.body_ko, r.translated_at, r.title_tried_at,
       r.created_at, r.updated_at
  from (select distinct on (i.url_key) i.*
          from public.app_news_items i
         where not exists (select 1 from public.app_news_articles a where a.url_key = i.url_key)
         order by i.url_key,
                  (i.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')) desc,
                  i.created_at, i.id) r
on conflict do nothing;

-- 2) 지도에 없는 옛 줄 → 같은 주소 공용 기사.
insert into public.app_news_id_map (old_id, workspace_id, article_id)
select i.id, i.workspace_id, a.id
  from public.app_news_items i
  join public.app_news_articles a on a.url_key = i.url_key
 where not exists (select 1 from public.app_news_id_map m where m.old_id = i.id)
 order by i.created_at, i.id
on conflict do nothing;

-- 3) 공용 본문 블록이 없는 기사 → 대표 옛 블록(옛 id = 기사 id 줄 → 최근 추출 → 먼저 생긴 줄).
insert into public.app_news_article_bodies (article_id, blocks, state, reason, rule, chars, images, extracted_at, created_at, updated_at)
select x.article_id, x.blocks, x.state, x.reason, x.rule, x.chars, x.images, x.extracted_at, x.created_at, x.updated_at
  from (select distinct on (m.article_id) m.article_id, b.blocks, b.state, b.reason, b.rule, b.chars, b.images, b.extracted_at, b.created_at, b.updated_at
          from public.app_feed_bodies b
          join public.app_news_id_map m on m.old_id = b.news_item_id and m.workspace_id = b.workspace_id
         where b.news_item_id is not null
           and not exists (select 1 from public.app_news_article_bodies n where n.article_id = m.article_id)
         order by m.article_id, (b.news_item_id = m.article_id) desc, b.extracted_at desc, b.created_at, b.id) x
on conflict do nothing;

-- 4) 읽음: 작업공간마다(같은 기사 여러 줄이면 먼저 읽은 시각). 옛 줄과 같은 작업공간만.
insert into public.app_news_reads (workspace_id, article_id, read_at)
select r.workspace_id, m.article_id, min(r.read_at)
  from public.app_feed_reads r
  join public.app_news_id_map m on m.old_id = r.news_item_id and m.workspace_id = r.workspace_id
 where r.news_item_id is not null
   and not exists (select 1 from public.app_news_reads n where n.workspace_id = r.workspace_id and n.article_id = m.article_id)
 group by r.workspace_id, m.article_id
on conflict do nothing;

-- 5) 한 건 자세히: 작업공간마다 최근 만든 것. 새 표 줄보다 새로 만든 옛 줄만 넣거나 고친다.
insert into public.app_news_now_details (workspace_id, article_id, level, summary, key_sentences, relevance, implications, related,
  interests_key, generated_at, context_at, created_at, updated_at)
select x.workspace_id, x.article_id, x.level, x.summary, x.key_sentences, x.relevance, x.implications, x.related,
       x.interests_key, x.generated_at, x.context_at, x.created_at, x.updated_at
  from (select distinct on (d.workspace_id, m.article_id) d.workspace_id, m.article_id, d.level, d.summary, d.key_sentences, d.relevance, d.implications,
               d.related, d.interests_key, d.generated_at, d.context_at, d.created_at, d.updated_at
          from public.app_now_details d
          join public.app_news_id_map m on m.old_id = d.news_item_id and m.workspace_id = d.workspace_id
         where d.news_item_id is not null
         order by d.workspace_id, m.article_id, d.generated_at desc, d.id) x
 where not exists (select 1 from public.app_news_now_details n
                    where n.workspace_id = x.workspace_id and n.article_id = x.article_id and n.generated_at >= x.generated_at)
on conflict (workspace_id, article_id) do update
   set level = excluded.level, summary = excluded.summary, key_sentences = excluded.key_sentences, relevance = excluded.relevance,
       implications = excluded.implications, related = excluded.related, interests_key = excluded.interests_key,
       generated_at = excluded.generated_at, context_at = excluded.context_at, updated_at = excluded.updated_at
 where public.app_news_now_details.generated_at < excluded.generated_at;

-- 6) 반응: 같은 id 그대로(옛 줄과 같은 작업공간만).
insert into public.app_news_now_signals (id, workspace_id, article_id, action, created_at)
select s.id, s.workspace_id, m.article_id, s.action, s.created_at
  from public.app_now_signals s
  join public.app_news_id_map m on m.old_id = s.news_item_id and m.workspace_id = s.workspace_id
 where s.news_item_id is not null
   and not exists (select 1 from public.app_news_now_signals n where n.id = s.id)
 order by s.created_at, s.id
on conflict do nothing;

-- 사후 확인: 함수 DEFINER·search_path 고정·service_role만 실행, 새 표 권한 D2 그대로,
-- 적용 시각 1분 전까지 생긴 옛 줄은 모두 같은 주소·같은 작업공간 지도, 그 지도에 걸린 본문·읽음·자세히·반응이 새 표에 있음. 다르면 전체 취소.
do $$
declare v_cut timestamptz := now() - interval '1 minute';
begin
  if (select count(*) from pg_proc p where p.oid = to_regprocedure('public.app_news_refs_sync(integer)')
        and p.prosecdef and p.proconfig = array['search_path=""'] and coalesce(p.proacl::text, '') !~ '(^|[{,])=') <> 1
     or not has_function_privilege('service_role', 'public.app_news_refs_sync(integer)', 'execute')
     or has_function_privilege('anon', 'public.app_news_refs_sync(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.app_news_refs_sync(integer)', 'execute')
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_id_map', 'select,insert,update,references')
     or has_any_column_privilege('anon', 'public.app_news_id_map', 'select,insert,update,references')
     or exists (select 1 from public.app_news_items i
                 where i.created_at < v_cut
                   and not exists (select 1 from public.app_news_id_map m join public.app_news_articles a on a.id = m.article_id
                                    where m.old_id = i.id and a.url_key = i.url_key and m.workspace_id = i.workspace_id))
     or exists (select 1 from public.app_news_id_map m join public.app_news_items i on i.id = m.old_id
                  join public.app_news_articles a on a.id = m.article_id
                 where a.url_key <> i.url_key or m.workspace_id <> i.workspace_id)
     or exists (select 1 from public.app_news_articles a where a.origin = 'tg_scrap' and a.lane <> 'channel')
     or exists (select 1 from public.app_feed_bodies b join public.app_news_id_map m on m.old_id = b.news_item_id and m.workspace_id = b.workspace_id
                 where b.created_at < v_cut and not exists (select 1 from public.app_news_article_bodies n where n.article_id = m.article_id))
     or exists (select 1 from public.app_feed_reads r join public.app_news_id_map m on m.old_id = r.news_item_id and m.workspace_id = r.workspace_id
                 where r.read_at < v_cut and not exists (select 1 from public.app_news_reads n where n.workspace_id = r.workspace_id and n.article_id = m.article_id))
     or exists (select 1 from public.app_now_details d join public.app_news_id_map m on m.old_id = d.news_item_id and m.workspace_id = d.workspace_id
                 where d.generated_at < v_cut and not exists (select 1 from public.app_news_now_details n
                   where n.workspace_id = d.workspace_id and n.article_id = m.article_id and n.generated_at >= d.generated_at))
     or exists (select 1 from public.app_now_signals s join public.app_news_id_map m on m.old_id = s.news_item_id and m.workspace_id = s.workspace_id
                 where s.created_at < v_cut and not exists (select 1 from public.app_news_now_signals n where n.id = s.id)) then
    raise exception 'NEWS_REFS_SYNC_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115160000', 'news_refs_sync', array['NEWS for all E2 sync: SECURITY DEFINER public.app_news_refs_sync(integer) with empty search_path, execute service_role only (no anon, PUBLIC or authenticated); idempotent inserts (on conflict do nothing; details only replaced by a newer generated row) of old-only url keys into app_news_articles (same rule as D1/D2), missing app_news_id_map rows (same url, same workspace), one shared body per article without one, and per workspace reads, details and signals into the D2 tables, only from rows of the same workspace; returns row counts only; called once at apply and later by news-feed; no change to existing tables, policies, grants, triggers, functions or rows; no anon/PUBLIC privilege']);
commit;
