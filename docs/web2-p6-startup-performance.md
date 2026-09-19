# Web2 P6 초기 로딩 성능

## 범위와 보안 불변조건

P6는 `/app/`의 인증된 홈 critical path만 줄인다. Supabase schema/RLS, Edge Function 인증, URL, 문서 공개 범위, Drive 공개 동기화 순서는 변경하지 않았다. 인증 여부를 결정하기 전에는 내부 shell을 공개하지 않으며, 사용자→workspace membership→workspace 확인 순서를 그대로 유지한다.

## 측정 방법

### 계측점

`app.js`가 `window.__KPTU_STARTUP__` 단일 계측 owner를 만들고 다음 `performance.now()` 시각을 `marks`에 기록하며 `kptu:startup-mark` 이벤트를 보낸다.

1. `htmlStart` (navigation 기준 0)
2. `appJs`
3. `loaderStart`
4. `sessionCheckStart` / `sessionCheckComplete`
5. `workspaceReady` (사용자, membership, workspace 확인 완료)
6. `routeResolved` (`public` 또는 `authenticated`)
7. `homeRendererStart` / `homeRendererReady`
8. `homeDataStart` / `homeDataComplete`
9. `homeUsable`
10. `allInitialModulesComplete` (deferred feature bundle 완료)

개발자 도구에서는 `window.__KPTU_STARTUP__.marks`로 같은 navigation의 원시 값을 읽는다. cold는 DevTools cache를 끄고 새 context에서, warm은 cache를 켠 같은 origin의 두 번째 navigation에서 각각 5회 측정해 중앙값을 사용한다. Resource Timing의 `/app/*.js`와 Supabase 요청을 함께 저장해야 한다.

이 작업 환경에는 Chromium/Playwright가 설치되어 있지 않았고 npm registry와 GitHub network가 HTTP 403으로 차단되어, 로그인 자격증명을 이용한 배포 환경 wall-clock 재측정은 실행하지 못했다. 따라서 시간을 추정하거나 만들어 넣지 않았다. 아래 표의 시간은 사용자 보고 기준 또는 `미측정`으로 명시하고, 코드에서 직접 재현 가능한 요청/import 개수만 전후 수치로 기록한다.

## 변경 전 부팅 경로와 병목 순위

1. **전체 기능 모듈 직렬 대기**: loader가 50개의 top-level `await import()`를 거쳐야 `app-ui-ready`를 보냈다. 전체 그래프는 65개 JS 모듈이었다.
2. **홈과 무관한 기능이 reveal을 차단**: 프로젝트 편집, 팀 관리, 프로필, 사진, 페이지 관리, 언론대응, 회의, Google Calendar/Tasks, 알림, 하위조직 및 모바일 보정까지 홈보다 먼저 완료되어야 했다.
3. **전체 workspace 데이터 선행**: 사용자/membership/workspace 뒤 11개 전체 목록 API(`members`, `profiles`, `spaces`, `groups`, `pages`, `events`, `attendees`, `tasks`, `meetings`, `documents`, `notifications`)를 모두 기다린 후 team readiness가 완료됐다.
4. **인증 context 중복 조회**: team이 조회한 `/auth/v1/user`와 membership을 capability와 홈 dashboard가 각각 다시 조회했다.
5. **독립 import 직렬화**: runtime 이후 router, a11y, session resilience, auth service, capabilities, PWA 등 독립 모듈도 순차 다운로드/평가됐다.

GitHub Pages는 정적 호스팅이므로 query-string 버전이 바뀐 JS/CSS는 cold fetch가 발생한다. 동일 URL의 warm navigation은 브라우저 HTTP cache의 이점을 얻지만 Supabase API는 runtime이 `cache: no-store`로 요청하므로 다시 확인된다. P6는 cache에 기대어 보안/데이터 신선도를 바꾸지 않고 critical 요청 자체를 줄였다.

## 실제 수정사항

- runtime 이후 서로 독립적인 bootstrap import 9개를 안전하게 병렬화했다.
- session 확인 후에만 `team.js`를 import하며, 사용자→membership→workspace 검증 순서는 유지했다.
- 검증된 `{user, membership, workspace}`를 기존 boot lifecycle의 읽기 전용 context로 홈과 capability에 전달해 초기 중복 4요청을 제거했다. 별도 영속 저장소나 권한 판단 source는 추가하지 않았다.
- team의 11개 전체 데이터 요청은 홈 reveal 뒤 feature bundle이 시작할 때로 이동했다. 홈은 자신이 소유한 최소 4개 병렬 query(프로젝트, 마일스톤, 내 할 일, 자료)를 완료한 뒤 usable 이벤트를 보낸다.
- 홈과 무관한 기능 bundle은 home usable 후 `requestIdleCallback`(2.5초 timeout)에서 background load한다. 메뉴와 페이지 편집 버튼의 첫 클릭은 해당 bundle readiness를 기다린 뒤 이어서 실행한다. 직접 `?view=` URL도 bundle readiness를 기다린 뒤 해당 화면을 reveal한다.
- 모바일 스와이프 동작은 홈 진입 시 함께 준비해 첫 제스처가 놓치지 않도록 한다. 소속이 없는 로그인 사용자의 가입 승인 안내는 홈 로드 대신 접근 승인 모듈로 처리한다.
- 페이지 builder는 편집기 open 이벤트 시 lazy load를 유지하고, AI 4개 모듈은 feature bundle 이후 background load한다.
- deferred load 실패는 앱 전체를 제거하지 않고 navigation 아래 `role=alert` 안내를 표시한다.
- session 제거 이벤트가 오면 즉시 인증 화면으로 전환하고 boot context를 폐기한다. 홈 renderer의 epoch guard도 이전 사용자의 늦은 응답 commit을 계속 차단한다.

