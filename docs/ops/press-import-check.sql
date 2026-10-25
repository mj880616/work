-- PRESS-자료실편입 대조: 가져오기([옛 성명·보도자료 가져오기])로 자료실에 들어온 성명·보도자료가 Web1 원본 목록과 맞는지 확인 — 읽기 전용 (select 한 문장).
-- 사용: Supabase SQL Editor 새 쿼리 창(+)에 전체를 붙여 넣고 한 번 실행한다. 결과 표를 캡처해 커맨드센터에 보낸다.
-- 이 파일은 아무것도 바꾸지 않는다(insert/update/delete/함수 호출 없음). 기준 목록은 이미 Web1에 공개된 제목·발표일·구분뿐이고 개인정보·비밀값은 없다.
--
-- 기준 목록 48줄 = 글 44건(press/archive.json 42건 + 목록 밖 옛 글 2건) + 첨부 4건(HWP 2 · PDF 2).
--   file_name = 가져오기 코드(app/press-import-model.mjs buildPlan)가 겹침 판정에 쓰는 열쇠. kind = page(글) | attachment(첨부).
--   이 값은 tests/security/press-import-check-sql.test.mjs가 buildPlan과 같은지 매번 검사한다.
--
-- 읽는 법:
--  - 결과가 한 줄이고 problem이 '이상 없음'이면 끝: 기준 48줄이 모두 자료실에 한 번씩, 발표일·종류 맞게 들어와 있다.
--  - 그 밖이면 줄마다 problem 이 문제 종류다: 빠짐(자료실에 없음) · 중복(같은 file_name이 2행 이상) · 발표일 다름 · 종류 다름(성명·보도자료가 아님) · 구분 꼬리표 없음(성명/보도자료/취재요청) · 제목 다름.
--  - 빠짐만 있으면 [옛 성명·보도자료 가져오기]를 다시 누르면 빠진 것만 올라온다(겹침은 건너뜀). 중복은 자료실에서 사용자가 판단한다(이 SQL은 지우지 않는다).

