begin;
-- S59-11 LIB-받는폴더 (요청함 11/11 15:03, 명진 "잡동사니 시안 ㄱ", 시안 docs/design/mockups/lib-receive-folder.html #2396).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 자료실 폴더 하나를 '받는 폴더'로 켜 두면, 폴더를 정하지 않고 자료실에 들어오는 새 자료가 저절로 그 폴더에 들어간다.
--  1) app_profiles.library_receive_folder uuid 칸 하나(비어 있음 = 꺼짐, 기존 행은 그대로 null). 받는 폴더는 사람마다 하나뿐이다.
--     폴더 표(app_library_folders.id)를 가리키고, 폴더가 실제로 지워지면(휴지통 영구 삭제·작업공간 삭제) 저절로 비워진다(on delete set null).
--     화면은 기존 내 프로필 저장처럼 내 행의 이 칸만 PATCH한다(task12a owner 정책·표 UPDATE 권한 그대로, 새 권한 없음).
--     library_view(JSON 한 칸 통째 쓰기)에 넣지 않은 까닭: 그 칸은 화면이 묶기·칩을 바꿀 때마다 통째로 다시 쓰므로, 다른 기기에서 켠 받는 폴더를
--     옛 값으로 덮어 지울 수 있다. 칸을 따로 두면 이 값만 쓰고 읽는다(어느 기기에서나 같음).
--  2) 넣기 뒤 트리거 app_documents_receive_folder(app_documents, after insert, 행마다): 새 자료 행이 생기면 그 작업공간 owner의
--     받는 폴더를 서버에서 다시 찾아, 그 폴더가 같은 작업공간 것이고 휴지통에 없을 때만 자료 연결 한 줄(app_library_folder_items)을 넣는다.
--     화면이 보낸 폴더 id를 믿지 않는다: 프로필 칸 값이 다른 작업공간 폴더·휴지통 폴더·없는 폴더면 아무것도 하지 않는다(지금처럼 '폴더 밖').
--     자료실로 들어오는 모든 길(자료 등록 창·화면에 끌어 놓기·[파일]에서 보내기·잊지 말기 첨부 보내기·HWP 새 파일로 저장·주간보고 확정본·
--     회의·사업 보고 자료·녹음 파일·폰 앱 올리기)이 자료 행 하나를 만들므로 한곳에서 빠짐없이 받는다. Edge Function·화면 길마다 고치지 않는다.
--     폴더를 열고 올리거나 폴더 줄에 놓은 자료는 화면이 그 뒤 기존 owner RLS로 연결 줄을 그 폴더로 고친다(지금처럼 그 폴더).
--     같은 문장 안에서 이미 연결이 있으면 건드리지 않는다(on conflict do nothing). 폴더가 그 사이 영구 삭제되면(외래 키 거절) 연결 없이 넘어간다.
-- 권한: 트리거 함수는 private 스키마, security definer(서버 키·로그인 사용자 어느 쪽이 자료를 넣어도 폴더 연결 표에 쓸 수 있어야 함 —
--   폴더 표들은 service_role 권한이 없다), search_path 빈칸, 본문은 public 표만 직접 읽고 쓴다(private 함수 호출 없음 →
--   service_role의 schema private 이름 해석 문제 없음, 20261024210000 참고). 실행 권한은 모두 걷는다(public·anon·authenticated·service_role).
--   표 grant·정책·RLS 변경 없음, anon·PUBLIC 권한 없음. 기존 자료 행·폴더 연결 행은 바꾸지 않는다('폴더 밖' 자료 한 번에 옮기기는 명진이 화면에서).
-- 짝: docs/20261111181000_library_receive_folder.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_profiles in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록·칸·함수·트리거·색인 없음, 앞선 기록(폴더 휴지통) 있음,
-- 폴더·연결·자료 표 모양, app_profiles RLS 켜짐·anon/PUBLIC 없음·authenticated 표 UPDATE 있음·task12a 정책 두 개 그대로.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261111181000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261025180000' and name = 'trash_library_folder_db') <> 1
     or to_regclass('public.app_library_folders') is null
     or to_regclass('public.app_library_folder_items') is null
     or to_regclass('public.app_documents') is null
     or to_regclass('public.app_workspace_members') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_library_folders'::regclass and attnum > 0 and not attisdropped
           and ((attname = 'id' and atttypid = 'uuid'::regtype) or (attname = 'workspace_id' and atttypid = 'uuid'::regtype)
             or (attname = 'deleted_at' and atttypid = 'timestamptz'::regtype))) <> 3
     or (select count(*) from pg_attribute where attrelid = 'public.app_library_folder_items'::regclass and attnum > 0 and not attisdropped
           and attname in ('document_id', 'folder_id', 'workspace_id') and atttypid = 'uuid'::regtype) <> 3
     or not exists (select 1 from pg_constraint where conrelid = 'public.app_library_folder_items'::regclass and contype = 'p'
           and pg_get_constraintdef(oid) = 'PRIMARY KEY (document_id)')
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and attnum > 0 and not attisdropped
           and attname in ('id', 'workspace_id') and atttypid = 'uuid'::regtype) <> 2
     or (select count(*) from pg_attribute where attrelid = 'public.app_workspace_members'::regclass and attnum > 0 and not attisdropped
           and ((attname in ('workspace_id', 'user_id') and atttypid = 'uuid'::regtype) or (attname = 'role' and atttypid = 'text'::regtype))) <> 3
     or (select count(*) from pg_attribute where attrelid = 'public.app_profiles'::regclass and attnum > 0 and not attisdropped
           and attname = 'user_id' and atttypid = 'uuid'::regtype) <> 1
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_profiles'::regclass and not attisdropped and attname = 'library_receive_folder')
     or exists (select 1 from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_library_receive_folder_fkey')
     or to_regclass('public.app_profiles_library_receive_folder_idx') is not null
     or to_regprocedure('private.app_documents_receive_folder()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_documents'::regclass and tgname = 'app_documents_receive_folder')
     -- app_profiles: RLS 켜짐, anon·PUBLIC 표 권한 없음, authenticated 표 UPDATE 권한이 이미 있음(새 칸에 따로 권한을 주지 않는다).
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or not exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_owner_all'
           and permissive = 'PERMISSIVE' and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_profiles' and policyname = 'task12a_profile_self_select'
           and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) <> 1
     -- 폴더·연결·자료 표: RLS 켜짐, anon·PUBLIC 권한 없음.
     or exists (select 1 from pg_class where oid in ('public.app_library_folders'::regclass, 'public.app_library_folder_items'::regclass,
           'public.app_documents'::regclass) and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?=')) then
    raise exception 'LIBRARY_RECEIVE_FOLDER_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 받는 폴더 칸. 비어 있으면(null) 꺼짐. 폴더가 실제로 지워지면 저절로 비워진다.
alter table public.app_profiles
  add column library_receive_folder uuid,
  add constraint app_profiles_library_receive_folder_fkey foreign key (library_receive_folder)
    references public.app_library_folders(id) on delete set null;
-- 폴더를 지울 때 외래 키가 이 칸을 찾는 색인(켠 사람만).
create index app_profiles_library_receive_folder_idx on public.app_profiles(library_receive_folder)
  where library_receive_folder is not null;

-- 2) 새 자료 → 받는 폴더. 같은 작업공간·휴지통 아님을 서버가 다시 확인한다. 아무것도 맞지 않으면 그대로(폴더 밖).
create function private.app_documents_receive_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $receive$
declare
  v_folder uuid;
