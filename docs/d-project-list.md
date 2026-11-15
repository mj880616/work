# D-프로젝트목록 조사·검증 (2026-10-09)

- PR: [#447](https://github.com/mj880616/work/pull/447), merge 대기.

- 시작: `origin/main` 재조회, `f1bb66a910335c7bdc12690b3e605224f408db9c`(#446 merge). 오래된 checkout `cdc67719`에서 구현하지 않고 `codex/d-project-list`를 최신 main에서 만들었다.
- 원인(사실): 프로젝트 V3 목록은 담당조직과 별도 두 줄 CSS이고, 큰 카드 제목·동급 보관함 버튼·하위 토글을 설치했다. 상위에 자신/하위의 할 일·자료를 합산하고 0도 표시했다. 일정·진행 날짜 조회는 없었다.

## 구현·조회 상한

- 화면 상단 제목 유지, 카드 머리줄 `프로젝트 N개`(상위 수, 12px muted), `보관 N` 글자 링크(0 숨김)와 추가 버튼. 상위·하위 모두 기존 프로젝트 상세를 연다. 하위는 항상 16px 더 들여 쓰며 하위 추가는 상세 본문에만 남긴다.
- 공용 클래스로 옮기는 방식을 선택했다. `list-row.css`의 `kptu-list-row/main/name/summary/chevron/task-count/overdue`는 좌우 16px, 모바일 48px·PC 50px 줄, 이름 16px 말줄임, 숫자 12px muted, danger, 체크 SVG 경로/획을 한 곳에서 정의한다. 담당조직의 기존 `so-*` 선택자는 유지하여 이벤트/검사 대상이 바뀌지 않는다.
- 각 줄은 자기 프로젝트의 미완료 할 일만 센다(상위/하위 중복 합산 없음). Google 완료 상태·기한은 홈/담당조직과 같은 `KPTUGoogleTasks.peekTasks/listTasks/readLinks/isOverdue`. 확정 연결만 포함하고 같은 task ID는 중복 제거한다. 자료 조회는 목록에서 없앴으며 상세의 기존 자료/하위 자료 개수 조회는 유지한다.
- 날짜·일정 HTTP **1회**: owner/workspace/목록 project ID 범위의 `app_spaces`에 `progress:app_project_progress_updates!project_id(effective_on)`와 `milestones:app_project_milestones!project_id(start_at)`을 포함한다. 진행은 `effective_on.desc,created_at.desc`와 `progress.limit=1`; 일정은 KST 오늘 시작 이후·미완료/미취소, `start_at.asc`, `milestones.limit=1`. 각 프로젝트에서 1건만 반환하므로 한 프로젝트에 과거 기록 1,200개가 몰려도 다른 프로젝트의 오래된 최신 기록을 빠뜨리지 않는다. 전체 history offset 순회나 프로젝트별 조회는 없다. inner join을 쓰지 않아 기록 없는 프로젝트도 남는다.
- 정상 cold 메타데이터 요청은 `1 + 1 + ceil(T/50)`(날짜·일정, overview, 연결; T는 Google 할 일 수). 기기 캐시를 먼저 채우면 연결 읽기는 최대 `ceil(C/50)+ceil(T/50)`(C는 기존 캐시 할 일 수). 구형 Edge의 기존 overview fallback은 status/tasks로 최대 2회 추가. 프로젝트 수 P와 무관하다. 이름/catalog/context와 상세 자체의 기존 요청은 이 메타데이터 상한과 별개다.
- 목록 이름은 먼저 표시한다. 날짜·할 일 실패는 서로 막지 않고 기존 표시를 유지한다. 연결 해제가 확인되면 옛 task 수를 비운다. session/run 검증으로 늦은 응답을 버린다. 상세에서 읽은 날짜는 검증된 상세 renderer에서 같은 목록 상태에 반영한다. 진행/일정 저장, Google 할 일/연결 변경 뒤에는 같은 배치 조회로 갱신한다.
- 홈 처음 진입 후 프로젝트로 이동하는 테스트에서는 홈 overview가 요청 수에 섞인다. 요청 수 검사는 프로젝트 직접 진입으로 별도 측정한다. 초기 모듈 설치 때 다른 화면에 있으면 목록 메타데이터를 읽지 않는다.

## 바꾼 기존 기대값

- `project-system-v3.spec.mjs`: 큰 제목→상위 개수; 보관함→보관 N; 상위의 합산 할 일/자료와 0→각 줄 자기 할 일/일정/날짜 및 0 생략; 하위 숨김·토글→상시 표시·토글 없음. 상위/하위 상세·보관함·복구 버튼·44px·넘침 검사는 유지/강화. 360/390/1280px, 확정/미확정/완료/중복/기한 지남, KST 오늘, 일정 완료/취소/과거 제외, 오래된 최신 기록, 2/202 프로젝트 동일 요청 수, 지연/독립 실패 검사를 추가했다. mock은 실제 PostgREST 포함 관계 제한을 반영하고 Google overview에 실제 fixture 할 일을 반환한다.
- `add-button-placement.spec.mjs`: 카드 h2→개수 span, 보관 글자 링크 44px 높이/너비와 36px 추가 버튼의 중심 정렬, 보관 fixture 1개. 카드 안 위치·겹침 없음·재그리기·보관/추가 열기 검사는 유지한다.
- `list-typography.spec.mjs`: 프로젝트 카드 제목 20px→개수 12px. 보관 이름은 공용 줄의 16px/750/21.6px, metadata는 공용 12px/16px·grid 자동 높이·visible/clip. 다른 화면과 모달/입력의 기존 비교는 유지한다.
- `button-sizing.spec.mjs`: 보관 버튼의 36px/secondary 기대값→44px 실제 영역·12px muted 글자 링크·투명 배경·padding/border 0. 보관 링크만 실제 rect로 네 모서리 hit-test; 추가 버튼의 기존 pseudo 영역 검사는 유지한다.
- `modal-typography.spec.mjs`: 프로젝트 카드 h2→12px muted 개수 span, 보관 버튼→글자 링크, 프로젝트 이름→공용 16px/750/21.6px, 0 metadata→20px chevron. 담당조직은 공용 클래스명이 추가된 것만 기대값에 반영하며 기존 크기·굵기·색 비교를 유지한다.
- `app-smoke-check`: 토글 존재→토글 금지, 하위 줄·개수·공용 클래스·per-parent limit 존재 검사를 추가한다. 기존 단일 renderer/관리 기능/권한 검사는 유지한다.
- 캐시 기대값만: `project-v3-structure`, `calendar-hotfix`, `startup-performance`, `task-layout-groups`, `suborganization-filters`, `organization-order`와 두 workflow. `team-list`의 기대값·검사는 수정하지 않는다.

## 검증·제한

- Node 341/341 통과: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs`.
- 관련 Chromium **198/198 통과**: project-system-v3, project-v3-structure, team-list, suborganization-filters, startup-performance, calendar-hotfix, task-layout-groups, organization-order(148), add-button-placement/list-typography(20), d4c-polish(10), button-sizing/modal-typography(20). 첫 전체 CI는 1009/1015 통과, 이 두 spec의 이전 디자인 기대값 6개 실패를 수정하고 관련 20개를 재검증했다. PR CI 결과는 PR에 기록한다. 클라우드에서는 관련 spec만 실행하며 전체 E2E는 PR CI가 실행한다. 설치된 `/usr/bin/chromium`, `/tmp` 임시 설정을 사용한다.
- 정적: smoke/담당조직/조직 상세 workflow의 Check 단계, JS 구문 검사, `git diff --check`, 재귀 캐시 검사.
- 캐시: project V3 JS v41/CSS v24, suborganizations JS v16/CSS v11, list-row CSS v1, view-loader v103, loader-v2 v335, app v223, styles v73(login 참조). index.html까지 전파한다.
- DB·Edge·RLS·저장 키 변경 및 production 접근 없음. 포함 관계 SQL의 원래 FK DDL은 저장소에 없어 연결 발견 자체는 운영에 접속해 검증하지 않았다. 표준 PostgREST `!project_id` 구문을 사용하며 포함 관계 실패에도 이름·상세는 유지된다.
- 범위 밖: 담당조직의 기존 진행 기록 페이지 순회는 이 프로젝트 목록 작업에서 변경하지 않는다.
- 사진·시험 산출물은 커밋하지 않는다. 새 `!important` 없음. merge 금지.
