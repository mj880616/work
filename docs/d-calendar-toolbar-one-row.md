# D-보기전환한줄 검증 기록

기준: #443 merge 뒤 main `2294697a2f4b8ebfbd1ac2fa11fc7b06c1ff75ab`. 작업 브랜치 `codex/d-calendar-toolbar-one-row`.

모든 폭에서 보기 전환을 날짜 줄로 이동했다. 폰 제목은 시작 월만 표시하고 다른 해의 연도를 같은 자리 위에 쌓는다. 전체 월/범위는 화면 읽기 이름과 기존 월간 조회용 full span에 보존한다. 상태·저장·기본 보기·밀기·조회 범위 계산은 기존 경로를 유지한다. 월간 ✓N은 체크 SVG와 숫자로 표시한다.

## 2026-10-08 최초360px 실측

| 요소 | 폭(px) |
| --- | ---: |
| 줄 안쪽 | 310 |
| 이전(보이는 폭) | 16 |
| 제목(10월) | 42 |
| 다음(보이는 폭) | 16 |
| 오늘 | 36 |
| border 구분선 | 1 |
| 목록/주간/월간 | 44 / 44 / 44 |
| 추가 | 36 |
| 요소 합계 | 279 |
| 여섯 간격 | 6 |
| 추가 여백(다음17·구분선1) | 18 |
| 남는 폭 | 7 |

문서 가로 폭은 360px. 390·686·760·761·1023·1280px도 한 줄이며 가로 넘침 없다. 다른 해 제목의 폭은 월 글자 폭과 같다. 보기 버튼 SVG는18px, 누름 범위44×44px, 월간 할 일 SVG는12px. 추가 버튼의 기존 확장 누름 범위도 기존 배치 spec으로 검사한다. 화살표는 기존32px 높이·11px 글자를 유지하고 보이는 폭만16px로 줄이며 투명44px 누름 범위는 제목 위까지 확장한다. 제목은 누름을 가로채지 않으며 다음/오늘/보기 사이 여백으로 실제 버튼 누름 범위끼리 겹치지 않는다. 캡처는 검토에만 사용하고 커밋하지 않는다.

## 바꾼 기존 테스트

- `calendar-week-view.spec.mjs`: 보기 버튼의 이름에 ‘보기’ 추가. PC 전체 범위 제목은 full span에서 검사. 폰 시작 월과 연도를 포함한 전체 범위 이름을 함께 검사. 주간 이동/조회/저장/키보드/밀기 유지.
- `calendar-list-view.spec.mjs`: 버튼 이름·폰 월 제목 기대값 갱신. 원래 전체 범위는 접근 가능한 이름으로 추가 검사. 페이지 로딩·재시도·저장·갱신 검사는 유지.
- `calendar-month-three-lines.spec.mjs`: ✓N 텍스트를 N으로 갱신. 날짜 줄 위치·높이·개수·danger·진입 동작 유지.
- `calendar-month-tasks.spec.mjs`: ✓N 텍스트를 N으로 갱신. SVG 존재·aria-hidden·stroke와 부모 색 일치 추가. 개수·danger·위치·모달 진입 유지.
- `calendar-month-event-footer.spec.mjs`: ✓N 텍스트를 N으로 갱신. 일정 줄 수·SVG 포함 경계/글꼴 확대 검사 유지.
- `list-typography.spec.mjs`: 폰 monthTitle만15px→20px 기대값으로 변경. PC·다른 요소 글꼴 비교 유지.
- `modal-typography.spec.mjs`: full/compact 제목 span을 기존 B 제목 역할로 정규화해 비교. 폰 제목의20px/24px을 명시적으로 검사하며 나머지 글꼴·색·굵기·행간과 모달 검사 유지.
- `swipe-nav-follow.spec.mjs`: 모든 월 범위 불변 검사에서 제목의 full span으로 범위 불변을 검사. 테스트 clock 설치가 ‘올해’ 판정에 영향을 주더라도 월 상태 불변·메뉴 밀기 검사는 그대로다.
- `calendar-hotfix.spec.mjs`, `startup-performance.spec.mjs`, `task-layout-groups.spec.mjs`: 캐시 버전 기대값만 변경.

