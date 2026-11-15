begin;
-- S62-12 NEWS-모두에게열기 ① DB(D1, Expand). 설계: docs/design/news-for-all.md 2·4절(#2622). 명진 결정 11/15 08:32·09:20(3 가·5 예·6 그대로), 11/14 22:47(뉴스방은 명진이 누른 방만).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙에서 거절되면 AGENTS.md 7절 SQL Editor 경로)으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  1) app_news_articles(새): 공용 기사 한 벌. 작업공간 칸이 없다. url_key는 전체에서 유일.
--     origin: 'site'(매체·키워드 사이트 수집), 'tg_room'(명진이 [뉴스방으로] 정한 방 글 속 기사 주소), 'tg_scrap'(옮기는 동안의 앱 스크립트 채널 스크랩).
--     텔레그램 글 원문·방 이름·방 키·보낸 사람 칸은 없다(넣을 곳이 없음).
--     읽기: 로그인 + 자기 owner 행 정확히 1개 + 차단 명단에 없음(private.app_news_reader_ok). 'tg_scrap' 줄은 telegram 기능이 있는 운영자만(private.app_news_scrap_reader_ok).
--     넣기·고치기·지우기: service_role만(화면 권한 없음). anon·PUBLIC 없음.
--  2) app_news_marks(새): 사람별 별표·폴더·숨김·키워드 표시. owner 정책. 화면은 자기 줄 넣기·별표/폴더/숨김 고치기·지우기, keywords는 서버만.
--     넣을 때 기사는 그 사람이 읽을 수 있는 공용 기사여야 한다(with check 안 하위 조회가 읽기 정책을 그대로 거침).
--  3) app_feed_rooms.news_at(칸 1개): 뉴스방으로 정한 시각. null = 뉴스방 아님. 고치는 길은 아래 함수뿐(화면에 칸 쓰기 권한 없음, 기존 정책·트리거 그대로).
--  4) public.app_feed_room_news(text, boolean): 화면 [뉴스방으로]/[뉴스방에서 빼기]. tg_room_pin과 같은 모양(DEFINER, authenticated만, auth.uid()의 owner 작업공간,
--     telegram 기능 필수). 그룹·채널 방만(1:1·종류 모름 거절), 가족 방(잊지 말기 줄이 있는 방) 거절. news_at·updated_at만 고친다. 빼도 이미 들어간 기사는 그대로(명진 결정 6).
--  5) public.app_news_room_take(uuid, text, jsonb): 수집기(service_role)만. 그 방이 지금 뉴스방인지 서버 표로 다시 판정한 뒤
--     기사 주소(url·url_key)만 공용 기사(origin 'tg_room', state 'pending')에 넣는다. 업무 문서·대화방 초대·단축 주소·내부 주소는 버리고 개수만 센다.
--     같은 주소가 이미 있으면 넣지 않는다('tg_scrap' 줄이면 origin만 'tg_room'으로 넓힘). 뉴스방이 아니면 아무것도 넣지 않는다.
--  6) 옮기기: app_news_items의 기사를 url_key마다 한 줄로 공용 기사에 복사(id는 운영자 줄 id 우선 → 그 밖은 먼저 생긴 줄 id).
--     lane 'channel'만 있던 주소는 origin 'tg_scrap', 그 밖은 'site'. 별표·폴더·숨김·키워드가 있던 줄은 그 작업공간의 표시로 복사.
--     옛 표·외래 키·정리 함수는 그대로(D2에서 외래 키를 옮기고, 그 사이 옛 표에 들어온 줄을 같은 규칙으로 한 번 더 복사).
-- 안 하는 것: 기존 표의 정책·권한·트리거·함수 변경, 기존 줄 변경·삭제, anon·PUBLIC 권한, RLS 끄기, rtw_* 객체, 사회운동 글(app_outside_posts).
-- 짝: docs/20261115100000_news_for_all.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261101233000' and name = 'news_clipping') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261108140000' and name = 'news_titles_tried') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261029090000' and name = 'operator_features') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261030060000' and name = 'tg_room_pin') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261105100000' and name = 'family_notes') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261113140000' and name = 'workspace_signup_allow') <> 1
     or to_regclass('public.app_news_items') is null
     or to_regclass('public.app_news_folders') is null
     or to_regclass('public.app_feed_rooms') is null
     or to_regclass('public.app_family_notes') is null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_workspace_signup_allow') is null
     or to_regclass('public.app_news_articles') is not null
     or to_regclass('public.app_news_marks') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_rooms') and attname = 'news_at' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_feed_rooms') and attname = 'chat_kind' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_news_items') and attname = 'title_tried_at' and not attisdropped)
     or to_regprocedure('private.app_news_reader_ok()') is not null
     or to_regprocedure('private.app_news_scrap_reader_ok()') is not null
     or to_regprocedure('public.app_feed_room_news(text,boolean)') is not null
     or to_regprocedure('public.app_news_room_take(uuid,text,jsonb)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_feed_owner_workspace()') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or (select count(*) from pg_trigger where tgrelid = to_regclass('public.app_feed_rooms') and tgname = 'trg_op_feature_guard' and not tgisinternal and tgenabled <> 'D') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_feed_rooms') and polname = 'op_feature_read' and not polpermissive) <> 1
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_news_items') and relrowsecurity)
     or has_table_privilege('anon', 'public.app_news_items', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.app_news_items', 'insert,delete')
     -- 운영자(telegram 기능) 작업공간이 정확히 하나이고 그 owner 행이 정확히 하나여야 옮기기 기준(id 우선)을 정할 수 있다.
     or (select count(distinct f.workspace_id) from public.app_operator_features f where f.feature = 'telegram') <> 1
     or (select count(*) from public.app_workspace_members m
          where m.role = 'owner' and m.workspace_id = (select min(f.workspace_id::text)::uuid from public.app_operator_features f where f.feature = 'telegram')) <> 1 then
    raise exception 'NEWS_FOR_ALL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 공용 기사 한 벌. 칸 규칙은 app_news_items와 같다(작업공간·별표·폴더·숨김·키워드 칸만 없음).
create table public.app_news_articles (
  id uuid primary key default gen_random_uuid(),
  origin text not null,
  lane text not null,
  url text not null,
  url_key text not null,
  title text,
  title_key text,
  lang text not null default 'ko',
  publisher text,
  source_key text,
  published_at timestamptz,
  scrapped_at timestamptz,
  fetched_at timestamptz,
  state text not null default 'pending',
  summary text,
  body text,
  body_kind text,
  title_ko text,
  body_ko text,
  translated_at timestamptz,
  title_tried_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_news_articles_url_key_unique unique (url_key),
  constraint app_news_articles_origin_check check (origin in ('site', 'tg_room', 'tg_scrap')),
  constraint app_news_articles_lane_check check (lane in ('channel', 'keyword', 'media')),
  constraint app_news_articles_url_check check (
    url ~ '^https?://[^[:space:]]+$' and char_length(url) <= 2000 and char_length(url_key) between 1 and 2000),
  constraint app_news_articles_state_check check (
    state in ('pending', 'ok', 'robots', 'bot_check', 'paywall', 'failed', 'too_big', 'blocked')),
  constraint app_news_articles_lang_check check (lang ~ '^[a-z]{2,3}$'),
  constraint app_news_articles_text_check check (
    (title is null or (char_length(title) between 1 and 500 and title !~ '[[:cntrl:]]'))
    and (title_key is null or char_length(title_key) between 1 and 500)
    and (title_ko is null or (char_length(title_ko) between 1 and 500 and title_ko !~ '[[:cntrl:]]'))
    and (publisher is null or (char_length(publisher) between 1 and 120 and publisher !~ '[[:cntrl:]]'))
    and (source_key is null or source_key ~ '^[a-z0-9][a-z0-9-]{1,39}$')
    and (summary is null or char_length(summary) between 1 and 600)),
  constraint app_news_articles_body_check check (
    (body is null) = (body_kind is null)
    and (body_kind is null or body_kind in ('full', 'lead'))
    and (body is null or char_length(body) between 1 and 100000)
    and (body_ko is null or char_length(body_ko) between 1 and 100000)
    and ((translated_at is null) = (title_ko is null and body_ko is null)))
);
create index app_news_articles_list_idx on public.app_news_articles(coalesce(published_at, scrapped_at, created_at) desc);
create index app_news_articles_pending_idx on public.app_news_articles(created_at) where state = 'pending';
create index app_news_articles_title_idx on public.app_news_articles(title_key) where title_key is not null;
create index app_news_articles_source_idx on public.app_news_articles(source_key, created_at desc) where source_key is not null;

-- 2) 사람별 표시. 줄은 표시나 키워드가 생길 때만. 폴더는 같은 작업공간 폴더만(옛 표와 같은 외래 키 모양).
create table public.app_news_marks (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  article_id uuid not null references public.app_news_articles(id) on delete cascade,
  starred_at timestamptz,
  folder_id uuid,
  hidden_at timestamptz,
  keywords text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_news_marks_pkey primary key (workspace_id, article_id),
  constraint app_news_marks_folder_fk foreign key (folder_id, workspace_id)
    references public.app_news_folders(id, workspace_id) on delete set null (folder_id),
  constraint app_news_marks_folder_star_check check (folder_id is null or starred_at is not null),
  constraint app_news_marks_keywords_check check (
    cardinality(keywords) <= 10 and array_position(keywords, null) is null)
);
create index app_news_marks_article_idx on public.app_news_marks(article_id);
create index app_news_marks_star_idx on public.app_news_marks(workspace_id, starred_at desc) where starred_at is not null;
create index app_news_marks_folder_idx on public.app_news_marks(folder_id) where folder_id is not null;

