begin;
-- LIB-수정파일교체 DB (사용자 요청 2026-10-23 11:48, 추천안 "옛 파일은 지우지 않고 Drive에 남기고 이전 파일 ▾"):
-- 자료실 [수정] 창에서 파일 자체를 바꿔도 제목·날짜·종류·프로젝트·담당조직 연결은 그대로 두려면, 자료 한 줄(app_documents)이
-- "지금 파일"을 가리키는 칸만 새 파일로 바꾸고 옛 파일의 위치를 어딘가 남겨야 한다. 그 기록 칸이 지금 표에 없어서 칸 두 개를 더한다.
-- 1) previous_files jsonb: 옛 파일 목록(오래된 순). 각 항목은 객체 {file_id(필수, Drive 번호 모양), file_name, mime_type, file_size, drive_url, replaced_at}.
--    기본 []. 최대 50개·글자로 64 KiB까지. 검사는 "객체의 배열이고 각 항목에 Drive 번호 모양의 file_id가 있다"까지만 본다
--    (나머지 칸은 Edge가 서버에서 쓰고 화면은 읽기만 한다. 값이 틀려도 목록 표시만 달라질 뿐 권한과 무관).
-- 2) reclassify_needed boolean: 파일이 바뀌어 AI 분류를 한 번 다시 해야 한다는 표시(기본 false). 교체하면 서버가 true로 두고,
--    AI 분류가 끝나면 false로 돌린다. 시간 창에 기대지 않아 창을 닫았다가 나중에 열어도 한 번 다시 본다.
-- 기존 행은 모두 previous_files = [] / reclassify_needed = false 로 시작한다(표를 다시 쓰지 않음, 기존 값·분류·연결 변경 없음).
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음. 새 칸은 기존 표 단위 권한과 기존 소유자 정책(task12a_owner_all) 아래에 있다.
--   사전 확인: RLS 켜짐, anon·PUBLIC 표 권한 없음, 정책 1개(소유자), authenticated의 표 단위 UPDATE 권한 있음.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 짝: docs/20261024030000_library_replace_file.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 넓혀서 통과시키지 않는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024030000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261023120000' and name = 'library_ai_classify') <> 1
     or to_regclass('public.app_documents') is null
     or exists (select 1 from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and attname in ('previous_files', 'reclassify_needed'))
     or exists (select 1 from pg_constraint where conrelid = 'public.app_documents'::regclass
         and conname = 'app_documents_previous_files_check')
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and ((attname = 'file_id' and atttypid = 'text'::regtype)
           or (attname = 'file_name' and atttypid = 'text'::regtype)
           or (attname = 'extracted_text' and atttypid = 'text'::regtype)
           or (attname = 'extraction_status' and atttypid = 'text'::regtype)
           or (attname = 'field_origin' and atttypid = 'jsonb'::regtype))) <> 5
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_policy where polrelid = 'public.app_documents'::regclass
         and (polroles @> array[0::oid] or polroles @> array['anon'::regrole::oid]))
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_documents' and policyname = 'task12a_owner_all'
           and cmd = 'ALL' and roles = array['authenticated']::name[]) <> 1
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w') then
    raise exception 'LIBRARY_REPLACE_FILE_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_documents
  add column previous_files jsonb not null default '[]'::jsonb,
  add column reclassify_needed boolean not null default false;
-- 모양 검사: 배열, 50개 이하, 64 KiB 이하, 모든 항목이 객체이고 Drive 번호 모양의 문자열 file_id를 가진다.
-- 어긋나면 검사가 "모름"이 되어 통과하는 일이 없도록 앞 조건은 coalesce(…, false)로 감싼다.
alter table public.app_documents
  add constraint app_documents_previous_files_check check (
    coalesce(
      jsonb_typeof(previous_files) = 'array'
      and jsonb_array_length(previous_files) <= 50
      and octet_length(previous_files::text) <= 65536
      and not jsonb_path_exists(previous_files, 'strict $[*] ? (@.type() != "object")')
      and not jsonb_path_exists(previous_files, 'lax $[*] ? (!exists(@.file_id) || @.file_id.type() != "string" || !(@.file_id like_regex "^[A-Za-z0-9_-]{1,255}$"))'),
      false));

-- 사후 확인: 두 칸·검사(검증됨)가 있고 모든 기존 행은 비어 있음, 권한 경계 그대로. 다르면 전체 취소.
do $$
begin
  if (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
        and ((attname = 'previous_files' and atttypid = 'jsonb'::regtype and attnotnull)
          or (attname = 'reclassify_needed' and atttypid = 'boolean'::regtype and attnotnull))) <> 2
     or (select count(*) from pg_constraint where conrelid = 'public.app_documents'::regclass
           and conname = 'app_documents_previous_files_check' and contype = 'c' and convalidated) <> 1
     or exists (select 1 from public.app_documents where previous_files <> '[]'::jsonb or reclassify_needed)
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from pg_policy where polrelid = 'public.app_documents'::regclass
         and (polroles @> array[0::oid] or polroles @> array['anon'::regrole::oid]))
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1 then
    raise exception 'LIBRARY_REPLACE_FILE_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024030000', 'library_replace_file', array['LIB-수정파일교체 DB: app_documents.previous_files jsonb (default []) + shape CHECK, app_documents.reclassify_needed boolean (default false); existing owner RLS, no grants/policies/functions/triggers']);
commit;
