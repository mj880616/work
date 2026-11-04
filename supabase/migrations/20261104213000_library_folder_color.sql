begin;
-- FOLDER-순서·색 ③-1 DB (S49-47, 설계 docs/design/folder-color-order.md 2-1·4절, 명진 결정 11/04 16:19: 8색 그대로·안 고른 폴더는 지금 모양 그대로).
-- 자료실 폴더마다 색 번호 하나를 서버에 남긴다(폰·PC 같음, 기기 저장 없음). null = 안 고른 폴더(지금 모양 그대로).
-- 무엇:
--  1) public.app_library_folders에 칸 1개: color smallint null, 검사 app_library_folders_color_check = null 또는 1~8. 기존 줄은 null로 시작한다.
--  2) 새 함수 1개(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--     public.app_library_folder_set_color(p_id uuid, p_color smallint) -> jsonb {ok, id, color}
--     - 그 폴더의 작업공간을 서버가 폴더 줄에서 읽고 private.app_is_workspace_owner(그 작업공간)이 참일 때만 color 한 칸을 바꾼다(클라이언트가 보낸 주인·작업공간 값을 믿지 않음).
--     - 폴더가 없거나 내 것이 아니면 거절(LIBRARY_FOLDER_COLOR_FORBIDDEN, 없는 폴더인지 남의 것인지 구분해 알려 주지 않음). 번호가 null·1~8 밖이면 거절(LIBRARY_FOLDER_COLOR_ARGS).
-- 설계와 다른 점(한 줄): 설계 2-1은 'grant update (color)'였으나, 승인형 DB workflow 확장 규칙이 기존 표에 대한 권한 추가(grant-existing)를 거절하므로
--   표 권한을 넓히지 않고 owner 판정 함수 1개로 쓴다(정책·표 권한·RLS 변경 없음, 이름·상위·순서 쓰기 길은 그대로).
-- 안 하는 것: 기존 정책·표 권한·트리거·함수 변경, 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 읽기: 표 단위 select(authenticated)가 이미 있어 새 칸도 owner 정책으로만 읽힌다.
-- 순서는 이미 있는 sort_order 칸을 그대로 쓴다(DB 변경 없음). 휴지통에 간 폴더의 줄은 이 함수가 건드리지 않는다(deleted_at is null인 폴더만).
-- 짝: docs/20261104213000_library_folder_color.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261104213000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261022120000' and name = 'library_folders') <> 1
     or to_regclass('public.app_library_folders') is null
     or not exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'deleted_at' and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'color' and not attisdropped)
     or to_regprocedure('public.app_library_folder_set_color(uuid,smallint)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_library_folders') and relrowsecurity)
     or exists (select 1 from pg_class where oid = to_regclass('public.app_library_folders') and relacl::text ~ '(^|[{,])(anon)?=') then
    raise exception 'LIBRARY_FOLDER_COLOR_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_library_folders add column color smallint;
alter table public.app_library_folders add constraint app_library_folders_color_check check (color is null or color between 1 and 8);

create function public.app_library_folder_set_color(p_id uuid, p_color smallint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
begin
  if p_id is null or (p_color is not null and (p_color < 1 or p_color > 8)) then
    raise exception using errcode = '22023', message = 'LIBRARY_FOLDER_COLOR_ARGS';
  end if;
  select f.workspace_id into ws from public.app_library_folders f where f.id = p_id and f.deleted_at is null;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = '42501', message = 'LIBRARY_FOLDER_COLOR_FORBIDDEN';
  end if;
  update public.app_library_folders f set color = p_color where f.id = p_id and f.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'color', p_color);
end
$$;

revoke all on function public.app_library_folder_set_color(uuid, smallint) from public, anon, authenticated, service_role;
grant execute on function public.app_library_folder_set_color(uuid, smallint) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_library_folders'::regclass and attname = 'color' and not attisdropped
                   and atttypid = 'int2'::regtype and not attnotnull)
     or (select count(*) from pg_constraint where conrelid = 'public.app_library_folders'::regclass and conname = 'app_library_folders_color_check' and contype = 'c' and convalidated) <> 1
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_library_folder_set_color(uuid,smallint)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_library_folder_set_color(uuid,smallint)', 'execute')
     or has_function_privilege('anon', 'public.app_library_folder_set_color(uuid,smallint)', 'execute')
     or has_function_privilege('service_role', 'public.app_library_folder_set_color(uuid,smallint)', 'execute')
     or has_any_column_privilege('anon', 'public.app_library_folders'::regclass, 'select,insert,update,references')
     or has_column_privilege('authenticated', 'public.app_library_folders'::regclass, 'color', 'insert,update') then
    raise exception 'LIBRARY_FOLDER_COLOR_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261104213000', 'library_folder_color', array['FOLDER color 3-1: app_library_folders adds nullable smallint color (null or 1..8, check app_library_folders_color_check); SECURITY DEFINER function app_library_folder_set_color(uuid,smallint) (empty search_path, authenticated execute only, owner of the folder workspace only, changes color only); no policy, table grant, trigger or RLS change']);
commit;
