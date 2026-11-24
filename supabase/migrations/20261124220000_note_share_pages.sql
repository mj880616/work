begin;
-- NOTE-게시 ①(서버·DB). 명진 11/24 21:41 "공유 페이지를 아예 노트 내 기능으로", CC 1단계 안(21:42 "ㄱ"). 설계: docs/design/note-publish.md.
-- 노트 하나를 기존 공유 링크 길(app_share_pages + app_share_page_links + share-page-read)로 게시한다. 새 공개 길을 만들지 않는다.
-- 무엇: 새 표 1개(app_note_share_pages: 게시용 공유 페이지 행 하나 ↔ 노트 하나). 기존 표·정책·권한·트리거·자료는 한 줄도 바꾸지 않는다.
--   - 노트를 게시하면 화면이 (1) 공유 페이지 행(제목 사본·빈 블록·status 'published'), (2) 이 표의 짝 한 줄, (3) 링크 한 줄을 owner 권한으로 넣는다.
--   - 로그인 없는 읽기(share-page-read)는 링크 → 페이지 → 이 표에서 노트 id → 그 노트의 지금 제목·글만 돌려준다(노트를 고치면 게시도 바로 바뀜).
--   - 게시 멈춤 = 페이지 status를 draft로(기존 길). 노트가 휴지통·보관이면 읽기 함수가 404. 노트를 완전히 지우면 note_id가 비고 404.
--   - 이미 보낸 공유 페이지 링크는 그대로 둔다(나중 단계에서 그 페이지 글을 노트로 옮기고 이 표에 짝만 더하면 같은 링크가 노트를 보여 준다).
-- 보안(AGENTS.md 3절):
--   - RLS 켬. authenticated: owner 정책 하나(읽기·더하기·지우기). 고치기 권한 없음(짝을 다른 노트·페이지로 옮기지 못함).
--     더할 때 노트가 같은 작업공간의 kind 'note'이고 페이지도 같은 작업공간이어야 한다. 노트 하나·페이지 하나에 짝 하나.
--   - anon·PUBLIC 권한 없음. service_role(share-page-read)은 page_id·note_id 두 칸만 읽는다. 노트 표 권한·정책은 바꾸지 않는다.
-- 짝: docs/20261124220000_note_share_pages.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124220000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261020005000' and name = 'share_pages_links') <> 1
     or to_regclass('public.app_note_share_pages') is not null
     or to_regclass('public.app_share_pages') is null
     or to_regclass('public.app_share_page_links') is null
     or to_regclass('public.app_notes') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_notes'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'workspace_id', 'kind', 'title', 'doc', 'raw_text', 'deleted_at', 'archived_at')) <> 8
     or not exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOTE_SHARE_PAGES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 게시 짝. note_id는 노트를 완전히 지우면 비고(on delete set null) 읽기 함수가 404로 본다. 페이지를 지우면 짝도 지워진다.
create table public.app_note_share_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  page_id uuid not null references public.app_share_pages(id) on delete cascade,
  note_id uuid references public.app_notes(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint app_note_share_pages_page_key unique (page_id),
  constraint app_note_share_pages_note_key unique (note_id)
);
create index app_note_share_pages_workspace_idx on public.app_note_share_pages(workspace_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
alter table public.app_note_share_pages enable row level security;
revoke all on table public.app_note_share_pages from public, anon, authenticated, service_role;
grant select, delete on table public.app_note_share_pages to authenticated;
grant insert (workspace_id, page_id, note_id) on table public.app_note_share_pages to authenticated;
grant select (page_id, note_id) on table public.app_note_share_pages to service_role;

create policy note_share_pages_owner_all on public.app_note_share_pages for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and note_id is not null
    and exists (
      select 1 from public.app_notes n
      where n.id = note_id and n.workspace_id = app_note_share_pages.workspace_id and n.kind = 'note')
    and exists (
      select 1 from public.app_share_pages p
      where p.id = page_id and p.workspace_id = app_note_share_pages.workspace_id));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC 권한 없음. 다르면 전체 취소.
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.app_note_share_pages'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_note_share_pages'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_note_share_pages'::regclass and attacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_note_share_pages'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_note_share_pages'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'NOTE_SHARE_PAGES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124220000', 'note_share_pages', array['NOTE-게시 ①: app_note_share_pages (share page row ↔ one note), owner RLS, no anon, service_role page_id·note_id SELECT only']);
commit;
