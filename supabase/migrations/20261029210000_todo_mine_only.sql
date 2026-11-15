begin;
-- TODO-내일만(요청함 10/29 16:41, 명진 결정 16:47·17:24): 챙길 것에 명진 본인 일만 올리기 — DB 단계.
-- 새 표 2개와 서버 전용 읽기 함수 1개만 만든다. 기존 표·정책·권한·자료는 바꾸지 않는다.
--  1) app_todo_ask_rooms: 단체방 '다들 ~해 주세요' 같은 전체 부탁도 챙길 것으로 올릴 예외 방(사람별, 설정에서 더하고 뺌).
--     방은 이름이 아니라 방 열쇠(room_key, app_feed_rooms와 같은 값)로 저장한다. 화면은 app_feed_rooms의 이름을 보여 준다.
--  2) app_todo_not_mine: 후보 줄 메뉴 [내 일 아님]을 누른 기록(출처 종류 + 한 줄 요약). 다음 판단 때 비슷한 것을 거르는 예시로만 쓴다.
--     후보 표(app_todo_candidates)와 따로 둔다: 처리한 후보는 30일 뒤 정리되지만 이 예시는 남아야 하고, 후보 표 권한을 넓히지 않기 위해서다.
--  3) app_todo_ask_filter(p_workspace, p_room_key) -> jsonb {group_room: bool, not_mine: [요약 …최근 20개]}
--     텔레그램 서버(collector-feed, service_role)가 그 방이 예외 방인지와 [내 일 아님] 예시를 읽는다. 읽기만 한다.
--     새 표에 service_role 권한을 주지 않고 이 함수만 연다(SECURITY DEFINER, 빈 search_path, 실행권 service_role만).
-- 권한: 두 표 모두 작업공간 소유자(private.app_is_workspace_owner)만, 정책 하나씩. authenticated = 읽기·넣기(정한 칸만)·지우기, 고치기 없음.
--   anon·PUBLIC·service_role 표 권한 없음.
-- 짝: docs/20261029210000_todo_mine_only.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
-- 안 하는 것: 기존 표(app_todo_candidates·app_feed_rooms 등) 칸·권한·정책 변경, 기존 후보 줄 변경, rtw_* 객체.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261029210000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_todo_candidates') is null
     or to_regclass('public.app_todo_ask_rooms') is not null
     or to_regclass('public.app_todo_not_mine') is not null
     or to_regprocedure('public.app_todo_ask_filter(uuid,text)') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'TODO_MINE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_todo_ask_rooms (
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  room_key text not null,
  created_at timestamptz not null default now(),
  constraint app_todo_ask_rooms_pkey primary key (workspace_id, room_key),
  constraint app_todo_ask_rooms_key_check check (room_key ~ '^[A-Za-z0-9_.:-]{1,100}$')
);

create table public.app_todo_not_mine (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  source_kind text not null,
  summary text not null,
  created_at timestamptz not null default now(),
  constraint app_todo_not_mine_source_check check (
    source_kind in ('basket', 'note', 'work', 'meeting', 'org_update', 'project_update', 'telegram')),
  constraint app_todo_not_mine_summary_check check (
    char_length(btrim(summary)) between 1 and 100 and summary !~ '[[:cntrl:]]')
);
create index app_todo_not_mine_ws_idx on public.app_todo_not_mine(workspace_id, created_at desc);

alter table public.app_todo_ask_rooms enable row level security;
alter table public.app_todo_not_mine enable row level security;
revoke all on table public.app_todo_ask_rooms from public, anon, authenticated, service_role;
revoke all on table public.app_todo_not_mine from public, anon, authenticated, service_role;

grant select, delete on table public.app_todo_ask_rooms to authenticated;
grant insert (workspace_id, room_key) on table public.app_todo_ask_rooms to authenticated;
grant select, delete on table public.app_todo_not_mine to authenticated;
grant insert (workspace_id, source_kind, summary) on table public.app_todo_not_mine to authenticated;

