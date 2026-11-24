begin;
-- ORG-기록자료폴더(명진 11/24 "앞으로 조직관리에서 각 조직 기록 자료 추가하면 궤도 조직 각 조직 폴더에 저장").
-- 담당조직 기록에 붙여 올린 자료를 자료실 '모으는 폴더(부모) › 그 조직 폴더'에 넣는다. 폴더 이름·경로는 코드·DB에 박지 않는다.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 무엇:
--  1) public.app_profiles.org_files_folder uuid 칸 하나(사람마다 모으는 부모 폴더, 비어 있음 = 아직 안 정함). 받는 폴더(20261111181000)와 같은 모양:
--     폴더 표를 가리키고 폴더가 실제로 지워지면 저절로 비워진다(on delete set null). 화면은 내 프로필 행의 이 칸만 PATCH한다
--     (task12a owner 정책·기존 표 UPDATE 권한 그대로, 새 권한 없음). 이 칸은 화면이 폴더를 고르는 데만 쓰고 서버 권한 판단에 쓰지 않는다.
--  2) public.app_library_folders.organization_id uuid 칸 하나(그 폴더와 짝인 담당조직, 이름이 아니라 id로 기억 — 조직·폴더 이름을 바꿔도 짝 유지).
--     담당조직 행이 실제로 지워지면 저절로 비워진다(on delete set null). 한 작업공간에서 조직 하나는 폴더 하나와만 짝(부분 unique index).
--  3) 새 함수 1개(SECURITY DEFINER, 빈 search_path, PUBLIC·anon·service_role 실행권 없음, authenticated만):
--     public.app_library_folder_set_org(p_id uuid, p_org uuid) -> jsonb {ok, id, organization_id}
--     - 폴더의 작업공간을 서버가 폴더 줄에서 읽고 private.app_is_workspace_owner(그 작업공간)일 때만, 휴지통이 아닌 폴더만.
--     - p_org가 있으면 그 조직이 같은 작업공간·휴지통 아님일 때만(남의 작업공간 조직 — 공유로 보이는 조직 포함 — 은 거절). 같은 조직의 다른 폴더 짝은 푼다.
--     - 남의 것·없는 폴더·남의 조직은 같은 오류(LIBRARY_FOLDER_ORG_FORBIDDEN), 인자가 비면 LIBRARY_FOLDER_ORG_ARGS.
-- 안 하는 것: 기존 정책·표 권한·트리거·함수 변경, 기존 줄 내용 변경, anon·PUBLIC 권한, RLS 약화, rtw_* 객체.
-- 읽기: 두 표 모두 표 단위 select(authenticated)가 이미 있어 새 칸도 owner 정책으로만 읽힌다.
-- 앞 단계: 20261124100000_library_folder_drive(같은 표·같은 함수 모양), 20261111181000_library_receive_folder(같은 프로필 칸 모양).
-- 짝: docs/20261124160000_library_org_folder.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261124160000')
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261124100000' and name = 'library_folder_drive') <> 1
     or (select count(*) from supabase_migrations.schema_migrations where version = '20261111181000' and name = 'library_receive_folder') <> 1
     or to_regclass('public.app_library_folders') is null
     or to_regclass('public.app_suborganizations') is null
     or to_regclass('public.app_profiles') is null
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_library_folders') and not attisdropped
           and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname = 'deleted_at' and atttypid = 'timestamptz'::regtype))) <> 3
     or (select count(*) from pg_attribute where attrelid = to_regclass('public.app_suborganizations') and not attisdropped
           and ((attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) or (attname = 'deleted_at' and atttypid = 'timestamptz'::regtype))) <> 3
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_library_folders') and attname = 'organization_id' and not attisdropped)
     or exists (select 1 from pg_attribute where attrelid = to_regclass('public.app_profiles') and attname = 'org_files_folder' and not attisdropped)
     or to_regclass('public.app_library_folders_org_idx') is not null
     or to_regclass('public.app_profiles_org_files_folder_idx') is not null
     or to_regprocedure('public.app_library_folder_set_org(uuid,uuid)') is not null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef)
     or exists (select 1 from pg_class where oid in (to_regclass('public.app_library_folders'), to_regclass('public.app_profiles'), to_regclass('public.app_suborganizations'))
           and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or not exists (select 1 from pg_class where oid = to_regclass('public.app_profiles') and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then
    raise exception 'LIBRARY_ORG_FOLDER_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 모으는 부모 폴더(사람마다).
alter table public.app_profiles
  add column org_files_folder uuid,
  add constraint app_profiles_org_files_folder_fkey foreign key (org_files_folder)
    references public.app_library_folders(id) on delete set null;
create index app_profiles_org_files_folder_idx on public.app_profiles(org_files_folder)
  where org_files_folder is not null;

-- 2) 폴더 ↔ 담당조직 짝.
alter table public.app_library_folders
  add column organization_id uuid,
  add constraint app_library_folders_organization_fkey foreign key (organization_id)
    references public.app_suborganizations(id) on delete set null;
create unique index app_library_folders_org_idx on public.app_library_folders (workspace_id, organization_id)
  where organization_id is not null;

-- 3) 짝짓기 함수(내 작업공간 폴더·조직만).
create function public.app_library_folder_set_org(p_id uuid, p_org uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ws uuid;
  org_ws uuid;
begin
  if p_id is null then
    raise exception using errcode = '22023', message = 'LIBRARY_FOLDER_ORG_ARGS';
  end if;
  select f.workspace_id into ws from public.app_library_folders f where f.id = p_id and f.deleted_at is null for update;
  if ws is null or not private.app_is_workspace_owner(ws) then
    raise exception using errcode = '42501', message = 'LIBRARY_FOLDER_ORG_FORBIDDEN';
  end if;
  if p_org is not null then
    select o.workspace_id into org_ws from public.app_suborganizations o where o.id = p_org and o.deleted_at is null;
    if org_ws is null or org_ws <> ws then
      raise exception using errcode = '42501', message = 'LIBRARY_FOLDER_ORG_FORBIDDEN';
    end if;
    update public.app_library_folders o set organization_id = null
     where o.workspace_id = ws and o.organization_id = p_org and o.id <> p_id;
  end if;
  update public.app_library_folders f set organization_id = p_org where f.id = p_id and f.workspace_id = ws;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id, 'organization_id', p_org);
