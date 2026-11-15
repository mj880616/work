begin;
-- S62-12c NEWS-모두에게열기 D1b DB(Expand) — [사회운동] 공용 글 한 벌. 설계: docs/design/news-for-all.md 14절(#2634, 명진 결정 2 '나').
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙에서 거절되면 AGENTS.md 7절 SQL Editor 경로)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 사회운동 글(app_outside_posts)은 지금 작업공간마다 따로 모은다(같은 글을 켠 사람 수만큼 요약). 공용 글 한 벌로 바꾸되 옛 표는 건드리지 않는다.
--  1) app_outside_articles(새): 공용 글. app_outside_posts 칸 그대로에서 작업공간 칸만 뺌, url 전체 유일.
--  2) app_outside_article_sentences(새): 공용 문장(article_id, idx).
--     1·2 읽기: 로그인 + 자기 owner 행 1개 + 차단 명단 아님(private.app_news_reader_ok, D1 함수 재사용). 쓰기 service_role만.
--  3) app_outside_article_marks(새): 사람별 별표·보관·관심 없음. owner 정책, 화면은 자기 줄 넣기(읽을 수 있는 글만)·칸 고치기·지우기.
--  4) app_outside_article_bodies(새): 글마다 본문 블록 1줄(공용, 그 글을 읽을 수 있는 사람만). app_feed_bodies와 같은 칸·검사.
--  5) app_outside_reads·app_outside_now_details·app_outside_now_signals(새): 사람별 읽음·한 건 자세히·반응(뉴스 D2와 같은 모양).
--  6) app_outside_id_map(새): 옛 글 id → 공용 글 id. 화면 권한 없음. public.app_outside_article_of(uuid[])(DEFINER, authenticated만)로 자기 작업공간 옛 id만.
--  7) public.app_outside_search_shared(새): 공용 문장 찾기. 인자·결과 칸은 app_outside_search와 같다(post_id 자리에 공용 글 id). SECURITY INVOKER — 공용 표 정책을 그대로 거침.
--  8) 옮기기: 옛 글을 url마다 공용 글 1줄로(id는 대표 줄 = 운영자 작업공간 줄 → 먼저 받은 줄 → id 순), 문장은 문장이 있는 줄 중 대표 줄 우선,
--     옛 줄마다 지도 1줄, 표시·본문·읽음·자세히·반응은 그 작업공간 것으로. 옮기는 동안 관련 표 쓰기만 잠근다.
-- 그대로: app_outside_seen(사람별 마지막 본 시각)·app_outside_sources(사람별 단체 켜기 = 수집 대상), 옛 표·정책·권한·트리거·함수·줄.
-- 안 하는 것: anon·PUBLIC 권한, RLS 끄기, rtw_* 객체, 텔레그램 표(새 표는 텔레그램 표를 가리키지 않고 방·보낸 사람·메시지 칸이 없다).
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115150000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115100000' and name = 'news_for_all') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261031230000' and name = 'outside_statements') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102150000' and name = 'outside_search_undated') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261108020000' and name = 'outside_post_body_ko') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102140000' and name = 'now_detail') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261106050000' and name = 'feed_bodies') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261106080000' and name = 'feed_reads_news_prefs') <> 1
     or to_regclass('public.app_outside_posts') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_outside_sentences') is null
     or to_regclass('public.app_outside_marks') is null
     or to_regclass('public.app_feed_bodies') is null
     or to_regclass('public.app_feed_reads') is null
     or to_regclass('public.app_now_details') is null
     or to_regclass('public.app_now_signals') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_outside_posts') and attname = 'body_ko' and not attisdropped)
     or to_regclass('public.app_outside_articles') is not null
     or to_regclass('public.app_outside_article_sentences') is not null
     or to_regclass('public.app_outside_article_marks') is not null
     or to_regclass('public.app_outside_article_bodies') is not null
     or to_regclass('public.app_outside_reads') is not null
     or to_regclass('public.app_outside_now_details') is not null
     or to_regclass('public.app_outside_now_signals') is not null
     or to_regclass('public.app_outside_id_map') is not null
     or to_regprocedure('public.app_outside_article_of(uuid[])') is not null
     or to_regprocedure('public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_news_reader_ok()') and prosecdef
                      and proconfig = array['search_path=""'] and has_function_privilege('authenticated', oid, 'execute')
                      and not has_function_privilege('anon', oid, 'execute')) then
    raise exception 'OUTSIDE_FOR_ALL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 옮기는 동안 쓰기만 막는다(읽기는 됨). 수집기는 잠시 기다렸다 이어 쓴다.
