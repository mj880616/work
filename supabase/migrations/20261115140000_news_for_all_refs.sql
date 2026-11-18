begin;
-- S62-12c NEWS-모두에게열기 D2 DB(Expand). 설계: docs/design/news-for-all.md 13절(#2634). 앞 단계: D1 20261115100000_news_for_all(#2628, 운영 적용), E1 Edge(#2633).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙에서 거절되면 AGENTS.md 7절 SQL Editor 경로)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 옛 뉴스 줄(app_news_items) id를 가리키는 표(본문 블록·읽음·한 건 자세히·반응)는 작업공간별 기사 줄을 전제로 한 유일 제약·정책·트리거를 가져
-- 외래 키만 공용 기사로 옮기면 깨진다(설계 13-1). 그래서 옛 표는 건드리지 않고 공용 기사를 가리키는 새 표를 더한다.
--  1) app_news_article_bodies(새): 기사마다 본문 블록 한 줄(공용). 칸·검사는 app_feed_bodies와 같고 작업공간 칸이 없다.
--     읽기: 그 기사를 읽을 수 있는 사람만(정책 안 하위 조회가 공용 기사 읽기 정책을 그대로 거침 → 가입자, 'tg_scrap'은 운영자만). 쓰기 service_role만.
--  2) app_news_reads(새): 사람별 읽음 (workspace_id, article_id) 기본 키. owner 정책. 화면은 자기 줄 읽기·넣기·지우기, 넣을 때 읽을 수 있는 기사만.
--  3) app_news_now_details(새): 사람별 한 건 자세히 (workspace_id, article_id) 기본 키. 칸·검사는 app_now_details와 같다. 화면은 자기 줄 읽기만, 쓰기 서버.
--  4) app_news_now_signals(새): 사람별 반응 기록. app_now_signals와 같은 모양(기사 칸만 article_id). 화면은 자기 줄 읽기·더하기(읽을 수 있는 기사만).
--  5) app_news_id_map(새): 옛 id(old_id) → 공용 기사 id. 화면 권한 없음(service_role만). 밑줄·노트 메모·옛 now 줄의 옛 id는 지우거나 고치지 않고 읽을 때 바꾼다.
--     화면은 public.app_news_article_of(uuid[])(DEFINER, authenticated만)로 자기 작업공간 옛 id만, 자기가 읽을 수 있는 기사로만 바꿔 받는다.
--  6) 옮기기: 옛 표에만 있는 기사(D1 뒤 E1이 공용 표에 못 넣은 주소)를 D1과 같은 규칙으로 공용 기사에 복사(id는 대표 줄 id, 이미 쓰인 id면 새 id).
--     옛 줄 전부 → 지도 1줄씩, 대표 본문 블록(옛 id = 기사 id 줄 우선 → 최근 추출), 작업공간마다 읽음·자세히·반응.
--     옮기는 동안 수집기가 옛 표·공용 표에 쓰지 못하게 관련 표를 잠근다(읽기는 됨).
-- 안 하는 것: 기존 표·칸·정책·권한·트리거·외래 키·함수 변경, 기존 줄 변경·삭제, anon·PUBLIC 권한, RLS 끄기, rtw_* 객체, 사회운동 글(D1b 별도).
-- 텔레그램: 새 표 어디에도 방 키·방 이름·보낸 사람·메시지 원문 칸이 없다. 공용 기사로 들어가는 길은 D1 그대로(새 길 없음).
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115140000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115100000' and name = 'news_for_all') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261106050000' and name = 'feed_bodies') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261106080000' and name = 'feed_reads_news_prefs') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261102140000' and name = 'now_detail') <> 1
     or to_regclass('public.app_news_items') is null
     or to_regclass('public.app_news_articles') is null
     or to_regclass('public.app_feed_bodies') is null
     or to_regclass('public.app_feed_reads') is null
     or to_regclass('public.app_now_details') is null
     or to_regclass('public.app_now_signals') is null
     or to_regclass('public.app_news_article_bodies') is not null
     or to_regclass('public.app_news_reads') is not null
     or to_regclass('public.app_news_now_details') is not null
     or to_regclass('public.app_news_now_signals') is not null
     or to_regclass('public.app_news_id_map') is not null
     or to_regprocedure('public.app_news_article_of(uuid[])') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_news_reader_ok()') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_news_scrap_reader_ok()') and prosecdef)
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_news_articles')) <> 2
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_news_articles') and relrowsecurity)
     or has_table_privilege('authenticated', 'public.app_news_articles', 'insert,update,delete')
     or has_table_privilege('anon', 'public.app_news_articles', 'select,insert,update,delete') then
    raise exception 'NEWS_REFS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 옮기는 동안 쓰기만 막는다(읽기는 됨). 수집기는 잠시 기다렸다 이어 쓴다.
