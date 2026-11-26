begin;
-- S70-73c LIB-드라이브위치따라가기(명진 11/26 10:47 자료실 '잡동사니' 파일을 드라이브에서 제자리 폴더로 옮김).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: 자료실 자료 연결 줄(app_library_folder_items)에 '마지막으로 폴더를 옮긴 시각' 칸 moved_at 하나를 더한다.
--  - 새 줄은 넣는 시각, 폴더(folder_id)가 바뀌면 그 시각을 서버(트리거)가 적는다. 화면·서버 키가 보낸 값은 쓰지 않는다(넣기·고치기 때 덮어씀).
--  - 기존 줄은 적용 시각으로 채워진다(그 뒤 30분 동안 드라이브 위치 따라가기가 쉰다 — 안전한 쪽).
--  - 쓰는 곳: library-files drive-auto(자료실을 열 때)가 드라이브에서 옮긴 등록 자료의 자료실 폴더를 따라 고칠 때, 앱에서 막 옮긴 자료
--    (S70-76 드라이브 맞추기가 아직 드라이브를 옮기기 전)는 건너뛰어 앱 값을 되돌리지 않는다. 칸이 없으면 그 따라가기만 쉰다(지금처럼).
-- 권한: 새 칸에 권한을 주지 않는다(authenticated의 이 표 넣기·고치기는 이미 칸 단위 — document_id·folder_id·workspace_id / folder_id만).
--   읽기는 기존 표 SELECT 권한 그대로. 트리거 함수는 private, security invoker, search_path 빈칸, 표를 읽거나 쓰지 않고 NEW 한 칸만 정한다.
--   실행 권한은 모두 걷는다. 정책·RLS·표 권한 변경 없음, 기존 자료·폴더 연결 값(folder_id 등) 변경 없음.
-- 짝: docs/20261126150000_library_item_moved_at.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_library_folder_items in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록·칸·함수·트리거 없음, 연결 표 모양, RLS 켜짐·anon/PUBLIC 없음,
-- authenticated 넣기·고치기가 칸 단위(표 단위 INSERT·UPDATE 없음), 정책 1개.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261126150000')
     or to_regclass('public.app_library_folder_items') is null
     or (select count(*) from pg_attribute where attrelid = 'public.app_library_folder_items'::regclass and attnum > 0 and not attisdropped
           and attname in ('document_id', 'folder_id', 'workspace_id') and atttypid = 'uuid'::regtype) <> 3
     or exists (select 1 from pg_attribute where attrelid = 'public.app_library_folder_items'::regclass and not attisdropped and attname = 'moved_at')
     or to_regprocedure('private.app_library_folder_items_moved_at()') is not null
     or exists (select 1 from pg_trigger where tgrelid = 'public.app_library_folder_items'::regclass and tgname = 'app_library_folder_items_moved_at')
     or exists (select 1 from pg_class where oid = 'public.app_library_folder_items'::regclass
           and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or has_table_privilege('authenticated', 'public.app_library_folder_items', 'insert')
     or has_table_privilege('authenticated', 'public.app_library_folder_items', 'update')
     or (select count(*) from pg_policy where polrelid = 'public.app_library_folder_items'::regclass) <> 1 then
    raise exception 'LIBRARY_ITEM_MOVED_AT_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 옮긴 시각 칸. 기존 줄은 적용 시각.
alter table public.app_library_folder_items add column moved_at timestamptz not null default now();

-- 2) 넣을 때·폴더가 바뀔 때 서버가 시각을 적는다(보낸 값은 쓰지 않음). 폴더가 그대로면 옛 시각 그대로.
create function private.app_library_folder_items_moved_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $moved$
begin
  if tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id then
    new.moved_at := pg_catalog.now();
  else
    new.moved_at := old.moved_at;
  end if;
  return new;
end
$moved$;
revoke all on function private.app_library_folder_items_moved_at() from public, anon, authenticated, service_role;

create trigger app_library_folder_items_moved_at
before insert or update on public.app_library_folder_items
for each row execute function private.app_library_folder_items_moved_at();

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 1개, 새 칸에 넣기·고치기 권한 없음), 칸·함수(invoker, 실행권 없음)·트리거 하나씩.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_library_folder_items'::regclass
           and (not relrowsecurity or relacl::text ~ '(^|[{,])(anon)?='))
     or (select count(*) from pg_policy where polrelid = 'public.app_library_folder_items'::regclass) <> 1
     or has_table_privilege('authenticated', 'public.app_library_folder_items', 'insert')
     or has_table_privilege('authenticated', 'public.app_library_folder_items', 'update')
     or has_column_privilege('authenticated', 'public.app_library_folder_items', 'moved_at', 'insert')
     or has_column_privilege('authenticated', 'public.app_library_folder_items', 'moved_at', 'update')
     or has_column_privilege('anon', 'public.app_library_folder_items', 'moved_at', 'select')
     or (select count(*) from pg_attribute where attrelid = 'public.app_library_folder_items'::regclass and not attisdropped
           and attname = 'moved_at' and atttypid = 'timestamptz'::regtype and attnotnull and attacl is null) <> 1
     or (select count(*) from pg_proc where oid = to_regprocedure('private.app_library_folder_items_moved_at()')
           and not prosecdef and proconfig = array['search_path=""']
           and not has_function_privilege('anon', oid, 'execute')
           and not has_function_privilege('authenticated', oid, 'execute')
           and not has_function_privilege('service_role', oid, 'execute')) <> 1
     or (select count(*) from pg_trigger where tgrelid = 'public.app_library_folder_items'::regclass and tgname = 'app_library_folder_items_moved_at'
           and tgenabled = 'O' and tgfoid = to_regprocedure('private.app_library_folder_items_moved_at()')) <> 1 then
    raise exception 'LIBRARY_ITEM_MOVED_AT_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261126150000', 'library_item_moved_at', array['S70-73c LIB-드라이브위치따라가기: app_library_folder_items.moved_at timestamptz not null default now() + before insert/update trigger setting it when folder_id changes (invoker, search_path empty, execute revoked); no grants, policies or RLS change']);
commit;
