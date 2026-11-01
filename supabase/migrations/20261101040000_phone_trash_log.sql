begin;
-- S47-16 PHOTO-폰지우기안전장치(요청함 10/31 22:52, 명진 "진행"): 사진 정리 [폰에서만 지우기]·[나머지 지우기]로 폰에서 지운 사진의 기록.
-- 다음 사진 확인 때 Edge onedrive-photos가 이 기록의 원드라이브 사본이 아직 있는지 다시 확인하고, 사라졌으면 화면이 경고 한 줄을 띄운다.
-- 적용은 docs/ops-db-workflow.md "승인 한 번 흐름"(승인형 DB workflow)으로만 한다.
--
--  app_phone_trash_log: 폰 사진 번호(phone_id, MediaStore 숫자)·사본 출처(source, 지금은 onedrive만)·사본 항목 id(copy_id)·지운 시각만.
--    사진 이름·내용·위치·크기는 넣지 않는다. gone_at = 서버가 사본이 사라진 것을 본 시각, seen_at = 경고를 확인한 시각.
--    넣기·고치기·지우기(60일 지난 행 정리)는 Edge onedrive-photos(service_role)만. 화면(authenticated)은 자기 작업공간 행 읽기만.
--
-- 권한: RLS 켬 + private.app_is_workspace_owner(workspace_id) 소유자 읽기 정책(authenticated만). anon·PUBLIC 권한 없음.
--   service_role: select·insert·update·delete 넷만.
-- 안 하는 것: 기존 표 권한·정책·함수 변경, 새 함수, 확장, 읽생기 표.
-- 짝: docs/20261101040000_phone_trash_log.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261101040000')
     or to_regclass('public.app_workspaces') is null
     or to_regclass('public.app_phone_trash_log') is not null
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'PHONE_TRASH_LOG_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

create table public.app_phone_trash_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.app_workspaces(id) on delete cascade,
  phone_id text not null,
  source text not null,
  copy_id text not null,
  trashed_at timestamptz not null default now(),
  gone_at timestamptz,
  seen_at timestamptz,
  constraint app_phone_trash_log_phone_check check (phone_id ~ '^[0-9]{1,18}$'),
  constraint app_phone_trash_log_source_check check (source in ('onedrive')),
  constraint app_phone_trash_log_copy_check check (copy_id ~ '^[A-Za-z0-9!_.-]{1,200}$'),
  constraint app_phone_trash_log_seen_check check (seen_at is null or gone_at is not null)
);
create index app_phone_trash_log_ws_idx on public.app_phone_trash_log(workspace_id, trashed_at desc);

alter table public.app_phone_trash_log enable row level security;
revoke all on table public.app_phone_trash_log from public, anon, authenticated, service_role;
grant select on table public.app_phone_trash_log to authenticated;
grant select, insert, update, delete on table public.app_phone_trash_log to service_role;

create policy phone_trash_log_owner_select on public.app_phone_trash_log for select to authenticated
  using (private.app_is_workspace_owner(workspace_id));

-- 사후 확인: RLS 켜짐·anon·PUBLIC 권한 없음·authenticated 읽기만·service_role 넷만·정책 1개(authenticated만). 다르면 전체 취소.
do $$
declare t regclass := 'public.app_phone_trash_log'::regclass;
begin
  if not (select relrowsecurity from pg_class where oid = t)
     or exists (select 1 from pg_class where oid = t and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_attribute where attrelid = t and attacl is not null)
     or has_table_privilege('anon', t, 'select,insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('anon', t, 'select,insert,update,references')
     or not has_table_privilege('authenticated', t, 'select')
     or has_table_privilege('authenticated', t, 'insert,update,delete,truncate,references,trigger')
     or has_any_column_privilege('authenticated', t, 'insert,update,references')
     or not has_table_privilege('service_role', t, 'select,insert,update,delete')
     or has_table_privilege('service_role', t, 'truncate,references,trigger')
     or (select count(*) from pg_policy where polrelid = t) <> 1
     or (select count(*) from pg_policy where polrelid = t and polcmd = 'r' and polroles = array['authenticated'::regrole]::oid[]) <> 1 then
    raise exception 'PHONE_TRASH_LOG_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261101040000', 'phone_trash_log', array['S47-16 PHOTO-폰지우기안전장치: app_phone_trash_log (phone id, copy source and id, trashed time only; owner read for authenticated, service_role writes)']);
commit;
