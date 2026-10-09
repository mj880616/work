# D-담당조직목록 조사·검증 (2026-10-09)

- 시작: 원격 `origin/main` 재조회, `cdc677196e00e5064f44fb189bf989022f6ea2e9`(#445 merge). 기존 checkout `2294697a`는 사용하지 않고 새 `codex/d-team-list`에서 작업했다.
- 원인(사실): 카드는 `organization-order.js`의 이름 기반 5묶음이고 줄 오른쪽은 별도 `organization_type`이다. 분류별 카드가 아니며, 마지막 두 묶음의 의미·명칭은 저장소에 없었다. 첫 조사 뒤 사용자 지시대로 정지했고, 2026-10-09 보완 지시에서 이름·구성이 확정됐다.

## 변경

- 공통 순서표를 철도·지하철·민자철도·민간도시철도 4묶음으로 변경. 기존 마지막 두 묶음 경계만 합치며 13개 전체 순서는 유지한다. 그 밖은 가나다순 “그 외”, 없으면 머리줄도 없다. 이름은 공통 파일의 `GROUP_NAMES`에만 정의한다.
- 목록 카드 위 이름·개수 12px muted, 줄마다 유형 삭제. 좌우 `--kptu-space-4` 16px, 한 줄 말줄임, 44px 이상 누름, 기존 상세·Enter/Space 접근 유지. 제목 아래 선·빈 공간 삭제, 개수와 추가 버튼 중심 높이 정렬.
- 확정 연결 Google 미완료 할 일 수와 기한 지남 danger는 `KPTUGoogleTasks`의 `peekTasks/listTasks/readLinks/isOverdue` 재사용. 체크 선 아이콘은 #440의 경로·획 규격과 동일하다. 완료·미확정 연결은 제외하고 같은 조직의 중복 연결은 한 번만 센다.
- 최근 날짜는 상세·홈과 같은 `app_suborganization_updates.occurred_at`, KST M.D. 홈의 이번 주 5건은 모든 조직의 최신 기록을 보장하지 못하므로 날짜 두 필드만 전체 조직 ID로 한 번에 읽는다. 500행을 넘으면 기록 단위로 페이지를 읽고 모든 최신 날짜가 확보되거나 끝나면 중단한다. 조직별 요청은 없다.
- 이름은 먼저 그리며 할 일·날짜는 독립적으로 채운다. 실패하면 목록 유지. 기존 기기 할 일 캐시를 재사용하고, Google 연결 해제가 확인되면 옛 개수는 비운다. 세션 변경 시 메타데이터를 지우고 이전 비동기 응답을 버린다. 목록 밖 화면에서 조직 선택을 준비할 때는 추가 메타데이터 요청을 하지 않는다.
- DB·Edge·RLS·저장 키·Android 앱 코드 변경 없음. 권한·저장·조직 상세 경로는 기존 상태를 유지한다.

## 묶음 변경 영향 화면

- 담당조직 목록.
- 홈 빠른 기록의 최근/전체 조직 선택 시트(최근 조직은 전체에서도 유지).
- Google 할 일 편집창과 조직 상세에서 할 일 추가·기존 할 일 연결 선택.
- 일정 등록의 조직 체크, Google 일정 수정의 조직 체크(숨은 기존 연결 보존).
- Drive 요약 Edge는 화면 묶음을 표시하지 않고 정렬에만 기존 배열을 사용한다. Edge 소스·배포는 유지한다. 전체 조직 순서 동일성을 계속 검사한다.

## 바꾼 기존 기대값

- `organization-order.spec.mjs`: 알려진 묶음 5→4, 그 외 포함 6→5, 마지막 2+2→4. 정렬·미등록·기존 선택 보존 검사는 유지. 새 이름·누락된 묶음 이름 매핑 검사 추가.
- `suborganization-filters.spec.mjs`: 행의 유형 글자→없음 및 머리줄 “철도 · 1”; 목록·일정 체크 묶음 6→5; 9호선/김포 사이 경계 제거. 카드 테두리는 머리줄 아래 실제 카드에서 측정한다. 모듈 실패 검사는 비동기 import도 차단해 같은 오류 안내를 계속 검사한다.
- `organization-detail-tasks.spec.mjs`: 같은 경계 1개 제거. 실제 Google 모듈의 조직 14/114개 요청 수 검사 추가.
- `google-tasks-push.spec.mjs`: 같은 경계 1개 제거, 편집창 묶음 6→5. 13개 전체 이름 순서·선택 저장 검사는 유지.
- `d4c-polish.spec.mjs`: 조직 목록의 카드 표면 측정 대상을 `.so-org-group`에서 `.so-group-card`로 변경. 흰 바탕·테두리·44px·행 배경 검사는 유지.
- `drive-summary.test.mjs`: Edge 5묶음과 UI 4묶음의 관계(처음 3개 동일, 마지막 두 배열 합치기)를 정확히 검사하고 양쪽 전체 순서 동일성·미등록 정렬 검사를 유지.
- 캐시 버전 기대값만 변경: `organization-order`, `suborganization-filters`, `startup-performance`, `calendar-hotfix`, `task-layout-groups` spec 및 `app-smoke-check`·`suborganization-filters-e2e` workflow. 조건·성능 한도·검사 수는 줄이지 않았다.

## 검증

- Node: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs` — 341/341 통과.
- Chromium: 관련 spec만 로컬 실행, 전체 E2E는 PR CI. 설치된 `/usr/bin/chromium`을 임시 설정으로 사용한다(운영·저장소 설정 변경 없음).
- 관련 spec: `team-list`, `organization-order`, `suborganization-filters`, `organization-detail-tasks`, `google-tasks-push`, `home-selection-sheet`, `d4c-polish`, `task-layout-groups`, `startup-performance`, `calendar-hotfix`.
- 360·390·1280px: 이름·개수·그 외 숨김·유형 없음·✓N·날짜·빈 경우·danger·말줄임·넘침 없음·누름 높이·높이 맞춤·상세 열기. 조회 지연/실패, Google 연결 해제, 기록 500행 초과, 실제 모듈의 조직 수 대비 요청 수 포함.
- 정적: 기존 smoke·담당조직·조직 상세·프로필 workflow의 Check/Validate 단계, `git diff --check`, JS 구문 검사, `check-loader-cache`.
- 캐시: organization-order v2, suborganizations JS v15/CSS v10, home-read v11, view-loader v102, loader-v2 v334, app v222, styles v72(login 참조). index.html까지 전파.
- 사진은 `/tmp`/시험 산출물에만 두며 커밋하지 않는다. 새 `!important` 없음.
