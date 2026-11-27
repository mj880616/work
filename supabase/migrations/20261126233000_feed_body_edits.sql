begin;
-- S71-68 ② READ-원문고치기(사용자 결정 2026-11-26 "읽을 거리에서 불필요한 글자 가져온 거 직접 수정 가능하게 수정 버튼 추가").
-- 읽을 거리 글 보기 '원문 전체' ⋯ [수정]으로 고친 원문을 내 작업공간에만 저장하는 사본 표 하나를 더한다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 같은 목적 표 재사용 검토(PR 본문에 같은 내용):
--  · 공용 본문 표(app_news_article_bodies·app_outside_article_bodies)는 가입자 모두가 같은 줄을 읽는다 — 한 사람이 고치면 남의 화면이 바뀐다. 화면은 읽기만 한다(그대로).
--  · 저장한 글 표(app_reading_items.body)는 저장한 글에만 있고 글자 한 칸(사진·소제목 없음)이라 읽을 거리 글 보기의 원문 블록을 담지 못한다.
--  · 옛 본문 표(app_feed_bodies)는 옮기는 중 지울 옛 표다.
--  그래서 '내가 고친 원문' 표 하나를 새로 둔다(작업공간마다 글 하나에 한 줄, owner만). 줄이 있으면 그 사람 화면만 고친 원문을 그리고('손으로 고침'),
--  지우면 처음 가져온 공용 원문으로 돌아간다. 공용 본문 다시 뽑기·다시 가져오기는 이 표를 건드리지 않는다.
--
--  public.app_feed_body_edits(새): 작업공간 · 글(뉴스 기사 news_article_id 또는 사회운동 글 outside_article_id 중 하나) · 블록(공용 본문과 같은 모양) · 고친 시각.
--  화면(authenticated): 자기 줄 읽기·지우기, 넣기(작업공간·글·블록·시각), 고치기(블록·시각만). 작업공간·글은 못 고친다.
--  블록 검사(공용 본문 표와 같음): 배열 1~400개, 종류 p·h·quote(제어 글자 없는 글자)·img(https 주소 2000자 안쪽, 설명·대체 글 300자 안쪽), 다른 칸 없음, 글자 합 11만 자 안쪽.
--
-- 권한: 새 표 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만). anon·PUBLIC·service_role 권한 없음. 공유(app_collab_*) 대상 아님.
-- 안 하는 것: 기존 표·칸·권한·정책·트리거·함수 변경, 기존 줄 변경, 함수 추가, 확장 추가, rtw_* 객체.
-- 되돌리기: docs/20261126233000_feed_body_edits.rollback.sql(SQL Editor 전용: 새 표 삭제. 고친 원문이 하나라도 있으면 지우지 않고 멈춤).
-- 짝: docs/20261126233000_feed_body_edits.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126233000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115100000' and name = 'news_for_all') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261115150000' and name = 'outside_for_all') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_news_articles') is null
     or to_regclass('public.app_outside_articles') is null
     or to_regclass('public.app_feed_body_edits') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'FEED_BODY_EDITS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 내가 고친 원문(작업공간마다 글 하나에 한 줄). 작업공간·글을 지우면 함께 지움.
create table public.app_feed_body_edits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  news_article_id uuid references public.app_news_articles(id) on delete cascade,
  outside_article_id uuid references public.app_outside_articles(id) on delete cascade,
  blocks jsonb not null,
  edited_at timestamptz not null default now(),
  constraint app_feed_body_edits_one_article check (num_nonnulls(news_article_id, outside_article_id) = 1),
  constraint app_feed_body_edits_news_unique unique (workspace_id, news_article_id),
  constraint app_feed_body_edits_outside_unique unique (workspace_id, outside_article_id),
  -- 블록 모양: 공용 본문 표(app_feed_bodies, 20261106050000)와 같은 검사 + 1개 넘음.
  constraint app_feed_body_edits_blocks_check check (
    jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) between 1 and 400
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
  -- 본문 글자 합 상한(공용 본문과 같음): 블록 글자들을 JSON 배열로 늘어놓은 길이 11만 자.
  constraint app_feed_body_edits_text_total_check check (
    char_length(jsonb_path_query_array(blocks, '$[*].text')::text) <= 110000)
);
create index app_feed_body_edits_scope_idx on public.app_feed_body_edits(workspace_id, edited_at desc);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_feed_body_edits enable row level security;
revoke all on table public.app_feed_body_edits from public, anon, authenticated, service_role;
grant select, delete on table public.app_feed_body_edits to authenticated;
grant insert (workspace_id, news_article_id, outside_article_id, blocks, edited_at) on table public.app_feed_body_edits to authenticated;
grant update (blocks, edited_at) on table public.app_feed_body_edits to authenticated;

create policy feed_body_edits_owner_all on public.app_feed_body_edits for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126233000', 'feed_body_edits', array['S71-68 READ edited article copies: new app_feed_body_edits (one row per workspace and shared news or outside article, owner RLS one policy, authenticated select/delete, insert workspace_id/news_article_id/outside_article_id/blocks/edited_at, update blocks/edited_at, block shape check, no anon/PUBLIC/service_role); no existing table, column, grant, policy, trigger or row change']);
commit;