lock table public.app_news_items, public.app_news_articles, public.app_feed_bodies, public.app_feed_reads,
  public.app_now_details, public.app_now_signals in share row exclusive mode;

-- 1) 공용 본문 블록. 칸·검사는 app_feed_bodies와 같다(작업공간·글 칸만 없음).
create table public.app_news_article_bodies (
  article_id uuid primary key references public.app_news_articles(id) on delete cascade,
  blocks jsonb not null default '[]'::jsonb,
  state text not null,
  reason text,
  rule text,
  chars integer not null default 0,
  images integer not null default 0,
  extracted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_news_article_bodies_state_check check (state in ('ok', 'lead', 'image_only', 'failed')),
  constraint app_news_article_bodies_reason_check check (reason is null or reason in
    ('robots', 'bot_check', 'paywall', 'too_big', 'timeout', 'http_4xx', 'http_5xx', 'no_body', 'off_host', 'relay')),
  -- 규칙 이름(출처 키 모양) @ 판 번호. 못 읽어 규칙을 쓰지 않은 글은 비워 둔다.
  constraint app_news_article_bodies_rule_check check (rule is null or rule ~ '^[a-z0-9][a-z0-9_-]{1,39}@[0-9]{1,4}$'),
  -- 블록: 배열, 400개까지. 종류는 p·h·quote(글자 하나)와 img(주소·캡션·대체 글)뿐, 그 밖의 칸 없음.
  constraint app_news_article_bodies_blocks_check check (
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
  constraint app_news_article_bodies_text_total_check check (
    char_length(jsonb_path_query_array(blocks, '$[*].text')::text) <= 110000),
  constraint app_news_article_bodies_chars_check check (
    chars between 0 and 100000
    and (chars > 0) = jsonb_path_exists(blocks, '$[*] ? (@.t != "img")')),
  -- 사진 수는 사진 블록 수와 같고 20개까지.
  constraint app_news_article_bodies_images_check check (
    images between 0 and 20
    and images = jsonb_array_length(jsonb_path_query_array(blocks, '$[*] ? (@.t == "img")'))),
  -- 상태와 까닭: ok는 까닭 없음·글자 있음, lead는 글자 있음, image_only는 사진 있음, failed는 까닭 있음·블록 없음.
  constraint app_news_article_bodies_state_shape_check check (
    case state
      when 'ok' then reason is null and chars > 0
      when 'lead' then chars > 0
      when 'image_only' then images > 0
      when 'failed' then reason is not null and jsonb_array_length(blocks) = 0
    end)
);

-- 2) 사람별 읽음.
create table public.app_news_reads (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_news_articles(id) on delete cascade,
  read_at timestamptz not null default now(),
  constraint app_news_reads_pkey primary key (workspace_id, article_id)
);
create index app_news_reads_article_idx on public.app_news_reads(article_id);
create index app_news_reads_recent_idx on public.app_news_reads(workspace_id, read_at desc);

