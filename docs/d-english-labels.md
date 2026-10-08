# D-영어표시정리 조사와 검증

기준: `origin/main` 9e72b2db (#442 merge), 2026-10-08. 수정 전 `app/` 전체 HTML·JS의 머리표를 조사했다. 제품·서비스 이름과 사용자 데이터는 제외했다.

## 수정 전 목록

#437 보고의 “15곳”은 본문 목록을 실제로 세면 17곳이다. 로그인 카드 1곳을 포함해 현재 18곳이다. 아래 18곳은 모두 기존 제목으로 의미가 충분하여 삭제한다. 한국어로 대체한 곳은 없다. 기존 한국어 머리표는 유지한다.

| 파일·수정 전 줄 | 창·화면 | 영어 머리표 | 처리·로딩 상태 |
| --- | --- | --- | --- |
| `app/index.html:35` | bootView | WEB2 | 삭제 |
| `app/index.html:142` | documentModal | LIBRARY | 삭제 |
| `app/index.html:144` | meetingModal | MEETING RESULT | 삭제 |
| `app/library-upload.js:59` | libraryManageModal | LIBRARY | 삭제 |
| `app/library-upload.js:59` | libraryEditModal | EDIT METADATA | 삭제 |
| `app/meeting-round-detail.js:20` | meetingRoundDetailModal | MEETING RESULT | 삭제 |
| `app/password-reset.js:9` | forgotPasswordModal | PASSWORD RECOVERY | 삭제 · 현재 로더 미사용 |
| `app/password-reset.js:10` | changePasswordModal | NEW PASSWORD | 삭제 · 현재 로더 미사용 |
| `app/project-suborganization-links.js:27` | polManageModal | RELATED WORK | 삭제 · 현재 로더 미사용 |
| `app/project-system-v3.js:144` | ps3CreateModal | PROJECT | 삭제 |
| `app/project-system-v3.js:148` | ps3DeleteModal | DELETE PROJECT | 삭제 |
| `app/project-system-v3.js:149` | ps3ArchiveModal | ARCHIVED PROJECTS | 삭제 |
| `app/project-templates.js:133` | pvtModal | PROJECT TEMPLATES | 삭제 · 현재 로더 미사용 |
| `app/suborganizations.js:23` | soEditModal | SUB ORGANIZATION | 삭제 |
| `app/suborganizations.js:23` | soAssignModal | ASSIGNEES | 삭제 |
| `app/workflow-ai-v3.js:13` | wfMeetingAiModal | AI MEETING DRAFT | 삭제 · 현재 로더 미사용 |
| `app/workplace-detail.js:8` | wdAffModal | AFFILIATIONS | 삭제 |
| `app/login/index.html:20` | 로그인 카드 | KPTU PUBLIC INSTITUTIONS TEAM | 삭제 |

제목과 닫기 버튼을 포함한 기존 `.modal-head` 구조를 유지한다. 머리표 요소 자체를 삭제하여 그 요소의 아래 여백도 제거한다. CSS·새 스타일·`!important` 추가는 없다. 로더 미사용 5곳은 표시 문구만 삭제하며 기능을 활성화하지 않는다. 해당 4개 파일을 불러오는 경로가 없어 올릴 캐시 버전도 없다.

## 버튼 글자 소유자

원인(사실): 공통 HTML의 버튼 글자 변경이 홈·일정에서만 실행되는 `calendar-mobile-ui.js`에 있었다. 자료실·회의로 직접 진입하거나 새로고침하면 긴 글자가 유지됐다.

`action-labels.js`가 기존 `mobileLabels` 6개 전부를 단독으로 소유한다. 인증 후 공통 `loader-v2.js`에서 초기 화면 공개 전 한 번 실행하고, `matchMedia` 변경으로 ≤760px은 첫 번째 값, ≥761px은 두 번째 값을 적용한다. 일정 전용 ARIA·도구 모음 처리는 기존 모듈에 유지한다. 프로젝트 부팅의 중복 글자 대입도 제거한다. 지연 덮어쓰기·MutationObserver 없음.

| 버튼 | ≤760px | ≥761px | 현재 사용 |
| --- | --- | --- | --- |
| newDocumentBtn | + 자료 | + 자료 등록 | 자료실 |
| newMeetingBtn | + 회의 | + 회의 결과 | 회의 |
| newPageBtn | + 페이지 | + 새 페이지 | 화면에 없음 · 정리 대상 보고만 |
| newProjectBtn | + 프로젝트 | + 프로젝트 | 프로젝트 |
| inviteBtn | + 초대 | 구성원 초대 | 화면에 없음 · 정리 대상 보고만 |
| newGroupBtn | + 그룹 | + 그룹 | 화면에 없음 · 정리 대상 보고만 |

게시판은 Web1 자료를 읽는 기존 구조로 추가 버튼이 없다. 네 경로의 게시판 진입·새로고침에서도 이 버튼들을 복원하지 않는지 검사한다.

## 검증

- 수정 전 회귀 재현: Node 머리표 검사는 기존 영어 때문에 실패, Chromium 390px 자료실 직접 진입은 `+ 자료 등록`으로 실패했다.
- 수정 후 Node: `node --test tests/*.test.mjs tests/domain/*.test.mjs tests/security/*.test.mjs scripts/*.test.mjs` 341개 통과(기준 main 322개 통과).
- 설치된 `/usr/bin/chromium`: 새 `english-labels.spec.mjs` 20개 + 기존 `add-button-placement.spec.mjs` 14개 = 34개 통과. 390·760·761·1280px, 자료실·회의·게시판·프로젝트 직접 진입/새로고침/일정·홈 경유/크기 변경 검사. 없는 버튼은 부재를 확인하고 별도 합성 DOM으로 6개 매핑 전체를 확인했다.
- 기존 모달 글자 검사 `modal-typography.spec.mjs` 6개 통과. 기존 제목·한국어 머리표·글자 역할 유지.
- 캐시 문자열을 변경한 기존 spec의 해당 검사 8개 통과. 전체 로컬 브라우저 실행은 관련 spec만(48개), 전체 E2E는 PR CI에서 확인한다.
- workflow의 JS 문법·의존성·인접 정적 검사 18개, `git diff --check`, `node scripts/check-loader-cache.mjs --base origin/main` 통과.
- 코드 리뷰: 차단 문제 없음. 홈의 오래된 글자 소유자 주석과 새 검사 파일의 CI 경로 조건 보완.
- 기존 문구 기대값을 바꾼 테스트: **없음**. 캐시 버전 기대값만 변경한 파일: `calendar-hotfix.spec.mjs`, `meeting-entry.spec.mjs`, `organization-order.spec.mjs`, `project-v3-structure.spec.mjs`, `startup-performance.spec.mjs`, `suborganization-filters.spec.mjs`, `task-layout-groups.spec.mjs` (모두 `tests/app-e2e/`).
- CI workflow는 기존 검사 조건을 유지하고 캐시 숫자만 갱신했다. `app-smoke-check.yml`에는 머리표 Node 검사와 공통 버튼 모듈 의존성 확인을 추가했다.
- 사진 커밋·CSS 변경·새 저장소 키·DB/RLS/Edge 변경·운영 접근 없음. 모든 브라우저 API는 합성 응답이다.

범위 밖: 현재 없는 `newPageBtn`·`inviteBtn`·`newGroupBtn`, 로더 미사용 4개 파일(머리표 5곳), 기존 Cloudflare 배포 workflow의 오래된 앱 검사 URL은 정리 대상 보고만 한다. 미사용 파일의 표시 문구 외 기능·로딩은 바꾸지 않았다.

사용자 확인: 실제 폰/WebView 표시 확인, PC 실기기 확인은 귀국 뒤. PR CI 확인 후 merge하지 않고 정지한다.
