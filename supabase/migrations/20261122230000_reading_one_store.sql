begin;
-- S68-27 READ-보관기록일원화 PR-1 DB(명진 11/22 20:58 "2. A", 21:37 "저장된 기록도 일원화 하지 왜?"). '보관한 글'의 원본을 읽을 거리 표(app_reading_items) 하나로.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙)으로만 한다. 이 브랜치는 적용 직전 정지. 순서: 이 DB 적용 → 화면 PR(PR-2).
-- Edge 함수 고침·배포 없음: 폰 공유 'News 보관'(news-feed ?action=save_url)은 아래 6)의 DB 함수를 그대로 부르므로 함수 안에서 바뀐다.
--
-- 무엇:
--  1) app_reading_items에 칸 셋을 더한다: origin('direct' 직접 저장 · 'news' News 언론 · 'outside' News 사회운동, 기본 'direct'),
--     news_article_id(→ app_news_articles), outside_article_id(→ app_outside_articles). 원래 글이 지워지면 연결만 비운다(줄·원문 사본은 남음).
--     같은 작업공간에 같은 원래 글은 한 줄(부분 고유 색인 둘). 한 줄은 한 글만 가리킨다. 표 권한·정책·RLS는 그대로(화면은 새 칸을 직접 넣거나 고치지 못함).
--  2) app_news_marks_folder_star_check(별표 폴더는 별표가 있어야 함)를 지운다. 이제 '보관'은 읽을 거리 줄이고 별표 칸은 원본이 아니므로,
--     별표 폴더 칸(folder_id)은 그 글이 읽을 거리에 있을 때 화면이 쓰고, 보관 풀기 때 아래 4)가 함께 비운다.
--  3) private.app_reading_body(text, uuid): News 본문 블록(문단·소제목·인용 글자만)을 읽을 거리 원문 사본 글자로(줄바꿈·탭 밖 제어 문자 빼기, 20만 자).
--     사회운동 옛 글은 문장 줄을 잇는다. 본문 상태 ok → 'ok', lead(공개 리드만) → 'paywall', 그 밖·없음 → null(화면이 나중에 받음).
--  4) public.app_reading_keep(uuid, text, uuid, boolean, timestamptz) — authenticated만(DEFINER, search_path 빈칸): News ★·밀기 보관/보관 풀기의 한 길.
--     켜기 = 그 글을 가리키는 읽을 거리 한 줄(이미 있으면 그 줄, 같은 주소의 직접 저장 줄이 있으면 그 줄에 연결만). p_saved_at은 되돌리기 때 원래 시각.
--     끄기 = 그 글을 가리키는 줄을 지우고(휴지통 없음 — 읽을 거리 지우기와 같음), 별표 폴더 칸을 비운다. 지운 줄의 저장 시각을 돌려준다(5초 되돌리기용).
--     서버 검사: 자기 작업공간 주인(app_is_workspace_owner) · News 기능 키 'outside'(운영자 허용 표, app_workspace_has_feature) · 그 글을 읽을 수 있음
--     (공용 기사 읽기 정책과 같은 조건: 가입자, 채널 스크랩은 텔레그램 운영자, 직접 넣은 기사는 내 표시 줄이 있을 때).
--     private.app_reading_keep_row(uuid, text, uuid, timestamptz)는 4)·6)이 함께 쓰는 쓰기 부분(실행권 없음 — DEFINER 함수 안에서만 불림).
--  5) 옮기기: 지금 별표(사회운동은 별표 또는 옛 보관 시각)가 있는 글을 작업공간마다 읽을 거리 줄로 넣는다. 저장 시각 = 별표 시각, 읽음 = News 읽음 시각,
--     원문 사본 = 3). 같은 주소의 직접 저장 줄이 이미 있으면 새 줄 없이 그 줄에 연결만. 한 줄이라도 못 옮기면 전체 취소(멈춤).
--     밑줄(app_news_highlights)은 옮기지 않는다: 종류 news·outside 밑줄은 지금처럼 원래 글 id를 가리키고, 읽을 거리 줄의 연결 칸으로 찾는다(원래 행 그대로).
--     옛 칸(app_news_marks.starred_at·folder_id, app_outside_article_marks.starred_at·archived_at)은 지우지도 고치지도 않는다(되돌리기용, 화면 PR 뒤 원본 아님).
--  6) public.app_news_user_save 같은 서명으로 다시: 별표 칸 대신 표시 줄(숨김 풀기)만 두고 읽을 거리 한 줄(4의 쓰기 부분). 돌려주는 값에 reading_id 더함.
--  7) public.app_news_prune·app_outside_prune 같은 서명으로 다시: 남기는 규칙의 '별표·보관'을 '읽을 거리 줄이 가리키거나 같은 주소인 글'로. 나머지 규칙 그대로.
-- 권한: 새 함수 실행권은 app_reading_keep만 authenticated. anon·PUBLIC·service_role 없음. 기존 표 권한·정책·트리거 변경 없음, 텔레그램·통화·가족·rtw_* 없음.
-- 남의 기록: 옮기기는 작업공간마다 자기 줄로만(다른 작업공간 줄을 만들거나 읽어 보여 주지 않음). 사후 확인은 개수만 센다.
-- 되돌리기: docs/20261122230000_reading_one_store.rollback.sql(SQL Editor 전용 — 함수를 이전 본문으로 되돌림).
-- 짝: docs/20261122230000_reading_one_store.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다. 다시 정의하는 세 함수는 저장소 원문 판이어야 한다(되돌리기가 그 판으로 돌아가므로).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261122230000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122100000' and name = 'reading_items') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261120130000' and name = 'news_outside_retention') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115230000' and name = 'news_user_save') <> 1
     or to_regclass('public.app_reading_items') is null
     or to_regclass('public.app_news_articles') is null or to_regclass('public.app_news_marks') is null
     or to_regclass('public.app_news_article_bodies') is null or to_regclass('public.app_news_reads') is null
     or to_regclass('public.app_outside_articles') is null or to_regclass('public.app_outside_article_marks') is null
     or to_regclass('public.app_outside_article_bodies') is null or to_regclass('public.app_outside_article_sentences') is null
     or to_regclass('public.app_outside_reads') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_reading_items'::regclass
         and attname in ('origin', 'news_article_id', 'outside_article_id') and not attisdropped)
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_marks'::regclass
         and conname = 'app_news_marks_folder_star_check' and contype = 'c') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_prune(timestamptz,integer)')
         and prosecdef and proconfig = array['search_path=""'] and length(prosrc) = 2673 and md5(prosrc) = 'e4809791a51e703fe5fb6238309e6b5f')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_outside_prune(timestamptz,integer)')
         and prosecdef and proconfig = array['search_path=""'] and length(prosrc) = 2965 and md5(prosrc) = 'c42fd96f95583096459b4e5a35c08cea')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)')
         and prosecdef and proconfig = array['search_path=""'] and length(prosrc) = 4096 and md5(prosrc) = 'be2c718c174a95885ee940d3bc46c45e')
     or to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)') is not null
     or to_regprocedure('private.app_reading_keep_row(uuid,text,uuid,timestamptz)') is not null
     or to_regprocedure('private.app_reading_body(text,uuid)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or to_regprocedure('private.app_news_reader_ok()') is null
     or to_regprocedure('private.app_news_scrap_reader_ok()') is null then
    raise exception 'READING_ONE_STORE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 어디서 왔나 + 원래 글 연결.
alter table public.app_reading_items
  add column origin text not null default 'direct',
  add column news_article_id uuid,
  add column outside_article_id uuid;
alter table public.app_reading_items
  add constraint app_reading_items_origin_check check (origin in ('direct', 'news', 'outside')),
  add constraint app_reading_items_one_article_check check (news_article_id is null or outside_article_id is null),
  add constraint app_reading_items_news_article_fkey foreign key (news_article_id) references public.app_news_articles(id) on delete set null,
  add constraint app_reading_items_outside_article_fkey foreign key (outside_article_id) references public.app_outside_articles(id) on delete set null;
create unique index app_reading_items_news_unique on public.app_reading_items(workspace_id, news_article_id) where news_article_id is not null;
create unique index app_reading_items_outside_unique on public.app_reading_items(workspace_id, outside_article_id) where outside_article_id is not null;
create index app_reading_items_news_article_idx on public.app_reading_items(news_article_id) where news_article_id is not null;
create index app_reading_items_outside_article_idx on public.app_reading_items(outside_article_id) where outside_article_id is not null;

-- 2) 별표 폴더 검사(별표 칸에 묶임)를 지운다. 폴더 외래 키·색인·다른 검사는 그대로.
alter table public.app_news_marks drop constraint app_news_marks_folder_star_check;