lock table public.app_outside_posts, public.app_outside_sentences, public.app_outside_marks, public.app_feed_bodies, public.app_feed_reads,
  public.app_now_details, public.app_now_signals in share row exclusive mode;

-- 1) 공용 글. 칸·검사는 app_outside_posts와 같다(작업공간 칸만 없음, url 전체 유일).
create table public.app_outside_articles (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  kind text not null,
  lang text not null,
  title text not null,
  title_ko text,
  author text,
  url text not null,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  summary_ko text,
  key_sentences jsonb not null default '[]'::jsonb,
  has_body boolean not null default false,
  body_ko text,
  constraint app_outside_articles_url_unique unique (url),
  constraint app_outside_articles_key_check check (source_key ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint app_outside_articles_kind_check check (kind in ('statement', 'comment', 'press', 'article')),
  constraint app_outside_articles_lang_check check (lang in ('ko', 'en')),
  constraint app_outside_articles_title_check check (
    char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'
    and (title_ko is null or (char_length(title_ko) between 1 and 500 and title_ko !~ '[[:cntrl:]]'))
    and (author is null or (char_length(author) between 1 and 200 and author !~ '[[:cntrl:]]'))),
  constraint app_outside_articles_url_check check (url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 2000),
  constraint app_outside_articles_summary_check check (summary_ko is null or char_length(summary_ko) between 1 and 2000),
  -- 핵심 문장: 외국 글만, 3개까지, 각각 {"orig": 원문, "ko": 번역} 글자 1~300자. 국내 글과 has_body는 함께 쓰지 않는다.
  constraint app_outside_articles_key_sentences_check check (
    jsonb_typeof(key_sentences) = 'array' and jsonb_array_length(key_sentences) <= 3
    and (lang = 'en' or jsonb_array_length(key_sentences) = 0)
    and not jsonb_path_exists(key_sentences,
      '$[*] ? (@.type() != "object" || !(@.orig.type() == "string") || !(@.ko.type() == "string")
              || !(@.orig like_regex "^.{1,150}.{0,150}$" flag "s") || !(@.ko like_regex "^.{1,150}.{0,150}$" flag "s"))')),
  constraint app_outside_articles_body_check check (lang = 'ko' or not has_body),
  constraint app_outside_articles_body_ko_check check (body_ko is null or (lang = 'en' and char_length(body_ko) between 1 and 100000))
);
create index app_outside_articles_list_idx on public.app_outside_articles(fetched_at desc);
create index app_outside_articles_source_idx on public.app_outside_articles(source_key, published_at desc);

-- 2) 공용 문장(국내 글 본문 문장). 칸·검사는 app_outside_sentences와 같다.
create table public.app_outside_article_sentences (
  article_id uuid not null references public.app_outside_articles(id) on delete cascade,
  idx integer not null,
  text text not null,
  constraint app_outside_article_sentences_pkey primary key (article_id, idx),
  constraint app_outside_article_sentences_idx_check check (idx between 0 and 3000),
  constraint app_outside_article_sentences_text_check check (char_length(text) between 1 and 500)
);

-- 3) 사람별 표시. 칸은 app_outside_marks와 같다.
create table public.app_outside_article_marks (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_outside_articles(id) on delete cascade,
  starred_at timestamptz,
  archived_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_outside_article_marks_pkey primary key (workspace_id, article_id)
);
create index app_outside_article_marks_article_idx on public.app_outside_article_marks(article_id);
create index app_outside_article_marks_saved_idx on public.app_outside_article_marks(workspace_id, coalesce(starred_at, archived_at) desc)
  where starred_at is not null or archived_at is not null;

