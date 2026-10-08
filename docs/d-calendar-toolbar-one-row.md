# D-보기전환한줄 검증 기록

기준: #443 merge 뒤 main `2294697a2f4b8ebfbd1ac2fa11fc7b06c1ff75ab`. 작업 브랜치 `codex/d-calendar-toolbar-one-row`.

모든 폭에서 보기 전환을 날짜 줄로 이동했다. 폰 제목은 시작 월만 표시하고 다른 해의 연도를 같은 자리 위에 쌓는다. 전체 월/범위는 화면 읽기 이름과 기존 월간 조회용 full span에 보존한다. 상태·저장·기본 보기·밀기·조회 범위 계산은 기존 경로를 유지한다. 월간 ✓N은 체크 SVG와 숫자로 표시한다.

## 360px 실측

| 요소 | 폭(px) |
| --- | ---: |
| 줄 안쪽 | 310 |
| 이전 | 28 |
| 제목(10월) | 42 |
| 다음 | 28 |
| 오늘 | 36 |
| border 구분선 | 1 |
| 목록/주간/월간 | 44 / 44 / 44 |
| 추가 | 36 |
| 요소 합계 | 303 |
| 여섯 간격 | 6 |
| 남는 폭 | 1 |

문서 가로 폭은 360px. 390·686·1280px도 한 줄이며 가로 넘침 없다. 다른 해 제목의 폭은 월 글자 폭과 같다. 보기 버튼 SVG는18px, 누름 범위44×44px, 월간 할 일 SVG는12px. 추가 버튼의 기존 확장 누름 범위도 기존 배치 spec으로 검사한다. 캡처는 검토에만 사용하고 커밋하지 않는다.

## 바꾼 기존 테스트

- `calendar-week-view.spec.mjs`: 보기 버튼의 이름에 ‘보기’ 추가. PC 전체 범위 제목은 full span에서 검사. 폰 시작 월과 연도를 포함한 전체 범위 이름을 함께 검사. 주간 이동/조회/저장/키보드/밀기 유지.
- `calendar-list-view.spec.mjs`: 버튼 이름·폰 월 제목 기대값 갱신. 원래 전체 범위는 접근 가능한 이름으로 추가 검사. 페이지 로딩·재시도·저장·갱신 검사는 유지.
- `calendar-month-three-lines.spec.mjs`: ✓N 텍스트를 N으로 갱신. 날짜 줄 위치·높이·개수·danger·진입 동작 유지.
- `calendar-month-tasks.spec.mjs`: ✓N 텍스트를 N으로 갱신. SVG 존재·aria-hidden·stroke와 부모 색 일치 추가. 개수·danger·위치·모달 진입 유지.
- `calendar-month-event-footer.spec.mjs`: ✓N 텍스트를 N으로 갱신. 일정 줄 수·SVG 포함 경계/글꼴 확대 검사 유지.
- `list-typography.spec.mjs`: 폰 monthTitle만15px→20px 기대값으로 변경. PC·다른 요소 글꼴 비교 유지.
- `modal-typography.spec.mjs`: full/compact 제목 span을 기존 B 제목 역할로 정규화해 비교. 폰 제목의20px/24px을 명시적으로 검사하며 나머지 글꼴·색·굵기·행간과 모달 검사 유지.
- `swipe-nav-follow.spec.mjs`: 760/761 경계 검사에서 제목의 full span으로 범위 불변을 검사. 테스트 clock 설치가 ‘올해’ 판정에 영향을 주더라도 월 상태 불변·메뉴 밀기 검사는 그대로다.
- `calendar-hotfix.spec.mjs`, `startup-performance.spec.mjs`, `task-layout-groups.spec.mjs`: 캐시 버전 기대값만 변경.

새 `calendar-toolbar-one-row.spec.mjs`는360·390·686·1280px의 순서/한 줄/넘침, 44px 보기 버튼·이름·SVG·현재 표시·활성 색·저장·새로고침, ‹ › 오늘 +, 목록/주간/월간의 다른 해 두 줄과 제목 폭을 검사한다. 저장 기본값의 현재 버튼은 재저장하지 않는 기존 동작을 유지하여 실제로 다른 보기로 전환한 뒤 검사한다.

## 실행 및 제한

- 수정 전 새360px spec이 기존 별도 줄 때문에 실패함을 확인했다.
- clean main Node300개 통과. 최종 Node+scripts341개 통과.
- 관련85개 묶음에서84개 통과 및 잘못 바꾼 textOverflow 기대값1개 실패. 해당 기대값을 바로잡아 핵심34개 묶음에서 재검사하여 모두 통과했다.
- 인접62개 묶음에서60개 통과. 기존 제목 글꼴 기대값과 clock에 영향받는 compact 제목 문자열 기대값2개를 위와 같이 갱신했다. 별도5개 재검사는 모두 통과했다.
- 캐시/시작 구조 정적17개 통과, JS 문법·diff 검사 통과. 캐시 변경은 index.html까지 전파하며 로그인 CSS entry도 갱신한다.
- 전체 E2E는 클라우드에서 실행하지 않고 PR CI로 확인한다. 모든 브라우저 API는 합성 응답이며 운영 접근·DB/RLS/Edge 변경 없음.
- 실제 폰/WebView와 PC 실기기 확인은 사용자 확인 항목이다. 360px의 남는1px은 측정한 Chromium 글꼴 기준이다.