alter table public.app_news_articles enable row level security;
alter table public.app_news_marks enable row level security;
revoke all on table public.app_news_articles from public, anon, authenticated, service_role;
revoke all on table public.app_news_marks from public, anon, authenticated, service_role;

-- 화면: 공용 기사는 읽기만. 표시는 자기 줄 읽기·넣기·별표/폴더/숨김 고치기·지우기(keywords는 못 씀).
grant select on table public.app_news_articles to authenticated;
grant select, delete on table public.app_news_marks to authenticated;
grant insert (workspace_id, article_id, starred_at, folder_id, hidden_at) on table public.app_news_marks to authenticated;
grant update (starred_at, folder_id, hidden_at, updated_at) on table public.app_news_marks to authenticated;
-- 수집기(service_role): 공용 기사 넣기·고치기·지우기, 표시는 키워드 칸을 위해 읽기·넣기·고치기·지우기.
grant select, insert, update, delete on table public.app_news_articles to service_role;
grant select, insert, update, delete on table public.app_news_marks to service_role;

-- 3) 뉴스방 시각 칸. 기존 정책(owner 읽기 + op_feature_read)·트리거(trg_op_feature_guard)가 그대로 덮는다.
alter table public.app_feed_rooms add column news_at timestamptz;

-- 읽을 수 있는 가입자: 로그인 + 자기 owner 행 정확히 1개 + 차단 명단(app_workspace_signup_allow kind 'blocked')에 없음.
-- 차단 확인은 가입 함수 app_workspace_start와 같은 방식(auth.users 메일 소문자 = 명단 메일).
create function private.app_news_reader_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and (select pg_catalog.count(*) from public.app_workspace_members m
           where m.user_id = (select auth.uid()) and m.role = 'owner') = 1
     and not exists (select 1 from public.app_workspace_signup_allow a join auth.users u on pg_catalog.lower(u.email) = a.email
                      where u.id = (select auth.uid()) and a.kind = 'blocked')
