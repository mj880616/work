-- WEEKLY-자료날짜: 자료실 자료의 자료 날짜(document_date)가 잘못 붙었을 수 있는 자료가 몇 건인지 세기 — 읽기 전용 (select만).
-- 사용: Supabase SQL Editor 새 쿼리 창(+)에 붙여 넣고 실행한 뒤 결과를 캡처해 커맨드센터에 보낸다. 한 번에 한 표(건수만)가 나온다.
-- 이 파일은 아무것도 바꾸지 않는다(insert/update/delete/함수 호출 없음). 자료 제목·파일 이름·내용은 보이지 않고 건수·연도만 센다.
-- 잘못 붙은 날짜를 한꺼번에 고치는 일은 하지 않는다(운영 데이터 일괄 변경 — 목록을 명진에게 보인 뒤 별도 작업으로, ★직전 정지★).
--
-- 읽는 법(kind):
--  - by_year: 올린 해(upload_year, 한국 날짜) × 자료 날짜 해(doc_year, 비었으면 null)별 자료 수. 올린 해보다 자료 날짜 해가 앞서면 옛 자료를 올린 것.
--  - recent_old_date: 최근 30일 안에 올렸고 자료 날짜가 올린 날보다 60일 넘게 앞선 자료(작년 성명을 이번에 올린 것 같은 자료) — 이번 고침 뒤엔 그 주 후보에 안 뜸.
--  - recent_no_date: 최근 30일 안에 올렸고 자료 날짜가 빈 자료 — 이 자료는 올린 날로 보므로 옛 자료면 여전히 그 주 후보에 뜬다(사람이 날짜를 채워야 함).
--  - year_conflict: 제목이나 파일 이름에 20xx 네 자리 연도가 있는데, 자료 날짜의 해는 거기 없는 자료(예: 제목에 2025, 자료 날짜는 2026) — 잘못 붙었을 가능성이 큰 자료.
--  - same_year_as_upload_no_year_in_name: 자료 날짜 해 = 올린 해이고, 자료 날짜를 AI가 넣었고(field_origin ->> 'document_date' = 'ai'),
--    제목·파일 이름에 연도 표시(20xx 또는 yymmdd)가 없는 자료 — 연도 없는 날짜를 올해로 짐작했을 수 있는 자료(확인 후보, 모두 틀린 것은 아님).
--  origin = 자료 날짜를 넣은 쪽(ai / user / 비어 있음 = 올릴 때 파일 이름 규칙 또는 기록 없음), n = 자료 수.
with d as (
  select
    extract(year from (doc.created_at at time zone 'Asia/Seoul'))::int as upload_year,
    (doc.created_at at time zone 'Asia/Seoul')::date as upload_day,
    doc.document_date,
    extract(year from doc.document_date)::int as doc_year,
    coalesce(doc.field_origin ->> 'document_date', '') as origin,
    coalesce(doc.title, '') || ' ' || coalesce(doc.file_name, '') as name
  from public.app_documents doc
)
select 'by_year' as kind, upload_year, doc_year, null::text as origin, count(*) as n
from d group by upload_year, doc_year
union all
select 'recent_old_date', null, doc_year, origin, count(*)
from d where upload_day >= (now() at time zone 'Asia/Seoul')::date - 30 and document_date < upload_day - 60
group by doc_year, origin
union all
select 'recent_no_date', null, null, null, count(*)
from d where upload_day >= (now() at time zone 'Asia/Seoul')::date - 30 and document_date is null
union all
select 'year_conflict', null, doc_year, origin, count(*)
from d where document_date is not null and name ~ '20[0-9]{2}' and position(doc_year::text in name) = 0
group by doc_year, origin
union all
select 'same_year_as_upload_no_year_in_name', upload_year, doc_year, origin, count(*)
from d where document_date is not null and doc_year = upload_year and origin = 'ai'
  and name !~ '20[0-9]{2}' and name !~ '(^|[^0-9])[0-9]{2}(0[1-9]|1[0-2])([0-2][0-9]|3[01])([^0-9]|$)'
group by upload_year, doc_year, origin
order by 1, 2 nulls first, 3 nulls first, 4 nulls first;