-- 3) 원문 사본 글자. 답: {"body": 글자, "state": "ok"|"paywall"} 또는 null.
create function private.app_reading_body(p_source text, p_article uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with b as (
    select nb.state, nb.blocks from public.app_news_article_bodies nb where p_source = 'news' and nb.article_id = p_article
    union all
    select ob.state, ob.blocks from public.app_outside_article_bodies ob where p_source = 'outside' and ob.article_id = p_article
  ), t as (
    select b.state,
      pg_catalog.left(pg_catalog.string_agg(pg_catalog.btrim(pg_catalog.regexp_replace(e.v ->> 'text', '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')),
        pg_catalog.chr(10) || pg_catalog.chr(10) order by e.o), 200000) as body
    from b
    cross join lateral pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(b.blocks) = 'array' then b.blocks else '[]'::jsonb end)
      with ordinality as e(v, o)
    where b.state in ('ok', 'lead') and e.v ->> 't' in ('p', 'h', 'quote')
      and pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(e.v ->> 'text', ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')) <> ''
    group by b.state
  ), s as (
    select 'ok'::text as state,
      pg_catalog.left(pg_catalog.string_agg(pg_catalog.btrim(pg_catalog.regexp_replace(x.text, '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')), ' ' order by x.idx), 200000) as body
    from public.app_outside_article_sentences x
    where p_source = 'outside' and x.article_id = p_article
      and pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(x.text, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', '', 'g')) <> ''
  )
  select pg_catalog.jsonb_build_object('body', u.body, 'state', case when u.state = 'lead' then 'paywall' else 'ok' end)
  from (select t.state, t.body, 1 as k from t union all select s.state, s.body, 2 from s) u
  where u.body is not null and pg_catalog.char_length(u.body) between 1 and 200000
  order by u.k
  limit 1
$$;
revoke all on function private.app_reading_body(text, uuid) from public;
revoke all on function private.app_reading_body(text, uuid) from anon;
revoke all on function private.app_reading_body(text, uuid) from authenticated;
revoke all on function private.app_reading_body(text, uuid) from service_role;

-- 4-a) 쓰기 부분(4·6이 함께 씀). 검사(주인·기능 키·읽을 수 있음)는 부르는 쪽이 먼저 한다. 답: {"id","saved_at","created"}.
create function private.app_reading_keep_row(p_workspace uuid, p_source text, p_article uuid, p_saved_at timestamptz)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_url text;
  v_title text;
  v_site text;
  v_read timestamptz;
  v_body jsonb;
  v_id uuid;
  v_saved timestamptz;
begin
  if p_workspace is null or p_article is null or p_source is null or p_source not in ('news', 'outside') then
    raise exception using errcode = '22023', message = 'READINGKEEP_ARGS';
  end if;
  if p_source = 'news' then
    select a.url, a.title, a.publisher into v_url, v_title, v_site from public.app_news_articles a where a.id = p_article;
    if not found then raise exception using errcode = '22023', message = 'READINGKEEP_ARTICLE'; end if;
    select rd.read_at into v_read from public.app_news_reads rd where rd.workspace_id = p_workspace and rd.article_id = p_article;
  else
    select a.url, a.title into v_url, v_title from public.app_outside_articles a where a.id = p_article;
    if not found then raise exception using errcode = '22023', message = 'READINGKEEP_ARTICLE'; end if;
    select rd.read_at into v_read from public.app_outside_reads rd where rd.workspace_id = p_workspace and rd.article_id = p_article;
  end if;
  if v_url is null or v_url !~ '^https?://[^[:space:][:cntrl:]]+$' or pg_catalog.char_length(v_url) > 2000 then
    raise exception using errcode = '22023', message = 'READINGKEEP_URL';
  end if;

  -- 이미 그 글을 가리키는 줄이 있으면 그 줄.
  select r.id, r.saved_at into v_id, v_saved from public.app_reading_items r
   where r.workspace_id = p_workspace
     and ((p_source = 'news' and r.news_article_id = p_article) or (p_source = 'outside' and r.outside_article_id = p_article));
  if found then
    return pg_catalog.jsonb_build_object('id', v_id, 'saved_at', v_saved, 'created', false);
  end if;
  -- 같은 주소의 (아무 글도 가리키지 않는) 줄이 있으면 새 줄 없이 연결만.
  update public.app_reading_items r
     set news_article_id = case when p_source = 'news' then p_article end,
         outside_article_id = case when p_source = 'outside' then p_article end,
         updated_at = pg_catalog.now()
   where r.workspace_id = p_workspace and r.url = v_url and r.news_article_id is null and r.outside_article_id is null
  returning r.id, r.saved_at into v_id, v_saved;
  if v_id is not null then
    return pg_catalog.jsonb_build_object('id', v_id, 'saved_at', v_saved, 'created', false);
  end if;

  v_body := private.app_reading_body(p_source, p_article);
  insert into public.app_reading_items (workspace_id, url, title, site, origin, news_article_id, outside_article_id,
    saved_at, read_at, body, body_state, body_at, updated_at)
  values (p_workspace, v_url,
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_title, ''), '[[:cntrl:]]', ' ', 'g')), 500)), ''),
    nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(v_site, ''), '[[:cntrl:]]', ' ', 'g')), 120)), ''),
    p_source, case when p_source = 'news' then p_article end, case when p_source = 'outside' then p_article end,
    coalesce(p_saved_at, pg_catalog.now()), v_read,
    v_body ->> 'body', coalesce(v_body ->> 'state', 'pending'), case when v_body is null then null else pg_catalog.now() end, pg_catalog.now())
  on conflict do nothing
  returning id, saved_at into v_id, v_saved;
  if v_id is null then
    -- 같은 주소 줄이 이미 다른 글을 가리킨다: 그 줄이 보관이다(한 주소 한 줄).
    select r.id, r.saved_at into v_id, v_saved from public.app_reading_items r where r.workspace_id = p_workspace and r.url = v_url;
    return pg_catalog.jsonb_build_object('id', v_id, 'saved_at', v_saved, 'created', false);
  end if;
  return pg_catalog.jsonb_build_object('id', v_id, 'saved_at', v_saved, 'created', true);