$$;

-- 옮기는 동안의 채널 스크랩 줄('tg_scrap')을 읽을 수 있는 사람: 위 조건 + 자기 작업공간에 telegram 기능(= 운영자만).
create function private.app_news_scrap_reader_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.app_news_reader_ok()
     and exists (select 1 from public.app_workspace_members m
                   join public.app_operator_features f on f.workspace_id = m.workspace_id and f.feature = 'telegram'
                  where m.user_id = (select auth.uid()) and m.role = 'owner')
$$;

revoke all on function private.app_news_reader_ok() from public, anon, authenticated, service_role;
revoke all on function private.app_news_scrap_reader_ok() from public, anon, authenticated, service_role;
grant execute on function private.app_news_reader_ok() to authenticated;
grant execute on function private.app_news_scrap_reader_ok() to authenticated;

create policy news_articles_reader_select on public.app_news_articles for select to authenticated
  using (origin <> 'tg_scrap' and private.app_news_reader_ok());
create policy news_articles_scrap_operator_select on public.app_news_articles for select to authenticated
  using (origin = 'tg_scrap' and private.app_news_scrap_reader_ok());
create policy news_marks_owner_all on public.app_news_marks for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id)
    and exists (select 1 from public.app_news_articles a where a.id = article_id));

-- 4) 화면 [뉴스방으로](p_on true) / [뉴스방에서 빼기](p_on false). 거절 오류(고정): 22023 TGDG_ARGS·TGNEWS_KIND·TGNEWS_FAMILY, 42501 OPERATOR_FEATURE_REQUIRED, P0002 TGDG_NOT_FOUND.
create function public.app_feed_room_news(p_room_key text, p_on boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
  cur public.app_feed_rooms;
  want timestamptz;
  changed boolean := false;
begin
  if p_room_key is null or p_on is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TGDG_ARGS';
  end if;
  ws := private.app_feed_owner_workspace();
  if not private.app_workspace_has_feature(ws, 'telegram') then
    raise exception using errcode = '42501', message = 'OPERATOR_FEATURE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app_feed_rooms:' || ws::text, 0));
  select * into cur from public.app_feed_rooms r where r.workspace_id = ws and r.room_key = p_room_key;
  if not found then
    raise exception using errcode = 'P0002', message = 'TGDG_NOT_FOUND';
  end if;
  if p_on then
    -- 1:1(user)·종류 모름(null)은 뉴스방이 될 수 없다. 그룹·채널만.
    if cur.chat_kind is null or cur.chat_kind not in ('group', 'channel') then
      raise exception using errcode = '22023', message = 'TGNEWS_KIND';
    end if;
    -- 가족 방: 잊지 말기 줄의 방 표(collector-feed familyRoomTag와 같은 계산)가 있는 방.
    if exists (select 1 from public.app_family_notes n
                where n.workspace_id = ws
                  and pg_catalog.starts_with(n.source_ref, 'fam:tg:' || pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(
                        pg_catalog.convert_to('family-room|' || ws::text || '|' || p_room_key, 'UTF8')), 'hex'), 16) || ':')) then
      raise exception using errcode = '22023', message = 'TGNEWS_FAMILY';
    end if;
    want := coalesce(cur.news_at, pg_catalog.now());
  else
    want := null;
  end if;
  if cur.news_at is distinct from want then
    update public.app_feed_rooms r set news_at = want, updated_at = pg_catalog.now()
      where r.workspace_id = ws and r.room_key = p_room_key;
    changed := true;
  end if;
  return pg_catalog.jsonb_build_object('ok', true, 'changed', changed, 'room_key', p_room_key, 'news_at', want);
