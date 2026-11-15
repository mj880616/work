begin;
-- SHARE-보관함·HTML공유 1/3(DB). 설계: docs/design/share-html-pages.md(2026-10-29 명진 결정: 이름+무작위 글자 링크, 블록 편집 공유 페이지 유지, 5MB).
-- 새 표 2개만 만든다. 기존 표(app_share_pages·app_share_page_links)의 칸·제약·권한·정책·트리거·자료는 바꾸지 않는다.
-- 1) app_share_page_html: HTML 파일 공유 페이지의 파일 판. 한 페이지에 판이 여러 개 쌓이고(새 파일로 바꾸기 = 새 판 추가, 이전 판 보관),
--    가장 최근 판을 보여 준다. HTML 판이 하나라도 있는 페이지가 'HTML 파일' 종류다(새 칸 없음). 판은 고치지 않고 더하기만 한다.
--    크기 한도 5MB(5,242,880바이트). 파일은 이 표(DB)에만 두고 공개 저장소에 남기지 않는다.
-- 2) app_share_page_slugs: 링크의 짧은 주소(이름 + DB가 만든 무작위 8글자). 링크 행 하나에 짧은 주소 하나(링크의 token_hash로 묶음).
--    끄기·기한은 원래 링크 행이 그대로 맡는다(짧은 주소와 긴 주소가 같은 링크). 무작위 글자는 DB 기본값으로만 생긴다(화면이 정하지 못함).
--    로그인 없는 읽기는 share-page-read가 짧은 주소의 지문(slug_hash = sha256)으로만 찾는다. 서버 읽기 역할은 이름·글자 원문을 못 읽는다.
-- anon·PUBLIC 권한과 공개 정책은 없다. 새 함수·트리거 없음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029140000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261020005000' and name = 'share_pages_links') <> 1
     or to_regclass('public.app_share_page_html') is not null
     or to_regclass('public.app_share_page_slugs') is not null
     or to_regclass('public.app_share_pages') is null
     or to_regclass('public.app_share_page_links') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_constraint where conrelid = 'public.app_share_page_links'::regclass
         and conname = 'app_share_page_links_token_hash_key' and contype = 'u') <> 1 then
    raise exception 'SHARE_HTML_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- HTML 파일 판. html은 올린 파일 글자 그대로(화면이 UTF-8로 읽은 것). 크기는 바이트로 잰다.
create table public.app_share_page_html (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  page_id uuid not null references public.app_share_pages(id) on delete cascade,
  html text not null,
  file_name text not null default '',
  bytes integer generated always as (octet_length(html)) stored,
  created_at timestamptz not null default now(),
  constraint app_share_page_html_size_check check (octet_length(html) between 1 and 5242880),
  constraint app_share_page_html_name_check check (char_length(file_name) <= 200 and file_name !~ '[[:cntrl:]]')
);
create index app_share_page_html_page_idx on public.app_share_page_html(page_id, created_at desc);
create index app_share_page_html_workspace_idx on public.app_share_page_html(workspace_id);

-- 짧은 주소. 이름은 소문자·숫자·하이픈(2~40자), 무작위 글자는 헷갈리는 글자(l·o·0·1)를 뺀 32글자 중 8개(40비트, 설계 3절 계산).
-- 기본값의 get_byte(uuid_send(gen_random_uuid()), 0)은 v4 UUID의 첫 바이트(버전 표시 없는 무작위 8비트)라 32로 나눈 나머지에 치우침이 없다.
create table public.app_share_page_slugs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  token_hash text not null references public.app_share_page_links(token_hash) on delete cascade,
  slug_name text not null,
  slug_code text not null default (
    substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)
    || substr('abcdefghijkmnpqrstuvwxyz23456789', get_byte(uuid_send(gen_random_uuid()), 0) % 32 + 1, 1)),
  slug_hash text generated always as (encode(sha256(decode(slug_name || '-' || slug_code, 'escape')), 'hex')) stored,
  created_at timestamptz not null default now(),
  constraint app_share_page_slugs_name_check check (
    char_length(slug_name) between 2 and 40 and slug_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint app_share_page_slugs_code_check check (slug_code ~ '^[a-km-np-z2-9]{8}$'),
  constraint app_share_page_slugs_link_key unique (token_hash),
  constraint app_share_page_slugs_hash_key unique (slug_hash)
);
create index app_share_page_slugs_workspace_idx on public.app_share_page_slugs(workspace_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
-- authenticated: 읽기는 표 전체(owner RLS), 쓰기는 더하기만(필요한 칸만). 판·짧은 주소는 고치지 않는다(바꾸면 새 판·새 링크).
--   짧은 주소는 지울 수 있다(링크를 지우면 함께 지워짐). HTML 판은 화면에서 지우지 않는다(페이지를 휴지통에서 완전 삭제하면 함께 지워짐).
-- service_role(share-page-read): 읽기에 필요한 칸만 SELECT. 짧은 주소의 이름·글자 원문, workspace는 못 읽는다.
alter table public.app_share_page_html enable row level security;
alter table public.app_share_page_slugs enable row level security;
revoke all on table public.app_share_page_html, public.app_share_page_slugs from public, anon, authenticated, service_role;
grant select on table public.app_share_page_html, public.app_share_page_slugs to authenticated;
grant delete on table public.app_share_page_slugs to authenticated;
grant insert (workspace_id, page_id, html, file_name) on table public.app_share_page_html to authenticated;
grant insert (workspace_id, token_hash, slug_name) on table public.app_share_page_slugs to authenticated;
grant select (page_id, html, created_at) on table public.app_share_page_html to service_role;
grant select (token_hash, slug_hash) on table public.app_share_page_slugs to service_role;

create policy share_page_html_owner_all on public.app_share_page_html for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_share_pages p
      where p.id = page_id and p.workspace_id = app_share_page_html.workspace_id));

create policy share_page_slugs_owner_all on public.app_share_page_slugs for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_share_page_links l
      where l.token_hash = app_share_page_slugs.token_hash and l.workspace_id = app_share_page_slugs.workspace_id));

-- 사후 확인: RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC 권한 없음. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid in ('public.app_share_page_html'::regclass, 'public.app_share_page_slugs'::regclass)
             and not relrowsecurity)
     or exists (select 1 from pg_class where oid in ('public.app_share_page_html'::regclass, 'public.app_share_page_slugs'::regclass)
             and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid in ('public.app_share_page_html'::regclass, 'public.app_share_page_slugs'::regclass)
             and attacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_page_html'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_share_page_slugs'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from pg_policy where polrelid in ('public.app_share_page_html'::regclass, 'public.app_share_page_slugs'::regclass)) <> 2 then
    raise exception 'SHARE_HTML_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029140000', 'share_html_pages', array['SHARE-보관함·HTML공유 1/3: app_share_page_html (5MB versions) + app_share_page_slugs (name + 8 random letters, sha256 lookup), owner RLS, no anon, service_role column SELECT only']);
commit;