end
$$;
revoke all on function private.app_reading_keep_row(uuid, text, uuid, timestamptz) from public;
revoke all on function private.app_reading_keep_row(uuid, text, uuid, timestamptz) from anon;
revoke all on function private.app_reading_keep_row(uuid, text, uuid, timestamptz) from authenticated;
revoke all on function private.app_reading_keep_row(uuid, text, uuid, timestamptz) from service_role;

-- 4-b) 화면의 한 길. 거절 오류(고정): 22023 READINGKEEP_ARGS·READINGKEEP_ARTICLE·READINGKEEP_URL, 42501 READINGKEEP_OWNER·READINGKEEP_UNAVAILABLE.
--      켜기 답 {"ok":true,"on":true,"id","saved_at","created"}, 끄기 답 {"ok":true,"on":false,"removed":n,"saved_at"}.
create function public.app_reading_keep(p_workspace uuid, p_source text, p_article uuid, p_on boolean, p_saved_at timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_origin text;
  v_row jsonb;
  v_saved timestamptz;
  v_n integer;
begin
  if p_workspace is null or p_article is null or p_on is null or p_source is null or p_source not in ('news', 'outside')
     or (p_saved_at is not null and (p_on is false or p_saved_at > pg_catalog.now() + interval '1 day'
         or p_saved_at < pg_catalog.now() - interval '20 years')) then
    raise exception using errcode = '22023', message = 'READINGKEEP_ARGS';
  end if;
  if not private.app_is_workspace_owner(p_workspace) then
    raise exception using errcode = '42501', message = 'READINGKEEP_OWNER';
  end if;
  if not private.app_workspace_has_feature(p_workspace, 'outside') or not private.app_news_reader_ok() then
    raise exception using errcode = '42501', message = 'READINGKEEP_UNAVAILABLE';
  end if;

  if not p_on then
    delete from public.app_reading_items r
     where r.workspace_id = p_workspace
       and ((p_source = 'news' and r.news_article_id = p_article) or (p_source = 'outside' and r.outside_article_id = p_article))
    returning r.saved_at into v_saved;
    get diagnostics v_n = row_count;
    if p_source = 'news' then
      update public.app_news_marks m set folder_id = null, updated_at = pg_catalog.now()
       where m.workspace_id = p_workspace and m.article_id = p_article and m.folder_id is not null;
    end if;
    return pg_catalog.jsonb_build_object('ok', true, 'on', false, 'removed', v_n, 'saved_at', v_saved);
  end if;

  -- 그 글을 읽을 수 있을 때만(공용 기사 읽기 정책과 같은 조건).
  if p_source = 'news' then
    select a.origin into v_origin from public.app_news_articles a where a.id = p_article;
    if not found then raise exception using errcode = '22023', message = 'READINGKEEP_ARTICLE'; end if;
    if (v_origin = 'tg_scrap' and not private.app_news_scrap_reader_ok())
       or (v_origin = 'user' and not exists (select 1 from public.app_news_marks m where m.workspace_id = p_workspace and m.article_id = p_article)) then
      raise exception using errcode = '42501', message = 'READINGKEEP_UNAVAILABLE';
    end if;
  end if;
  v_row := private.app_reading_keep_row(p_workspace, p_source, p_article, p_saved_at);
  return pg_catalog.jsonb_build_object('ok', true, 'on', true) || v_row;
end
$$;
revoke all on function public.app_reading_keep(uuid, text, uuid, boolean, timestamptz) from public;
revoke all on function public.app_reading_keep(uuid, text, uuid, boolean, timestamptz) from anon;
revoke all on function public.app_reading_keep(uuid, text, uuid, boolean, timestamptz) from authenticated;
revoke all on function public.app_reading_keep(uuid, text, uuid, boolean, timestamptz) from service_role;
grant execute on function public.app_reading_keep(uuid, text, uuid, boolean, timestamptz) to authenticated;

-- 6) 폰 공유 'News 보관'(news-feed ?action=save_url이 부름): 같은 서명·DEFINER·service_role만 그대로. 별표 대신 읽을 거리 한 줄.
create or replace function public.app_news_user_save(p_workspace uuid, p_url text, p_url_key text, p_page jsonb)
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
  v_keep jsonb;
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
  -- S68-27: 보관의 원본은 읽을 거리 한 표(app_reading_items). 표시 줄은 별표 칸 없이 둔다 — 'user' 기사를 넣은 사람이 읽을 수 있게(정책 app_news_marked_by_me)·숨김 풀기.
  insert into public.app_news_marks (workspace_id, article_id)
  values (p_workspace, v_id)
  on conflict (workspace_id, article_id) do update
    set hidden_at = null, updated_at = pg_catalog.now()
    where public.app_news_marks.workspace_id = excluded.workspace_id;
  v_keep := private.app_reading_keep_row(p_workspace, 'news', v_id, null);
  return pg_catalog.jsonb_build_object('ok', true, 'found', true, 'created', v_created, 'article_id', v_id, 'state', v_state,
    'reading_id', v_keep -> 'id');
