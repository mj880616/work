-- LIB-파일이름제목: AI가 제목을 파일 이름과 다르게 바꾼 자료 확인용 — 읽기 전용 (select만).
-- 사용: Supabase SQL Editor 새 쿼리 창(+)에 붙여 넣고 실행한 뒤 결과를 캡처해 커맨드센터에 보낸다. 조각이 둘이면 조각 하나씩(; 까지) 선택해 [Run selected]로 따로 실행한다.
-- 이 파일은 아무것도 바꾸지 않는다(insert/update/delete/함수 호출 없음). 자료를 되돌리는 일은 명진 확인 뒤 별도 작업이다.
-- 사람이 직접 고친 제목(field_origin 의 title 이 'user')은 목록에 넣지 않는다 — 손대지 않는다.
--
-- 읽는 법:
--  - file_name_base: 올린 파일 이름(확장자 뺀 것). current_title: 지금 제목. 두 칸이 다르면 AI가 파일 이름 대신 본문 제목을 쓴 자료다.
--  - old_title: 되돌리기 백업(예전 자료 정리가 바꾼 경우)에 남은 바꾸기 전 제목. 비어 있으면 올릴 때 바로 채운 자료(백업 없음; 파일 이름이 원래 제목).
--  - reverted_at 이 있으면 이미 되돌린 자료다.

-- 1) AI가 제목을 쓴 자료 목록(파일 이름 → 지금 제목). 파일 이름과 같은 제목은 same_as_file=true 로 같이 보인다.
select
  d.id,
  regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', '') as file_name_base,
  d.title as current_title,
  (lower(regexp_replace(coalesce(d.title, ''), '[\s_.()\[\]-]+', '', 'g'))
     = lower(regexp_replace(regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', ''), '[\s_.()\[\]-]+', '', 'g'))) as same_as_file,
  (select b.old_value from public.app_library_tidy_backups b
    where b.document_id = d.id and b.field = 'title' order by b.created_at asc limit 1) as old_title,
  (select b.reverted_at from public.app_library_tidy_backups b
    where b.document_id = d.id and b.field = 'title' order by b.created_at asc limit 1) as reverted_at,
  d.created_at
from public.app_documents d
where d.field_origin ->> 'title' = 'ai'
order by same_as_file, d.created_at desc
limit 500;

-- 2) 요약: 전체 몇 건 중 몇 건이 파일 이름과 다른 제목인지.
select
  count(*) as ai_title_total,
  count(*) filter (where lower(regexp_replace(coalesce(d.title, ''), '[\s_.()\[\]-]+', '', 'g'))
     <> lower(regexp_replace(regexp_replace(coalesce(d.file_name, ''), '\.[^.]{1,8}$', ''), '[\s_.()\[\]-]+', '', 'g'))) as changed_from_file_name
from public.app_documents d
where d.field_origin ->> 'title' = 'ai';
