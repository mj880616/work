begin;
-- S62-22 APP-공유로뉴스보관 ① DB(요청함 11/15 12:59 명진 지시). 폰 공유 창 '노동조합+ News 보관'으로 받은 기사 주소 하나를
-- 그 사람 News에 넣고 바로 보관(별표)하는 서버 길. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다.
-- 순서: 이 DB 적용 → news-feed Edge(?action=save_url) 배포 → 화면·폰 앱.
--
--  1) 공용 기사 app_news_articles 출처 검사(app_news_articles_origin_check)에 'user'(사람이 직접 넣은 기사)를 더한다(지우고 같은 이름으로 다시).
--  2) 'user' 기사는 넣은(보관한) 사람만 본다: 읽기 정책 news_articles_reader_select를 같은 이름·같은 표·authenticated로 다시 만든다.
--     이전: origin <> 'tg_scrap' and 가입자. 이후: (origin이 'tg_scrap'·'user'가 아님 and 가입자) or (origin = 'user' and 가입자 and 내 작업공간 표시가 있음).
--     'site'·'tg_room' 줄은 이전과 같고, 'user' 줄만 좁다(다른 사람 목록·관련 기사에 안 보임 — 개인 보관용, 지금 News와 같은 경계).
--     채널 스크랩 정책(news_articles_scrap_operator_select)·표시 표 정책은 그대로.
--  3) private.app_news_marked_by_me(uuid): 그 기사에 내 작업공간(owner) 표시가 있는지(정책 안에서 표시 표 RLS를 다시 타지 않게 DEFINER).
--  4) app_news_days.save_n: 하루 '주소로 보관' 횟수(서버만 씀 — 표 권한은 그대로 service_role 쓰기·authenticated 읽기 없음 그대로).
--  5) public.app_news_user_save(uuid,text,text,jsonb) — service_role만(news-feed Edge가 로그인·owner 확인 뒤 부름):
--     같은 주소(url_key)의 공용 기사가 있으면 새로 만들지 않고 그 사람 표시만(보관 = starred_at, 숨김 풀기). 없고 p_page가 null이면 found=false
--     (Edge가 원문을 읽은 뒤 다시 부름). p_page가 있으면 'user'·'channel' 기사 한 줄을 넣고 표시. 채널 스크랩('tg_scrap') 줄은
--     텔레그램 운영자 작업공간만 표시할 수 있다(그 밖은 42501 NEWSSAVE_UNAVAILABLE — 운영자 스크랩으로 가는 길 없음).
--     주소는 https·호스트 이름만, 문서·드라이브·텔레그램·대화방·단축 주소·내부 이름·IP·복둥·Supabase는 거절(app_news_room_take와 같은 목록).
--     쓰는 표는 app_news_articles(넣기)·app_news_marks(넣기·고치기)뿐. 텔레그램·가족·통화 표는 읽지도 쓰지도 않는다.
--
-- 권한: anon·PUBLIC 없음. 새 함수 실행권: app_news_user_save는 service_role만, app_news_marked_by_me는 authenticated만(정책용).
-- 안 하는 것: 표 권한·다른 정책·트리거 변경, 기존 행 변경, 옛 표(app_news_items) 변경, rtw_* 객체.
-- 짝: docs/20261115230000_news_user_save.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261115230000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115100000' and name = 'news_for_all') <> 1
     or to_regclass('public.app_news_articles') is null or to_regclass('public.app_news_marks') is null or to_regclass('public.app_news_days') is null
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_articles'::regclass
         and conname = 'app_news_articles_origin_check' and contype = 'c'
         and pg_get_constraintdef(oid) ~ '''tg_scrap''' and pg_get_constraintdef(oid) !~ '''user''') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_news_articles') <> 2
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_news_articles'
         and policyname = 'news_articles_reader_select' and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = array['authenticated']::name[]) <> 1
     or exists (select 1 from pg_attribute where attrelid = 'public.app_news_days'::regclass and attname = 'save_n' and not attisdropped)
     or to_regprocedure('private.app_news_marked_by_me(uuid)') is not null
     or to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') is not null
     or to_regprocedure('private.app_news_reader_ok()') is null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or exists (select 1 from public.app_news_articles where origin not in ('site', 'tg_room', 'tg_scrap')) then
    raise exception 'NEWS_USER_SAVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 출처 'user'.
alter table public.app_news_articles drop constraint app_news_articles_origin_check;
alter table public.app_news_articles add constraint app_news_articles_origin_check
  check (origin in ('site', 'tg_room', 'tg_scrap', 'user'));

