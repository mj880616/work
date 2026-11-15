begin;
-- ED-통합편집기 ①b (2026-10-22 사용자 결정 6 가): 공유 페이지에 새 편집기 글 블록 하나({"type":"doc","doc":{"v":"ed1","doc":{…}}})를
-- 7번째 블록 종류로 받는다. 옛 6종 블록은 그대로 받는다. 설계 docs/design/unified-editor.md 3.3·6절 ①b.
-- 적용은 커맨드센터가 docs/ops-db-workflow.md "승인 한 번 흐름"으로만 한다(이 브랜치는 적용 직전 정지).
--
-- 무엇: app_share_pages_blocks_check 하나만 바꾼다(지우고 같은 이름으로 다시 만듦).
--   - 바깥 한도 그대로: 배열, 60블록, jsonb 글자 256KB(262144바이트).
--   - type 허용 목록에 "doc" 추가(6종 → 7종).
--   - doc 블록 모양: 키는 type·doc 둘만, doc은 객체이고 v = "ed1", 그 안 doc은 type = "doc"이고 content 배열을 가진 객체.
--     문서 안쪽 노드 모양은 화면(ed-schema.mjs cleanDoc)이 저장 전에 허용 목록으로 정리하고, 읽는 화면(ed-render.mjs)이
--     다시 같은 정리를 거쳐 textContent로만 그린다(DB는 바깥 모양만 검사한다. 6종 블록 안 모양을 화면이 정하는 것과 같음).
-- 권한: 표 grant·정책·RLS·함수·트리거 변경 없음. Edge(share-page-read)도 바꾸지 않는다(blocks 배열을 그대로 돌려줌).
set local lock_timeout = '5s';
set local statement_timeout = '60s';
lock table public.app_share_pages in access exclusive mode;

-- 사전 조건이 다르면 아무것도 바꾸지 않고 멈춘다: 이번 기록 없음, 앞선 기록 있음, 제약이 20261020005000 원문 그대로,
-- RLS 켜짐, anon·PUBLIC 표 권한 없음, owner 정책 1개.
do $$
begin
  if exists (select 1 from supabase_migrations.schema_migrations where version = '20261022130000')
     or (select count(*) from supabase_migrations.schema_migrations
         where version = '20261020005000' and name = 'share_pages_links') <> 1
     or exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_pages'::regclass) <> 1
     or (select count(*) from pg_constraint where connamespace = 'public'::regnamespace and conname = 'app_share_pages_blocks_check') <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_share_pages'::regclass and conname = 'app_share_pages_blocks_check' and convalidated) <> 1
     -- 지금 제약 원문(공백만 맞춰 비교). 다르면 누군가 이미 바꾼 것이므로 멈춘다.
     -- check_clause의 바깥 괄호는 PostgreSQL 판에 따라 다르다(16: 한 겹 더, 17: 한 겹 덜 — 2026-10-22 운영 dry-run이 이 차이로 멈춤).
     -- 그래서 두 판의 글자만 받는다. 그 밖의 글자 차이는 모두 멈춘다.
     or (select count(*) from information_schema.check_constraints
         where constraint_schema = 'public' and constraint_name = 'app_share_pages_blocks_check'
           and btrim(regexp_replace(check_clause, '\s+', ' ', 'g')) in (
             btrim(regexp_replace(
'(((jsonb_typeof(blocks) = ''array''::text) AND (jsonb_array_length(blocks) <= 60) AND (octet_length((blocks)::text) <= 262144) AND (jsonb_array_length(jsonb_path_query_array(blocks, ''strict $[*]."type"?(((((@ == "summary" || @ == "stages") || @ == "schedule") || @ == "issues") || @ == "links") || @ == "updates")''::jsonpath, ''{}''::jsonb, true)) = jsonb_array_length(blocks))))',
               '\s+', ' ', 'g')),
             btrim(regexp_replace(
'((jsonb_typeof(blocks) = ''array''::text) AND (jsonb_array_length(blocks) <= 60) AND (octet_length((blocks)::text) <= 262144) AND (jsonb_array_length(jsonb_path_query_array(blocks, ''strict $[*]."type"?(((((@ == "summary" || @ == "stages") || @ == "schedule") || @ == "issues") || @ == "links") || @ == "updates")''::jsonpath, ''{}''::jsonb, true)) = jsonb_array_length(blocks)))',
               '\s+', ' ', 'g')))) <> 1 then
    raise exception 'SHARE_DOC_BLOCK_PREREQUISITE_CHANGED; stop';
  end if;
end
$$;

alter table public.app_share_pages drop constraint app_share_pages_blocks_check;
alter table public.app_share_pages
  add constraint app_share_pages_blocks_check check (
    jsonb_typeof(blocks) = 'array'
    and jsonb_array_length(blocks) <= 60
    and octet_length(blocks::text) <= 262144
    -- 블록마다 객체이고 type(글자)이 7종 중 하나: 7종 type 개수 = 블록 개수(strict라 type 없는 블록은 빈 결과 → 거절).
    and jsonb_array_length(jsonb_path_query_array(blocks,
      'strict $[*].type ? (@ == "summary" || @ == "stages" || @ == "schedule" || @ == "issues" || @ == "links" || @ == "updates" || @ == "doc")',
      '{}', true)) = jsonb_array_length(blocks)
    -- doc 블록 바깥 모양(lax: 없는 키는 빈 결과라 exists로 따로 본다).
    and not jsonb_path_exists(blocks, '$[*] ? (@.type == "doc" && (
        !exists(@.doc) || @.doc.type() != "object"
        || !exists(@.doc.v) || @.doc.v != "ed1"
        || !exists(@.doc.doc) || @.doc.doc.type() != "object"
        || !exists(@.doc.doc.type) || @.doc.doc.type != "doc"
        || !exists(@.doc.doc.content) || @.doc.doc.content.type() != "array"))')
    and not jsonb_path_exists(blocks, '$[*] ? (@.type == "doc").keyvalue() ? (@.key != "type" && @.key != "doc")')
    and not jsonb_path_exists(blocks, '$[*] ? (@.type == "doc").doc.keyvalue() ? (@.key != "v" && @.key != "doc")')
  );

-- 사후 확인: 권한 경계 그대로(RLS 켜짐, anon·PUBLIC 없음, 정책 1개), 제약 1개가 검증된 상태. 다르면 전체 취소.
do $$
begin
  if exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and not relrowsecurity)
     or exists (select 1 from pg_class where oid = 'public.app_share_pages'::regclass and relacl::text ~ '(^|[{,])(anon)?=')
     or (select count(*) from pg_policy where polrelid = 'public.app_share_pages'::regclass) <> 1
     or (select count(*) from pg_constraint where conrelid = 'public.app_share_pages'::regclass and conname = 'app_share_pages_blocks_check' and convalidated) <> 1 then
    raise exception 'SHARE_DOC_BLOCK_POSTCHECK_FAILED; stop';
  end if;
end
$$;

insert into supabase_migrations.schema_migrations (version, name, statements)
values ('20261022130000', 'share_pages_doc_block', array['ED-통합편집기 ①b: app_share_pages_blocks_check accepts a 7th block type "doc" (ed1 outer shape), no grants/policies/functions']);
commit;