end
$$;

revoke all on function public.app_library_folder_set_org(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.app_library_folder_set_org(uuid, uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_attribute where attrelid = 'public.app_library_folders'::regclass and attname = 'organization_id' and not attisdropped
                   and atttypid = 'uuid'::regtype and not attnotnull)
     or not exists (select 1 from pg_attribute where attrelid = 'public.app_profiles'::regclass and attname = 'org_files_folder' and not attisdropped
                   and atttypid = 'uuid'::regtype and not attnotnull)
     or (select count(*) from pg_constraint where conrelid = 'public.app_library_folders'::regclass and conname = 'app_library_folders_organization_fkey' and contype = 'f' and confdeltype = 'n') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_org_files_folder_fkey' and contype = 'f' and confdeltype = 'n') <> 1
     or not exists (select 1 from pg_index i where i.indexrelid = to_regclass('public.app_library_folders_org_idx') and i.indisunique)
     or to_regclass('public.app_profiles_org_files_folder_idx') is null
     or not exists (select 1 from pg_proc where oid = to_regprocedure('public.app_library_folder_set_org(uuid,uuid)')
         and prosecdef and proconfig = array['search_path=""'] and coalesce(proacl::text, '') !~ '(^|[{,])=')
     or not has_function_privilege('authenticated', 'public.app_library_folder_set_org(uuid,uuid)', 'execute')
     or has_function_privilege('anon', 'public.app_library_folder_set_org(uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'public.app_library_folder_set_org(uuid,uuid)', 'execute')
     or has_any_column_privilege('anon', 'public.app_library_folders'::regclass, 'select,insert,update,references')
     or has_any_column_privilege('anon', 'public.app_profiles'::regclass, 'select,insert,update,references')
     or has_column_privilege('authenticated', 'public.app_library_folders'::regclass, 'organization_id', 'insert,update')
     or exists (select 1 from pg_class where oid in ('public.app_library_folders'::regclass, 'public.app_profiles'::regclass) and not relrowsecurity) then
    raise exception 'LIBRARY_ORG_FOLDER_POSTCONDITION_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261124160000', 'library_org_folder', array['ORG-기록자료폴더: app_profiles adds nullable uuid org_files_folder (fk app_library_folders on delete set null, partial index); app_library_folders adds nullable uuid organization_id (fk app_suborganizations on delete set null, partial unique index app_library_folders_org_idx on workspace_id+organization_id); SECURITY DEFINER function app_library_folder_set_org(uuid,uuid) (empty search_path, authenticated execute only, owner of the folder workspace only, organization of the same workspace only, sets organization_id only); no policy, table grant, trigger or RLS change']);
commit;