-- 4) 공용 본문 블록. 칸·검사는 app_feed_bodies와 같다.
create table public.app_outside_article_bodies (
  article_id uuid primary key references public.app_outside_articles(id) on delete cascade,
  blocks jsonb not null default '[]'::jsonb,
  state text not null,
  reason text,
  rule text,
  chars integer not null default 0,
  images integer not null default 0,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_outside_article_bodies_state_check check (state in ('ok', 'lead', 'image_only', 'failed')),
  constraint app_outside_article_bodies_reason_check check (reason is null or reason in
    ('robots', 'bot_check', 'paywall', 'too_big', 'timeout', 'http_4xx', 'http_5xx', 'no_body', 'off_host', 'relay')),
  -- 규칙 이름(출처 키 모양) @ 판 번호. 못 읽어 규칙을 쓰지 않은 글은 비워 둔다.
  constraint app_outside_article_bodies_rule_check check (rule is null or rule ~ '^[a-z0-9][a-z0-9_-]{1,39}@[0-9]{1,4}$'),
  -- 블록: 배열, 400개까지. 종류는 p·h·quote(글자 하나)와 img(주소·캡션·대체 글)뿐, 그 밖의 칸 없음.
  constraint app_outside_article_bodies_blocks_check check (
    jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 400
    and not jsonb_path_exists(blocks,
      '$[*] ? (@.type() != "object" || !(@.t == "p" || @.t == "h" || @.t == "quote" || @.t == "img"))')
    and not jsonb_path_exists(blocks,
      '$[*].keyvalue() ? (!(@.key == "t" || @.key == "text" || @.key == "src" || @.key == "cap" || @.key == "alt"))')
    and not jsonb_path_exists(blocks,
      '$[*] ? (@.t != "img" && (!(@.text.type() == "string") || !(@.text like_regex "^[^[:cntrl:]]+$")
              || exists(@.src) || exists(@.cap) || exists(@.alt)))')
    and not jsonb_path_exists(blocks,
      '$[*] ? (@.t == "img" && (exists(@.text) || !(@.src.type() == "string")
              || !(@.src like_regex "^https://[^[:space:][:cntrl:]\"<>]{1,242}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}[^[:space:][:cntrl:]\"<>]{0,250}$")
              || (exists(@.cap) && !(@.cap.type() == "null") && !(@.cap.type() == "string" && @.cap like_regex "^[^[:cntrl:]]{1,150}[^[:cntrl:]]{0,150}$"))
              || (exists(@.alt) && !(@.alt.type() == "null") && !(@.alt.type() == "string" && @.alt like_regex "^[^[:cntrl:]]{1,150}[^[:cntrl:]]{0,150}$"))))')),
  -- 본문 글자 합 상한: 블록 글자들을 JSON 배열로 늘어놓은 길이(따옴표·쉼표 여유 포함) 11만 자, chars 10만 자.
  constraint app_outside_article_bodies_text_total_check check (
    char_length(jsonb_path_query_array(blocks, '$[*].text')::text) <= 110000),
  constraint app_outside_article_bodies_chars_check check (
    chars between 0 and 100000
    and (chars > 0) = jsonb_path_exists(blocks, '$[*] ? (@.t != "img")')),
  -- 사진 수는 사진 블록 수와 같고 20개까지.
  constraint app_outside_article_bodies_images_check check (
    images between 0 and 20
    and images = jsonb_array_length(jsonb_path_query_array(blocks, '$[*] ? (@.t == "img")'))),
  -- 상태와 까닭: ok는 까닭 없음·글자 있음, lead는 글자 있음, image_only는 사진 있음, failed는 까닭 있음·블록 없음.
  constraint app_outside_article_bodies_state_shape_check check (
    case state
      when 'ok' then reason is null and chars > 0
      when 'lead' then chars > 0
      when 'image_only' then images > 0
      when 'failed' then reason is not null and jsonb_array_length(blocks) = 0
    end)
);

