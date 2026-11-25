begin;
-- BLOG ①(서버·DB). 명진 11/25 11:00 블로그 요청, 11:05~11:06 "bokdoong.com 은 내 개인블로그로만 / 다른 가입자는 블로그 기능 안줘",
-- 12:34 "시안 확인 ㅇㅋ"(B 게시판은 노트 폴더와 따로, C [다시 게시]로 반영, D 검색 엔진 기본 금지, E 이름 필수·소개 한 줄 선택). 설계: docs/design/blog.md 3절.
-- 무엇:
--  1) 운영자 기능 키에 'blog'를 더한다(검사 지우고 같은 이름으로 다시 만듦 — 앞 단계 20261121090000_nojo_words_feature의 키 열은 그대로).
--     허용 행은 '통화(calls)가 허용된 작업공간이 정확히 하나일 때'만 그 작업공간에 1행(고정 id·이름·메일 없음, arsenal·outside와 같은 방식).
--  2) 새 표 3개: app_blogs(작업공간마다 0~1줄: 이름·소개·켬·검색 허용), app_blog_boards(게시판: 이름·순서·주소용 key),
--     app_blog_posts(글 한 편 = 기존 공유 페이지 행 하나 + 노트 하나 + 게시판, 주소용 key·게시 시각·다시 게시 시각).
--     공개용 사본은 기존 app_share_pages.blocks다(새 사본 표 없음). 기존 표·정책·권한·트리거·자료는 한 줄도 바꾸지 않는다.
-- 보안(AGENTS.md 3절·5절):
--   - 세 표 모두 RLS 켬. authenticated 정책은 '작업공간 주인' 그리고 'blog 허용'(private.app_workspace_has_feature)일 때만 — 다른 가입자는
--     화면을 우회해 REST로 넣어도 서버(RLS)가 거절한다. 허용 행을 지우면(SQL) 그 순간 읽기·쓰기 모두 막힌다.
--   - 넣을 때 게시판은 같은 작업공간 블로그, 글은 같은 작업공간의 게시판·공유 페이지·노트(kind 'note')만. 글 고치기는 board_id·republished_at만.
--   - anon·PUBLIC 권한·정책 없음. 주소용 key·시각은 DB가 만든다(authenticated가 넣지 못함).
--   - service_role(익명 읽기 함수 share-page-read의 블로그 길)은 아래 칸만 읽는다. 쓰기 권한 없음. 받는 작업공간은 요청이 아니라
--     public.app_operator_feature_workspace('blog')(허용된 작업공간이 정확히 하나일 때만)가 정한다.
-- 안 하는 것: 기존 허용 행·함수·정책·권한 변경, 공유 페이지·노트 표 변경, 새 함수·RPC·SECURITY DEFINER, rtw_* 객체.
-- 짝: docs/20261125113100_blog_tables.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_operator_features in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261125113100')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261121090000' and name = 'nojo_words_feature') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261027050000' and name = 'trash_share_pages_db') <> 1
     or to_regclass('public.app_blogs') is not null
     or to_regclass('public.app_blog_boards') is not null
     or to_regclass('public.app_blog_posts') is not null
     or to_regclass('public.app_operator_features') is null
     or to_regclass('public.app_share_pages') is null
     or to_regclass('public.app_notes') is null
     or to_regprocedure('public.app_operator_feature_workspace(text)') is null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_workspace_has_feature(uuid,text)') and prosecdef)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or (select count(*) from pg_attribute where attrelid = 'public.app_notes'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'workspace_id', 'kind', 'deleted_at')) <> 4
     or (select count(*) from pg_attribute where attrelid = 'public.app_share_pages'::regclass and attnum > 0 and not attisdropped
         and attname in ('id', 'workspace_id', 'title', 'blocks', 'status')) <> 5
     or not exists (select 1 from pg_class where oid = 'public.app_notes'::regclass and relrowsecurity)
     or not exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and relrowsecurity)
     or (select count(*) from pg_constraint where conrelid = 'public.app_operator_features'::regclass
         and conname = 'app_operator_features_feature_check' and contype = 'c' and convalidated
         and pg_get_constraintdef(oid) ~ '''nojo_words''' and pg_get_constraintdef(oid) !~ '''blog''') <> 1
     or exists (select 1 from public.app_operator_features
                 where feature not in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words')) then
    raise exception 'BLOG_TABLES_PREREQUISITE_CHANGED; stop';
  end if;
  if (select count(*) from public.app_operator_features where feature = 'calls') <> 1 then
    raise exception 'BLOG_TABLES_SEED_WORKSPACE_NOT_SINGLE; stop';
  end if;
end
$$;

-- 1) 운영자 기능 키 'blog' + 운영자 작업공간 한 줄.
alter table public.app_operator_features drop constraint app_operator_features_feature_check;
alter table public.app_operator_features add constraint app_operator_features_feature_check
  check (feature in ('calls', 'telegram', 'gdrive_photos', 'files', 'dev_inbox', 'family', 'ai_no_cap', 'arsenal', 'outside', 'ppwu_forms', 'nojo_words', 'blog'));
