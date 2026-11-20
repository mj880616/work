begin;
-- S67-24 DB-보관기간정리 ①(승인형 workflow). 명진 결정 11/20 10:51·10:52: "언론 기사는 3일", "사회운동 매체는 2개월까지(11:07 2개월→2개월로 정정) 보관", 나머지 지워도 되는 것은 다 지움.
-- 배경: Supabase 무료 한도 초과(DB 0.664GB / 0.5GB). 크기는 카탈로그로만 쟀다(내용 조회 없음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 정리 함수 둘만 바꾸거나 만든다. 이 파일을 적용하는 순간에는 줄을 하나도 지우지 않는다(최상위 DELETE·UPDATE 없음 → 자동 사본도 없음).
--  1) public.app_news_prune(timestamptz, integer) 고침(같은 서명·DEFINER·search_path ''·service_role만 그대로).
--     이전: 옛 표 app_news_items의 매체 글 30일·키워드 글 180일. 이후: 언론 기사(News [언론] 탭, 공용 app_news_articles + 옛 app_news_items, 모든 lane)를
--     받은 지(created_at) 72시간 지나면 지운다. 이미 부르는 곳(Edge news-feed 'prune' 단계, 예약 수집마다) 그대로.
--  2) public.app_outside_prune(timestamptz, integer) 새로(DEFINER·search_path ''·service_role만): 사회운동 글(공용 app_outside_articles + 옛 app_outside_posts)을
--     받은 지(fetched_at) 2개월 지나면 지운다. 언론과 같이 '받은 날' 기준이다: 게시일 기준이면 단체 목록에 아직 실린 옛 글을 수집기가 곧바로 다시 넣어
--     (다시 읽기·AI 요약) 넣고 지우기를 되풀이한다. 부르는 곳: 매일 정리 예약(docs/ops/retention-daily.apply.sql, SQL Editor).
--  두 함수 모두 한 번에 p_limit(1~5000)줄까지(공용 표·옛 표 따로), 지운 줄 수를 돌려준다.
--
-- 사람이 남긴 것은 지우지 않는다. 같은 주소(언론 url_key, 사회운동 url) 묶음 안에 아래 가운데 하나라도 있으면 공용 줄·옛 줄 모두 남긴다:
--   언론: 누구의 별표든(app_news_marks.starred_at — 별표 폴더는 별표가 있어야 함, 옛 app_news_items.starred_at), 직접 넣은 기사(origin 'user')·손으로 고친 기사(manual_at),
--         노트 메모(app_notes.metadata.news_item_id — 휴지통 노트 포함, 옛 id·공용 id·지도 app_news_id_map 모두), 밑줄(app_news_highlights source_type 'news').
--   사회운동: 별표·보관(app_outside_article_marks.starred_at/archived_at, 옛 app_outside_marks 같은 칸), 노트 메모(metadata.outside_post_id, 지도 app_outside_id_map 포함),
--         밑줄(source_type 'outside').
--   주간보고·사업보고·원장·기록 연결은 기사 id를 적지 않는다(저장소 확인). 노트로 보낸 밑줄은 노트에 글자가 복사되어 기사와 따로 남는다.
-- 같이 지워지는 것(외래 키 ON DELETE CASCADE, 지우는 기사에 딸린 것만): 본문 블록(app_news_article_bodies·app_outside_article_bodies·옛 app_feed_bodies),
--   문장(app_outside_article_sentences·옛 app_outside_sentences), 사람별 읽음·숨김·키워드 표시·자세히(AI)·반응 기록·지도 줄.
--   별표·보관·메모·밑줄이 있는 기사는 위 규칙으로 남으므로 그 표시도 남는다. 텔레그램·통화·가족 표는 읽지도 지우지도 않는다.
-- 권한: 두 함수 실행권은 service_role만(PUBLIC·anon·authenticated 회수). 표·정책·권한·트리거·칸 변경 없음, rtw_* 없음.
-- 되돌리기: 짝 rollback(SQL Editor 전용 — 이전 함수 본문을 다시 넣음). 지운 기사는 되살릴 수 없다(rollback은 규칙만 되돌림).
-- 짝: docs/20261120130000_news_outside_retention.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261120130000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101233000' and name = 'news_clipping') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115140000' and name = 'news_for_all_refs') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115150000' and name = 'outside_for_all') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115230000' and name = 'news_user_save') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261119000000' and name = 'news_hand_fill') <> 1
     or to_regclass('public.app_notes') is null
     or to_regclass('public.app_news_highlights') is null
     or to_regclass('public.app_news_id_map') is null
     or to_regclass('public.app_outside_id_map') is null
     or to_regclass('public.app_outside_marks') is null
     or to_regclass('public.app_outside_article_marks') is null
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_notes'::regclass and attname = 'metadata' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_news_articles'::regclass and attname = 'manual_at' and not attisdropped)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_prune(timestamptz,integer)') and prosecdef)
     or to_regprocedure('public.app_outside_prune(timestamptz,integer)') is not null then
    raise exception 'NEWS_OUTSIDE_RETENTION_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 언론 기사: 받은 지 72시간. 남길 주소 묶음(kept)을 먼저 모은 뒤, 공용 표·옛 표에서 묶음 밖 줄만 오래된 것부터 p_limit줄씩.