-- 5) 사람별 읽음·자세히·반응.
create table public.app_outside_reads (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_outside_articles(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint app_outside_reads_pkey primary key (workspace_id, article_id)
);
create index app_outside_reads_article_idx on public.app_outside_reads(article_id);
create index app_outside_reads_recent_idx on public.app_outside_reads(workspace_id, read_at desc);

create table public.app_outside_now_details (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_outside_articles(id) on delete cascade,
  level text not null default 'full',
  summary text,
  key_sentences jsonb not null default '[]'::jsonb,
  relevance jsonb,
  implications jsonb,
  related jsonb not null default '[]'::jsonb,
  interests_key text,
  generated_at timestamptz not null default now(),
  context_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_outside_now_details_pkey primary key (workspace_id, article_id),
  constraint app_outside_now_details_level_check check (level in ('full', 'basic')),
  constraint app_outside_now_details_summary_check check (summary is null or char_length(summary) between 1 and 1500),
  -- 주요 문장: 3개까지, {"orig": 원문 1~300자, "ko": 번역 1~300자 또는 없음}. 전문 번역은 두지 않는다(설계 2절 경계).
  constraint app_outside_now_details_sentences_check check (
    jsonb_typeof(key_sentences) = 'array' and jsonb_array_length(key_sentences) <= 3
    and not jsonb_path_exists(key_sentences,
      '$[*] ? (@.type() != "object" || !(@.orig.type() == "string") || !(@.orig like_regex "^.{1,150}.{0,150}$" flag "s")
              || (exists(@.ko) && !(@.ko.type() == "null") && !(@.ko.type() == "string" && @.ko like_regex "^.{1,150}.{0,150}$" flag "s")))')),
  -- 나와의 연관: {"topics": [주제 1~30자, 5개까지], "reason": 한 줄 1~200자}. 관심사와 무관하면 null(level='basic'도 null).
  constraint app_outside_now_details_relevance_check check (
    relevance is null or (
      jsonb_typeof(relevance) = 'object'
      and not jsonb_path_exists(relevance, 'strict $.keyvalue() ? (!(@.key == "topics" || @.key == "reason"))')
      and jsonb_typeof(relevance -> 'topics') = 'array' and jsonb_array_length(relevance -> 'topics') <= 5
      and not jsonb_path_exists(relevance, '$.topics[*] ? (@.type() != "string" || !(@ like_regex "^[^\\n\\r]{1,30}$"))')
      and jsonb_typeof(relevance -> 'reason') = 'string'
      and jsonb_path_exists(relevance, '$.reason ? (@ like_regex "^[^\\n\\r]{1,200}$")'))),
  -- 시사점: {"kptu": 공공운수노조 운동에의 시사점, "labor": 한국 노동운동에의 시사점} 각각 1~300자(둘 중 하나는 있어야 함).
  constraint app_outside_now_details_implications_check check (
    implications is null or (
      jsonb_typeof(implications) = 'object'
      and not jsonb_path_exists(implications, 'strict $.keyvalue() ? (!(@.key == "kptu" || @.key == "labor"))')
      and (implications ? 'kptu' or implications ? 'labor')
      and not jsonb_path_exists(implications, 'strict $.* ? (@.type() != "string" || !(@ like_regex "^.{1,150}.{0,150}$" flag "s"))'))),
  -- 함께 볼 것: 8개까지, {"kind": 어느 표, "id": 그 줄 id(글자 1~64), "title": 1~200자}. 화면은 id로 그 자리를 연다.
  constraint app_outside_now_details_related_check check (
    jsonb_typeof(related) = 'array' and jsonb_array_length(related) <= 8
    and not jsonb_path_exists(related,
      '$[*] ? (@.type() != "object"
              || !(@.kind == "outside" || @.kind == "news" || @.kind == "update" || @.kind == "ledger" || @.kind == "library")
              || !(@.id.type() == "string" && @.id like_regex "^[A-Za-z0-9_-]{1,64}$")
              || !(@.title.type() == "string" && @.title like_regex "^[^\\n\\r]{1,200}$"))')),
  constraint app_outside_now_details_key_check check (interests_key is null or interests_key ~ '^[a-z0-9]{1,64}$'),
  -- 연관·시사점은 'full'일 때만.
  constraint app_outside_now_details_basic_check check (level = 'full' or (relevance is null and implications is null))
);
create index app_outside_now_details_article_idx on public.app_outside_now_details(article_id);
create index app_outside_now_details_ws_idx on public.app_outside_now_details(workspace_id, generated_at desc);

create table public.app_outside_now_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_outside_articles(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  constraint app_outside_now_signals_action_check check (
    action in ('star', 'unstar', 'archive', 'unarchive', 'memo', 'dismiss', 'undismiss', 'open'))
);
create index app_outside_now_signals_ws_idx on public.app_outside_now_signals(workspace_id, created_at desc);
create index app_outside_now_signals_article_idx on public.app_outside_now_signals(article_id);

-- 6) 옛 id 지도.
create table public.app_outside_id_map (
  old_id uuid primary key,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_outside_articles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index app_outside_id_map_article_idx on public.app_outside_id_map(article_id);
create index app_outside_id_map_ws_idx on public.app_outside_id_map(workspace_id);

alter table public.app_outside_articles enable row level security;
alter table public.app_outside_article_sentences enable row level security;
alter table public.app_outside_article_marks enable row level security;
alter table public.app_outside_article_bodies enable row level security;
alter table public.app_outside_reads enable row level security;
alter table public.app_outside_now_details enable row level security;
alter table public.app_outside_now_signals enable row level security;
alter table public.app_outside_id_map enable row level security;
revoke all on table public.app_outside_articles from public, anon, authenticated, service_role;
revoke all on table public.app_outside_article_sentences from public, anon, authenticated, service_role;
revoke all on table public.app_outside_article_marks from public, anon, authenticated, service_role;
revoke all on table public.app_outside_article_bodies from public, anon, authenticated, service_role;
revoke all on table public.app_outside_reads from public, anon, authenticated, service_role;
revoke all on table public.app_outside_now_details from public, anon, authenticated, service_role;
revoke all on table public.app_outside_now_signals from public, anon, authenticated, service_role;
revoke all on table public.app_outside_id_map from public, anon, authenticated, service_role;

-- 화면(authenticated): 공용 글·문장·본문·자세히는 읽기만. 표시는 자기 줄 읽기·넣기·별표/보관/관심 없음 고치기·지우기.
-- 읽음은 읽기·넣기(작업공간·글만)·지우기, 반응은 읽기·더하기(시각은 서버 기본값). 지도는 권한 없음.
grant select on table public.app_outside_articles to authenticated;
grant select on table public.app_outside_article_sentences to authenticated;
grant select, delete on table public.app_outside_article_marks to authenticated;
grant insert (workspace_id, article_id, starred_at, archived_at, dismissed_at) on table public.app_outside_article_marks to authenticated;
grant update (starred_at, archived_at, dismissed_at, updated_at) on table public.app_outside_article_marks to authenticated;
grant select on table public.app_outside_article_bodies to authenticated;
grant select, delete on table public.app_outside_reads to authenticated;
grant insert (workspace_id, article_id) on table public.app_outside_reads to authenticated;
grant select on table public.app_outside_now_details to authenticated;
grant select on table public.app_outside_now_signals to authenticated;
grant insert (workspace_id, article_id, action) on table public.app_outside_now_signals to authenticated;
-- 서버(service_role): 공용 글·문장·본문·자세히 넣기·고치기·지우기, 표시 읽기, 읽음 읽기·넣기·지우기, 반응 읽기·오래된 줄 지우기, 지도 읽기·넣기.
grant select, insert, update, delete on table public.app_outside_articles to service_role;
grant select, insert, update, delete on table public.app_outside_article_sentences to service_role;
grant select on table public.app_outside_article_marks to service_role;
grant select, insert, update, delete on table public.app_outside_article_bodies to service_role;
grant select, insert, delete on table public.app_outside_reads to service_role;
grant select, insert, update, delete on table public.app_outside_now_details to service_role;
grant select, delete on table public.app_outside_now_signals to service_role;
grant select, insert on table public.app_outside_id_map to service_role;

-- 공용 글·문장: 가입자(차단 명단 아님)만. 본문 블록·표시·읽음·반응 넣기는 그 글을 읽을 수 있을 때만(하위 조회가 공용 글 정책을 거침).
create policy outside_articles_reader_select on public.app_outside_articles for select to authenticated
  using (private.app_news_reader_ok());
create policy outside_article_sentences_reader_select on public.app_outside_article_sentences for select to authenticated
  using (private.app_news_reader_ok());
create policy outside_article_bodies_reader_select on public.app_outside_article_bodies for select to authenticated
  using (exists (select 1 from public.app_outside_articles a where a.id = article_id));
create policy outside_article_marks_owner_all on public.app_outside_article_marks for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id)
    and exists (select 1 from public.app_outside_articles a where a.id = article_id));
create policy outside_reads_owner_select on public.app_outside_reads for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_reads_owner_insert on public.app_outside_reads for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id)
    and exists (select 1 from public.app_outside_articles a where a.id = article_id));
