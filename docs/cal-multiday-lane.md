# CAL-여러날막대 검증 기록

📱 폰 가능 — Codex 웹·클라우드, 2026-10-11.

시작은 새로 fetch한 `origin/main` `aadddb452aa0c934c3ff666c0433a9efbc61df58`(#477 merge), 브랜치는 `codex/cal-multiday-lane`이다.

원인(확인된 사실): `app/calendar-month-view.js`의 `render()`가 주 단위 `segmentWeeks()` 결과에 폰 전용 `compactPhoneWeek()`를 다시 적용했다. 이 함수의 `days[col].indexOf(seg)`가 날짜마다 줄을 재배정해 앞 일정 종료 뒤 남은 날을 위로 올렸다. Como와 Dobiacco가 각각 2개 DOM 막대가 되는 증상을 재현했다. PC는 이 압축을 거치지 않았지만 기존 `eventSort()`는 종일 여부를 시작일보다 먼저 비교했다.

같은 렌더러의 `segmentWeeks()`에서 여러 날 일정을 시작 날짜 오름차순, 날짜 범위 긴 것 우선, 기존 `eventSort()` 순으로 정렬한다. 각 주의 잘린 범위 전체가 비어 있는 가장 낮은 줄을 한 번 배정하며 하루 일정은 그 뒤 빈 줄을 채운다. `compactPhoneWeek()`와 호출을 제거했다. 할 일 데이터 소유권·색·CSS·클릭 속성·편집/이동 모듈·터치 보호·주 경계 표시·슬롯 높이는 유지한다.

폰의 날짜별 넘침 계산은 그 날짜에 사용되는 가장 높은 줄(`max(lane+1)`)로 기존 슬롯 제한을 적용한다. 고정 줄 아래가 비어도 일정을 올리지 않으며, 제한 밖 일정은 정확한 항목 개수로 +N과 날짜 목록에 남는다. 표시 제한에 따른 숨김/주 경계 잘림은 유지한다.

캐시 전파: calendar-month-view 20→21, view-loader 113→114, loader-v2 346→347, app.js 234→235, index의 modulepreload·script까지. 기존 기대 테스트 3개와 app-smoke-check의 고정 버전 3곳만 숫자를 맞췄다. workflow 동작 변경 없음.

## 재현 캡처

실제 월간 렌더러·스타일을 불러오는 기존 `calendar-month-view-fixture.html`에서 같은 가상 날짜(2026-10-11), 높이844px, 데이터를 사용했다. 운영 접속·실기기 캡처가 아니다. 종일 종료는 Google 배타적 날짜로 각각 10/7·10/9·10/11을 넣었다.

| 폭 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 폰390px | [전](cal-multiday-lane/before-390.png) | [후](cal-multiday-lane/after-390.png) |
| PC1280px | [전](cal-multiday-lane/before-1280.png) | [후](cal-multiday-lane/after-1280.png) |

폰 전: Como 10/6 둘째 줄 + 10/7~8 첫째 줄, Dobiacco 10/8 둘째 줄 + 10/9~10 첫째 줄. 후: Sirmione 첫째 줄10/5~6, Como 둘째 줄10/6~8, Dobiacco 첫째 줄10/8~10. PC의 이 세 일정 모양은 전후 동일하다.

## 검증

- Chromium151.0.7922.173, Playwright1.55.0, 재시도0, Asia/Seoul. 환경 설치 Chromium을 지정했다. Playwright 브라우저 다운로드는 네트워크 정책으로 거절됐고 의존성 설치는 root 권한이 없어 중단됐다. 환경에 이미 설치된 Chromium으로 실제 브라우저 검사를 실행했다.
- 수정 전 신규8개: 4실패/4통과. 폰 연속 막대·혼합 넘침·정렬, PC 정렬의 기대 동작 실패를 확인했다. 테스트 작성 중 잘못된 시간 일정 줄 기대값·CSS 계산색 비교·날짜 창까지 잡는 locator를 바로잡은 뒤 얻은 기준이다.
- 수정 후 신규10/10: 위3개 일정의 DOM 개수·정확한 칸 범위·줄, 여러 날 시간 일정의 주 경계, 시작일/기간 정렬, 하루 일정 빈 줄, 조밀한 날짜 +N/전체 목록, 빈 낮은 줄을 둔 높은 줄의 +1/전체 목록/칸 안 배치. 390·1280px 모두 페이지·콘솔 오류0.
- Node455/455: `tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs`. DB 실행 테스트(`tests/auth-handoff`) 제외.
- app-smoke-check의 정적·Node·HTTP 검사21개 모두 통과. cache checker에서 운영 참조393개 검사, `git diff --check` 통과.
- 기존 달력99/99와 당시 신규8개를 합친 관련 배치107/107 통과(3.3분), 추가한 sparse2개를 포함한 신규10/10 별도 통과. 캐시 기대값 관련 startup14/14·task 소유권1/1 통과. 관련 고유 브라우저 검사124개 통과. 기존 실패 없음. 로컬 전체 E2E·DB 테스트는 사용자 지정 범위에 따라 실행하지 않았다. PR CI는 생성 후 별도로 확인한다.
- 독립 코드 리뷰: critical/important 없음. sparse 높은 줄 넘침 커버리지 제안을 신규 테스트에 반영했다.

기존 달력 테스트를 삭제·약화하지 않았다. DB·production·권한·Edge·Cloudflare·서버 파일 변경과 운영 호출은 없다.

범위 밖 확인: 시작 main의 `calendar-interactions-v2.js`에는 막대 drag/drop 이동 핸들러가 없다. 기존 편집창의 날짜 변경·캘린더 이동·클릭 경로를 유지하고 관련 편집 테스트로 검증한다. 요청 범위에 새 드래그 기능을 추가하지 않았다. 실기기 폰 확인과 merge는 커맨드센터에 남긴다.
