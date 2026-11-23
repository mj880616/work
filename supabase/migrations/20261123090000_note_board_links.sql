begin;
-- S68-38 노트 '보드'(생각 지도) DB(요청 2026-11-23 08:12·08:23 명진): 보드 위 노트와 노트를 잇는 연결선(화살표).
-- 바꾸는 것: 새 표 1개(app_note_board_links)뿐. 기존 표·정책·권한·자료(app_notes, 화면 기억 view_prefs 포함)는 한 줄도 바꾸지 않는다.
--  - 선 한 줄 = 한 보드(board_id: [전체]는 'all', 이름 붙은 보드는 화면 기억 view_prefs.note_boards의 id 'b'+소문자 영문·숫자 6~12자)
--    위에서 노트(from_note) → 노트(to_note). 같은 노트끼리는 못 잇는다. 한 보드에서 같은 방향의 같은 두 노트는 한 줄뿐.
--  - 붙는 변(from_side·to_side: top·right·bottom·left, 비면 화면이 가까운 변을 고름), 모양(shape: curve 곡선·line 직선),
--    선 종류(dash: solid 실선·dashed 점선), 화살촉(ends: end 끝에만·both 양쪽·none 없음), 선 위 짧은 글자(label 1~40자, 없어도 됨).
--  - 카드 자리는 이 표와 무관하다: 지금처럼 노트 metadata.boards[보드 id](전체는 metadata.board)에 둔다(20261030091000).
--  - 노트를 영구 삭제하면 그 노트에 붙은 선도 함께 지워진다(on delete cascade). 휴지통에 있는 동안은 남는다(되돌리면 그대로).
--    보드는 표가 아니라 화면 기억 목록이라, 보드를 지우면 화면이 그 보드 id의 선을 지운다(남은 선은 화면이 읽을 때 무시).
-- 권한: owner만(private.app_is_workspace_owner). 넣거나 고칠 때 양쪽 노트가 모두 같은 작업공간의 노트(kind=note)여야 한다.
--   authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만(작업공간·보드는 못 고침). anon·PUBLIC·service_role 권한 없음.
--   공유(COLLAB) 함수는 이 표를 읽지 않는다(넓히지 않음).
-- 짝: docs/20261123090000_note_board_links.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261123090000')
     or to_regclass('public.app_note_board_links') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_notes') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_notes') and attname = 'kind'
         and atttypid = 'text'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'NOTE_BOARD_LINKS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_note_board_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  board_id text not null,
  from_note uuid not null references public.app_notes(id) on delete cascade,
  to_note uuid not null references public.app_notes(id) on delete cascade,
  from_side text,
  to_side text,
  shape text not null default 'curve',
  dash text not null default 'solid',
  ends text not null default 'end',
  label text,
  created_at timestamptz not null default now(),
  constraint app_note_board_links_board_check check (board_id ~ '^(all|b[0-9a-z]{6,12})$'),
  constraint app_note_board_links_self_check check (from_note <> to_note),
  constraint app_note_board_links_side_check check (
    (from_side is null or from_side in ('top', 'right', 'bottom', 'left'))
    and (to_side is null or to_side in ('top', 'right', 'bottom', 'left'))),
  constraint app_note_board_links_shape_check check (shape in ('curve', 'line')),
  constraint app_note_board_links_dash_check check (dash in ('solid', 'dashed')),
  constraint app_note_board_links_ends_check check (ends in ('end', 'both', 'none')),
  constraint app_note_board_links_label_check check (
    label is null or (char_length(label) between 1 and 40 and btrim(label) <> '' and label !~ '[[:cntrl:]]')),
  constraint app_note_board_links_pair_key unique (workspace_id, board_id, from_note, to_note)
);
create index app_note_board_links_from_idx on public.app_note_board_links(from_note);
create index app_note_board_links_to_idx on public.app_note_board_links(to_note);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만(id·created_at은 서버가 정함).
alter table public.app_note_board_links enable row level security;
revoke all on table public.app_note_board_links from public, anon, authenticated, service_role;
grant select, delete on table public.app_note_board_links to authenticated;
grant insert (workspace_id, board_id, from_note, to_note, from_side, to_side, shape, dash, ends, label) on table public.app_note_board_links to authenticated;
grant update (from_note, to_note, from_side, to_side, shape, dash, ends, label) on table public.app_note_board_links to authenticated;

-- 양쪽 노트는 같은 작업공간의 노트(kind=note)여야 한다. 노트 읽기는 그 표의 owner 정책을 그대로 따른다.
create policy note_board_links_owner_all on public.app_note_board_links for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_notes n
      where n.id = from_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note')
    and exists (
      select 1 from public.app_notes n
      where n.id = to_note and n.workspace_id = app_note_board_links.workspace_id and n.kind = 'note'));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 작업공간·보드 고치기 권한 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_note_board_links'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_note_board_links'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_note_board_links'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_note_board_links', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_note_board_links', 'update,truncate,references,trigger')
     or has_column_privilege('authenticated', 'public.app_note_board_links', 'workspace_id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_board_links', 'board_id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_board_links', 'id', 'update')
     or has_column_privilege('authenticated', 'public.app_note_board_links', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_note_board_links', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_board_links', 'to_note', 'insert')
     or not has_column_privilege('authenticated', 'public.app_note_board_links', 'shape', 'update')
     or not has_table_privilege('authenticated', 'public.app_note_board_links', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_note_board_links'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_note_board_links'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from public.app_note_board_links) <> 0 then
    raise exception 'NOTE_BOARD_LINKS_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261123090000', 'note_board_links', array['S68-38: app_note_board_links (owner RLS, both notes in same workspace, insert/select/update named columns/delete)']);
commit;
