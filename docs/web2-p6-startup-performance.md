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

개발자 도구에서는 `window.__KPTU_STARTUP__.marks`로 같은 navigation의 원시 값을 읽을 수 있다. 자동 비교는 `tests/app-e2e/startup-benchmark.mjs`와 `.github/workflows/app-e2e-check.yml`에서 수행한다. 기준 main `3d84e8e18a822c84015bf7a8a4a556b42d7f2f1c`와 P6 코드를 각각 로컬 정적 서버로 열고 정상 로그인 화면을 거쳐 인증 세션을 만든다. 두 버전 모두 동일한 모의 Supabase 응답을 사용한다. GitHub Actions ubuntu-latest, Chromium/Playwright 1.55.0, 1280×800에서 추가 네트워크 지연 없이 측정한다. cold는 새 브라우저 context의 첫 앱 진입, warm은 같은 context의 두 번째 진입이다. 각각 3회 중앙값을 사용한다. shell은 topbar DOM, auth는 검증된 workspace 역할 표시, home data는 네 홈 패널의 내용 생성, home usable은 그 데이터와 앱 가시성의 동시 충족으로 판정한다. 기존 main의 전체 모듈 완료는 `kptu:app-ui-ready`, P6는 `allInitialModulesComplete` 계측점이다. Resource Timing에서 home usable 시점까지의 JS URL 및 Supabase 요청을 센다.

이 수치는 동일한 조건의 실제 Chromium 실행 결과다([측정 CI 실행](https://github.com/mj880616/work/actions/runs/35425160160)). 다만 모의 API에 지연을 넣지 않았고 실서비스 로그인 계정·GitHub Pages 지역 네트워크를 사용하지 않았으므로 사용자 관측 10~15초를 재현하거나 실제 환경의 2~3초/5초 목표 달성을 판정하지 않는다. 그 수치는 실제 서비스에서 별도 계측이 필요하다.

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
- 인증된 앱 영역은 사용자·membership·workspace 검증 뒤에만 표시한다. 그 뒤 UI 준비 중 발생한 화면 전환은 URL에 보존해 준비 완료 시 홈으로 되돌아가는 경쟁 조건을 막는다.
- 지연 로딩된 메시지 메뉴가 추가되면 라우터의 활성 메뉴 스크롤 정렬을 호출한다.
- 페이지 builder는 편집기 open 이벤트 시 lazy load를 유지하고, AI 4개 모듈은 feature bundle 이후 background load한다.
- deferred load 실패는 앱 전체를 제거하지 않고 navigation 아래 `role=alert` 안내를 표시한다. 홈 핵심 API가 실패하면 오류를 보여주되 `homeUsable` 성공 계측점은 기록하지 않는다.
- session 제거 이벤트가 오면 즉시 인증 화면으로 전환하고 boot context를 폐기한다. 홈 renderer의 epoch guard도 이전 사용자의 늦은 응답 commit을 계속 차단한다.

## 전/후 결과

아래는 위 CI에서 실제 측정한 3회 중앙값이며 단위는 ms이다. 인증 완료는 UI에서 사용자와 workspace 확인 결과가 표시된 시점이다.

| 지표 | cold 변경 전 | cold 변경 후 | warm 변경 전 | warm 변경 후 |
|---|---:|---:|---:|---:|
| shell 표시 | 14.2 | 14.0 | 15.2 | 17.5 |
| auth/workspace 완료 | 134.8 | 108.6 | 120.1 | 106.0 |
| home data 완료 | 313.6 | 203.6 | 285.4 | 200.9 |
| home usable | 454.1 | 203.6 | 425.3 | 200.9 |
| 전체 초기 모듈 완료 | 453.0 | 504.8 | 424.4 | 483.1 |
| home usable 시점 JS import 수 | 61 | 18 | 61 | 18 |
| home usable 시점 Supabase API 요청 수 | 107 | 7 | 107 | 7 |

이 환경에서 home usable은 cold 250.5ms(55.2%), warm 224.4ms(52.8%) 단축됐다. 전체 모듈 완료 시점은 뒤로 이동했다. 홈과 무관한 작업을 홈 표시 이후로 옮긴 설계에 따른 결과다. 기존 loader의 전체 정적 import 그래프는 65개이며 기능을 삭제하지 않았다. 요청 수 107→7은 이 모의 계정과 응답을 사용한 브라우저 Resource Timing 기록이다. 코드 경로의 최소 요청 수 22→7과 범위가 다르고, 실제 계정의 데이터·모듈 분기·네트워크 조건에 따라 달라질 수 있다.

## 회귀검사

`startup-performance.spec.mjs`는 다음 계약을 검사한다.

- 홈 readiness가 non-critical bundle 호출보다 먼저인지
- 직접 feature URL이 bundle readiness를 기다리는지
- deferred failure가 사용자에게 alert로 남는지
- 홈이 검증된 boot context를 재사용하고 session epoch를 검사하는지
- page builder와 AI가 critical top-level await 경로로 돌아오지 않는지

기존 public workspace 코드는 인증 분기 이전/이후 동작을 변경하지 않았다. 모바일 스와이프 모듈은 public 경로와 인증 홈에서 모두 초기 로드하며, 직접 feature URL은 bundle을 선행하여 reload 동작을 보존한다. 원래의 모바일 메뉴·스와이프 E2E 검사는 수정 없이 통과했다. 최종 코드의 측정 CI 실행에서 11개 워크플로와 App browser E2E 102개가 통과했다.

## 일부러 수정하지 않은 부분

- 65개 전체 기능 모듈을 삭제하거나 합치지 않았다. 이는 기능별 경계 변경으로 P6 최소 범위를 넘는다.
- Supabase query/RLS를 집계 RPC로 바꾸지 않았다. schema/RPC 및 권한 검토가 필요한 별도 제안이다.
- API cache 정책을 바꾸지 않았다. 인증 데이터가 stale해지는 숫자 최적화를 피했다.
- CSS bundle 분할은 하지 않았다. 현재 단일 `styles.css` 계층의 소유권과 GitHub Pages cache invariant를 먼저 별도로 측정해야 한다.

## 남은 위험과 후속 후보

1. 실제 GitHub Pages + Supabase 지역 latency의 cold/warm 5회 중앙값을 위 계측으로 수집해 2~3초/5초 목표를 판정해야 한다. CI의 지연 없는 모의 응답으로 실사용 시간을 추정할 수 없다.
2. background bundle은 아직 하나의 큰 dependency-ordered unit이다. 다음 단계에서는 calendar/tasks/projects/pages/team별 명시적 manifest와 router readiness contract로 분할할 수 있다.
3. team 전체 데이터 11요청 중 화면별 select/range 축소는 RLS와 reload/save 경로 전수 검토 뒤 진행해야 한다.
4. 홈의 milestone query는 workspace 조건이 직접 없고 project id 교집합으로 제한된다. 노출 안전성은 기존 RLS에 의존하며 P6에서는 policy를 변경하지 않았다.
5. GitHub Pages는 PR preview를 제공하지 않으므로 실제 배포 성능 검증은 승인된 preview host 또는 main 병합 후 관찰 절차가 필요하다.