새 `calendar-toolbar-one-row.spec.mjs`는360·390·686·760·761·1023·1280px의 순서/한 줄/넘침, 44px 보기 버튼·이름·SVG·현재 표시·활성 색·저장·새로고침, ‹ › 오늘 +, 목록/주간/월간의 다른 해 두 줄과 제목 폭을 검사한다. 저장 기본값의 현재 버튼은 재저장하지 않는 기존 동작을 유지하여 실제로 다른 보기로 전환한 뒤 검사한다.

## 실행 및 제한

- 수정 전 새360px spec이 기존 별도 줄 때문에 실패함을 확인했다.
- clean main Node300개 통과. 최종 Node+scripts341개 통과.
- 관련85개 묶음에서84개 통과 및 잘못 바꾼 textOverflow 기대값1개 실패. 해당 기대값을 바로잡아 핵심34개 묶음에서 재검사하여 모두 통과했다.
- 인접62개 묶음에서60개 통과. 기존 제목 글꼴 기대값과 clock에 영향받는 compact 제목 문자열 기대값2개를 위와 같이 갱신했다. 별도5개 재검사는 모두 통과했다.
- 캐시/시작 구조 정적17개 통과, JS 문법·diff 검사 통과. 캐시 변경은 index.html까지 전파하며 로그인 CSS entry도 갱신한다.
- 전체 E2E는 클라우드에서 실행하지 않고 PR CI로 확인한다. 모든 브라우저 API는 합성 응답이며 운영 접근·DB/RLS/Edge 변경 없음.
- 실제 폰/WebView와 PC 실기기 확인은 사용자 확인 항목이다. 360px의 남는7px은 측정한 Chromium 글꼴 기준이다.

- 첫 PR CI의 Browser storage audit는 새 spec의 기존 보기 설정 읽기를 등록하지 않아 실패했다. 해당 spec의 `getItem('kptu-calendar-view')` 읽기만 좁게 등록하여 검사한다. 앱 저장/권한 정책 변경은 없다. 새 실측 로그의 remaining도 요소 합계와 간격을 모두 뺀 값으로 맞춘다.

- 첫 전체 E2E는978개 중972개 통과/6개 실패했다. 폰 화살표 여백·폭 기대값3개, clock에 따른 compact 제목 문자열1개, 실제 투명 누름 범위 차단/겹침2개였다. 누름 범위 검사를 약화하지 않고 배치를 조정했다. 관련19개 재검사 통과.
- `button-sizing.spec.mjs` 추가 변경: 폰 화살표 padding0/보이는 폭16px만 새 배치 기대값으로 맞춘다. 글꼴·높이·색·굵기·PC 크기 비교, 추가44px의 실제 가장자리 클릭·키보드 검사는 유지한다.
- `theme.spec.mjs`의44px 실제 hit/인접 겹침 검사는 수정하지 않는다. 새 toolbar spec에서도360·390·686·760·761·1023·1280px의 모든 날짜 줄 버튼 실제44px 범위 가장자리를 검사한다.

- CI 수정 뒤 관련87개 통과. 리뷰에서 추가한761·1023px 검사로 다음/오늘 실제 누름 범위 충돌2개를 재현하고 기존 PC 오늘 여백6px을 복원했다(폰은 별도0px). 경계760px도 추가하며 기존 검사 약화 없이 최종 toolbar10개를 검사한다.

## 2026-10-09 모양 보완 (같은 PR #444)

시작 main2294697a·branch head e483ce9d 확인: main 변경 없음. 같은 브랜치에 보완하며 새 브랜치/PR 없음.

