begin;
-- 20261122230000_reading_one_store의 짝 되돌리기(SQL Editor 전용: 함수 셋을 이전 본문으로 다시 정의하므로 승인형 workflow rollback 모드 대상 아님).
-- 먼저 화면을 이 DB를 쓰기 전 판(S68-24 화면 — 별표 칸을 읽고 쓰는 판)으로 되돌린다. 그다음 이 파일을 새 쿼리 창(+)에서 실행한다.
-- 되돌리는 것: app_news_user_save·app_news_prune·app_outside_prune를 이전 본문으로, 새 함수 셋(app_reading_keep·app_reading_keep_row·app_reading_body) 삭제,
--   읽을 거리의 새 칸 셋(origin·news_article_id·outside_article_id)과 그 색인·검사 삭제, 별표 폴더 검사 되살리기(NOT VALID — 지금 줄은 검사하지 않음), 기록 1행 삭제.
-- 남는 것: 옮겨 넣은 읽을 거리 줄은 지우지 않는다(직접 저장 줄처럼 남음 — 원문 사본·저장 시각 그대로). 옛 별표 칸은 옮길 때 그대로였으므로 News 보관도 그대로 보인다.
--   단, 이 DB 적용 뒤 새로 보관한 글은 별표 칸이 없으므로 되돌린 화면의 News 보관에는 안 보이고 읽을 거리 목록에만 남는다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version = '20261122230000' and name = 'reading_one_store') <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_prune(timestamptz,integer)') and md5(prosrc) = 'e8f32b5ecdd8933ca542d1a6ea8b510c')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_outside_prune(timestamptz,integer)') and md5(prosrc) = 'cbaf8e1787b6068a722e8ff6db7e8495')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') and md5(prosrc) = '040259503addb92d386f3b9c6da5acbf')
     or to_regprocedure('public.app_reading_keep(uuid,text,uuid,boolean,timestamptz)') is null then
    raise exception 'READING_ONE_STORE_ROLLBACK_BLOCKED: migration record or functions differ';
  end if;
end
$$;

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
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from public;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from anon;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from authenticated;
revoke all on function public.app_news_user_save(uuid, text, text, jsonb) from service_role;
grant execute on function public.app_news_user_save(uuid, text, text, jsonb) to service_role;

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

drop function public.app_reading_keep(uuid, text, uuid, boolean, timestamptz);
drop function private.app_reading_keep_row(uuid, text, uuid, timestamptz);
drop function private.app_reading_body(text, uuid);

drop index public.app_reading_items_news_unique;
drop index public.app_reading_items_outside_unique;
drop index public.app_reading_items_news_article_idx;
drop index public.app_reading_items_outside_article_idx;
alter table public.app_reading_items drop constraint app_reading_items_origin_check;
alter table public.app_reading_items drop constraint app_reading_items_one_article_check;
alter table public.app_reading_items drop constraint app_reading_items_news_article_fkey;
alter table public.app_reading_items drop constraint app_reading_items_outside_article_fkey;
alter table public.app_reading_items drop column origin;
alter table public.app_reading_items drop column news_article_id;
alter table public.app_reading_items drop column outside_article_id;

alter table public.app_news_marks add constraint app_news_marks_folder_star_check check (folder_id is null or starred_at is not null) not valid;

delete from supabase_migrations.schema_migrations where version = '20261122230000' and name = 'reading_one_store';

do $$
begin
  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_prune(timestamptz,integer)') and prosecdef and md5(prosrc) = 'e4809791a51e703fe5fb6238309e6b5f')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_outside_prune(timestamptz,integer)') and prosecdef and md5(prosrc) = 'c42fd96f95583096459b4e5a35c08cea')
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_news_user_save(uuid,text,text,jsonb)') and prosecdef and md5(prosrc) = 'be2c718c174a95885ee940d3bc46c45e')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_reading_items'::regclass and attname in ('origin', 'news_article_id', 'outside_article_id') and not attisdropped)
     or (select count(*) from pg_constraint where conrelid = 'public.app_news_marks'::regclass and conname = 'app_news_marks_folder_star_check') <> 1 then
    raise exception 'READING_ONE_STORE_ROLLBACK_CHECK_FAILED; stop';
  end if;
end
$$;
commit;