insert into public.app_operator_features (workspace_id, feature)
  select f.workspace_id, 'blog' from public.app_operator_features f where f.feature = 'calls';

-- 2) 블로그 한 개(작업공간마다 0~1줄). 켬·검색 허용은 기본 끔(결정 D). 이름 필수 1~60자, 소개 선택 1~120자(결정 E).
create table public.app_blogs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  title text not null,
  intro text,
  enabled boolean not null default false,
  indexable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_blogs_workspace_key unique (workspace_id),
  constraint app_blogs_title_check check (char_length(title) between 1 and 60 and btrim(title) <> '' and title !~ '[[:cntrl:]]'),
  constraint app_blogs_intro_check check (intro is null or (char_length(intro) between 1 and 120 and btrim(intro) <> '' and intro !~ '[[:cntrl:]]'))
);

-- 게시판(노트 폴더와 따로, 결정 B). 주소에는 내부 id 대신 DB가 만든 10글자 key.
create table public.app_blog_boards (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  blog_id uuid not null references public.app_blogs(id) on delete cascade,
  name text not null,
  sort integer not null default 0,
  public_key text not null default substr(md5(gen_random_uuid()::text), 1, 10),
  created_at timestamptz not null default now(),
  constraint app_blog_boards_public_key unique (public_key),
  constraint app_blog_boards_public_key_check check (public_key ~ '^[0-9a-f]{10}$'),
  constraint app_blog_boards_name_check check (char_length(name) between 1 and 40 and btrim(name) <> '' and name !~ '[[:cntrl:]]'),
  constraint app_blog_boards_sort_check check (sort between 0 and 100000)
);
create index app_blog_boards_blog_idx on public.app_blog_boards(blog_id, sort);

-- 글 한 편 = 공유 페이지 행 하나(사본) + 노트 하나. 글이 남은 게시판은 지울 수 없다(board_id 기본 no action — 작업공간 지우기 cascade는 같이 지워짐).
-- 노트를 완전히 지우면 note_id가 비고 익명 읽기는 404로 본다. 공유 페이지 행을 지우면(휴지통 트리거가 가로챔) 글 짝도 지워진다.
create table public.app_blog_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  board_id uuid not null references public.app_blog_boards(id),
  page_id uuid not null references public.app_share_pages(id) on delete cascade,
  note_id uuid references public.app_notes(id) on delete set null,
  public_key text not null default substr(md5(gen_random_uuid()::text), 1, 10),
  published_at timestamptz not null default now(),
  republished_at timestamptz,
  constraint app_blog_posts_page_key unique (page_id),
  constraint app_blog_posts_note_key unique (note_id),
  constraint app_blog_posts_public_key unique (public_key),
  constraint app_blog_posts_public_key_check check (public_key ~ '^[0-9a-f]{10}$')
);
create index app_blog_posts_board_idx on public.app_blog_posts(board_id, published_at desc);
create index app_blog_posts_workspace_idx on public.app_blog_posts(workspace_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다.
alter table public.app_blogs enable row level security;
alter table public.app_blog_boards enable row level security;
alter table public.app_blog_posts enable row level security;
revoke all on table public.app_blogs, public.app_blog_boards, public.app_blog_posts from public, anon, authenticated, service_role;
grant select, delete on table public.app_blogs, public.app_blog_boards, public.app_blog_posts to authenticated;
grant insert (workspace_id, title, intro, enabled, indexable) on table public.app_blogs to authenticated;
grant update (title, intro, enabled, indexable, updated_at) on table public.app_blogs to authenticated;
grant insert (workspace_id, blog_id, name, sort) on table public.app_blog_boards to authenticated;
grant update (name, sort) on table public.app_blog_boards to authenticated;
grant insert (workspace_id, board_id, page_id, note_id) on table public.app_blog_posts to authenticated;
grant update (board_id, republished_at) on table public.app_blog_posts to authenticated;
-- 익명 읽기 함수(service_role)가 읽는 칸. id 두 개는 표 사이를 잇는 데만 쓰고 응답에 넣지 않는다.
grant select (id, workspace_id, title, intro, enabled, indexable) on table public.app_blogs to service_role;
grant select (id, blog_id, name, sort, public_key) on table public.app_blog_boards to service_role;
grant select (board_id, page_id, note_id, public_key, published_at, republished_at) on table public.app_blog_posts to service_role;

create policy blogs_owner_select on public.app_blogs for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));
create policy blogs_owner_insert on public.app_blogs for insert to authenticated
  with check (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));
