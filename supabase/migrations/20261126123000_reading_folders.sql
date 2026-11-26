begin;
-- S70-83 READ-저장한글폴더(명진 2026-11-26 09:28 "저장한 글에도 폴더개념이 들어가야함"). 저장한 글을 폴더로 나눠 담는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"(확장 규칙)으로만 한다. 이 브랜치는 적용 직전 정지.
--
-- 같은 목적 표 재사용 검토(PR 본문에 같은 내용):
--  · app_note_folders(노트)·app_library_folders(자료실)는 그 화면 줄(노트·자료)만 담는 표이고 지우기·되돌리기 규칙이 그 화면에 묶여 있다.
--  · app_news_folders(News 별표 폴더)는 운영자 기능 키 'outside'로 서버가 받는 News 표 묶음이라, 모든 사람의 저장한 글 폴더로 쓰면 News 문을 넓히게 된다.
--  그래서 저장한 글 전용 폴더 표 하나를 새로 두고(작업공간마다, owner만), 저장한 글 한 줄에 '들어 있는 폴더' 칸 하나를 더한다.
--
--  1) public.app_reading_folders(새): 폴더(작업공간, 이름 1~40자, 순서). 한 단계(폴더 안 폴더 없음 — 상위 폴더 칸 없음).
--     화면(authenticated): 자기 폴더 읽기·넣기(id·작업공간·이름·순서 — id는 지운 폴더 되돌리기용)·이름·순서 고치기·지우기. 작업공간은 못 고친다.
--  2) public.app_reading_items.folder_id(새 칸, 비어 있으면 '폴더 없음'): (folder_id, workspace_id) → app_reading_folders(id, workspace_id)
--     이라 같은 작업공간 폴더만 가리킨다. 폴더를 지우면 그 폴더의 글은 지우지 않고 '폴더 없음'으로(on delete set null (folder_id)).
--     화면(authenticated)은 이 칸만 칸 단위로 고칠 수 있다(기존 칸 권한 그대로).
--
-- 권한: 새 표 RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 정책 1개(authenticated만). anon·PUBLIC·service_role 권한 없음. 공유(app_collab_*) 대상 아님.
-- 안 하는 것: 기존 칸·권한·정책·트리거·함수 변경, 기존 줄 변경(새 칸은 모두 비어 있음 = 폴더 없음), 함수 추가, 확장 추가, rtw_* 객체.
-- 되돌리기: docs/20261126123000_reading_folders.rollback.sql(SQL Editor 전용: 새 칸·새 표 삭제. 폴더가 하나라도 있으면 지우지 않고 멈춤).
-- 짝: docs/20261126123000_reading_folders.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126123000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261122100000' and name = 'reading_items') <> 1
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_reading_items') is null
     or to_regclass('public.app_reading_folders') is not null
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_reading_items') and attname = 'folder_id' and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_reading_items') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and attnotnull and not attisdropped)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_reading_items') and relrowsecurity)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'READING_FOLDERS_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 저장한 글 폴더. 작업공간을 지우면 함께 지움.
create table public.app_reading_folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint app_reading_folders_ws_unique unique (id, workspace_id),
  constraint app_reading_folders_name_check check (
    char_length(name) between 1 and 40 and name = btrim(name) and name !~ '[[:cntrl:]]')
);
create index app_reading_folders_scope_idx on public.app_reading_folders(workspace_id, sort_order);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기·고치기는 필요한 칸만.
alter table public.app_reading_folders enable row level security;
revoke all on table public.app_reading_folders from public, anon, authenticated, service_role;
grant select, delete on table public.app_reading_folders to authenticated;
grant insert (id, workspace_id, name, sort_order) on table public.app_reading_folders to authenticated;
grant update (name, sort_order) on table public.app_reading_folders to authenticated;

create policy reading_folders_owner_all on public.app_reading_folders for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

-- 저장한 글이 들어 있는 폴더(비어 있으면 폴더 없음). 같은 작업공간 폴더만, 폴더를 지우면 이 칸만 비운다(글은 그대로).
alter table public.app_reading_items
  add column folder_id uuid;
alter table public.app_reading_items
  add constraint app_reading_items_folder_fkey foreign key (folder_id, workspace_id)
    references public.app_reading_folders(id, workspace_id) on delete set null (folder_id);
create index app_reading_items_folder_idx on public.app_reading_items(folder_id) where folder_id is not null;
grant update (folder_id) on table public.app_reading_items to authenticated;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126123000', 'reading_folders', array['S70-83 READ saved-post folders: new app_reading_folders (owner RLS one policy, authenticated select/delete, insert id/workspace_id/name/sort_order, update name/sort_order, no anon/PUBLIC/service_role), app_reading_items adds folder_id (FK with workspace_id to app_reading_folders, on delete set null folder_id only, update grant on that column only); no existing column, grant, policy, trigger or row change']);
commit;