-- 3) 사람별 한 건 자세히. 칸·검사는 app_now_details와 같다(기사 칸만 article_id).
create table public.app_news_now_details (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_news_articles(id) on delete cascade,
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
  constraint app_news_now_details_pkey primary key (workspace_id, article_id),
  constraint app_news_now_details_level_check check (level in ('full', 'basic')),
  constraint app_news_now_details_summary_check check (summary is null or char_length(summary) between 1 and 1500),
  -- 주요 문장: 3개까지, {"orig": 원문 1~300자, "ko": 번역 1~300자 또는 없음}. 전문 번역은 두지 않는다(설계 2절 경계).
  constraint app_news_now_details_sentences_check check (
    jsonb_typeof(key_sentences) = 'array' and jsonb_array_length(key_sentences) <= 3
    and not jsonb_path_exists(key_sentences,
      '$[*] ? (@.type() != "object" || !(@.orig.type() == "string") || !(@.orig like_regex "^.{1,150}.{0,150}$" flag "s")
              || (exists(@.ko) && !(@.ko.type() == "null") && !(@.ko.type() == "string" && @.ko like_regex "^.{1,150}.{0,150}$" flag "s")))')),
  -- 나와의 연관: {"topics": [주제 1~30자, 5개까지], "reason": 한 줄 1~200자}. 관심사와 무관하면 null(level='basic'도 null).
  constraint app_news_now_details_relevance_check check (
    relevance is null or (
      jsonb_typeof(relevance) = 'object'
      and not jsonb_path_exists(relevance, 'strict $.keyvalue() ? (!(@.key == "topics" || @.key == "reason"))')
      and jsonb_typeof(relevance -> 'topics') = 'array' and jsonb_array_length(relevance -> 'topics') <= 5
      and not jsonb_path_exists(relevance, '$.topics[*] ? (@.type() != "string" || !(@ like_regex "^[^\\n\\r]{1,30}$"))')
      and jsonb_typeof(relevance -> 'reason') = 'string'
      and jsonb_path_exists(relevance, '$.reason ? (@ like_regex "^[^\\n\\r]{1,200}$")'))),
  -- 시사점: {"kptu": 공공운수노조 운동에의 시사점, "labor": 한국 노동운동에의 시사점} 각각 1~300자(둘 중 하나는 있어야 함).
  constraint app_news_now_details_implications_check check (
    implications is null or (
      jsonb_typeof(implications) = 'object'
      and not jsonb_path_exists(implications, 'strict $.keyvalue() ? (!(@.key == "kptu" || @.key == "labor"))')
      and (implications ? 'kptu' or implications ? 'labor')
      and not jsonb_path_exists(implications, 'strict $.* ? (@.type() != "string" || !(@ like_regex "^.{1,150}.{0,150}$" flag "s"))'))),
  -- 함께 볼 것: 8개까지, {"kind": 어느 표, "id": 그 줄 id(글자 1~64), "title": 1~200자}. 화면은 id로 그 자리를 연다.
  constraint app_news_now_details_related_check check (
    jsonb_typeof(related) = 'array' and jsonb_array_length(related) <= 8
    and not jsonb_path_exists(related,
      '$[*] ? (@.type() != "object"
              || !(@.kind == "outside" || @.kind == "news" || @.kind == "update" || @.kind == "ledger" || @.kind == "library")
              || !(@.id.type() == "string" && @.id like_regex "^[A-Za-z0-9_-]{1,64}$")
              || !(@.title.type() == "string" && @.title like_regex "^[^\\n\\r]{1,200}$"))')),
  constraint app_news_now_details_key_check check (interests_key is null or interests_key ~ '^[a-z0-9]{1,64}$'),
  -- 연관·시사점은 'full'일 때만.
  constraint app_news_now_details_basic_check check (level = 'full' or (relevance is null and implications is null))
);
create index app_news_now_details_article_idx on public.app_news_now_details(article_id);
create index app_news_now_details_ws_idx on public.app_news_now_details(workspace_id, generated_at desc);

-- 4) 사람별 반응 기록. app_now_signals와 같은 모양.
create table public.app_news_now_signals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_news_articles(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now(),
  constraint app_news_now_signals_action_check check (
    action in ('star', 'unstar', 'archive', 'unarchive', 'memo', 'dismiss', 'undismiss', 'open'))
);
create index app_news_now_signals_ws_idx on public.app_news_now_signals(workspace_id, created_at desc);
create index app_news_now_signals_article_idx on public.app_news_now_signals(article_id);

-- 5) 옛 id 지도. 옛 줄이 나중에 정리돼도 지도는 남는다(옛 표 외래 키 없음). 기사가 지워지면 지도 줄도 지워진다.
create table public.app_news_id_map (
  old_id uuid primary key,
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_news_articles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index app_news_id_map_article_idx on public.app_news_id_map(article_id);
create index app_news_id_map_ws_idx on public.app_news_id_map(workspace_id);

alter table public.app_news_article_bodies enable row level security;
alter table public.app_news_reads enable row level security;
alter table public.app_news_now_details enable row level security;
alter table public.app_news_now_signals enable row level security;
alter table public.app_news_id_map enable row level security;
revoke all on table public.app_news_article_bodies from public, anon, authenticated, service_role;
revoke all on table public.app_news_reads from public, anon, authenticated, service_role;
revoke all on table public.app_news_now_details from public, anon, authenticated, service_role;
revoke all on table public.app_news_now_signals from public, anon, authenticated, service_role;
revoke all on table public.app_news_id_map from public, anon, authenticated, service_role;

-- 화면(authenticated): 본문 블록·자세히는 읽기만, 읽음은 읽기·넣기(작업공간·기사만)·지우기, 반응은 읽기·더하기(시각은 서버 기본값). 지도는 권한 없음.
grant select on table public.app_news_article_bodies to authenticated;
grant select, delete on table public.app_news_reads to authenticated;
grant insert (workspace_id, article_id) on table public.app_news_reads to authenticated;
grant select on table public.app_news_now_details to authenticated;
grant select on table public.app_news_now_signals to authenticated;
grant insert (workspace_id, article_id, action) on table public.app_news_now_signals to authenticated;
-- 서버(service_role): 본문 블록·자세히 넣기·고치기·지우기, 읽음 읽기·넣기·지우기, 반응 읽기·오래된 줄 지우기, 지도 읽기·넣기.
grant select, insert, update, delete on table public.app_news_article_bodies to service_role;
grant select, insert, delete on table public.app_news_reads to service_role;
grant select, insert, update, delete on table public.app_news_now_details to service_role;
grant select, delete on table public.app_news_now_signals to service_role;
grant select, insert on table public.app_news_id_map to service_role;

-- 본문 블록: 그 기사를 읽을 수 있는 사람만(하위 조회가 공용 기사 읽기 정책 — 가입자·차단 아님, 'tg_scrap'은 운영자 — 을 그대로 거친다).
create policy news_article_bodies_reader_select on public.app_news_article_bodies for select to authenticated
  using (exists (select 1 from public.app_news_articles a where a.id = article_id));
create policy news_reads_owner_select on public.app_news_reads for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy news_reads_owner_insert on public.app_news_reads for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id)
    and exists (select 1 from public.app_news_articles a where a.id = article_id));