create policy outside_reads_owner_delete on public.app_outside_reads for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_now_details_owner_select on public.app_outside_now_details for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_now_signals_owner_select on public.app_outside_now_signals for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy outside_now_signals_owner_insert on public.app_outside_now_signals for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id)
    and exists (select 1 from public.app_outside_articles a where a.id = article_id));

-- 7) 화면용 지도 함수: 옛 글 id(1~200개) → 자기 작업공간 옛 줄인 것만 (old_id, article_id). 가입자(차단 아님)만. 거절 오류(고정): 22023 OUTSIDEMAP_ARGS.
create function public.app_outside_article_of(p_old uuid[])
returns table (old_id uuid, article_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_old is null or pg_catalog.cardinality(p_old) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'OUTSIDEMAP_ARGS';
  end if;
  return query
    select m.old_id, m.article_id
      from public.app_outside_id_map m
     where m.old_id = any (p_old)
       and private.app_is_workspace_owner(m.workspace_id)
       and private.app_news_reader_ok();
end
$$;
revoke all on function public.app_outside_article_of(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.app_outside_article_of(uuid[]) to authenticated;

-- 8) 공용 문장 찾기. app_outside_search(20261102150000)와 같은 규칙, 공용 표에서. INVOKER라 공용 글·문장 읽기 정책을 그대로 거친다.
create function public.app_outside_search_shared(
  p_query text, p_terms text[], p_sources text[], p_from date, p_to date, p_limit integer, p_offset integer)
returns table (
  post_id uuid, source_key text, kind text, lang text, title text, url text, published_at timestamptz,
  idx integer, sentence text, prev_sentence text, next_sentence text, matched text, is_similar boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $search$
declare
  v_query text := btrim(coalesce(p_query, ''));
  v_terms text[];
  v_pats text[];
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 2000);
begin
  if char_length(v_query) not between 1 and 100 then
    return;
  end if;
  select array_agg(t order by o) into v_terms from (
    select distinct on (lower(t)) t, o from (
      select v_query as t, 0::bigint as o
      union all
      select btrim(x), u.o from unnest(coalesce(p_terms, array[]::text[])) with ordinality u(x, o)
        where x is not null and char_length(btrim(x)) between 1 and 100
    ) a order by lower(t), o
  ) b where o <= 6 or o = 0;
  v_terms := v_terms[1:7];
  select array_agg('%' || replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') || '%' order by o)
    into v_pats from unnest(v_terms) with ordinality u(t, o);

  return query
  select s.article_id, p.source_key, p.kind, p.lang, p.title, p.url, p.published_at, s.idx, s.text,
    (select q.text from public.app_outside_article_sentences q where q.article_id = s.article_id and q.idx = s.idx - 1),
    (select q.text from public.app_outside_article_sentences q where q.article_id = s.article_id and q.idx = s.idx + 1),
    m.t, m.o > 1
  from public.app_outside_article_sentences s
  join public.app_outside_articles p on p.id = s.article_id
  cross join lateral (
    select v_terms[u.o] as t, u.o from unnest(v_pats) with ordinality u(pat, o)
      where s.text ilike u.pat order by u.o limit 1
  ) m
  where (p_sources is null or cardinality(p_sources) = 0 or p.source_key = any(p_sources))
    and (p_from is null or (p.published_at is not null and (p.published_at at time zone 'Asia/Seoul')::date >= p_from))
    and (p_to is null or (p.published_at is not null and (p.published_at at time zone 'Asia/Seoul')::date <= p_to))
  order by p.published_at desc nulls last, p.fetched_at desc, s.article_id, s.idx
  limit v_limit offset v_offset;
end
$search$;
revoke all on function public.app_outside_search_shared(text, text[], text[], date, date, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.app_outside_search_shared(text, text[], text[], date, date, integer, integer) to authenticated;

-- 9) 옮기기.
-- 9-1) url마다 공용 글 1줄. 대표 줄 = 운영자(telegram 기능) 작업공간 줄 → 먼저 받은 줄 → id 순, id는 대표 줄 id.
insert into public.app_outside_articles (id, source_key, kind, lang, title, title_ko, author, url, published_at, fetched_at,
  summary_ko, key_sentences, has_body, body_ko)
select r.id, r.source_key, r.kind, r.lang, r.title, r.title_ko, r.author, r.url, r.published_at, r.fetched_at,
       r.summary_ko, r.key_sentences, r.has_body, r.body_ko
  from (select distinct on (p.url) p.*
          from public.app_outside_posts p
         order by p.url,
                  (p.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')) desc,
                  p.fetched_at, p.id) r;

-- 9-2) 옛 줄마다 지도 한 줄(같은 url의 공용 글).
insert into public.app_outside_id_map (old_id, workspace_id, article_id)
select p.id, p.workspace_id, a.id
  from public.app_outside_posts p
  join public.app_outside_articles a on a.url = p.url;

-- 9-3) 문장: 문장이 있는 옛 줄 중 하나(옛 id = 공용 글 id 줄 → 먼저 받은 줄 → id 순)의 문장 전부.
insert into public.app_outside_article_sentences (article_id, idx, text)
select c.article_id, s.idx, s.text
  from (select distinct on (m.article_id) m.article_id, p.id as post_id
          from public.app_outside_posts p
          join public.app_outside_id_map m on m.old_id = p.id
         where exists (select 1 from public.app_outside_sentences x where x.post_id = p.id)
         order by m.article_id, (p.id = m.article_id) desc, p.fetched_at, p.id) c
  join public.app_outside_sentences s on s.post_id = c.post_id;

