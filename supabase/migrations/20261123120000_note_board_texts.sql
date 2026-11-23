begin;
-- S68-38c 노트 보드 글 상자·선 곡선 DB(요청 2026-11-23 08:32·08:47 명진).
-- 앞 단계: 20261123090000_note_board_links(연결선 표) 기록이 있어야 한다.
-- 바꾸는 것:
--  1) 새 표 app_note_board_texts: 그 보드에만 있는 짧은 글 상자(노트가 아니다 — 노트 목록·검색·폴더·태그에 안 나온다).
--     보드 id(board_id, 연결선과 같은 규칙), 글(body 1~300자, 줄바꿈만 허용), 판 위 자리(x·y 0~100000 정수). 폭은 화면이 글에 맞춘다(저장 안 함).
--  2) 연결선 표 app_note_board_links: 끝점이 노트 또는 글 상자.
--     from_note·to_note를 비워도 되게 하고 from_text·to_text를 더한다. 각 끝은 노트·글 상자 중 정확히 하나(check).
--     글 상자 끝은 (글 상자 id, 작업공간, 보드) 세 칸 외래 키로 같은 작업공간·같은 보드의 글 상자만 가리킨다. 글 상자를 지우면 그 선도 지워진다(cascade).
--     선 가운데를 끌어 만든 곡선의 지나는 점(bend_x·bend_y): 두 끝점 기준 상대 위치(bend_x = 시작→끝 방향 비율, bend_y = 수직 방향 비율, 각 -5~5).
--     둘 다 비면 곡선 점 없음. 점이 있으면 모양은 curve여야 한다. 새 선의 기본 모양을 line(직선)으로 바꾼다.
--     정책 note_board_links_owner_all은 같은 이름·같은 표·같은 역할(authenticated)·같은 명령(all)으로 다시 만든다:
--     노트 끝은 지금처럼 같은 작업공간의 노트(kind=note)만, 노트 끝이 빈 쪽은 글 상자 외래 키가 지킨다. owner 조건 그대로(넓히지 않음).
--     새 칸 넣기·고치기 권한(from_text·to_text·bend_x·bend_y)만 authenticated에 더한다. 작업공간·보드는 지금처럼 못 고친다.
-- 기존 행: 한 줄도 바꾸지 않는다(기존 선은 노트↔노트, 곡선 점 없음 = 지금 모양 그대로).
-- 권한: owner만(private.app_is_workspace_owner). anon·PUBLIC·service_role 권한 없음. 함수·트리거 없음. 공유(COLLAB) 함수는 두 표를 읽지 않는다.
-- 적용 경로: 기존 표(app_note_board_links)에 칸 권한을 더하므로 승인형 DB workflow 확장 규칙(grant-existing)이 받지 않는다.
--   SQL Editor(AGENTS.md 7절·폰 경로 C)로 적용한다. 짝: docs/20261123120000_note_board_texts.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261123120000')
     or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261123090000' and name = 'note_board_links')
     or to_regclass('public.app_note_board_links') is null
     or to_regclass('public.app_note_board_texts') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_note_board_links')
         and attname in ('from_text', 'to_text', 'bend_x', 'bend_y') and not attisdropped)
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')
         and polname = 'note_board_links_owner_all') <> 1
     or (select count(*) from pg_policy where polrelid = to_regclass('public.app_note_board_links')) <> 1
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOTE_BOARD_TEXTS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 글 상자 표
create table public.app_note_board_texts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  board_id text not null,
  body text not null,
  x integer not null default 0,
  y integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_note_board_texts_board_check check (board_id ~ '^(all|b[0-9a-z]{6,12})$'),
  constraint app_note_board_texts_body_check check (
    char_length(body) between 1 and 300 and btrim(body, E' \n') <> '' and translate(body, E'\n', '') !~ '[[:cntrl:]]'),
  constraint app_note_board_texts_place_check check (x between 0 and 100000 and y between 0 and 100000),
  constraint app_note_board_texts_end_key unique (id, workspace_id, board_id)
);
create index app_note_board_texts_board_idx on public.app_note_board_texts(workspace_id, board_id);

