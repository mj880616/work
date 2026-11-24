begin;
-- S69-12 자료실 '지난 정돈 되돌리기'(요청 2026-11-24 08:09 명진: 정돈 제안이 다른 단체 회의 자료까지 한 폴더로 옮김).
-- 바꾸는 것: 새 표 1개(app_library_move_log)뿐. 기존 표·정책·권한·자료(app_library_folders·app_library_folder_items 포함)는 한 줄도 바꾸지 않는다.
--  - 한 줄 = 화면의 [정돈 제안]·[폴더로 나누기]에서 [옮기기]로 자료 하나를 옮긴 기록: 묶음 번호(batch_id, 한 번 누름 = 하나), 종류(kind: tidy·sort),
--    자료(document_id), 옮기기 전 폴더(from_folder_id, 비면 '폴더 밖'), 옮긴 폴더(to_folder_id), 시각.
--  - 화면이 나중에 [지난 정돈 되돌리기]를 누르면 그 묶음 중 아직 옮긴 폴더에 있는 자료만 옮기기 전 폴더로 되돌리고 그 묶음 기록을 지운다.
--  - 30일 지난 기록은 화면이 기록을 더하거나 목록을 열 때 주인 권한으로 지운다(서버 예약 작업 없음).
--  - 자료·폴더를 영구 삭제하면 그 기록도 함께 지워진다(on delete cascade). 제목·이름·내용은 담지 않는다(번호만).
-- 권한: owner만(private.app_is_workspace_owner). 넣을 때 자료·두 폴더가 모두 같은 작업공간 것이어야 한다.
--   authenticated: 읽기·지우기, 넣기는 필요한 칸만, 고치기 없음. anon·PUBLIC·service_role 권한 없음. 공유(COLLAB) 함수는 이 표를 읽지 않는다.
-- 짝: docs/20261124090000_library_move_log.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124090000')
     or to_regclass('public.app_library_move_log') is not null
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_library_folders') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_documents') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'workspace_id'
         and atttypid = 'uuid'::regtype and not attisdropped)
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'LIBRARY_MOVE_LOG_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_library_move_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  batch_id uuid not null,
  kind text not null,
  document_id uuid not null references public.app_documents(id) on delete cascade,
  from_folder_id uuid references public.app_library_folders(id) on delete cascade,
  to_folder_id uuid not null references public.app_library_folders(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint app_library_move_log_kind_check check (kind in ('tidy', 'sort')),
  constraint app_library_move_log_folders_check check (from_folder_id is null or from_folder_id <> to_folder_id)
);
create index app_library_move_log_recent_idx on public.app_library_move_log(workspace_id, created_at desc);
create index app_library_move_log_batch_idx on public.app_library_move_log(batch_id);
create index app_library_move_log_document_idx on public.app_library_move_log(document_id);
create index app_library_move_log_from_idx on public.app_library_move_log(from_folder_id) where from_folder_id is not null;
create index app_library_move_log_to_idx on public.app_library_move_log(to_folder_id);

-- 권한: 호스팅 기본 권한을 모두 걷어 낸다. authenticated: 읽기·지우기, 넣기는 필요한 칸만(id·created_at은 서버가 정함), 고치기 없음.
alter table public.app_library_move_log enable row level security;
revoke all on table public.app_library_move_log from public, anon, authenticated, service_role;
grant select, delete on table public.app_library_move_log to authenticated;
grant insert (workspace_id, batch_id, kind, document_id, from_folder_id, to_folder_id) on table public.app_library_move_log to authenticated;

-- 자료와 두 폴더는 같은 작업공간 것이어야 한다. 자료·폴더 읽기는 그 표들의 owner 정책을 그대로 따른다.
create policy library_move_log_owner_all on public.app_library_move_log for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (
    private.app_is_workspace_owner(workspace_id)
    and exists (
      select 1 from public.app_documents d
      where d.id = document_id and d.workspace_id = app_library_move_log.workspace_id)
    and exists (
      select 1 from public.app_library_folders f
      where f.id = to_folder_id and f.workspace_id = app_library_move_log.workspace_id)
    and (from_folder_id is null or exists (
      select 1 from public.app_library_folders f
      where f.id = from_folder_id and f.workspace_id = app_library_move_log.workspace_id)));

-- 사후 확인: RLS 켜짐, 정책 1개(authenticated만), anon·PUBLIC·service_role 권한 없음, 고치기 권한 없음. 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_library_move_log'::regclass)
     or exists (select 1 from pg_class where oid = 'public.app_library_move_log'::regclass
             and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid = 'public.app_library_move_log'::regclass
             and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', 'public.app_library_move_log', 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.app_library_move_log', 'update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', 'public.app_library_move_log', 'update')
     or has_column_privilege('authenticated', 'public.app_library_move_log', 'id', 'insert')
     or has_column_privilege('authenticated', 'public.app_library_move_log', 'created_at', 'insert')
     or not has_column_privilege('authenticated', 'public.app_library_move_log', 'to_folder_id', 'insert')
     or not has_table_privilege('authenticated', 'public.app_library_move_log', 'select,delete')
     or (select count(*) from pg_policy where polrelid = 'public.app_library_move_log'::regclass) <> 1
     or (select count(*) from pg_policy where polrelid = 'public.app_library_move_log'::regclass
         and polroles = array['authenticated'::regrole]::oid[]) <> 1
     or (select count(*) from public.app_library_move_log) <> 0 then
    raise exception 'LIBRARY_MOVE_LOG_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124090000', 'library_move_log', array['S69-12: app_library_move_log (owner RLS, document and folders in same workspace, insert named columns/select/delete, no update)']);
commit;
