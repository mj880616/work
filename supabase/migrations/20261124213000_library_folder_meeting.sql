begin;
-- MTG-정기회의자료폴더(명진 11/24 21:03 "자료실 폴더 이름 중 회의 폴더 이름이 정기 회의 폴더 이름과 같고 매칭이 되어서.
--   저기에 회의자료 등을 올리면 저 폴더로 자동으로 가게").
-- 정기 회의 이름 하나 ↔ 자료실 폴더 하나를 서버에 기억한다. 짝은 폴더 줄에 회의명 열쇠(띄어쓰기 없이·소문자, app/meeting-name-sorts.mjs nameKey)로 남긴다.
-- 회의명·폴더 이름은 코드·DB에 박지 않는다. 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 무엇:
--  1) public.app_library_folders.meeting_key text 칸 하나(그 폴더와 짝인 회의명 열쇠, 비어 있음 = 짝 없음).
--     검사 app_library_folders_meeting_key_check: null 또는 1~100자, 띄어쓰기·제어문자·쉼표 없음(회의명 정리 값의 열쇠 규칙과 같음).
--     한 작업공간에서 회의명 하나는 폴더 하나와만 짝(부분 unique index app_library_folders_meeting_key_idx). 기존 줄은 null로 시작한다.
--  2) 새 함수 1개(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--     public.app_library_folder_set_meeting(p_id uuid, p_key text) -> jsonb {ok, id, meeting_key}
--     - 폴더의 작업공간을 서버가 폴더 줄에서 읽고 private.app_is_workspace_owner(그 작업공간)일 때만, 휴지통이 아닌 폴더만.
--     - p_key가 있으면 같은 작업공간에서 그 열쇠를 가진 다른 폴더(휴지통 포함)의 짝은 푼다. p_key가 null이면 이 폴더의 짝을 푼다.
--     - 남의 것·없는 폴더는 같은 오류(LIBRARY_FOLDER_MEETING_FORBIDDEN), 인자·모양이 틀리면 LIBRARY_FOLDER_MEETING_ARGS.
-- 안 하는 것: 기존 정책·표 권한·트리거·함수 변경, 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 읽기: 표 단위 select(authenticated)가 이미 있어 새 칸도 owner 정책으로만 읽힌다. authenticated는 이 칸을 직접 쓰지 못한다(칸 단위 권한 그대로).
-- 앞 단계: 20261124100000_library_folder_drive(같은 표·같은 함수 모양).
-- 짝: docs/20261124213000_library_folder_meeting.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124213000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261124100000' and name = 'library_folder_drive') <> 1
     or to_regclass('public.app_library_folders') is null
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_library_folders') and not attisdropped
           and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname = 'deleted_at' and atttypid = 'timestamptz'::regtype))) <> 3
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'meeting_key' and not attisdropped)
     or to_regclass('public.app_library_folders_meeting_key_idx') is not null
     or to_regprocedure('public.app_library_folder_set_meeting(uuid,text)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_library_folders') and relrowsecurity)
     or exists (select 1 from pg_class where oid = to_regclass('public.app_library_folders') and relacl::text ~ '(^|[{,])(anon)?=') then
    raise exception 'LIBRARY_FOLDER_MEETING_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 폴더 ↔ 회의명 짝.
alter table public.app_library_folders add column meeting_key text;
alter table public.app_library_folders add constraint app_library_folders_meeting_key_check
  check (meeting_key is null or (char_length(meeting_key) between 1 and 100 and meeting_key !~ '[[:space:][:cntrl:],]'));
create unique index app_library_folders_meeting_key_idx on public.app_library_folders (workspace_id, meeting_key)
  where meeting_key is not null;

-- 2) 짝짓기 함수(내 작업공간 폴더만).
create function public.app_library_folder_set_meeting(p_id uuid, p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if p_id is null
     or (p_key is not null and (char_length(p_key) < 1 or char_length(p_key) > 100 or p_key ~ '[[:space:][:cntrl:],]')) then
    raise exception using errcode = '22023', message = 'LIBRARY_FOLDER_MEETING_ARGS';
  end if;
  select f.workspace_id into ws from public.app_library_folders f where f.id = p_id and f.deleted_at is null for update;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = '42501', message = 'LIBRARY_FOLDER_MEETING_FORBIDDEN';
  end if;
  if p_key is not null then
    update public.app_library_folders o set meeting_key = null
     where o.workspace_id = ws and o.meeting_key = p_key and o.id <> p_id;
  end if;
  update public.app_library_folders f set meeting_key = p_key where f.id = p_id and f.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'meeting_key', p_key);
end
$$;

revoke all on function public.app_library_folder_set_meeting(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.app_library_folder_set_meeting(uuid, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_library_folders'::regclass and attname = 'meeting_key' and not attisdropped
                   and atttypid = 'text'::regtype and not attnotnull)
     or (select count(*) from pg_constraint where conrelid = 'public.app_library_folders'::regclass and conname = 'app_library_folders_meeting_key_check' and contype = 'c') <> 1
     or not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.app_library_folders_meeting_key_idx') and i.indisunique)
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_library_folder_set_meeting(uuid,text)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_library_folder_set_meeting(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.app_library_folder_set_meeting(uuid,text)', 'execute')
     or has_function_privilege('service_role', 'public.app_library_folder_set_meeting(uuid,text)', 'execute')
     or has_any_column_privilege('anon', 'public.app_library_folders'::regclass, 'select,insert,update,references')
     or has_column_privilege('authenticated', 'public.app_library_folders'::regclass, 'meeting_key', 'insert,update')
     or exists (select 1 from pg_class where oid = 'public.app_library_folders'::regclass and not relrowsecurity) then
    raise exception 'LIBRARY_FOLDER_MEETING_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124213000', 'library_folder_meeting', array['MTG-정기회의자료폴더: app_library_folders adds nullable text meeting_key (check 1-100 chars without space, control or comma; partial unique index app_library_folders_meeting_key_idx on workspace_id+meeting_key); SECURITY DEFINER function app_library_folder_set_meeting(uuid,text) (empty search_path, authenticated execute only, owner of the folder workspace only, live folder only, sets meeting_key only and releases the same key on other folders of that workspace); no policy, table grant, trigger or RLS change']);
commit;
