begin;
-- S69-20 ③ 자료실 앱 폴더 = 구글 드라이브 폴더(명진 11/24 08:48 "ㄱ 폴더도").
-- 앱 폴더마다 짝 드라이브 폴더 id 한 칸을 서버에 남긴다. 서버(Edge workspace-drive)가 로그인한 본인 토큰으로 이 칸을 읽고,
-- 아래 함수로만 적는다(표 권한을 넓히지 않음 — service_role에는 이 표 권한이 없고, authenticated도 이 칸을 직접 쓰지 못한다).
-- 무엇:
--  1) public.app_library_folders에 칸 1개: drive_folder_id text null, 검사 app_library_folders_drive_folder_check(null 또는 드라이브 id 모양 10~200자 영문·숫자·_-).
--     한 작업공간에서 드라이브 폴더 하나는 앱 폴더 하나와만 짝(부분 unique index app_library_folders_drive_folder_idx). 기존 줄은 null로 시작한다.
--  2) 새 함수 1개(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--     public.app_library_folder_set_drive(p_id uuid, p_drive text, p_expect text) -> jsonb {ok, id, drive_folder_id, [taken]}
--     - 폴더의 작업공간을 서버가 폴더 줄에서 읽고 private.app_is_workspace_owner(그 작업공간)일 때만, 휴지통이 아닌 폴더만.
--     - 지금 값이 p_expect와 다르면 바꾸지 않고 ok:false(두 요청이 겹쳐도 덮어쓰지 않음). 같은 작업공간 다른 폴더가 이미 그 드라이브 폴더와 짝이면 ok:false, taken:true.
--     - 남의 것·없는 폴더는 같은 오류(LIBRARY_FOLDER_DRIVE_FORBIDDEN), 모양이 틀리면 LIBRARY_FOLDER_DRIVE_ARGS.
-- 안 하는 것: 기존 정책·표 권한·트리거·함수 변경, 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 읽기: 표 단위 select(authenticated)가 이미 있어 새 칸도 owner 정책으로만 읽힌다(휴지통 폴더는 지금처럼 숨음).
-- 앞 단계: 20261104213000_library_folder_color(같은 표·같은 함수 모양).
-- 짝: docs/20261124100000_library_folder_drive.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124100000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261104213000' and name = 'library_folder_color') <> 1
     or to_regclass('public.app_library_folders') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'deleted_at' and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'drive_folder_id' and not attisdropped)
     or to_regclass('public.app_library_folders_drive_folder_idx') is not null
     or to_regprocedure('public.app_library_folder_set_drive(uuid,text,text)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_library_folders') and relrowsecurity)
     or exists (select 1 from pg_class where oid = to_regclass('public.app_library_folders') and relacl::text ~ '(^|[{,])(anon)?=') then
    raise exception 'LIBRARY_FOLDER_DRIVE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_library_folders add column drive_folder_id text;
alter table public.app_library_folders add constraint app_library_folders_drive_folder_check check (drive_folder_id is null or drive_folder_id ~ '^[A-Za-z0-9_-]{10,200}$');
create unique index app_library_folders_drive_folder_idx on public.app_library_folders (workspace_id, drive_folder_id) where drive_folder_id is not null;

create function public.app_library_folder_set_drive(p_id uuid, p_drive text, p_expect text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
  cur text;
begin
  if p_id is null
     or (p_drive is not null and p_drive !~ '^[A-Za-z0-9_-]{10,200}$')
     or (p_expect is not null and p_expect !~ '^[A-Za-z0-9_-]{10,200}$') then
    raise exception using errcode = '22023', message = 'LIBRARY_FOLDER_DRIVE_ARGS';
  end if;
  select f.workspace_id, f.drive_folder_id into ws, cur from public.app_library_folders f where f.id = p_id and f.deleted_at is null for update;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = '42501', message = 'LIBRARY_FOLDER_DRIVE_FORBIDDEN';
  end if;
  if cur is distinct from p_expect then
    return pg_catalog.jsonb_build_object('ok', false, 'id', p_id, 'drive_folder_id', cur);
  end if;
  if p_drive is not null and exists (select 1 from public.app_library_folders o where o.workspace_id = ws and o.drive_folder_id = p_drive and o.id <> p_id) then
    return pg_catalog.jsonb_build_object('ok', false, 'id', p_id, 'drive_folder_id', cur, 'taken', true);
  end if;
  update public.app_library_folders f set drive_folder_id = p_drive where f.id = p_id and f.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'drive_folder_id', p_drive);
end
$$;

revoke all on function public.app_library_folder_set_drive(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.app_library_folder_set_drive(uuid, text, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_library_folders'::regclass and attname = 'drive_folder_id' and not attisdropped
                   and atttypid = 'text'::regtype and not attnotnull)
     or (select count(*) from pg_constraint where conrelid = 'public.app_library_folders'::regclass and conname = 'app_library_folders_drive_folder_check' and contype = 'c' and convalidated) <> 1
     or to_regclass('public.app_library_folders_drive_folder_idx') is null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_library_folder_set_drive(uuid,text,text)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_library_folder_set_drive(uuid,text,text)', 'execute')
     or has_function_privilege('anon', 'public.app_library_folder_set_drive(uuid,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.app_library_folder_set_drive(uuid,text,text)', 'execute')
     or has_any_column_privilege('anon', 'public.app_library_folders'::regclass, 'select,insert,update,references')
     or has_column_privilege('authenticated', 'public.app_library_folders'::regclass, 'drive_folder_id', 'insert,update') then
    raise exception 'LIBRARY_FOLDER_DRIVE_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124100000', 'library_folder_drive', array['S69-20: app_library_folders adds nullable text drive_folder_id (Drive id shape check app_library_folders_drive_folder_check, partial unique index app_library_folders_drive_folder_idx on workspace_id+drive_folder_id); SECURITY DEFINER function app_library_folder_set_drive(uuid,text,text) (empty search_path, authenticated execute only, owner of the folder workspace only, compare-and-set of drive_folder_id only); no policy, table grant, trigger or RLS change']);
commit;