create policy news_reads_owner_delete on public.app_news_reads for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy news_now_details_owner_select on public.app_news_now_details for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy news_now_signals_owner_select on public.app_news_now_signals for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));
create policy news_now_signals_owner_insert on public.app_news_now_signals for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id)
    and exists (select 1 from public.app_news_articles a where a.id = article_id));

-- 6) 화면용 지도 함수: 옛 id 목록(1~200개) → 자기 작업공간 옛 줄이고 자기가 읽을 수 있는 공용 기사인 것만 (old_id, article_id).
--    지도 표·공용 기사를 DEFINER로 읽으므로 owner·읽기 조건을 함수 안에서 직접 건다. 없는 id·남의 id는 줄이 없다(오류 아님).
--    거절 오류(고정): 22023 NEWSMAP_ARGS.
create function public.app_news_article_of(p_old uuid[])
returns table (old_id uuid, article_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_old is null or pg_catalog.cardinality(p_old) not between 1 and 200 then
    raise exception using errcode = '22023', message = 'NEWSMAP_ARGS';
  end if;
  return query
    select m.old_id, m.article_id
      from public.app_news_id_map m
      join public.app_news_articles a on a.id = m.article_id
     where m.old_id = any (p_old)
       and private.app_is_workspace_owner(m.workspace_id)
       and case when a.origin = 'tg_scrap' then private.app_news_scrap_reader_ok() else private.app_news_reader_ok() end;
end
$$;
revoke all on function public.app_news_article_of(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.app_news_article_of(uuid[]) to authenticated;

-- 7) 옮기기.
-- 7-1) 옛 표에만 있는 주소를 공용 기사로(D1과 같은 규칙: 대표 줄 = 운영자 작업공간 줄 → 먼저 생긴 줄 → id 순, 채널 스크랩만 있던 주소는 'tg_scrap').
--      대표 줄 id가 이미 다른 공용 기사 id로 쓰였으면 새 id.
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
                  i.created_at, i.id) r;

-- 7-2) 옛 줄마다 지도 한 줄(같은 주소의 공용 기사).
insert into public.app_news_id_map (old_id, workspace_id, article_id)
select i.id, i.workspace_id, a.id
  from public.app_news_items i
  join public.app_news_articles a on a.url_key = i.url_key;

