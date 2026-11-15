begin;
-- S53-5 NEWS-밑줄모으기 ① DB (요청함 11/08 09:55·09:56, 시안 docs/design/mockups/news-highlights.html #2090).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다. 이 브랜치는 적용 직전 정지.
--
--  app_news_highlights: 원문이 있는 글(뉴스 기사·사회운동 글·텔레그램 원문)에서 끌어 고른 글(밑줄) 한 건.
--   - source_type/source_id: 어느 글인지(news = app_news_items.id, outside = app_outside_posts.id, telegram = app_feed_items.id).
--     외래 키는 두지 않는다 — 원문 글이 지워지거나 바뀌어도 밑줄 글·출처는 따로 남긴다(요청: "원문이 바뀌어도 밑줄 글은 따로 남김").
--   - quote: 고른 글 그대로(1~4000자). quote_prefix/quote_suffix: 다시 열었을 때 같은 자리를 찾으려는 앞뒤 글(각 0~60자).
--   - memo: 메모(선택, 1~2000자). source_title/source_media/source_date/source_url: [노트로]·[밑줄] 탭에 보일 출처 사본.
--   - 화면이 넣고(정해진 열만), 메모만 고치고(memo, updated_at), 지운다. 다른 열은 고치지 못한다.
--
-- 권한: RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만). anon·PUBLIC·service_role 권한 없음.
-- 안 하는 것: 기존 표·열·정책·권한·함수 변경, 함수·트리거 추가, 확장 추가, 읽생기 표.
-- 짝: docs/20261108070000_news_highlights.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261108070000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_news_highlights') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NEWS_HIGHLIGHTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_news_highlights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source_type text not null,
  source_id uuid not null,
  quote text not null,
  quote_prefix text not null default '',
  quote_suffix text not null default '',
  memo text,
  source_title text,
  source_media text,
  source_date timestamptz,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_news_highlights_type_check check (source_type in ('news', 'outside', 'telegram')),
  constraint app_news_highlights_quote_check check (char_length(quote) between 1 and 4000 and btrim(quote) <> ''),
  constraint app_news_highlights_edge_check check (char_length(quote_prefix) <= 60 and char_length(quote_suffix) <= 60),
  constraint app_news_highlights_memo_check check (memo is null or char_length(memo) between 1 and 2000),
  constraint app_news_highlights_source_check check (
    (source_title is null or (char_length(source_title) between 1 and 500 and source_title !~ '[[:cntrl:]]'))
    and (source_media is null or (char_length(source_media) between 1 and 200 and source_media !~ '[[:cntrl:]]'))),
  constraint app_news_highlights_url_check check (
    source_url is null or (source_url ~ '^https?://[^[:space:]]+$' and char_length(source_url) <= 2000))
);
create index app_news_highlights_list_idx on public.app_news_highlights(workspace_id, created_at desc);
create index app_news_highlights_source_idx on public.app_news_highlights(workspace_id, source_type, source_id);

alter table public.app_news_highlights enable row level security;
revoke all on table public.app_news_highlights from public, anon, authenticated, service_role;

grant select, delete on table public.app_news_highlights to authenticated;
grant insert (workspace_id, source_type, source_id, quote, quote_prefix, quote_suffix, memo,
  source_title, source_media, source_date, source_url) on table public.app_news_highlights to authenticated;
grant update (memo, updated_at) on table public.app_news_highlights to authenticated;

create policy news_highlights_owner_all on public.app_news_highlights for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐·anon·PUBLIC·service_role 권한 없음·authenticated 정해진 권한만·정책 1개(authenticated만). 다르면 전체 취소.
do $$
declare t regclass := 'public.app_news_highlights'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
     or not has_table_privilege('authenticated', t, 'select')
     or not has_table_privilege('authenticated', t, 'delete')
     or not has_column_privilege('authenticated', t, 'quote', 'insert')
     or not has_column_privilege('authenticated', t, 'memo', 'update')
     or has_column_privilege('authenticated', t, 'id', 'insert,update')
     or has_column_privilege('authenticated', t, 'created_at', 'insert,update')
     or has_column_privilege('authenticated', t, 'workspace_id', 'update')
     or has_column_privilege('authenticated', t, 'quote', 'update')
     or has_column_privilege('authenticated', t, 'source_id', 'update')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'NEWS_HIGHLIGHTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261108070000', 'news_highlights', array['S53-5 NEWS-밑줄모으기: app_news_highlights (owner RLS, authenticated insert listed columns, update memo only, delete; no anon/PUBLIC/service_role)']);
commit;