create or replace function public.app_news_prune(p_now timestamptz, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $prune$
declare
  v_cut timestamptz := coalesce(p_now, pg_catalog.now()) - interval '72 hours';
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_a integer;
  v_i integer;
begin
  with kept_ids as (
    select pg_catalog.lower(n.metadata ->> 'news_item_id') as id
      from public.app_notes n where n.metadata ->> 'news_item_id' is not null
    union
    select h.source_id::text from public.app_news_highlights h where h.source_type = 'news'
  ), kept as (
    select a.url_key from public.app_news_articles a
     where a.origin = 'user' or a.manual_at is not null or a.id::text in (select k.id from kept_ids k)
    union
    select a.url_key from public.app_news_marks m join public.app_news_articles a on a.id = m.article_id where m.starred_at is not null
    union
    select a.url_key from public.app_news_id_map mp join public.app_news_articles a on a.id = mp.article_id
     where mp.old_id::text in (select k.id from kept_ids k)
    union
    select i.url_key from public.app_news_items i where i.starred_at is not null or i.id::text in (select k.id from kept_ids k)
  ), doomed as (
    select a.id from public.app_news_articles a
     where a.created_at < v_cut
       and not exists (select 1 from kept k where k.url_key = a.url_key)
     order by a.created_at
     limit v_limit
  )
  delete from public.app_news_articles a using doomed d where a.id = d.id;
  get diagnostics v_a = row_count;

  with kept_ids as (
    select pg_catalog.lower(n.metadata ->> 'news_item_id') as id
      from public.app_notes n where n.metadata ->> 'news_item_id' is not null
    union
    select h.source_id::text from public.app_news_highlights h where h.source_type = 'news'
  ), kept as (
    select a.url_key from public.app_news_articles a
     where a.origin = 'user' or a.manual_at is not null or a.id::text in (select k.id from kept_ids k)
    union
    select a.url_key from public.app_news_marks m join public.app_news_articles a on a.id = m.article_id where m.starred_at is not null
    union
    select a.url_key from public.app_news_id_map mp join public.app_news_articles a on a.id = mp.article_id
     where mp.old_id::text in (select k.id from kept_ids k)
    union
    select i.url_key from public.app_news_items i where i.starred_at is not null or i.id::text in (select k.id from kept_ids k)
  ), doomed as (
    select i.id from public.app_news_items i
     where i.created_at < v_cut
       and not exists (select 1 from kept k where k.url_key = i.url_key)
     order by i.created_at
     limit v_limit
  )
  delete from public.app_news_items i using doomed d where i.id = d.id;
  get diagnostics v_i = row_count;
  return v_a + v_i;
end
$prune$;
revoke all on function public.app_news_prune(timestamptz, integer) from public;
revoke all on function public.app_news_prune(timestamptz, integer) from anon;
revoke all on function public.app_news_prune(timestamptz, integer) from authenticated;
revoke all on function public.app_news_prune(timestamptz, integer) from service_role;
grant execute on function public.app_news_prune(timestamptz, integer) to service_role;

-- 2) 사회운동 글: 받은 지(fetched_at) 2개월. 같은 방식(주소 url 묶음).
create function public.app_outside_prune(p_now timestamptz, p_limit integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $oprune$
declare
  v_cut timestamptz := coalesce(p_now, pg_catalog.now()) - interval '2 months';
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 5000);
  v_a integer;
  v_p integer;