end
$$;

-- 5) 수집기 전용: 뉴스방 글에서 뽑은 기사 주소만 공용 기사로. p_items = [{"url": "...", "url_key": "..."}] 1~50개.
--    서버 표로 판정: 그 작업공간이 telegram 기능을 가졌고, 방이 news_at 있음 + 그룹·채널 + 가족 방 아님. 아니면 0줄(news false).
--    버리는 주소(개수만 셈): https 아님·모양 틀림, 텔레그램·구글 문서/드라이브/설문·원드라이브/셰어포인트·노션·드롭박스·박스, 복둥 주소,
--    대화방 초대·화상회의(오픈채팅·왓츠앱·디스코드·밴드·줌·구글 미트), 단축 주소, IP·localhost·내부 이름·Supabase.
create function public.app_news_room_take(p_workspace uuid, p_room_key text, p_items jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  cur public.app_feed_rooms;
  it jsonb;
  v_url text;
  v_key text;
  v_host text;
  v_origin text;
  taken integer := 0;
  dup integer := 0;
  widened integer := 0;
  refused integer := 0;
begin
  if p_workspace is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$'
     or p_items is null or pg_catalog.jsonb_typeof(p_items) <> 'array'
     or pg_catalog.jsonb_array_length(p_items) not between 1 and 50 then
    raise exception using errcode = '22023', message = 'NEWSROOM_ARGS';
  end if;
  if not exists (select 1 from public.app_operator_features f where f.workspace_id = p_workspace and f.feature = 'telegram') then
    return pg_catalog.jsonb_build_object('ok', true, 'news', false, 'taken', 0, 'dup', 0, 'widened', 0, 'refused', 0);
  end if;
  select * into cur from public.app_feed_rooms r where r.workspace_id = p_workspace and r.room_key = p_room_key;
  if not found or cur.news_at is null or cur.chat_kind is null or cur.chat_kind not in ('group', 'channel')
     or exists (select 1 from public.app_family_notes n
                 where n.workspace_id = p_workspace
                   and pg_catalog.starts_with(n.source_ref, 'fam:tg:' || pg_catalog.left(pg_catalog.encode(pg_catalog.sha256(
                         pg_catalog.convert_to('family-room|' || p_workspace::text || '|' || p_room_key, 'UTF8')), 'hex'), 16) || ':')) then
    return pg_catalog.jsonb_build_object('ok', true, 'news', false, 'taken', 0, 'dup', 0, 'widened', 0, 'refused', 0);
  end if;
  for it in select e from pg_catalog.jsonb_array_elements(p_items) as x(e) loop
    v_url := case when pg_catalog.jsonb_typeof(it) = 'object' and pg_catalog.jsonb_typeof(it -> 'url') = 'string' then it ->> 'url' end;
    v_key := case when pg_catalog.jsonb_typeof(it) = 'object' and pg_catalog.jsonb_typeof(it -> 'url_key') = 'string' then it ->> 'url_key' end;
    v_host := pg_catalog.lower(pg_catalog.substring(v_url, '^https://([^/?#:@[:space:]]+)(?:[/?#]|$)'));
    if v_url is null or v_key is null or v_host is null
       or v_url !~ '^https://[^[:space:]]+$' or pg_catalog.char_length(v_url) > 2000
       or pg_catalog.char_length(v_key) not between 1 and 2000 or v_key ~ '[[:space:][:cntrl:]]'
       or v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
       or v_host ~ '^[0-9.]+$'
       or v_host ~ '(^|\.)(t\.me|telegram\.org|telegram\.me|telegram\.dog|docs\.google\.com|drive\.google\.com|forms\.gle|forms\.google\.com|sites\.google\.com|meet\.google\.com|onedrive\.live\.com|1drv\.ms|sharepoint\.com|notion\.so|notion\.site|dropbox\.com|box\.com|bokdoong\.com|supabase\.co|supabase\.in|open\.kakao\.com|chat\.whatsapp\.com|discord\.gg|discord\.com|band\.us|zoom\.us|bit\.ly|tinyurl\.com|t\.co|goo\.gl|han\.gl|me2\.do|vo\.la|url\.kr|buly\.kr|ow\.ly|is\.gd|lrl\.kr|naver\.me|kko\.to|shorturl\.at|rb\.gy|cutt\.ly|localhost|local|internal|lan|home|corp)$' then
      refused := refused + 1;
      continue;
    end if;
    select a.origin into v_origin from public.app_news_articles a where a.url_key = v_key;
    if found then
      if v_origin = 'tg_scrap' then
        update public.app_news_articles a set origin = 'tg_room', updated_at = pg_catalog.now() where a.url_key = v_key;
        widened := widened + 1;
      else
        dup := dup + 1;
      end if;
      continue;
    end if;
    insert into public.app_news_articles (origin, lane, url, url_key, scrapped_at, state)
    values ('tg_room', 'channel', v_url, v_key, pg_catalog.now(), 'pending')
    on conflict (url_key) do nothing;
    if found then
      taken := taken + 1;
    else
      dup := dup + 1;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'news', true, 'taken', taken, 'dup', dup, 'widened', widened, 'refused', refused);
