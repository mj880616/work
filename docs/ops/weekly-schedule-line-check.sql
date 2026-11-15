-- WEEKLY-장소칸: 주간보고 일정에 예전 한 줄 모양('10:30 / 제목 / 장소')으로 섞여 저장된 값이 몇 건인지 세기 — 읽기 전용 (select만).
-- 사용: Supabase SQL Editor 새 쿼리 창(+)에 붙여 넣고 실행한 뒤 결과를 캡처해 커맨드센터에 보낸다. 한 번에 한 표(건수만)가 나온다.
-- 이 파일은 아무것도 바꾸지 않는다(insert/update/delete/함수 호출 없음). 일정 제목·장소 글은 보이지 않고 건수만 센다(업무 내용 출력 없음).
-- 화면은 이 값들을 읽을 때 시간·제목·장소 칸으로 나눠 보이고(app/schedule-line-split.mjs), 화면에서 고쳐 저장할 때만 나뉜 모양으로 저장한다.
-- 서버 값을 한꺼번에 고치는 일은 하지 않는다(운영 데이터 일괄 변경 — 필요하면 별도 작업으로 명진 승인 뒤).
--
-- 읽는 법(where_saved):
--  - memory: 주간보고 기억(app_profiles.weekly_schedule_memory)의 기억한 이름(title).
--  - draft_titles: 그 주 임시저장의 일정 칸별 고침(app_weekly_exec_requests.draft -> 'titles')의 제목.
--  - draft_hq: [주간 정리] 2) 주요 일정 수기 줄(app_weekly_exec_requests.draft -> 'hq')의 내용.
--  owners = 그런 값이 있는 사람(작업공간) 수, entries = 값 건수.
with line as (select '^\s*([01]?\d|2[0-3])[:.][0-5]\d\s*/\s*\S' as re),
memory as (
  select p.user_id as owner, e ->> 'title' as title
  from public.app_profiles p, jsonb_array_elements(case when jsonb_typeof(p.weekly_schedule_memory) = 'array' then p.weekly_schedule_memory else '[]'::jsonb end) e
),
titles as (
  select r.workspace_id as owner, e ->> 'title' as title
  from public.app_weekly_exec_requests r, jsonb_array_elements(case when jsonb_typeof(r.draft -> 'titles') = 'array' then r.draft -> 'titles' else '[]'::jsonb end) e
),
hq as (
  select r.workspace_id as owner, e ->> 'title' as title
  from public.app_weekly_exec_requests r, jsonb_array_elements(case when jsonb_typeof(r.draft -> 'hq') = 'array' then r.draft -> 'hq' else '[]'::jsonb end) e
)
select 'memory' as where_saved, count(distinct owner) as owners, count(*) as entries from memory, line where title ~ line.re
union all
select 'draft_titles', count(distinct owner), count(*) from titles, line where title ~ line.re
union all
select 'draft_hq', count(distinct owner), count(*) from hq, line where title ~ line.re;
