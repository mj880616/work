begin;
-- SHARE-현장공유 PR 1(서버). 설계: docs/design/field-share-pages.md S1~S5(2026-10-20 사용자 승인).
-- 새 표 2개만 만든다. 기존 표·정책·함수·자료는 바꾸지 않는다. 옛 공유 링크(app_share_links·app_open_share)는 쓰지 않는다.
-- 1) app_share_pages: 공유용으로 따로 쓴 페이지(제목·블록). owner만 읽고 쓴다(private.app_is_workspace_owner).
-- 2) app_share_page_links: 받는 사람별 링크(S4). 링크 값은 DB가 만들고(화면이 정하지 못함), 확인용 지문(sha256)을 함께 둔다.
--    링크 값 원문(token)은 owner만 다시 복사용으로 읽는다(S2). 서버 읽기 역할(service_role)은 원문 칸을 읽을 수 없다.
-- anon·PUBLIC 권한과 공개 정책은 없다. 로그인 없는 읽기는 새 Edge 함수(share-page-read)가 지문으로 한 페이지만 돌려준다.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261020005000')
     or to_regclass('public.app_share_pages') is not null
     or to_regclass('public.app_share_page_links') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_spaces') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_space_in_workspace(uuid,uuid)') and prosecdef) then
    raise exception 'SHARE_PAGES_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 공유 페이지. 블록은 S5 6종(한 줄 현황·진행 단계·일정·쟁점·요구·자료·링크·업데이트 기록)만, 순서는 배열 순서.
create table public.app_share_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  project_id uuid references public.app_spaces(id) on delete set null,
  title text not null,
  blocks jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_share_pages_title_check check (
    char_length(btrim(title)) between 1 and 200 and title !~ '[[:cntrl:]]'),
  constraint app_share_pages_status_check check (status in ('draft', 'published')),
  constraint app_share_pages_blocks_check check (
    jsonb_typeof(blocks) = 'array'
    and jsonb_array_length(blocks) <= 60
    and octet_length(blocks::text) <= 262144
    -- 블록마다 객체이고 type(글자)이 6종 중 하나여야 한다: 6종 type 개수 = 블록 개수.
    -- strict라 type이 없거나 객체가 아닌 블록은 오류 → 빈 결과 → 개수 불일치로 거절된다. 블록 안 모양은 화면 PR에서 정한다.
    and jsonb_array_length(jsonb_path_query_array(blocks,
      'strict $[*].type ? (@ == "summary" || @ == "stages" || @ == "schedule" || @ == "issues" || @ == "links" || @ == "updates")',
      '{}', true)) = jsonb_array_length(blocks))
);
create index app_share_pages_workspace_idx on public.app_share_pages(workspace_id, updated_at desc);
create index app_share_pages_project_idx on public.app_share_pages(project_id) where project_id is not null;

-- 받는 사람별 링크. token은 DB 기본값으로만 생긴다(gen_random_uuid 두 개 = 무작위 244비트, 16진수 64자).
-- token_hash = sha256(token 바이트)의 16진수. 로그인 없는 읽기는 이 칸으로만 찾는다.
create table public.app_share_page_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  page_id uuid not null references public.app_share_pages(id) on delete cascade,
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  token_hash text generated always as (encode(sha256(decode(token, 'hex')), 'hex')) stored,
  label text not null default '',
  expires_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint app_share_page_links_token_check check (token ~ '^[0-9a-f]{64}$'),
  constraint app_share_page_links_label_check check (char_length(label) <= 60 and label !~ '[[:cntrl:]]'),
  constraint app_share_page_links_token_hash_key unique (token_hash)
);
create index app_share_page_links_page_idx on public.app_share_page_links(page_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
-- authenticated: 읽기·삭제는 표 전체, 쓰기는 필요한 칸만(token·token_hash·id·page_id 옮기기 불가).
-- service_role(Edge 읽기 함수): 읽기에 필요한 칸만 SELECT. 링크 원문(token)·workspace·만든 시각은 못 읽는다.
alter table public.app_share_pages enable row level security;
alter table public.app_share_page_links enable row level security;
revoke all on table public.app_share_pages, public.app_share_page_links from public, anon, authenticated, service_role;
grant select, delete on table public.app_share_pages, public.app_share_page_links to authenticated;
grant insert (workspace_id, project_id, title, blocks, status) on table public.app_share_pages to authenticated;
grant update (project_id, title, blocks, status, updated_at) on table public.app_share_pages to authenticated;
grant insert (workspace_id, page_id, label, expires_at) on table public.app_share_page_links to authenticated;
grant update (label, expires_at, disabled_at) on table public.app_share_page_links to authenticated;
grant select (id, title, blocks, status) on table public.app_share_pages to service_role;
grant select (page_id, token_hash, expires_at, disabled_at) on table public.app_share_page_links to service_role;

create policy share_pages_owner_all on public.app_share_pages for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and private.app_space_in_workspace(project_id, workspace_id));

create policy share_page_links_owner_all on public.app_share_page_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_share_pages p
      where p.id = page_id and p.workspace_id = app_share_page_links.workspace_id));

-- 사후 확인: RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_share_pages'::regclass, 'public.app_share_page_links'::regclass)
             and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_share_pages'::regclass, 'public.app_share_page_links'::regclass)
             and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_share_pages'::regclass, 'public.app_share_page_links'::regclass)
             and attacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_pages'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_share_page_links'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid in ('public.app_share_pages'::regclass, 'public.app_share_page_links'::regclass)) <> 2 then
    raise exception 'SHARE_PAGES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020005000', 'share_pages_links', array['SHARE-현장공유 PR 1: app_share_pages + app_share_page_links, owner RLS, no anon, service_role column SELECT only']);
commit;