end
$$;

revoke all on function public.app_feed_room_news(text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.app_news_room_take(uuid, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_feed_room_news(text, boolean) to authenticated;
grant execute on function public.app_news_room_take(uuid, text, jsonb) to service_role;

-- 6) 옮기기. url_key마다 대표 줄 하나: 운영자(telegram 기능) 작업공간 줄 → 먼저 생긴 줄 → id 순.
insert into public.app_news_articles (id, origin, lane, url, url_key, title, title_key, lang, publisher, source_key,
  published_at, scrapped_at, fetched_at, state, summary, body, body_kind, title_ko, body_ko, translated_at, title_tried_at, created_at, updated_at)
select r.id,
       case when exists (select 1 from public.app_news_items o where o.url_key = r.url_key and o.lane <> 'channel') then 'site' else 'tg_scrap' end,
       r.lane, r.url, r.url_key, r.title, r.title_key, r.lang, r.publisher, r.source_key,
       r.published_at, r.scrapped_at, r.fetched_at, r.state, r.summary, r.body, r.body_kind, r.title_ko, r.body_ko, r.translated_at, r.title_tried_at,
       r.created_at, r.updated_at
  from (select distinct on (i.url_key) i.*
          from public.app_news_items i
         order by i.url_key,
                  (i.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')) desc,
                  i.created_at, i.id) r;

insert into public.app_news_marks (workspace_id, article_id, starred_at, folder_id, hidden_at, keywords, created_at, updated_at)
select i.workspace_id, a.id, i.starred_at, i.folder_id, i.hidden_at, i.keywords, i.created_at, i.updated_at
  from public.app_news_items i
  join public.app_news_articles a on a.url_key = i.url_key
 where i.starred_at is not null or i.folder_id is not null or i.hidden_at is not null or cardinality(i.keywords) > 0;

-- 사후 확인: 새 표 RLS 켜짐·anon·PUBLIC 권한 없음·화면 쓰기 권한 정해진 대로, 정책 수, 함수 DEFINER·search_path 고정·실행 권한,
-- 옮긴 줄 수(기사 = 서로 다른 url_key 수, 운영자 줄 id 모두 있음, 표시 = 표시 있던 줄 수), 옛 표 줄 수 그대로. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_news_articles'::regclass, 'public.app_news_marks'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or not has_table_privilege('authenticated', t, 'select')
       or has_table_privilege('service_role', t, 'truncate,references,trigger')
       or not has_table_privilege('service_role', t, 'select,insert,update,delete')
       or exists (select 1 from pg_policy where polrelid = t and polroles <> array['authenticated'::regrole]::oid[]) then
      raise exception 'NEWS_FOR_ALL_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if (select count(*) from pg_policy where polrelid = 'public.app_news_articles'::regclass and polcmd = 'r' and polpermissive) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_news_articles'::regclass) <> 2
     or (select count(*) from pg_policy where polrelid = 'public.app_news_marks'::regclass) <> 1
     or has_table_privilege('authenticated', 'public.app_news_articles', 'delete')
     or has_any_column_privilege('authenticated', 'public.app_news_articles', 'insert,update')
     or has_column_privilege('authenticated', 'public.app_news_marks', 'keywords', 'insert,update')
     or not has_column_privilege('authenticated', 'public.app_news_marks', 'starred_at', 'insert,update')
     or not has_table_privilege('authenticated', 'public.app_news_marks', 'delete')
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_feed_rooms'::regclass and attname = 'news_at' and not attisdropped
                      and atttypid = 'timestamptz'::regtype and not attnotnull and not atthasdef and attacl is null)
     or has_column_privilege('authenticated', 'public.app_feed_rooms', 'news_at', 'insert,update')
     or has_any_column_privilege('anon', 'public.app_feed_rooms', 'select,insert,update,references')
     or exists (select 1 from public.app_feed_rooms where news_at is not null)
     or exists (select 1 from pg_proc p where p.oid in (to_regprocedure('private.app_news_reader_ok()'), to_regprocedure('private.app_news_scrap_reader_ok()'),
                    to_regprocedure('public.app_feed_room_news(text,boolean)'), to_regprocedure('public.app_news_room_take(uuid,text,jsonb)'))
                  and (not p.prosecdef or p.proconfig is distinct from array['search_path=""'] or coalesce(p.proacl::text, '') ~ '(^|[{,])='))
     or (select count(*) from pg_proc p where p.oid in (to_regprocedure('private.app_news_reader_ok()'), to_regprocedure('private.app_news_scrap_reader_ok()'),
                    to_regprocedure('public.app_feed_room_news(text,boolean)'), to_regprocedure('public.app_news_room_take(uuid,text,jsonb)'))) <> 4
     or has_function_privilege('anon', 'public.app_feed_room_news(text,boolean)', 'execute')
     or has_function_privilege('service_role', 'public.app_feed_room_news(text,boolean)', 'execute')
     or not has_function_privilege('authenticated', 'public.app_feed_room_news(text,boolean)', 'execute')
     or has_function_privilege('anon', 'public.app_news_room_take(uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.app_news_room_take(uuid,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.app_news_room_take(uuid,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.app_news_reader_ok()', 'execute')
     or has_function_privilege('anon', 'private.app_news_scrap_reader_ok()', 'execute')
     or (select count(*) from public.app_news_articles) <> (select count(distinct url_key) from public.app_news_items)
     or exists (select 1 from public.app_news_items i
                 where i.workspace_id in (select f.workspace_id from public.app_operator_features f where f.feature = 'telegram')
                   and not exists (select 1 from public.app_news_articles a where a.id = i.id))
     or (select count(*) from public.app_news_marks) <> (select count(*) from public.app_news_items i
           where i.starred_at is not null or i.folder_id is not null or i.hidden_at is not null or cardinality(i.keywords) > 0)
     or exists (select 1 from public.app_news_articles a where a.origin = 'tg_scrap' and a.lane <> 'channel') then
    raise exception 'NEWS_FOR_ALL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115100000', 'news_for_all', array['NEWS for all D1 (expand): new shared table app_news_articles (no workspace column, unique url_key, origin site/tg_room/tg_scrap; RLS on; authenticated select only via private.app_news_reader_ok (signed in, exactly one owner row, not on the signup block list) and tg_scrap rows only via private.app_news_scrap_reader_ok (also telegram operator feature); writes service_role only); new per-workspace table app_news_marks (star/folder/hide/keywords; owner policy; authenticated select/insert/update star-folder-hide/delete, keywords service_role only; insert check requires a readable article); app_feed_rooms adds nullable news_at; SECURITY DEFINER functions with empty search_path: app_feed_room_news(text,boolean) authenticated only (owner workspace, telegram feature, group/channel rooms only, family rooms refused, changes news_at and updated_at only) and app_news_room_take(uuid,text,jsonb) service_role only (re-checks the room on the server table, inserts article URLs only, refuses document/invite/shortener/internal hosts); copies app_news_items into articles (one row per url_key, operator row id first) and marks; no change to existing tables, policies, grants, triggers, functions or rows; no anon/PUBLIC privilege']);
commit;