end
$$;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from public;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from anon;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from authenticated;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from service_role;
grant execute on function public.app_news_user_save(uuid, text, text, jsonb) to service_role;

-- 7) 보관 기간 정리: 남기는 규칙의 '별표'를 읽을 거리 연결(그 글을 가리키는 줄 또는 같은 주소 줄)로 바꾼다. 나머지 규칙·서명·권한 그대로.
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
    select a.url_key from public.app_reading_items r join public.app_news_articles a on a.id = r.news_article_id
    union
    select a.url_key from public.app_news_articles a where a.url in (select r.url from public.app_reading_items r)
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
    select a.url_key from public.app_reading_items r join public.app_news_articles a on a.id = r.news_article_id
    union
    select a.url_key from public.app_news_articles a where a.url in (select r.url from public.app_reading_items r)
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

create or replace function public.app_outside_prune(p_now timestamptz, p_limit integer)
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
    select a.url from public.app_reading_items r join public.app_outside_articles a on a.id = r.outside_article_id
    union
    select r.url from public.app_reading_items r
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
    select a.url from public.app_reading_items r join public.app_outside_articles a on a.id = r.outside_article_id
    union
    select r.url from public.app_reading_items r
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

-- ===== 옮기기 시작 (5) — 두 번 돌려도 같은 결과(이미 옮긴 글은 건너뜀). 작업공간마다 자기 줄로만.
-- 5-a) 같은 주소의 직접 저장 줄이 있으면 연결만(언론 → 사회운동 차례). 한 줄은 한 글만.
update public.app_reading_items r
   set news_article_id = a.id, updated_at = pg_catalog.now()
  from public.app_news_marks m
  join public.app_news_articles a on a.id = m.article_id
 where m.starred_at is not null
   and r.workspace_id = m.workspace_id and r.url = a.url
   and r.news_article_id is null and r.outside_article_id is null
   and not exists (select 1 from public.app_reading_items x where x.workspace_id = m.workspace_id and x.news_article_id = a.id);