create policy blogs_owner_update on public.app_blogs for update to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'))
  with check (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));
create policy blogs_owner_delete on public.app_blogs for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));

create policy blog_boards_owner_select on public.app_blog_boards for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));
create policy blog_boards_owner_insert on public.app_blog_boards for insert to authenticated
  with check (
    private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog')
    and exists (select 1 from public.app_blogs b where b.id = blog_id and b.workspace_id = app_blog_boards.workspace_id));
create policy blog_boards_owner_update on public.app_blog_boards for update to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'))
  with check (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));
create policy blog_boards_owner_delete on public.app_blog_boards for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));

create policy blog_posts_owner_select on public.app_blog_posts for select to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));
create policy blog_posts_owner_insert on public.app_blog_posts for insert to authenticated
  with check (
    private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog')
    and note_id is not null
    and exists (select 1 from public.app_blog_boards g where g.id = board_id and g.workspace_id = app_blog_posts.workspace_id)
    and exists (select 1 from public.app_share_pages p where p.id = page_id and p.workspace_id = app_blog_posts.workspace_id)
    and exists (select 1 from public.app_notes n
                 where n.id = note_id and n.workspace_id = app_blog_posts.workspace_id and n.kind = 'note'));
-- 고치기: 게시판 옮기기·다시 게시 시각만(칸 권한). 옮길 게시판도 같은 작업공간.
create policy blog_posts_owner_update on public.app_blog_posts for update to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'))
  with check (
    private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog')
    and exists (select 1 from public.app_blog_boards g where g.id = board_id and g.workspace_id = app_blog_posts.workspace_id));
create policy blog_posts_owner_delete on public.app_blog_posts for delete to authenticated
  using (private.app_is_workspace_owner(workspace_id) and private.app_workspace_has_feature(workspace_id, 'blog'));

-- 사후 확인: 세 표 RLS 켜짐·정책 4개씩(authenticated만)·anon·PUBLIC 권한 없음·service_role 쓰기 없음,
-- 운영자 표는 RLS 켜짐·정책 없음·API 역할 권한 없음 그대로, blog 행은 calls 행과 같은 작업공간 1행. 다르면 전체 취소.
do $$
declare
  t regclass;
begin
  foreach t in array array['public.app_blogs'::regclass, 'public.app_blog_boards'::regclass, 'public.app_blog_posts'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', t, 'select,insert,update,references')
       or has_table_privilege('service_role', t, 'insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('service_role', t, 'insert,update,references')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or (select count(*) from pg_policy where polrelid = t) <> 4
       or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[]) <> 4 then
      raise exception 'BLOG_TABLES_POSTCHECK_FAILED: %; stop', t;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'public.app_blog_posts', 'page_id', 'update')
     or has_column_privilege('authenticated', 'public.app_blog_posts', 'note_id', 'update')
     or has_column_privilege('authenticated', 'public.app_blog_posts', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_blog_posts', 'public_key', 'insert')
     or has_column_privilege('authenticated', 'public.app_blog_boards', 'public_key', 'insert')
     or has_column_privilege('authenticated', 'public.app_blog_boards', 'public_key', 'update')
     or has_column_privilege('authenticated', 'public.app_blog_boards', 'blog_id', 'update')
     or has_column_privilege('authenticated', 'public.app_blogs', 'workspace_id', 'update')
     or has_column_privilege('service_role', 'public.app_blog_posts', 'workspace_id', 'select')
     or not (select relrowsecurity from pg_class where oid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_policy where polrelid = 'public.app_operator_features'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_operator_features'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or has_table_privilege('authenticated', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', 'public.app_operator_features', 'select,insert,update,delete,truncate,references,trigger')
     or (select count(*) from public.app_operator_features where feature = 'blog') <> 1
     or (select count(*) from public.app_operator_features d join public.app_operator_features c
           on c.workspace_id = d.workspace_id and c.feature = 'calls' where d.feature = 'blog') <> 1 then
    raise exception 'BLOG_TABLES_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261125113100', 'blog_tables', array['BLOG ①: operator feature key blog (seeded only for the single calls workspace); app_blogs, app_blog_boards, app_blog_posts with owner + blog-feature RLS (4 authenticated policies each), no anon/PUBLIC, column-limited service_role SELECT for share-page-read; no change to existing tables, policies, grants or functions']);
commit;