-- 7-3) 기사마다 대표 본문 블록 하나: 옛 id = 기사 id 줄 → 최근 추출 → 먼저 생긴 줄.
insert into public.app_news_article_bodies (article_id, blocks, state, reason, rule, chars, images, extracted_at, created_at, updated_at)
select distinct on (m.article_id) m.article_id, b.blocks, b.state, b.reason, b.rule, b.chars, b.images, b.extracted_at, b.created_at, b.updated_at
  from public.app_feed_bodies b
  join public.app_news_id_map m on m.old_id = b.news_item_id
 where b.news_item_id is not null
 order by m.article_id, (b.news_item_id = m.article_id) desc, b.extracted_at desc, b.created_at, b.id;

-- 7-4) 작업공간마다 읽음(같은 기사 여러 줄이면 먼저 읽은 시각).
insert into public.app_news_reads (workspace_id, article_id, read_at)
select r.workspace_id, m.article_id, min(r.read_at)
  from public.app_feed_reads r
  join public.app_news_id_map m on m.old_id = r.news_item_id
 where r.news_item_id is not null
 group by r.workspace_id, m.article_id;

-- 7-5) 작업공간마다 한 건 자세히(같은 기사 여러 줄이면 최근 만든 줄).
insert into public.app_news_now_details (workspace_id, article_id, level, summary, key_sentences, relevance, implications, related,
  interests_key, generated_at, context_at, created_at, updated_at)
select distinct on (d.workspace_id, m.article_id) d.workspace_id, m.article_id, d.level, d.summary, d.key_sentences, d.relevance, d.implications, d.related,
       d.interests_key, d.generated_at, d.context_at, d.created_at, d.updated_at
  from public.app_now_details d
  join public.app_news_id_map m on m.old_id = d.news_item_id
 where d.news_item_id is not null
 order by d.workspace_id, m.article_id, d.generated_at desc, d.id;

-- 7-6) 반응 기록 전부(같은 id 그대로).
insert into public.app_news_now_signals (id, workspace_id, article_id, action, created_at)
select s.id, s.workspace_id, m.article_id, s.action, s.created_at
  from public.app_now_signals s
  join public.app_news_id_map m on m.old_id = s.news_item_id
 where s.news_item_id is not null;