## 전/후 결과

| 지표 | 변경 전 | 변경 후 |
|---|---:|---:|
| shell 표시 | 사용자 관측 10~15초 범위(홈과 동일 reveal gate) | 배포 wall-clock 미측정 |
| auth 완료 | 기존 계측 없음 | `sessionCheckComplete`로 계측 가능; wall-clock 미측정 |
| home data 완료 | 기존 계측 없음 | `homeDataComplete`로 계측 가능; wall-clock 미측정 |
| home usable | 사용자 관측 10~15초 범위 | `homeUsable`로 계측 가능; wall-clock 미측정 |
| 전체 초기 모듈 완료 | 기존 계측 없음 | `allInitialModulesComplete`로 별도 계측; 홈을 차단하지 않음 |
| 전체 loader import 그래프 | 65 | 65 (기능 삭제 없음) |
| home usable 전 명시적 top-level 순차 import | 50 | 6 |
| home usable 전 dynamic import 모듈 | 65 | 16 |
| home usable 전 Supabase API 요청 | 최소 22 | 7 |

요청 수는 로그인 session이 만료되지 않았고 invite/Google callback이 없는 기본 인증 홈에서 source call path를 세어 얻었다. 변경 전은 user/membership/workspace 3 + 전체 workspace 11 + capability 2 + 홈 context 2 + 홈 data 4에서 중복되는 실행을 포함한 최소치이며, 변경 후는 user/membership/workspace 3 + 홈 data 4이다. 기능 bundle 완료 시 전체 데이터 요청은 그대로 수행되므로 기능이나 데이터 일관성을 제거한 최적화가 아니다.

## 회귀검사

`startup-performance.spec.mjs`는 다음 계약을 검사한다.

- 홈 readiness가 non-critical bundle 호출보다 먼저인지
- 직접 feature URL이 bundle readiness를 기다리는지
- deferred failure가 사용자에게 alert로 남는지
- 홈이 검증된 boot context를 재사용하고 session epoch를 검사하는지
- page builder와 AI가 critical top-level await 경로로 돌아오지 않는지

기존 public workspace 코드는 인증 분기 이전/이후 동작을 변경하지 않았다. 모바일 UI 모듈은 public 경로에서는 기존처럼 즉시, 인증 홈에서는 deferred bundle에서 로드된다. 직접 URL은 bundle을 선행하여 reload semantics를 보존한다.

## 일부러 수정하지 않은 부분

- 65개 전체 기능 모듈을 삭제하거나 합치지 않았다. 이는 기능별 경계 변경으로 P6 최소 범위를 넘는다.
- Supabase query/RLS를 집계 RPC로 바꾸지 않았다. schema/RPC 및 권한 검토가 필요한 별도 제안이다.
- API cache 정책을 바꾸지 않았다. 인증 데이터가 stale해지는 숫자 최적화를 피했다.
- CSS bundle 분할은 하지 않았다. 현재 단일 `styles.css` 계층의 소유권과 GitHub Pages cache invariant를 먼저 별도로 측정해야 한다.

## 남은 위험과 후속 후보

1. 실제 GitHub Pages + Supabase 지역 latency의 cold/warm 5회 중앙값을 위 계측으로 수집해 2~3초/5초 목표를 판정해야 한다.
2. background bundle은 아직 하나의 큰 dependency-ordered unit이다. 다음 단계에서는 calendar/tasks/projects/pages/team별 명시적 manifest와 router readiness contract로 분할할 수 있다.
3. team 전체 데이터 11요청 중 화면별 select/range 축소는 RLS와 reload/save 경로 전수 검토 뒤 진행해야 한다.
4. 홈의 milestone query는 workspace 조건이 직접 없고 project id 교집합으로 제한된다. 노출 안전성은 기존 RLS에 의존하며 P6에서는 policy를 변경하지 않았다.
5. GitHub Pages는 PR preview를 제공하지 않으므로 실제 배포 성능 검증은 승인된 preview host 또는 main 병합 후 관찰 절차가 필요하다.