update public.app_reading_items r
   set outside_article_id = a.id, updated_at = pg_catalog.now()
  from public.app_outside_article_marks m
  join public.app_outside_articles a on a.id = m.article_id
 where (m.starred_at is not null or m.archived_at is not null)
   and r.workspace_id = m.workspace_id and r.url = a.url
   and r.news_article_id is null and r.outside_article_id is null
   and not exists (select 1 from public.app_reading_items x where x.workspace_id = m.workspace_id and x.outside_article_id = a.id);
-- 5-b) 나머지는 새 줄. 저장 시각 = 별표(옛 보관) 시각, 읽음 = News 읽음 시각, 원문 사본 = 3). 주소 규칙 밖 글은 넣지 않고 아래 확인에서 멈춘다.
insert into public.app_reading_items (workspace_id, url, title, site, origin, news_article_id, saved_at, read_at, body, body_state, body_at, updated_at)
select m.workspace_id, a.url,
  nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(a.title, ''), '[[:cntrl:]]', ' ', 'g')), 500)), ''),
  nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(a.publisher, ''), '[[:cntrl:]]', ' ', 'g')), 120)), ''),
  'news', a.id, m.starred_at, rd.read_at,
  x.b ->> 'body', coalesce(x.b ->> 'state', 'pending'), case when x.b is null then null else pg_catalog.now() end, pg_catalog.now()
  from public.app_news_marks m
  join public.app_news_articles a on a.id = m.article_id
  left join public.app_news_reads rd on rd.workspace_id = m.workspace_id and rd.article_id = a.id
  cross join lateral (select private.app_reading_body('news', a.id) as b) x
 where m.starred_at is not null
   and a.url ~ '^https?://[^[:space:][:cntrl:]]+$' and pg_catalog.char_length(a.url) <= 2000
   and not exists (select 1 from public.app_reading_items r where r.workspace_id = m.workspace_id and (r.news_article_id = a.id or r.url = a.url))