-- 9-4) 작업공간마다 표시(작업공간마다 같은 url 옛 줄은 하나라 줄도 하나).
insert into public.app_outside_article_marks (workspace_id, article_id, starred_at, archived_at, dismissed_at, created_at, updated_at)
select k.workspace_id, m.article_id, k.starred_at, k.archived_at, k.dismissed_at, k.created_at, k.updated_at
  from public.app_outside_marks k
  join public.app_outside_id_map m on m.old_id = k.post_id;

-- 9-5) 글마다 대표 본문 블록 하나: 옛 id = 공용 글 id 줄 → 최근 추출 → 먼저 생긴 줄.
insert into public.app_outside_article_bodies (article_id, blocks, state, reason, rule, chars, images, extracted_at, created_at, updated_at)
select distinct on (m.article_id) m.article_id, b.blocks, b.state, b.reason, b.rule, b.chars, b.images, b.extracted_at, b.created_at, b.updated_at
  from public.app_feed_bodies b
  join public.app_outside_id_map m on m.old_id = b.outside_post_id
 where b.outside_post_id is not null
 order by m.article_id, (b.outside_post_id = m.article_id) desc, b.extracted_at desc, b.created_at, b.id;

-- 9-6) 작업공간마다 읽음·자세히·반응.
insert into public.app_outside_reads (workspace_id, article_id, read_at)
select r.workspace_id, m.article_id, min(r.read_at)
  from public.app_feed_reads r
  join public.app_outside_id_map m on m.old_id = r.outside_post_id
 where r.outside_post_id is not null
 group by r.workspace_id, m.article_id;