alter table public.app_note_board_texts enable row level security;
revoke all on table public.app_note_board_texts from public, anon, authenticated, service_role;
grant select, delete on table public.app_note_board_texts to authenticated;
grant insert (workspace_id, board_id, body, x, y) on table public.app_note_board_texts to authenticated;
grant update (body, x, y) on table public.app_note_board_texts to authenticated;
create policy note_board_texts_owner_all on public.app_note_board_texts for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 2) 연결선 끝점: 노트 또는 글 상자, 곡선 지나는 점
alter table public.app_note_board_links alter column from_note drop not null;
alter table public.app_note_board_links alter column to_note drop not null;
alter table public.app_note_board_links alter column shape set default 'line';
alter table public.app_note_board_links add column from_text uuid;
alter table public.app_note_board_links add column to_text uuid;
alter table public.app_note_board_links add column bend_x real;
alter table public.app_note_board_links add column bend_y real;
alter table public.app_note_board_links add constraint app_note_board_links_from_text_fkey
  foreign key (from_text, workspace_id, board_id) references public.app_note_board_texts(id, workspace_id, board_id) on delete cascade;
alter table public.app_note_board_links add constraint app_note_board_links_to_text_fkey
  foreign key (to_text, workspace_id, board_id) references public.app_note_board_texts(id, workspace_id, board_id) on delete cascade;
alter table public.app_note_board_links add constraint app_note_board_links_end_one_check
  check (num_nonnulls(from_note, from_text) = 1 and num_nonnulls(to_note, to_text) = 1);
alter table public.app_note_board_links add constraint app_note_board_links_text_self_check check (from_text <> to_text);
alter table public.app_note_board_links add constraint app_note_board_links_bend_check check (
  (bend_x is null) = (bend_y is null)
  and (bend_x is null or (shape = 'curve' and bend_x between -5 and 5 and bend_y between -5 and 5)));
create index app_note_board_links_from_text_idx on public.app_note_board_links(from_text);
create index app_note_board_links_to_text_idx on public.app_note_board_links(to_text);
-- 같은 보드·같은 방향·같은 두 끝(노트든 글 상자든)은 한 줄(기존 노트↔노트 unique는 그대로 둔다).
create unique index app_note_board_links_end_key on public.app_note_board_links
  (workspace_id, board_id, coalesce(from_note, from_text), coalesce(to_note, to_text));

grant insert (from_text, to_text, bend_x, bend_y) on table public.app_note_board_links to authenticated;
grant update (from_text, to_text, bend_x, bend_y) on table public.app_note_board_links to authenticated;

drop policy note_board_links_owner_all on public.app_note_board_links;
create policy note_board_links_owner_all on public.app_note_board_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and (from_note is null or exists (
      select 1 from public.app_notes n
      where n.id = from_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note'))
    and (to_note is null or exists (
      select 1 from public.app_notes n
      where n.id = to_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note')));

-- 사후 확인: 두 표 RLS 켜짐, 정책 각 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 작업공간·보드 고치기 권한 없음. 다르면 전체 취소.
do $$
declare t regclass;
begin
  foreach t in array array['public.app_note_board_texts'::regclass, 'public.app_note_board_links'::regclass] loop
    if not (select relrowsecurity from pg_class where oid = t)
       or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon|service_role)?=')
       or exists (select 1 from pg_attribute where attrelid = t and attacl::text ~ '(^|[{,])(anon|service_role)?=')
       or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
       or has_table_privilege('authenticated', t, 'insert,update,truncate,references,trigger')
       or not has_table_privilege('authenticated', t, 'select,delete')
       or has_column_privilege('authenticated', t, 'workspace_id', 'update')
       or has_column_privilege('authenticated', t, 'board_id', 'update')
       or has_column_privilege('authenticated', t, 'id', 'insert')
       or has_column_privilege('authenticated', t, 'id', 'update')
       or has_column_privilege('authenticated', t, 'created_at', 'insert')
       or (select count(*) from pg_policy where polrelid = t) <> 1
       or (select count(*) from pg_policy where polrelid = t and polroles = array['authenticated'::regrole]::oid[] and polcmd = '*') <> 1
       or (select count(*) from pg_trigger where tgrelid = t and not tgisinternal) <> 0 then
      raise exception 'NOTE_BOARD_TEXTS_POSTCHECK_FAILED; stop';
    end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.app_note_board_texts', 'body', 'update')
     or not has_column_privilege('authenticated', 'public.app_note_board_texts', 'x', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_board_links', 'from_text', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_board_links', 'bend_y', 'update')
     or (select count(*) from public.app_note_board_texts) <> 0 then
    raise exception 'NOTE_BOARD_TEXTS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261123120000', 'note_board_texts', array['S68-38c: app_note_board_texts (owner RLS) + app_note_board_links ends note|text, bend point, default straight']);
commit;