on conflict do nothing;
insert into public.app_reading_items (workspace_id, url, title, site, origin, outside_article_id, saved_at, read_at, body, body_state, body_at, updated_at)
select m.workspace_id, a.url,
  nullif(pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(a.title, ''), '[[:cntrl:]]', ' ', 'g')), 500)), ''),
  null, 'outside', a.id, coalesce(m.starred_at, m.archived_at), rd.read_at,
  x.b ->> 'body', coalesce(x.b ->> 'state', 'pending'), case when x.b is null then null else pg_catalog.now() end, pg_catalog.now()
  from public.app_outside_article_marks m
  join public.app_outside_articles a on a.id = m.article_id
  left join public.app_outside_reads rd on rd.workspace_id = m.workspace_id and rd.article_id = a.id
  cross join lateral (select private.app_reading_body('outside', a.id) as b) x
 where (m.starred_at is not null or m.archived_at is not null)
   and a.url ~ '^https?://[^[:space:][:cntrl:]]+$' and pg_catalog.char_length(a.url) <= 2000
   and not exists (select 1 from public.app_reading_items r where r.workspace_id = m.workspace_id and (r.outside_article_id = a.id or r.url = a.url))
on conflict do nothing;
-- ===== 옮기기 끝

-- 5-c) 모든 보관이 읽을 거리에 있어야 한다(그 글을 가리키는 줄 또는 같은 주소 줄). 하나라도 없으면 전체 취소.
do $$
begin
  if exists (select 1 from public.app_news_marks m join public.app_news_articles a on a.id = m.article_id
              where m.starred_at is not null
                and not exists (select 1 from public.app_reading_items r where r.workspace_id = m.workspace_id and (r.news_article_id = a.id or r.url = a.url)))
     or exists (select 1 from public.app_outside_article_marks m join public.app_outside_articles a on a.id = m.article_id
              where (m.starred_at is not null or m.archived_at is not null)
                and not exists (select 1 from public.app_reading_items r where r.workspace_id = m.workspace_id and (r.outside_article_id = a.id or r.url = a.url))) then
    raise exception 'READING_ONE_STORE_MOVE_INCOMPLETE; stop';
  end if;
