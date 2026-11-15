begin;
-- LIB-AI자동분류 (docs/design/library-ai-fill.md 4절): 자료실 AI 빈 칸 채우기의 DB 바탕.
-- 1) app_documents.field_origin: 칸별 안쪽 기록(화면에 표시하지 않음). {"title":"ai","source":"user"}처럼
--    제목·분류·출처(작성 주체)·자료 날짜 4칸만, 값은 'ai'(AI가 채움) 또는 'user'(사용자가 넣거나 고침). 기본 {}.
--    기존 행은 {}로 시작한다(기존 값·분류·권한 변경 없음).
-- 2) 파일 본문 글자는 새 표를 만들지 않고 이미 있는 app_documents.extracted_text·extraction_status·extraction_error·extracted_at
--    (옛 document-ai-index가 쓰던 칸, 커맨드센터 조사 2026-10-22)를 다시 쓴다. 이 migration은 그 칸이 있는지만 확인하고 바꾸지 않는다.
-- 새 표·함수·트리거·정책 없음, 기존 정책·grant·값 변경 없음.
-- 짝: docs/20261022100000_library_ai_fill.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_documents in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다(권한을 넓혀서 통과시키지 않는다).
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022100000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261018032038' and name = 'doc_organization_link') <> 1
     or to_regclass('public.app_workspaces') is null
     or exists (select 1 from pg_attribute
         where attrelid = 'public.app_documents'::regclass and not attisdropped and attname = 'field_origin')
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_documents' and policyname = 'task12a_owner_all'
           and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_workspace_ownerworkspace_id') <> 1
     or not exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and attname in ('title', 'category', 'source', 'document_date', 'workspace_id', 'id')) <> 6
     -- 다시 쓸 글자 칸 4개(옛 document-ai-index): 있고 종류가 맞아야 한다. 없으면 멈추고 따로 계획한다.
     or (select count(*) from pg_attribute where attrelid = 'public.app_documents'::regclass and not attisdropped
         and ((attname = 'extracted_text' and atttypid = 'text'::regtype)
           or (attname = 'extraction_status' and atttypid = 'text'::regtype)
           or (attname = 'extraction_error' and atttypid = 'text'::regtype)
           or (attname = 'extracted_at' and atttypid = 'timestamptz'::regtype))) <> 4
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_workspace_owner(uuid)') and prosecdef) then
    raise exception 'LIBRARY_AI_FILL_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

-- 1) 칸별 안쪽 기록. 기존 행은 {}(아무 표시 없음). 기존 authenticated 표 UPDATE 권한과 owner 정책이 그대로 걸린다.
alter table public.app_documents
  add column field_origin jsonb not null default '{}'::jsonb;
alter table public.app_documents
  add constraint app_documents_field_origin_check check (
    jsonb_typeof(field_origin) = 'object'
    and (field_origin - array['title', 'category', 'source', 'document_date']) = '{}'::jsonb
    -- 값은 글자 'ai'·'user'만. 숫자·참거짓·객체는 비교가 "모름"이 되므로 종류를 따로 막는다.
    and not jsonb_path_exists(field_origin, 'strict $.* ? (@.type() != "string")')
    and not jsonb_path_exists(field_origin, 'strict $.* ? (@ != "ai" && @ != "user")')
  );

-- 사후 확인: 다르면 전체 취소.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.app_documents'::regclass)
     or (select count(*) from pg_policy where polrelid = 'public.app_documents'::regclass) <> 1
     or exists (select 1 from pg_class where oid = 'public.app_documents'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or exists (select 1 from public.app_documents where field_origin <> '{}'::jsonb) then
    raise exception 'LIBRARY_AI_FILL_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022100000', 'library_ai_fill', array['LIB-AI자동분류: app_documents.field_origin (hidden per-field ai/user record); reuses existing extracted_text columns']);
commit;
