begin;
-- S73-01 NEWS-본문하루(승인형 workflow). 사용자 결정(2026-11-27 17:34): DB 용량(무료 한도 500MB 중 406MB)을 줄이려고
-- "받은 지 하루 지난 언론 기사는 본문만 지우고 제목·요약·주소는 남긴다. 하루 지난 기사는 원래 사이트에서 읽으면 된다."
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지). 설계: docs/design/db-retention.md 1-1절.
--
-- 무엇: 새 함수 하나만 만든다. 이 파일을 적용하는 순간에는 줄을 하나도 비우지 않는다(최상위 UPDATE·DELETE 없음 → 자동 사본도 없음).
--  public.app_news_trim_bodies(p_now timestamptz, p_limit integer) returns integer — DEFINER·search_path ''·service_role만(app_news_prune와 같은 모양).
--  언론 기사(News [언론] 탭: 공용 app_news_articles + 옛 app_news_items, 모든 lane) 가운데 받은 지(created_at) 24시간 지난 것의 본문만 비운다.
--   · 기사 줄: body·body_kind·body_ko를 비운다. 번역 시각(translated_at)은 번역 제목(title_ko)이 없을 때만 함께 비운다(표 검사: 번역 시각 = 번역 제목 또는 번역 본문이 있음).
--     제목·요약·주소·번역 제목·날짜·상태·분류는 그대로. updated_at도 그대로(목록 차례·동기화가 흔들리지 않게).
--   · 공용 본문 블록(app_news_article_bodies): 그 기사 줄을 '비운 본문' 표시 줄로 바꾼다 — blocks '[]', state 'failed', reason 'no_body', rule 'trim@1', chars·images 0.
--     블록 줄이 없던 기사도 표시 줄 하나를 넣는다(작은 줄). 그래야 화면이 '본문 없음'을 보고 글 쪽을 다시 읽으러 가지 않고(news-feed open),
--     수집기 보충(app_news_refs_sync — 줄이 없을 때만 넣음)도 옛 본문을 다시 채우지 않는다. 뽑은 시각(extracted_at)은 고치지 않는다(요약 저장본이 그대로 쓰이게).
--   · 옛 본문 블록(app_feed_bodies, 뉴스 기사 줄): 있는 줄만 같은 표시 줄로 바꾼다(새로 넣지 않음).
--  한 번에 p_limit(1~5000)줄까지(공용 표·옛 표 따로), 비운 기사 줄 수를 돌려준다. 이미 비운 기사(본문 칸 비었고 블록 줄이 trim@1)는 다시 고르지 않는다(되풀이해 불러도 됨).
--  부르는 곳: 매일 정리 private.app_retention_daily()(SQL Editor로 만든 함수 — docs/ops/news-body-trim-daily.apply.sql 조각 ①에서 이 함수를 부르게 고침).
--
-- 본문을 남기는 것(사람이 남긴 것 — 지우기 규칙 app_news_prune와 같은 묶음, docs/design/db-retention.md 2절). 같은 주소(url_key) 묶음 안에 하나라도 있으면 공용 줄·옛 줄 모두 본문 그대로:
--   읽을 거리 줄이 가리키거나 같은 주소인 글(News ★ 보관), 직접 넣은 기사(origin 'user')·손으로 고친 기사(manual_at), 노트 메모(app_notes.metadata.news_item_id — 휴지통 포함,
--   공용 id·옛 id·지도 app_news_id_map), 밑줄(app_news_highlights source_type 'news'), 옛 표 별표(app_news_items.starred_at).
--   그리고 손으로 넣은 본문 블록(rule manual@1)이 있는 기사, 아직 읽기 전(state 'pending')인 기사는 고르지 않는다.
-- 읽지도 고치지도 않는 것: 사회운동 글(2개월 보관 그대로), 사람별 읽음·표시·자세히·반응, 내가 고친 원문(app_feed_body_edits), 텔레그램·통화·가족 표, rtw_*.
-- 권한: 새 함수 실행권은 service_role만(PUBLIC·anon·authenticated 회수). 표·칸·검사·정책·표 권한·트리거 변경 없음.
-- 되돌리기: 짝 rollback(새 함수와 기록 1행 지움 — 승인형 workflow rollback 모드). 먼저 매일 정리를 이전 본문으로(docs/ops/news-body-trim-daily.rollback.sql).
--   비운 본문은 되살릴 수 없다. 글 보기 ⋯ [원문 다시 가져오기]로 사람이 다시 읽으면 그 글만 다시 채워진다.
-- 짝: docs/20261127180000_news_body_trim.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261127180000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261120130000' and name = 'news_outside_retention') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122230000' and name = 'reading_one_store') <> 1
     or to_regclass('public.app_news_articles') is null or to_regclass('public.app_news_items') is null
     or to_regclass('public.app_news_article_bodies') is null or to_regclass('public.app_feed_bodies') is null
     or to_regclass('public.app_reading_items') is null or to_regclass('public.app_notes') is null
     or to_regclass('public.app_news_highlights') is null or to_regclass('public.app_news_id_map') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_reading_items'::regclass and attname = 'news_article_id' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_news_articles'::regclass and attname = 'manual_at' and not attisdropped)
     -- 남길 것 규칙은 지금 지우기 함수(저장소 20261122230000 판)와 같은 묶음이다. 그 함수가 바뀌었으면 멈춘다.
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_prune(timestamptz,integer)')
         and prosecdef and proconfig = array['search_path=""'] and md5(prosrc) = 'e8f32b5ecdd8933ca542d1a6ea8b510c')
     -- 비운 표시 줄이 표 검사에 맞는가(failed = 까닭 있음·블록 없음, 규칙 이름 모양).
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_article_bodies'::regclass
         and conname in ('app_news_article_bodies_state_shape_check', 'app_news_article_bodies_rule_check', 'app_news_article_bodies_reason_check')) <> 3
     or (select count(*) from pg_constraint where conrelid = 'public.app_feed_bodies'::regclass
         and conname in ('app_feed_bodies_state_shape_check', 'app_feed_bodies_rule_check', 'app_feed_bodies_reason_check')) <> 3
     or to_regprocedure('public.app_news_trim_bodies(timestamptz,integer)') is not null then
    raise exception 'NEWS_BODY_TRIM_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create function public.app_news_trim_bodies(p_now timestamptz, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $trim$