insert into public.app_outside_now_details (workspace_id, article_id, level, summary, key_sentences, relevance, implications, related,
  interests_key, generated_at, context_at, created_at, updated_at)
select distinct on (d.workspace_id, m.article_id) d.workspace_id, m.article_id, d.level, d.summary, d.key_sentences, d.relevance, d.implications, d.related,
       d.interests_key, d.generated_at, d.context_at, d.created_at, d.updated_at
  from public.app_now_details d
  join public.app_outside_id_map m on m.old_id = d.outside_post_id
 where d.outside_post_id is not null
 order by d.workspace_id, m.article_id, d.generated_at desc, d.id;

insert into public.app_outside_now_signals (id, workspace_id, article_id, action, created_at)
select s.id, s.workspace_id, m.article_id, s.action, s.created_at
  from public.app_now_signals s
  join public.app_outside_id_map m on m.old_id = s.outside_post_id
 where s.outside_post_id is not null;

-- 사후 확인: RLS·권한·정책 수, 함수 모양·실행 권한, 옮긴 줄 수·같은 작업공간. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_outside_articles'::regclass, 'public.app_outside_article_sentences'::regclass, 'public.app_outside_article_marks'::regclass,
                           'public.app_outside_article_bodies'::regclass, 'public.app_outside_reads'::regclass, 'public.app_outside_now_details'::regclass,
                           'public.app_outside_now_signals'::regclass, 'public.app_outside_id_map'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or has_table_privilege('service_role', t, 'truncate,references,trigger')
       or not has_table_privilege('service_role', t, 'select')
       or exists (select 1 from pg_policy where polrelid = t and (polroles <> array['authenticated'::regrole]::oid[] or not polpermissive)) then
      raise exception 'OUTSIDE_FOR_ALL_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.app_outside_id_map', 'select,delete')
     or has_any_column_privilege('authenticated', 'public.app_outside_id_map', 'select,insert,update,references')
     or exists (select 1 from pg_policy where polrelid = 'public.app_outside_id_map'::regclass)
     or has_table_privilege('service_role', 'public.app_outside_id_map', 'update,delete')
     or exists (select 1 from unnest(array['public.app_outside_articles', 'public.app_outside_article_sentences', 'public.app_outside_article_bodies',
                  'public.app_outside_now_details']) x(n)
                 where has_table_privilege('authenticated', x.n, 'delete') or has_any_column_privilege('authenticated', x.n, 'insert,update')
                    or not has_table_privilege('authenticated', x.n, 'select'))
     or has_any_column_privilege('authenticated', 'public.app_outside_reads', 'update')
     or has_column_privilege('authenticated', 'public.app_outside_reads', 'read_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_outside_reads', 'article_id', 'insert')
     or has_any_column_privilege('authenticated', 'public.app_outside_now_signals', 'update')
     or has_table_privilege('authenticated', 'public.app_outside_now_signals', 'delete')
     or has_column_privilege('authenticated', 'public.app_outside_now_signals', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_outside_now_signals', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_outside_article_marks', 'article_id', 'update')
     or has_column_privilege('authenticated', 'public.app_outside_article_marks', 'workspace_id', 'update')
     or not has_column_privilege('authenticated', 'public.app_outside_article_marks', 'starred_at', 'insert,update')
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_articles'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_article_sentences'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_article_bodies'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_article_marks'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_reads'::regclass) <> 3
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_now_details'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_outside_now_signals'::regclass) <> 2
     or (select count(*) from pg_proc p where p.oid = to_regprocedure('public.app_outside_article_of(uuid[])')
           and p.prosecdef and p.proconfig = array['search_path=""'] and coalesce(p.proacl::text, '') !~ '(^|[{,])=') <> 1
     or (select count(*) from pg_proc p where p.oid = to_regprocedure('public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)')
           and not p.prosecdef and p.proconfig = array['search_path=""'] and coalesce(p.proacl::text, '') !~ '(^|[{,])=') <> 1
     or not has_function_privilege('authenticated', 'public.app_outside_article_of(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.app_outside_article_of(uuid[])', 'execute')
     or has_function_privilege('service_role', 'public.app_outside_article_of(uuid[])', 'execute')
     or not has_function_privilege('authenticated', 'public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)', 'execute')
     or has_function_privilege('anon', 'public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)', 'execute')
     or has_function_privilege('service_role', 'public.app_outside_search_shared(text,text[],text[],date,date,integer,integer)', 'execute')
     -- 옮기기
     or (select count(*) from public.app_outside_articles) <> (select count(distinct url) from public.app_outside_posts)
     or exists (select 1 from public.app_outside_posts p
                 where p.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')
                   and not exists (select 1 from public.app_outside_articles a where a.id = p.id))
     or (select count(*) from public.app_outside_id_map) <> (select count(*) from public.app_outside_posts)
     or exists (select 1 from public.app_outside_id_map m join public.app_outside_posts p on p.id = m.old_id
                 join public.app_outside_articles a on a.id = m.article_id where a.url <> p.url or m.workspace_id <> p.workspace_id)
     or (select count(distinct article_id) from public.app_outside_article_sentences)
          <> (select count(distinct m.article_id) from public.app_outside_sentences s join public.app_outside_id_map m on m.old_id = s.post_id)
     or (select count(*) from public.app_outside_article_marks) <> (select count(*) from public.app_outside_marks)
     or exists (select 1 from public.app_outside_article_marks n where not exists (select 1 from public.app_outside_marks k
                  join public.app_outside_id_map m on m.old_id = k.post_id where k.workspace_id = n.workspace_id and m.article_id = n.article_id))
     or (select count(*) from public.app_outside_article_bodies)
          <> (select count(distinct m.article_id) from public.app_feed_bodies b join public.app_outside_id_map m on m.old_id = b.outside_post_id)
     or (select count(*) from public.app_outside_reads)
          <> (select count(*) from (select distinct r.workspace_id, m.article_id from public.app_feed_reads r join public.app_outside_id_map m on m.old_id = r.outside_post_id) x)
     or (select count(*) from public.app_outside_now_details)
          <> (select count(*) from (select distinct d.workspace_id, m.article_id from public.app_now_details d join public.app_outside_id_map m on m.old_id = d.outside_post_id) x)
     or (select count(*) from public.app_outside_now_signals) <> (select count(*) from public.app_now_signals where outside_post_id is not null)
     or exists (select 1 from public.app_outside_reads n where not exists (select 1 from public.app_feed_reads r join public.app_outside_id_map m on m.old_id = r.outside_post_id
                  where r.workspace_id = n.workspace_id and m.article_id = n.article_id))
     or exists (select 1 from public.app_outside_now_details n where not exists (select 1 from public.app_now_details d join public.app_outside_id_map m on m.old_id = d.outside_post_id
                  where d.workspace_id = n.workspace_id and m.article_id = n.article_id)) then
    raise exception 'OUTSIDE_FOR_ALL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115150000', 'outside_for_all', array['Outside statements for all D1b (expand): new shared tables app_outside_articles (posts columns without workspace, unique url) and app_outside_article_sentences, read by signed-in members not on the block list through private.app_news_reader_ok, writes service_role only; app_outside_article_bodies readable when the article is readable; per workspace app_outside_article_marks (owner policy, screen insert/update star-archive-dismiss/delete, insert needs a readable article), app_outside_reads, app_outside_now_details, app_outside_now_signals (owner policies like news D2); app_outside_id_map (old post id to article id, no screen privilege); SECURITY DEFINER app_outside_article_of(uuid[]) with empty search_path, authenticated only, own old ids only; SECURITY INVOKER app_outside_search_shared with the same arguments as app_outside_search over the shared tables, authenticated only; copies posts (one per url, operator row id first), sentences, marks, bodies, reads, details, signals; app_outside_seen and app_outside_sources stay per workspace; no change to existing tables, policies, grants, triggers, functions or rows; no anon/PUBLIC privilege']);
commit;