-- 사후 확인: 새 표 RLS 켜짐·anon·PUBLIC 권한 없음·화면 권한 정해진 대로·정책 수, 지도 화면 권한 없음, 함수 DEFINER·search_path 고정·실행 권한,
-- 옮긴 줄 수(옛 주소 모두 공용 기사에 있음, 옛 줄 = 지도 줄, 본문·읽음·자세히·반응 수), 고아 0. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_news_article_bodies'::regclass, 'public.app_news_reads'::regclass, 'public.app_news_now_details'::regclass,
                           'public.app_news_now_signals'::regclass, 'public.app_news_id_map'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or has_any_column_privilege('authenticated', t, 'update')
       or has_table_privilege('service_role', t, 'truncate,references,trigger')
       or not has_table_privilege('service_role', t, 'select')
       or exists (select 1 from pg_policy where polrelid = t and polroles <> array['authenticated'::regrole]::oid[]) then
      raise exception 'NEWS_REFS_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.app_news_id_map', 'select,delete')
     or has_any_column_privilege('authenticated', 'public.app_news_id_map', 'select,insert,update,references')
     or exists (select 1 from pg_policy where polrelid = 'public.app_news_id_map'::regclass)
     or has_table_privilege('authenticated', 'public.app_news_article_bodies', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_news_article_bodies', 'insert')
     or not has_table_privilege('authenticated', 'public.app_news_article_bodies', 'select')
     or has_table_privilege('authenticated', 'public.app_news_now_details', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_news_now_details', 'insert')
     or not has_table_privilege('authenticated', 'public.app_news_now_details', 'select')
     or not has_table_privilege('authenticated', 'public.app_news_reads', 'select,delete')
     or not has_column_privilege('authenticated', 'public.app_news_reads', 'article_id', 'insert')
     or has_column_privilege('authenticated', 'public.app_news_reads', 'read_at', 'insert')
     or has_table_privilege('authenticated', 'public.app_news_now_signals', 'delete')
     or not has_column_privilege('authenticated', 'public.app_news_now_signals', 'action', 'insert')
     or has_column_privilege('authenticated', 'public.app_news_now_signals', 'created_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_news_now_signals', 'id', 'insert')
     or has_table_privilege('service_role', 'public.app_news_id_map', 'update,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_news_article_bodies'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_news_reads'::regclass) <> 3
     or (select count(*) from pg_policy where polrelid = 'public.app_news_now_details'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_news_now_signals'::regclass) <> 2
     or exists (select 1 from pg_policy where polrelid in ('public.app_news_article_bodies'::regclass, 'public.app_news_reads'::regclass,
                  'public.app_news_now_details'::regclass, 'public.app_news_now_signals'::regclass) and not polpermissive)
     or (select count(*) from pg_proc p where p.oid = to_regprocedure('public.app_news_article_of(uuid[])')
           and p.prosecdef and p.proconfig = array['search_path=""'] and coalesce(p.proacl::text, '') !~ '(^|[{,])=') <> 1
     or not has_function_privilege('authenticated', 'public.app_news_article_of(uuid[])', 'execute')
     or has_function_privilege('anon', 'public.app_news_article_of(uuid[])', 'execute')
     or has_function_privilege('service_role', 'public.app_news_article_of(uuid[])', 'execute')
     -- 옮기기
     or exists (select 1 from public.app_news_items i where not exists (select 1 from public.app_news_articles a where a.url_key = i.url_key))
     or (select count(*) from public.app_news_id_map) <> (select count(*) from public.app_news_items)
     or exists (select 1 from public.app_news_id_map m join public.app_news_items i on i.id = m.old_id
                 join public.app_news_articles a on a.id = m.article_id where a.url_key <> i.url_key or m.workspace_id <> i.workspace_id)
     or exists (select 1 from public.app_news_articles a where a.origin = 'tg_scrap' and a.lane <> 'channel')
     or (select count(*) from public.app_news_article_bodies)
          <> (select count(distinct m.article_id) from public.app_feed_bodies b join public.app_news_id_map m on m.old_id = b.news_item_id)
     or (select count(*) from public.app_news_reads)
          <> (select count(*) from (select distinct r.workspace_id, m.article_id from public.app_feed_reads r join public.app_news_id_map m on m.old_id = r.news_item_id) x)
     or (select count(*) from public.app_news_now_details)
          <> (select count(*) from (select distinct d.workspace_id, m.article_id from public.app_now_details d join public.app_news_id_map m on m.old_id = d.news_item_id) x)
     or (select count(*) from public.app_news_now_signals) <> (select count(*) from public.app_now_signals where news_item_id is not null)
     -- 사람별 줄은 옛 줄과 같은 작업공간 것만(다른 작업공간으로 새지 않음).
     or exists (select 1 from public.app_news_reads n where not exists (select 1 from public.app_feed_reads r join public.app_news_id_map m on m.old_id = r.news_item_id
                  where r.workspace_id = n.workspace_id and m.article_id = n.article_id))
     or exists (select 1 from public.app_news_now_details n where not exists (select 1 from public.app_now_details d join public.app_news_id_map m on m.old_id = d.news_item_id
                  where d.workspace_id = n.workspace_id and m.article_id = n.article_id)) then
    raise exception 'NEWS_REFS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115140000', 'news_for_all_refs', array['NEWS for all D2 (expand): new tables pointing at shared articles, old tables untouched; app_news_article_bodies (one body per article; RLS on; authenticated select only when the article itself is readable through its policies; writes service_role only); app_news_reads (per workspace read marks; owner select/insert/delete, insert needs a readable article); app_news_now_details (per workspace detail; owner select, writes service_role); app_news_now_signals (per workspace signals; owner select/insert, insert needs a readable article); app_news_id_map (old app_news_items id to article id; no screen privilege, service_role select/insert); SECURITY DEFINER app_news_article_of(uuid[]) with empty search_path, authenticated only, returns only the caller own old ids mapped to articles the caller can read; copies old-only url keys into articles (same rule as D1), one map row per old item, one body per article, reads, details and signals per workspace; no change to existing tables, policies, grants, triggers, functions or rows; no anon/PUBLIC privilege']);
commit;