declare
  v_cut timestamptz := coalesce(p_now, pg_catalog.now()) - interval '24 hours';
  v_at timestamptz := pg_catalog.now();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_a integer;
  v_i integer;
begin
  -- 1) 공용 기사. 남길 주소 묶음(kept — app_news_prune와 같은 규칙)을 먼저 모은 뒤, 묶음 밖에서 비울 본문이 남은 줄만 오래된 것부터.
  with kept_ids as (
    select pg_catalog.lower(n.metadata ->> 'news_item_id') as id
      from public.app_notes n where n.metadata ->> 'news_item_id' is not null
    union
    select h.source_id::text from public.app_news_highlights h where h.source_type = 'news'
  ), kept as (
    select a.url_key from public.app_news_articles a
     where a.origin = 'user' or a.manual_at is not null or a.id::text in (select k.id from kept_ids k)
    union
    select a.url_key from public.app_reading_items r join public.app_news_articles a on a.id = r.news_article_id
    union
    select a.url_key from public.app_news_articles a where a.url in (select r.url from public.app_reading_items r)
    union
    select a.url_key from public.app_news_id_map mp join public.app_news_articles a on a.id = mp.article_id
     where mp.old_id::text in (select k.id from kept_ids k)
    union
    select i.url_key from public.app_news_items i where i.starred_at is not null or i.id::text in (select k.id from kept_ids k)
  ), picked as (
    select a.id from public.app_news_articles a
     where a.created_at < v_cut
       and a.state <> 'pending'
       and not exists (select 1 from kept k where k.url_key = a.url_key)
       and not exists (select 1 from public.app_news_article_bodies b where b.article_id = a.id and b.rule = 'manual@1')
       and (a.body is not null or a.body_ko is not null
            or exists (select 1 from public.app_news_article_bodies b where b.article_id = a.id and b.rule is distinct from 'trim@1'))
     order by a.created_at
     limit v_limit
  ), marks as (
    insert into public.app_news_article_bodies as b (article_id, blocks, state, reason, rule, chars, images, extracted_at, updated_at)
    select p.id, '[]'::jsonb, 'failed', 'no_body', 'trim@1', 0, 0, v_at, v_at from picked p
    on conflict (article_id) do update
      set blocks = '[]'::jsonb, state = 'failed', reason = 'no_body', rule = 'trim@1', chars = 0, images = 0, updated_at = v_at
    returning b.article_id
  )
  update public.app_news_articles a
     set body = null, body_kind = null, body_ko = null,
         translated_at = case when a.title_ko is null then null else a.translated_at end
    from picked p
   where a.id = p.id;
  get diagnostics v_a = row_count;

  -- 2) 옛 표(작업공간마다 한 줄). 같은 남길 묶음. 옛 본문 블록은 있는 줄만 표시 줄로 바꾼다.
  with kept_ids as (
    select pg_catalog.lower(n.metadata ->> 'news_item_id') as id
      from public.app_notes n where n.metadata ->> 'news_item_id' is not null
    union
    select h.source_id::text from public.app_news_highlights h where h.source_type = 'news'
  ), kept as (
    select a.url_key from public.app_news_articles a
     where a.origin = 'user' or a.manual_at is not null or a.id::text in (select k.id from kept_ids k)
    union
    select a.url_key from public.app_reading_items r join public.app_news_articles a on a.id = r.news_article_id
    union
    select a.url_key from public.app_news_articles a where a.url in (select r.url from public.app_reading_items r)
    union
    select a.url_key from public.app_news_id_map mp join public.app_news_articles a on a.id = mp.article_id
     where mp.old_id::text in (select k.id from kept_ids k)
    union
    select i.url_key from public.app_news_items i where i.starred_at is not null or i.id::text in (select k.id from kept_ids k)
  ), picked as (
    select i.id from public.app_news_items i
     where i.created_at < v_cut
       and i.state <> 'pending'
       and not exists (select 1 from kept k where k.url_key = i.url_key)
       and not exists (select 1 from public.app_feed_bodies b where b.news_item_id = i.id and b.rule = 'manual@1')
       and (i.body is not null or i.body_ko is not null
            or exists (select 1 from public.app_feed_bodies b where b.news_item_id = i.id and b.rule is distinct from 'trim@1'))
     order by i.created_at
     limit v_limit
  ), marks as (
    update public.app_feed_bodies b
       set blocks = '[]'::jsonb, state = 'failed', reason = 'no_body', rule = 'trim@1', chars = 0, images = 0, updated_at = v_at
      from picked p
     where b.news_item_id = p.id
    returning b.id
  )
  update public.app_news_items i
     set body = null, body_kind = null, body_ko = null,
         translated_at = case when i.title_ko is null then null else i.translated_at end
    from picked p
   where i.id = p.id;
  get diagnostics v_i = row_count;
  return v_a + v_i;