begin
  select f.id into v_folder
    from public.app_workspace_members m
    join public.app_profiles p on p.user_id = m.user_id
    join public.app_library_folders f on f.id = p.library_receive_folder
   where m.workspace_id = new.workspace_id
     and m.role = 'owner'
     and f.workspace_id = new.workspace_id
     and f.deleted_at is null
   order by m.user_id
   limit 1;
  if v_folder is null then
    return null;
  end if;
  begin
    insert into public.app_library_folder_items (document_id, folder_id, workspace_id)
    values (new.id, v_folder, new.workspace_id)
    on conflict (document_id) do nothing;
  exception when foreign_key_violation then
    -- 찾은 뒤 그 폴더가 영구 삭제됐으면 연결 없이 넘어간다(자료는 '폴더 밖'). 자료 넣기는 막지 않는다.
    return null;
  end;
  return null;
end
$receive$;
revoke all on function private.app_documents_receive_folder() from public, anon, authenticated, service_role;

create trigger app_documents_receive_folder
after insert on public.app_documents
for each row execute function private.app_documents_receive_folder();

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 2개), 새 칸·외래 키·색인·함수(definer, 실행권 없음)·트리거가 하나씩. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_profiles'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_profiles'::regclass) <> 2
     or (select count(*) from pg_attribute where attrelid = 'public.app_profiles'::regclass and not attisdropped
           and attname = 'library_receive_folder' and atttypid = 'uuid'::regtype and not attnotnull) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_profiles'::regclass and conname = 'app_profiles_library_receive_folder_fkey'
           and contype = 'f' and confrelid = 'public.app_library_folders'::regclass and confdeltype = 'n' and convalidated) <> 1
     or to_regclass('public.app_profiles_library_receive_folder_idx') is null
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_documents_receive_folder()')
           and prosecdef and proconfig = array['search_path=""']
           and not has_function_privilege('anon', oid, 'execute')
           and not has_function_privilege('authenticated', oid, 'execute')
           and not has_function_privilege('service_role', oid, 'execute')) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_documents'::regclass and tgname = 'app_documents_receive_folder'
           and tgenabled = 'O' and tgfoid = to_regprocedure('private.app_documents_receive_folder()')) <> 1 then
    raise exception 'LIBRARY_RECEIVE_FOLDER_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261111181000', 'library_receive_folder', array['LIB-받는폴더: app_profiles.library_receive_folder uuid (FK app_library_folders on delete set null, partial index) + after-insert trigger on app_documents filing a new document into the owner''s receive folder when it is in the same workspace and not in the trash (definer, search_path empty, execute revoked); no grants, policies or RLS change']);
commit;