create policy todo_ask_rooms_owner_all on public.app_todo_ask_rooms for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));
create policy todo_not_mine_owner_all on public.app_todo_not_mine for all to authenticated
  using (private.app_is_workspace_owner(workspace_id))
  with check (private.app_is_workspace_owner(workspace_id));

create function public.app_todo_ask_filter(p_workspace uuid, p_room_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_workspace is null or p_room_key is null or p_room_key !~ '^[A-Za-z0-9_.:-]{1,100}$' then
    raise exception using errcode = '22023', message = 'TODO_MINE_ARGS';
  end if;
  return pg_catalog.jsonb_build_object(
    'group_room', exists (select 1 from public.app_todo_ask_rooms r where r.workspace_id = p_workspace and r.room_key = p_room_key),
    'not_mine', coalesce((select pg_catalog.jsonb_agg(n.summary order by n.created_at desc)
      from (select m.summary, m.created_at from public.app_todo_not_mine m
            where m.workspace_id = p_workspace order by m.created_at desc limit 20) n), '[]'::jsonb));
end
$$;

revoke all on function public.app_todo_ask_filter(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_todo_ask_filter(uuid, text) to service_role;

-- 사후 확인: 두 표 RLS 켜짐·authenticated 정책 하나씩, anon·service_role 표 권한 없음, 고치기 없음,
-- 함수는 DEFINER·빈 search_path·service_role만 실행. 다르면 전체 취소.
do $$
declare a regclass := 'public.app_todo_ask_rooms'::regclass; n regclass := 'public.app_todo_not_mine'::regclass;
begin
  if (select count(*) from pg_class where oid in (a, n) and relrowsecurity) <> 2
     or exists (select 1 from pg_class where oid in (a, n) and relacl::text ~ '(^|[{,])(anon|service_role)?=')
     or exists (select 1 from pg_attribute where attrelid in (a, n) and attacl::text ~ '(^|[{,])(anon|service_role)?=')
     or has_table_privilege('anon', a, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('anon', n, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', a, 'select,insert,update,delete,truncate,references,trigger')
     or has_table_privilege('service_role', n, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('service_role', a, 'select,insert,update,references')
     or has_any_column_privilege('service_role', n, 'select,insert,update,references')
     or not has_table_privilege('authenticated', a, 'select,delete')
     or not has_table_privilege('authenticated', n, 'select,delete')
     or has_table_privilege('authenticated', a, 'insert,update,truncate,references,trigger')
     or has_table_privilege('authenticated', n, 'insert,update,truncate,references,trigger')
     or has_any_column_privilege('authenticated', a, 'update')
     or has_any_column_privilege('authenticated', n, 'update')
     or not has_column_privilege('authenticated', a, 'room_key', 'insert')
     or has_column_privilege('authenticated', a, 'created_at', 'insert')
     or not has_column_privilege('authenticated', n, 'summary', 'insert')
     or has_column_privilege('authenticated', n, 'id', 'insert')
     or (select count(*) from pg_policy where polrelid = a) <> 1
     or (select count(*) from pg_policy where polrelid = n) <> 1
     or exists (select 1 from pg_policy where polrelid in (a, n) and not (polroles = array[to_regrole('authenticated')::oid]))
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_todo_ask_filter(uuid,text)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('service_role', 'public.app_todo_ask_filter(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.app_todo_ask_filter(uuid,text)', 'execute')
     or has_function_privilege('authenticated', 'public.app_todo_ask_filter(uuid,text)', 'execute') then
    raise exception 'TODO_MINE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261029210000', 'todo_mine_only', array['TODO-mine-only: app_todo_ask_rooms + app_todo_not_mine (owner RLS, no update, no anon/PUBLIC/service_role table privilege) + SECURITY DEFINER read function app_todo_ask_filter (empty search_path, service_role execute only)']);
commit;