with expected(file_name, kind, doc_date, type_label, title) as (
  values
    ('2026-10-02-two-person-team-forum-followup.html', 'page', date '2026-10-02', '보도자료', '혼자 일하다 숨진 노동자 10년간 3,884명'),
    ('261002_사후보도자료_2인1조법제화토론회_.pdf', 'attachment', date '2026-10-02', '보도자료', '혼자 일하다 숨진 노동자 10년간 3,884명'),
    ('2026-10-01-two-person-team-forum-request.html', 'page', date '2026-10-01', '취재요청', '혼자 일하다 숨진 노동자 10년간 3,884명 위험업무 2인1조, 산안법에 어떻게 담을 것인가'),
    ('261001_취재요청_2인1조_법제화_토론회_.pdf', 'attachment', date '2026-10-01', '취재요청', '혼자 일하다 숨진 노동자 10년간 3,884명 위험업무 2인1조, 산안법에 어떻게 담을 것인가'),
    ('2026-09-29-private-rail-forum-followup.html', 'page', date '2026-09-29', '보도자료', '민자철도 20년, 실제 현장엔 1인·무인근무…국회토론회 결과'),
    ('260929_사후보도자료_민자철도_20년_공공성과_안전성은_어디에_국회토론회_배포_.hwp', 'attachment', date '2026-09-29', '보도자료', '민자철도 20년, 실제 현장엔 1인·무인근무…국회토론회 결과'),
    ('2026-09-28-private-rail-forum-request.html', 'page', date '2026-09-28', '취재요청', '민자철도 20년, 공공성과 안전은 어디에?…공공운수노조·윤종오 의원 국회토론회 개최'),
    ('260928_취재요청_민자철도_20년_공공성과_안전성은_어디에_국회토론회_개최_배포.hwp', 'attachment', date '2026-09-28', '취재요청', '민자철도 20년, 공공성과 안전은 어디에?…공공운수노조·윤종오 의원 국회토론회 개최'),
    ('2026-09-22-public-institution-workforce-joint-action.html', 'page', date '2026-09-22', '보도자료', '“사람이 있어야 안전과 공공서비스를 지킨다” 공공운수노조, 공공기관 인력확충 촉구 1박2일 공동투쟁 마무리'),
    ('2026-09-14-workforce-press-conference-0914-press-release.html', 'page', date '2026-09-14', '보도자료', '공공기관 인력감축 없다더니… 증원 요구 기관에는 “기존 정원 최소 2% 감축 소요 발굴”'),
    ('2026-09-14-workforce.html', 'page', date '2026-09-11', '취재요청', '청년일자리 늘린다더니… ‘인력 필요하면 기존 인력부터 2% 감축’'),
    ('2026-04-27-private-rail-publicization.html', 'page', date '2026-04-27', '성명', '민자철도는 실패했다'),
    ('2025-12-22-korail-performance-pay.html', 'page', date '2025-12-22', '성명', '철도 노동자 성과급 차별 해소가 공공기관 운영 정상화다'),
    ('2025-12-08-high-speed-rail-integration.html', 'page', date '2025-12-08', '성명', '정부의 고속철도 운영기관 통합 추진 환영한다'),
    ('2025-12-03-everline-unfair-dismissal.html', 'page', date '2025-12-03', '성명', '중앙노동위원회의 용인에버라인운영㈜ 부당해고·부당노동행위 인정 환영한다'),
    ('2025-11-21-daegu-subway-strike.html', 'page', date '2025-11-21', '성명', '‘오죽했으면’, 대구 지하철 노동자들의 20년만의 파업투쟁 정당하다!'),
    ('2025-11-17-innovation-guideline-restoration.html', 'page', date '2025-11-17', '취재요청', '혁신가이드라인 원상회복 요구 기자회견'),
    ('2025-11-11-rail-workers-joint-struggle-rally.html', 'page', date '2025-11-11', '보도자료', '궤도노동자 공동투쟁 결의대회'),
    ('2025-11-10-rail-workers-joint-struggle-rally-request.html', 'page', date '2025-11-10', '취재요청', '궤도노동자 공동투쟁 결의대회'),
    ('2025-11-04-rail-workers-struggle-declaration.html', 'page', date '2025-11-04', '취재요청', '궤도노동자 투쟁선포 기자회견'),
    ('2025-10-28-seohae-warning-strike.html', 'page', date '2025-10-28', '보도자료', '서해선지부 경고파업 돌입 기자회견'),
    ('2025-10-24-seohae-warning-strike-request.html', 'page', date '2025-10-24', '취재요청', '서해선지부 경고파업 돌입 예고'),
    ('2025-10-24-private-urban-rail-law-revision.html', 'page', date '2025-10-24', '취재요청', '민간도시철도 공공성·안전 강화를 위한 도시철도법 개정 촉구'),
    ('2025-10-16-line9-press-conference.html', 'page', date '2025-10-16', '취재요청', '서울교통공사 9호선지부 기자회견'),
    ('2025-10-02-seohae-rail-cba.html', 'page', date '2025-10-02', '성명', '서해철도는 비정규직 확대 노린 단협해지 통고를 즉각 철회하라'),
    ('2025-08-25-public-institution-total-labor-cost-testimony.html', 'page', date '2025-08-25', '취재요청', '공공기관 총인건비 증언대회'),
    ('2025-08-20-railway-worker-deaths.html', 'page', date '2025-08-20', '성명', '대통령의 엄중경고와 장관의 다짐만으로는 일터의 죽음을 막을 수 없다'),
    ('2025-07-30-ordinary-wage.html', 'page', date '2025-07-30', '성명', '통상임금 대법 판결 기준 반영한 총인건비 모수 증액 결정을 환영한다'),
    ('2025-07-02-mof-reorganization.html', 'page', date '2025-07-02', '성명', '기재부 개편, 단순 분리를 넘어 공공기관 운영 민주화와 재정 민주주의 실현으로 나아가야 한다'),
    ('2025-06-21-public-workers-joint-rally.html', 'page', date '2025-06-21', '보도자료', '양대노총 공공노동자 총력투쟁 결의대회'),
    ('2025-06-03-line5-fire-one-person.html', 'page', date '2025-06-03', '성명', '참사는 막았지만 참사 직전의 시스템은 남았다'),
    ('2025-04-15-rail-workers-total-labor-cost-rally.html', 'page', date '2025-04-15', '보도자료', '총인건비 제도 전면개선 촉구 궤도노동자 결의대회'),
    ('2025-02-28-seoulmetro-timeoff.html', 'page', date '2025-02-28', '성명', '서울교통공사는 노동위원회의 부당해고 판정을 존중하고 무리한 행정소송을 즉각 취하하라'),
    ('2025-01-22-subway-fare.html', 'page', date '2025-01-22', '성명', '교통불평등 심화하고, 기후정의 역행하는 수도권 지하철 요금인상 즉각 철회하라'),
    ('2024-12-26-ordinary-wage-ruling-press-release.html', 'page', date '2024-12-26', '보도자료', '통상임금 대법 판결 존중·노정교섭 촉구 기자회견'),
    ('2024-12-24-ordinary-wage-ruling-press-request.html', 'page', date '2024-12-24', '취재요청', '통상임금 대법 판결 존중·노정교섭 촉구 기자회견'),
    ('2024-11-20-private-rail-three-unions-rally.html', 'page', date '2024-11-20', '취재요청', '민자철도 3사 노조 연합집회'),
    ('2024-11-08-private-rail-strike-vote-result.html', 'page', date '2024-11-08', '취재요청', '민자철도 3사 노조 파업찬반투표 결과발표'),
    ('2024-11-05-private-rail-three-companies-strike.html', 'page', date '2024-11-05', '취재요청', '민자철도 3사가 동시에 멈춥니다'),
    ('2024-10-10-seoulmetro-park-solidarity-press-release.html', 'page', date '2024-10-10', '보도자료', '부당해고가 죽였다, 오세훈과 서울교통공사는 사죄하라'),
    ('2024-10-08-seoulmetro-park-solidarity-press-request.html', 'page', date '2024-10-08', '취재요청', '부당해고가 죽였다, 오세훈과 서울교통공사는 사죄하라'),
    ('2024-08-27-line9-staffing-press-release.html', 'page', date '2024-08-27', '보도자료', '9호선 2·3단계, 시민과 노동자 안전을 위한 인력 충원 촉구 기자회견'),
    ('2024-08-25-line9-staffing-press-request.html', 'page', date '2024-08-25', '취재요청', '9호선 2·3단계, 시민과 노동자 안전을 위한 인력 충원 촉구 기자회견'),
    ('2024-08-21-seoulmetro-lrc-ruling.html', 'page', date '2024-08-21', '성명', '지노위, 해고 노조간부 전원 부당해고 판정'),
    ('2024-08-02-seoulmetro-reinstatement-press-conference.html', 'page', date '2024-08-02', '보도자료', '서울교통공사 집단해고 복직촉구 양대노총 기자회견'),
    ('2024-07-03-seoulmetro-ilo-forum.html', 'page', date '2024-07-03', '보도자료', 'ILO 국제노동기준으로 바라 본 서울교통공사의 노동조합 탄압 국회토론회'),
    ('2024-09-04-public-rail-policy-conference.html', 'page', date '2024-09-04', '취재요청', '기후위기, 불평등 해결하는 공공 철도·지하철 정책대회 취재요청'),
    ('2024-09-09-public-rail-policy-conference.html', 'page', date '2024-09-09', '보도자료', '‘공공 철도 지하철 정책대회’ 성황리 개최')
),
found as (
  select d.id, d.file_name, d.category, d.document_date, d.title, d.tags
  from public.app_documents d
  where d.file_name in (select file_name from expected)
),
problems as (
  select '빠짐' as problem, e.file_name, e.kind, e.doc_date::text as expected_value, null::text as actual_value
  from expected e
  where not exists (select 1 from found f where f.file_name = e.file_name)
  union all
  select '중복', f.file_name, e.kind, '1행', count(*)::text || '행'
  from found f join expected e using (file_name)
  group by f.file_name, e.kind
  having count(*) > 1
  union all
  select '발표일 다름', e.file_name, e.kind, e.doc_date::text, coalesce(f.document_date::text, '(비어 있음)')
  from expected e join found f using (file_name)
  where f.document_date is distinct from e.doc_date
  union all
  select '종류 다름', e.file_name, e.kind, '성명·보도자료', coalesce(f.category, '(비어 있음)')
  from expected e join found f using (file_name)
  where f.category is distinct from '성명·보도자료'
  union all
  select '구분 꼬리표 없음', e.file_name, e.kind, e.type_label, coalesce(array_to_string(f.tags, ','), '(비어 있음)')
  from expected e join found f using (file_name)
  where e.type_label <> '' and not (e.type_label = any (coalesce(f.tags, '{}'::text[])))
  union all
  select '제목 다름', e.file_name, e.kind, e.title, coalesce(f.title, '(비어 있음)')
  from expected e join found f using (file_name)
  where f.title is distinct from e.title
)
select problem, file_name, kind, expected_value, actual_value
from problems
union all
select '이상 없음', '빠진 것 0건 · 중복 0건 · 발표일 다른 것 0건 (기준 48줄 모두 확인)', null, null, null
where not exists (select 1 from problems)
order by problem, file_name;
