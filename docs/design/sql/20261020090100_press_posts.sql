-- 초안(DRAFT) — 적용·실행 금지. supabase/migrations가 아니라 docs/design/sql/에 둔다.
-- 설계: docs/design/press-to-web2-design.md (추천안 B: 성명·보도자료 본문을 Web2 DB의 비공개 표에).
-- 적용 때: 최신 main 기준으로 version을 새로 정하고, 파일을 supabase/migrations/로 옮기며,
--          아래 schema_migrations 행의 version·name을 파일 이름과 같게 고친다(AGENTS.md §7).
-- 범위: 새 표 1개 + owner 전용 RLS. 새 함수·트리거 없음. anon·public 권한 없음. Web1·RTW 표는 건드리지 않는다.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations
      where version = '20261013034836' and name = 'basket_photo_ocr_db') <> 1
     or to_regclass('public.app_press_posts') is not null
     or to_regprocedure('private.app_is_workspace_owner(uuid)') is null
     or to_regclass('public.app_workspaces') is null then
    raise exception 'PRESS_POSTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 성명·보도자료·취재요청 1건 = 1행. 본문은 원본 HTML 그대로(화면은 칸막이 iframe으로만 보여 준다).
create table public.app_press_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  published_on date not null check (published_on between date '2000-01-01' and date '2100-12-31'),
  kind text not null check (kind in ('statement', 'release', 'request')),
  title text not null check (length(btrim(title)) between 1 and 300 and title !~ '[\r\n]'),
  publisher text not null check (length(btrim(publisher)) between 1 and 100 and publisher !~ '[\r\n]'),
  body_html text not null check (length(body_html) between 1 and 200000),
  -- 첨부(HWP·PDF)는 자료실(app_documents) 행으로 두고 그 id만 적는다. 내려받기는 기존 자료실 경로를 쓴다.
  attachments jsonb not null default '[]'::jsonb,
  -- 어디서 왔나: legacy_web1(옛 press/ 가져오기) / manual(직접 입력) / ai_upload(PRESS-자동올리기)
  origin text not null default 'manual' check (origin in ('legacy_web1', 'manual', 'ai_upload')),
  -- 옛 Web1 경로(가져오기 중복 방지·대조용). 예: press/2026-10-02-two-person-team-forum-followup/
  legacy_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_press_posts_legacy_path_check check (
    (origin = 'legacy_web1') = (legacy_path is not null)
    and (legacy_path is null or legacy_path ~ '^[a-z0-9][a-z0-9/-]{0,199}/$')
  ),
  constraint app_press_posts_attachments_check check (
    case when jsonb_typeof(attachments) = 'array' then
      jsonb_array_length(attachments) <= 10
      and not jsonb_path_exists(attachments, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(attachments, '$[*] ? (
        !exists(@.document_id) || !exists(@.file_name)
        || @.document_id.type() != "string"
        || !(@.document_id like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
        || @.file_name.type() != "string"
        || !(@.file_name like_regex "^.{1,255}$" flag "s")
      )')
      and not jsonb_path_exists(attachments, '$[*].keyvalue() ? (@.key != "document_id" && @.key != "file_name")')
    else false end
  ),
  constraint app_press_posts_legacy_unique unique (workspace_id, legacy_path)
);
create index app_press_posts_list_idx on public.app_press_posts (workspace_id, published_on desc, id desc);

-- 권한: 호스팅 기본 권한을 걷어 내고 authenticated에 네 가지만. 행 접근은 sole-owner 경계로만 연다.
alter table public.app_press_posts enable row level security;
revoke all on table public.app_press_posts from public, anon, authenticated;
grant select, insert, update, delete on table public.app_press_posts to authenticated;
create policy press_posts_owner_all on public.app_press_posts for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_press_posts'::regclass)
     or (select count(*) from pg_policy where polrelid = 'public.app_press_posts'::regclass) <> 1
     or has_table_privilege('anon', 'public.app_press_posts', 'select,insert,update,delete')
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_press_posts'::regclass and not tgisinternal) then
    raise exception 'PRESS_POSTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261020090100', 'press_posts', array['PRESS-Web2자리: private owner-only app_press_posts, no functions']);
commit;
