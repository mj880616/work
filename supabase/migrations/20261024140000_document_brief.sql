begin;
-- WEEKLY-자료요약 1단계 DB (docs/design/weekly-file-summary.md 3.1·8.1, 명진 결정 Q1 ①): 이미 있는 "자료별 AI 요약 표"
-- app_document_ai_index를 다시 쓴다. 새 표·새 칸·새 함수·새 정책 없음. 이 migration은 검사 하나만 더한다.
-- 검사는 content_hash가 'b1:'로 시작하는 행(이 기능이 쓸 행)에만 걸린다:
--   지문 모양 b1: + 소문자 16진수 32자, 요약 글은 있음(빈 글 = 요약할 것 없음)·200자 이하·2줄 이하·줄마다 120자 이하,
--   줄바꿈 밖 제어 문자 없음, 꺾쇠(<·>) 없음, keywords는 빈 목록, chunk_count는 0.
-- 옛 행(document-ai-index가 쓴 긴 인덱싱 요약, b1:로 시작하지 않음)은 검사에 걸리지 않아 그대로 남는다(데이터 보존).
-- 권한: 표 grant·정책·RLS·트리거·함수 변경 없음. 기존 owner 정책 task12a_owner_all(자료 주인만)과 authenticated 권한 그대로.
-- 주의: 이 표를 만든 migration은 저장소에 없다(migration 기록 이전 운영 표). 그래서 칸 모양·권한·정책을 먼저 확인하고,
--   설계의 가정과 하나라도 다르면 아무것도 바꾸지 않고 멈춘다. authenticated의 SELECT·INSERT·UPDATE가 없으면 멈춘다(권한을 넓히지 않음).
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
-- 짝: docs/20261024140000_document_brief.{precheck,snapshot,postcheck,rollback}.sql, .summary.md
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_document_ai_index in share row exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261024140000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261022100000' and name = 'library_ai_fill') <> 1
     or to_regclass('public.app_documents') is null
     -- 설계가 가정한 칸 9개와 종류
     or (select count(*) from pg_attribute where attrelid = 'public.app_document_ai_index'::regclass and attnum > 0 and not attisdropped
         and ((attname = 'document_id' and atttypid = 'uuid'::regtype)
           or (attname = 'workspace_id' and atttypid = 'uuid'::regtype)
           or (attname = 'content_hash' and atttypid = 'text'::regtype)
           or (attname = 'summary' and atttypid = 'text'::regtype)
           or (attname = 'keywords' and atttypid = 'text[]'::regtype)
           or (attname = 'chunk_count' and atttypid in ('integer'::regtype, 'bigint'::regtype, 'smallint'::regtype))
           or (attname = 'summary_model' and atttypid = 'text'::regtype)
           or (attname = 'indexed_at' and atttypid = 'timestamptz'::regtype)
           or (attname = 'updated_at' and atttypid = 'timestamptz'::regtype))) <> 9
     -- document_id 하나로 고유(자료마다 1행 upsert)
     or not exists (select 1 from pg_index i where i.indrelid = 'public.app_document_ai_index'::regclass and i.indisunique
         and i.indnkeyatts = 1 and i.indpred is null
         and i.indkey[0] = (select attnum from pg_attribute where attrelid = 'public.app_document_ai_index'::regclass and attname = 'document_id'))
     or not exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_document_ai_index'::regclass) <> 1
     or (select count(*) from pg_catalog.pg_policies
         where schemaname = 'public' and tablename = 'app_document_ai_index' and policyname = 'task12a_owner_all'
           and cmd = 'ALL' and roles = array['authenticated']::name[]
           and regexp_replace(qual, '[\s()]', '', 'g') = 'private.app_is_owner_documentdocument_id'
           and regexp_replace(with_check, '[\s()]', '', 'g') = 'private.app_is_owner_documentdocument_id') <> 1
     -- authenticated 권한: 읽기·넣기·고치기가 모두 있어야 한다(없으면 멈춤, 여기서 주지 않는다)
     or not exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*r')
     or not exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*a')
     or not exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relacl::text ~ '(^|[{,])authenticated=[a-zA-Z]*w')
     or not exists (select 1 from pg_proc
         where oid = to_regprocedure('private.app_is_owner_document(uuid)') and prosecdef)
     or exists (select 1 from pg_constraint
         where conrelid = 'public.app_document_ai_index'::regclass and conname = 'app_document_ai_index_brief_check')
     -- 이 기능의 행은 아직 없어야 한다
     or exists (select 1 from public.app_document_ai_index where left(content_hash, 3) = 'b1:') then
    raise exception 'DOCUMENT_BRIEF_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_document_ai_index
  add constraint app_document_ai_index_brief_check check (
    content_hash is null
    or left(content_hash, 3) <> 'b1:'
    or (
      content_hash ~ '^b1:[0-9a-f]{32}$'
      and summary is not null
      and char_length(summary) <= 200
      and char_length(summary) - char_length(replace(summary, E'\n', '')) <= 1
      and summary !~ '[^\n]{121}'
      and summary !~ '[\x01-\x09\x0b-\x1f\x7f]'
      and summary !~ '[<>]'
      and keywords is not distinct from '{}'::text[]
      and chunk_count is not distinct from 0
    )
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 1개), 검사 1개가 검증된 상태. 다르면 전체 취소.
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_document_ai_index'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_document_ai_index'::regclass) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_document_ai_index'::regclass
         and conname = 'app_document_ai_index_brief_check' and contype = 'c' and convalidated) <> 1 then
    raise exception 'DOCUMENT_BRIEF_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261024140000', 'document_brief', array['WEEKLY-자료요약: app_document_ai_index_brief_check (rows whose content_hash starts with b1: only), no new table/column/grant/policy']);
commit;