- 모든 조작 보이는 높이32px, 날짜 줄48px(위8/아래8 padding). 무테 muted 화살표. 보기36px/아이콘16px/1.7 currentColor 선, 한 묶음 외곽선. 주간7열 막대와 월간 격자 구분. divider20×1px, 좌우2px 여백.
- 360px 보이는 폭: 이전16·제목42·다음16·오늘36·구분선1·보기36/36/36·추가36px=255px. 묶음의 투명 누름 공간24px 포함 배치 합계279px, 간격6px·고정여백21px, 안쪽310px에서 남는4px. 모든 실제 누름 범위44px 이상이며 elementFromPoint 가장자리/쌍별 비겹침을 검사한다.
- 이번 변경 spec: calendar-toolbar-one-row(32/36/16px·외곽선·여백·비겹침 추가, 기존 이름/활성/저장/새로고침/이동/모달/제목 동작 유지); button-sizing(추가32px·화살표32px/24px glyph/muted/무테 기대값, 기존 actual44px 클릭/키보드 유지); theme(날짜 줄 paint32px만 변경, actual44px/겹침 유지); list-typography(화살표24px); modal-typography(요청한 화살표 글꼴/색/행간만 정규화, 명시적24px 검사); calendar-hotfix/startup-performance/task-layout-groups(캐시 기대값만).
- RED: 새36px 보기 기대값이 기존44px에서 실패. 초기 GREEN9/10에서 PC 화살표38px 우선 규칙을 발견·32px 수정 뒤 toolbar10개 통과. 초기 인접 검사에서는 잘못 입력한 muted 색 기대값이 실패하여 실제 기존 token으로 검사하도록 수정했다.
- Node341개 통과. 실제360·686·1280 캡처로 모양 검토(커밋 제외). 데이터/동작 JS 및 월간 체크는 변경하지 않는다. cache chain calendar-ui33/styles70/view-loader100/loader332/app220까지 갱신.

- 초기 캐시/시작 인접26개 중25개 통과·startup-performance의 `tab navigation waits for deferred feature data on first click` 1개 실패(로딩 표시 노드 미관측). clean main과 수정본에서 해당 검사는 각1개 재실행 통과했고 동작 코드를 수정하지 않았다. 타이밍 영향은 추정이며 최초 실패 원인은 확정하지 않는다.

- 보완 최종: toolbar+button-sizing24개 통과(32px/44px/비겹침/아이콘/동작). 인접72개 초기66통과/6개 화살표 모양 기대값 실패는 위 token/높이 수정 뒤 button-sizing14개 재검사로 해결했다. 캐시/시작26개 검사에서는 같은 로딩 표시가 다시 실패했지만 startup-performance14개 전체를 별도 실행하여 통과했다. clean main도 올바른 checkout cwd에서 startup14개 통과. 초기 main 검사 도구의 cwd가 작업본이어서 캐시 기대값2개가 잘못 실패한 실행은 baseline 판정에서 제외했다. 모든 최초 실패를 기록하며 검사·동작을 완화하지 않는다.

- 보완 첫 CI smoke의 디자인 반경 검사에서 raw `border-radius:0`을 거부했다. 검사 규칙을 유지하고 보기 묶음 내부의0px 반경 토큰을 선언·사용한다. 모양/크기는 그대로이며 같은 workflow의 모든 Check 단계 스크립트를 로컬 정적으로 실행한다. 캐시 체인도 다시 전파한다.

- 반경 토큰 적용 뒤 toolbar+캐시/시작 관련36개 통과. App smoke workflow의18개 Check 단계 스크립트도 전부 통과(내부 Node 검사18개 포함).

- e559cec 전체 PR E2E981개 중976통과/5실패: add-button-placement(390/1440), design-system, ui-system, workspace가 일정 추가의 기존36px 높이를 기대했다. 이4개 spec의 해당 높이 기대값만32px로 갱신(테스트 제목2개도 일치), 다른 화면36px/폼/등록/핵심 흐름 검사는 유지한다. 변경 테스트 목록에 위4개를 추가한다. 추가 관련17개 첫 실행16통과/1실패는 design-system이 CSS 토큰을 초기 빈 값으로 읽은 경우였다(크기 검사 전); 재검사 결과를 따로 기록한다.

- 누락된 높이 기대값4개 spec 수정 뒤 추가 관련17개 전체 재검사 통과. design-system 단독1개도 통과. 제품 변경 없이 테스트·검증 문서만 추가 커밋하며 캐시 버전 추가 대상 없음.