begin
  with kept_ids as (
    select pg_catalog.lower(n.metadata ->> 'outside_post_id') as id
      from public.app_notes n where n.metadata ->> 'outside_post_id' is not null
    union
    select h.source_id::text from public.app_news_highlights h where h.source_type = 'outside'
  ), kept as (
    select a.url from public.app_outside_articles a where a.id::text in (select k.id from kept_ids k)
    union
    select a.url from public.app_outside_article_marks m join public.app_outside_articles a on a.id = m.article_id
     where m.starred_at is not null or m.archived_at is not null
    union
    select a.url from public.app_outside_id_map mp join public.app_outside_articles a on a.id = mp.article_id
     where mp.old_id::text in (select k.id from kept_ids k)
    union
    select p.url from public.app_outside_posts p where p.id::text in (select k.id from kept_ids k)
    union
    select p.url from public.app_outside_marks m join public.app_outside_posts p on p.id = m.post_id
     where m.starred_at is not null or m.archived_at is not null
  ), doomed as (
    select a.id from public.app_outside_articles a
     where a.fetched_at < v_cut
       and not exists (select 1 from kept k where k.url = a.url)
     order by a.fetched_at
     limit v_limit
  )
  delete from public.app_outside_articles a using doomed d where a.id = d.id;
  get diagnostics v_a = row_count;

  with kept_ids as (
    select pg_catalog.lower(n.metadata ->> 'outside_post_id') as id
      from public.app_notes n where n.metadata ->> 'outside_post_id' is not null
    union
    select h.source_id::text from public.app_news_highlights h where h.source_type = 'outside'
  ), kept as (
    select a.url from public.app_outside_articles a where a.id::text in (select k.id from kept_ids k)
    union
    select a.url from public.app_outside_article_marks m join public.app_outside_articles a on a.id = m.article_id
     where m.starred_at is not null or m.archived_at is not null
    union
    select a.url from public.app_outside_id_map mp join public.app_outside_articles a on a.id = mp.article_id
     where mp.old_id::text in (select k.id from kept_ids k)
    union
    select p.url from public.app_outside_posts p where p.id::text in (select k.id from kept_ids k)
    union
    select p.url from public.app_outside_marks m join public.app_outside_posts p on p.id = m.post_id
     where m.starred_at is not null or m.archived_at is not null
  ), doomed as (
    select p.id from public.app_outside_posts p
     where p.fetched_at < v_cut
       and not exists (select 1 from kept k where k.url = p.url)
     order by p.fetched_at
     limit v_limit
  )
  delete from public.app_outside_posts p using doomed d where p.id = d.id;
  get diagnostics v_p = row_count;
  return v_a + v_p;
end
$oprune$;
revoke all on function public.app_outside_prune(timestamptz, integer) from public;
revoke all on function public.app_outside_prune(timestamptz, integer) from anon;
revoke all on function public.app_outside_prune(timestamptz, integer) from authenticated;
revoke all on function public.app_outside_prune(timestamptz, integer) from service_role;
grant execute on function public.app_outside_prune(timestamptz, integer) to service_role;

-- 사후 확인: 두 함수 DEFINER·search_path ''·service_role만 실행. 다르면 전체 취소.
do $$
declare f regprocedure;
begin
  foreach f in array array['public.app_news_prune(timestamptz,integer)'::regprocedure, 'public.app_outside_prune(timestamptz,integer)'::regprocedure] loop
    if not (select prosecdef from pg_proc where oid = f)
       or (select proconfig from pg_proc where oid = f) is distinct from array['search_path=""']
       or not has_function_privilege('service_role', f, 'execute')
       or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')
       or exists (select 1 from pg_proc where oid = f and proacl::text ~ '(^|[{,])(anon|authenticated)?=') then
      raise exception 'NEWS_OUTSIDE_RETENTION_POSTCHECK_FAILED; stop';
    end if;
  end loop;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261120130000', 'news_outside_retention', array['S67-24 DB retention: replace public.app_news_prune(timestamptz,integer) (same signature, SECURITY DEFINER, empty search_path, service_role only) so news articles (shared app_news_articles and old app_news_items, all lanes) are deleted 72 hours after created_at; add public.app_outside_prune(timestamptz,integer) (same shape) deleting social-movement posts (app_outside_articles and old app_outside_posts) 2 months after fetched_at; both keep every url group with a star, archive, manual entry, note memo (incl. trashed notes, old/shared/mapped ids) or highlight; no row deleted at apply time; no table, policy, grant or trigger change']);
commit;