end
$$;

-- 사후 확인: 칸·검사·권한·함수가 위와 같지 않으면 전체 취소.
do $$
declare t regclass := 'public.app_reading_items'::regclass;
begin
  if (select count(*) from pg_attribute where attrelid = t and attname in ('origin', 'news_article_id', 'outside_article_id') and not attisdropped) <> 3
     or (select count(*) from pg_constraint where conrelid = t and conname in ('app_reading_items_origin_check', 'app_reading_items_one_article_check',
         'app_reading_items_news_article_fkey', 'app_reading_items_outside_article_fkey')) <> 4
     or exists (select 1 from pg_constraint where conrelid = 'public.app_news_marks'::regclass and conname = 'app_news_marks_folder_star_check')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or has_column_privilege('authenticated', t, 'origin', 'insert') or has_column_privilege('authenticated', t, 'origin', 'update')
     or has_column_privilege('authenticated', t, 'news_article_id', 'insert') or has_column_privilege('authenticated', t, 'news_article_id', 'update')
     or has_column_privilege('authenticated', t, 'outside_article_id', 'insert') or has_column_privilege('authenticated', t, 'outside_article_id', 'update')
     or has_table_privilege('anon', t, 'select,insert,update,delete') or has_table_privilege('service_role', t, 'select,insert,update,delete')
     or not has_function_privilege('authenticated', 'public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)', 'execute')
     or has_function_privilege('service_role', 'public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.app_reading_keep_row(uuid,text,uuid,timestamptz)', 'execute')
     or has_function_privilege('service_role', 'private.app_reading_keep_row(uuid,text,uuid,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'private.app_reading_body(text,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.app_news_user_save(uuid,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.app_news_user_save(uuid,text,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.app_news_prune(timestamptz,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.app_outside_prune(timestamptz,integer)', 'execute')
     or exists (select 1 from pg_proc where oid in ('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)'::regprocedure,
                'private.app_reading_keep_row(uuid,text,uuid,timestamptz)'::regprocedure, 'private.app_reading_body(text,uuid)'::regprocedure,
                'public.app_news_user_save(uuid,text,text,jsonb)'::regprocedure, 'public.app_news_prune(timestamptz,integer)'::regprocedure,
                'public.app_outside_prune(timestamptz,integer)'::regprocedure)
                and (proacl is null or proacl::text ~ '(^|[{,])=' or proconfig is distinct from array['search_path=""']))
     or not exists (select 1 from pg_proc where oid = 'public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)'::regprocedure and prosecdef)
     or exists (select 1 from pg_proc where oid in ('private.app_reading_keep_row(uuid,text,uuid,timestamptz)'::regprocedure,
                'private.app_reading_body(text,uuid)'::regprocedure) and prosecdef)
     or not exists (select 1 from pg_proc where oid = 'public.app_news_prune(timestamptz,integer)'::regprocedure and prosecdef and md5(prosrc) = 'e8f32b5ecdd8933ca542d1a6ea8b510c')
     or not exists (select 1 from pg_proc where oid = 'public.app_outside_prune(timestamptz,integer)'::regprocedure and prosecdef and md5(prosrc) = 'cbaf8e1787b6068a722e8ff6db7e8495')
     or not exists (select 1 from pg_proc where oid = 'public.app_news_user_save(uuid,text,text,jsonb)'::regprocedure and prosecdef and md5(prosrc) = '040259503addb92d386f3b9c6da5acbf') then
    raise exception 'READING_ONE_STORE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261122230000', 'reading_one_store', array['S68-27 READ one store: app_reading_items adds origin (direct/news/outside) and news_article_id/outside_article_id (FK on delete set null, one article per row, unique per workspace), no grant or policy change; drops app_news_marks_folder_star_check; new private.app_reading_body and private.app_reading_keep_row (no execute grants) and public.app_reading_keep (SECURITY DEFINER, empty search_path, authenticated only, owner + outside feature + article readable); replaces app_news_user_save, app_news_prune, app_outside_prune (same signatures and grants) so saving and retention use reading rows instead of star columns; copies every starred news/outside article into the owner workspace reading rows (saved_at = star time, read_at from reads, body copy), linking same-url direct rows instead of duplicating, stops if any star is not represented; star/archive/folder columns and highlights unchanged']);
commit;