end
$trim$;
revoke all on function public.app_news_trim_bodies(timestamptz, integer) from public;
revoke all on function public.app_news_trim_bodies(timestamptz, integer) from anon;
revoke all on function public.app_news_trim_bodies(timestamptz, integer) from authenticated;
revoke all on function public.app_news_trim_bodies(timestamptz, integer) from service_role;
grant execute on function public.app_news_trim_bodies(timestamptz, integer) to service_role;

-- 사후 확인: DEFINER·search_path ''·service_role만 실행. 다르면 전체 취소.
do $$
declare f regprocedure := 'public.app_news_trim_bodies(timestamptz,integer)'::regprocedure;
begin
  if not (select prosecdef from pg_proc where oid = f)
     or (select proconfig from pg_proc where oid = f) is distinct from array['search_path=""']
     or not has_function_privilege('service_role', f, 'execute')
     or has_function_privilege('authenticated', f, 'execute')
     or has_function_privilege('anon', f, 'execute')
     or exists (select 1 from pg_proc where oid = f and proacl::text ~ '(^|[{,])(anon|authenticated)?=') then
    raise exception 'NEWS_BODY_TRIM_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261127180000', 'news_body_trim', array['S73-01 news body trim: add public.app_news_trim_bodies(timestamptz,integer) (SECURITY DEFINER, empty search_path, service_role only) that, for news articles (shared app_news_articles and old app_news_items) received more than 24 hours ago, clears only body, body_kind and body_ko (translated_at only when there is no translated title) and turns their body block rows into an empty trim@1 marker (shared table: upsert, old table: existing rows only); keeps every url group kept by app_news_prune (reading rows, manual or user articles, note memos, highlights, old stars), hand bodies and pending articles; title, summary, url, dates unchanged; no row changed at apply time; no table, column, policy, grant or trigger change']);
commit;