-- 4) 하루 '주소로 보관' 횟수.
alter table public.app_news_days add column save_n integer not null default 0;
alter table public.app_news_days add constraint app_news_days_save_n_check check (save_n >= 0);

-- 3) 내 작업공간 표시가 있는 기사인가(정책용).
create function private.app_news_marked_by_me(p_article uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_news_marks m
                  where m.article_id = p_article and private.app_is_workspace_owner(m.workspace_id))
$$;
revoke all on function private.app_news_marked_by_me(uuid) from public, anon, authenticated, service_role;
grant execute on function private.app_news_marked_by_me(uuid) to authenticated;

-- 2) 읽기 정책 다시(같은 이름·같은 표·authenticated·select).
drop policy news_articles_reader_select on public.app_news_articles;
create policy news_articles_reader_select on public.app_news_articles for select to authenticated
  using ((origin <> 'tg_scrap' and origin <> 'user' and private.app_news_reader_ok())
      or (origin = 'user' and private.app_news_reader_ok() and private.app_news_marked_by_me(id)));

-- 5) 주소로 보관(서버 전용). 거절 오류(고정): 22023 NEWSSAVE_ARGS·NEWSSAVE_URL·NEWSSAVE_PAGE, 42501 NEWSSAVE_OWNER·NEWSSAVE_UNAVAILABLE.
--    p_page = {"title","title_key","publisher","published_at","lang","state","summary","body","body_kind"} — 칸 글자 규칙은 표 검사가 그대로 본다.
create function public.app_news_user_save(p_workspace uuid, p_url text, p_url_key text, p_page jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_host text;
  v_id uuid;
  v_origin text;
  v_state text;
  v_created boolean := false;
  v_page_state text;
  v_kind text;
begin
  if p_workspace is null or p_url is null or p_url_key is null
     or (p_page is not null and pg_catalog.jsonb_typeof(p_page) <> 'object') then
    raise exception using errcode = '22023', message = 'NEWSSAVE_ARGS';
  end if;
  v_host := pg_catalog.lower(pg_catalog.substring(p_url, '^https://([^/?#:@[:space:]]+)(?:[/?#]|$)'));
  if v_host is null or p_url !~ '^https://[^[:space:]]+$' or pg_catalog.char_length(p_url) > 2000
     or pg_catalog.char_length(p_url_key) not between 1 and 2000 or p_url_key ~ '[[:space:][:cntrl:]]'
     or v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
     or v_host ~ '^[0-9.]+$'
     or v_host ~ '(^|\.)(t\.me|telegram\.org|telegram\.me|telegram\.dog|docs\.google\.com|drive\.google\.com|forms\.gle|forms\.google\.com|sites\.google\.com|meet\.google\.com|onedrive\.live\.com|1drv\.ms|sharepoint\.com|notion\.so|notion\.site|dropbox\.com|box\.com|bokdoong\.com|supabase\.co|supabase\.in|open\.kakao\.com|chat\.whatsapp\.com|discord\.gg|discord\.com|band\.us|zoom\.us|bit\.ly|tinyurl\.com|t\.co|goo\.gl|han\.gl|me2\.do|vo\.la|url\.kr|buly\.kr|ow\.ly|is\.gd|lrl\.kr|naver\.me|kko\.to|shorturl\.at|rb\.gy|cutt\.ly|localhost|local|internal|lan|home|corp)$' then
    raise exception using errcode = '22023', message = 'NEWSSAVE_URL';
  end if;
  if (select pg_catalog.count(*) from public.app_workspace_members m where m.workspace_id = p_workspace and m.role = 'owner') <> 1 then
    raise exception using errcode = '42501', message = 'NEWSSAVE_OWNER';
  end if;

  select a.id, a.origin, a.state into v_id, v_origin, v_state from public.app_news_articles a where a.url_key = p_url_key;
  if not found then
    if p_page is null then
      return pg_catalog.jsonb_build_object('ok', true, 'found', false);
    end if;
    v_page_state := p_page ->> 'state';
    v_kind := p_page ->> 'body_kind';
    if v_page_state is null or v_page_state not in ('ok', 'paywall', 'bot_check', 'robots', 'failed', 'too_big', 'blocked')
       or (v_kind is not null and v_kind not in ('full', 'lead')) then
      raise exception using errcode = '22023', message = 'NEWSSAVE_PAGE';
    end if;
    insert into public.app_news_articles (origin, lane, url, url_key, title, title_key, lang, publisher, published_at,
      scrapped_at, fetched_at, state, summary, body, body_kind)
    values ('user', 'channel', p_url, p_url_key,
      nullif(p_page ->> 'title', ''), nullif(p_page ->> 'title_key', ''), coalesce(nullif(p_page ->> 'lang', ''), 'ko'),
      nullif(p_page ->> 'publisher', ''), (nullif(p_page ->> 'published_at', ''))::timestamptz,
      pg_catalog.now(), pg_catalog.now(), v_page_state, nullif(p_page ->> 'summary', ''),
      case when v_kind is null then null else nullif(p_page ->> 'body', '') end, case when nullif(p_page ->> 'body', '') is null then null else v_kind end)
    on conflict (url_key) do nothing
    returning id, origin, state into v_id, v_origin, v_state;
    if v_id is null then
      select a.id, a.origin, a.state into v_id, v_origin, v_state from public.app_news_articles a where a.url_key = p_url_key;
    else
      v_created := true;
    end if;
  end if;
  -- 채널 스크랩 줄은 텔레그램 운영자 작업공간만(다른 사람은 읽을 수 없는 줄이므로 표시도 만들지 않는다).
  if v_origin = 'tg_scrap' and not exists (select 1 from public.app_operator_features f where f.workspace_id = p_workspace and f.feature = 'telegram') then
    raise exception using errcode = '42501', message = 'NEWSSAVE_UNAVAILABLE';
  end if;
  insert into public.app_news_marks (workspace_id, article_id, starred_at)
  values (p_workspace, v_id, pg_catalog.now())
  on conflict (workspace_id, article_id) do update
    set starred_at = coalesce(public.app_news_marks.starred_at, pg_catalog.now()), hidden_at = null, updated_at = pg_catalog.now()
    where public.app_news_marks.workspace_id = excluded.workspace_id;
  return pg_catalog.jsonb_build_object('ok', true, 'found', true, 'created', v_created, 'article_id', v_id, 'state', v_state);
end
$$;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.app_news_user_save(uuid, text, text, jsonb) to service_role;

-- 사후 확인: 검사·정책·함수·권한이 위와 같지 않으면 전체 취소.
do $$
declare t regclass := 'public.app_news_articles'::regclass;
begin
  if (select count(*) from pg_constraint where conrelid = t and conname = 'app_news_articles_origin_check' and pg_get_constraintdef(oid) ~ '''user''') <> 1
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_news_articles') <> 2
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_news_articles'
         and policyname = 'news_articles_reader_select' and roles = array['authenticated']::name[] and cmd = 'SELECT'
         and qual ~ 'app_news_marked_by_me' and qual ~ 'app_news_reader_ok') <> 1
     or has_table_privilege('anon', t, 'select,insert,update,delete')
     or has_table_privilege('authenticated', t, 'insert,update,delete')
     or has_function_privilege('anon', 'public.app_news_user_save(uuid,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.app_news_user_save(uuid,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.app_news_user_save(uuid,text,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.app_news_marked_by_me(uuid)', 'execute')
     or exists (select 1 from pg_proc where oid in ('public.app_news_user_save(uuid,text,text,jsonb)'::regprocedure, 'private.app_news_marked_by_me(uuid)'::regprocedure)
                and (proacl is null or proacl::text ~ '(^|[{,])='))
     or has_table_privilege('authenticated', 'public.app_news_days', 'insert,update,delete') then
    raise exception 'NEWS_USER_SAVE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261115230000', 'news_user_save', array['S62-22 APP-share-to-news-save: app_news_articles_origin_check adds user; policy news_articles_reader_select replaced (same name, table, role authenticated, select) so user-origin rows are readable only by signed-in readers whose own workspace has a mark on the row, other origins unchanged; new private.app_news_marked_by_me(uuid) SECURITY DEFINER empty search_path, execute authenticated only; app_news_days adds save_n (>= 0); new public.app_news_user_save(uuid,text,text,jsonb) SECURITY DEFINER empty search_path, execute service_role only (one owner workspace, https host-only URL with document/telegram/chat/shortener/internal/IP hosts refused, existing url_key marks only, new rows origin user lane channel, tg_scrap rows only for the telegram operator workspace, writes app_news_articles and app_news_marks only); no anon/PUBLIC privilege, no other grants, policies, triggers or row changes']);
commit;
