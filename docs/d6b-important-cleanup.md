# D-6b: #422 dialog 중요도 정리

기준: main `23f5b87241a6a8b2db4f6bb552237ef4d41a3139` (#449 merge), Codex 웹. 아래 줄 번호는 **수정 전 main** 기준이다. 강도는 `(ID, class/attribute/pseudo-class, type)`이며 `:is()`·`:not()`는 가장 강한 인자를 사용한다. 별도 표시 없는 경쟁 규칙은 모두 일반 선언이다.

실제 원인은 두 종류였다. 일반 규칙 대부분은 명시적 dialog ID보다 약하므로 `!important`가 필요하지 않았다. 실제 중요도/인라인 충돌은 모바일 자료실 hint와 미로딩 workflow의 안내문이었다. 이 값들을 같은 역할 토큰으로 정렬(a)하고, 나머지 규칙은 공통 dialog 보정 소유 `workspace-ui.css` 또는 각 화면 CSS 끝으로 옮겼다(b). 선택자를 늘리거나 새 `!important`를 추가하지 않았다. c로 남긴 대상은 없다.

| main 줄 / 역할 | 경쟁 규칙: main 파일·줄 / 강도 / 값 / 중요도 | 처리 | 390px·1280px font-size/color 비교(매칭 수/폭) |
| --- | --- | --- | --- |
| 195 제목 | `base-ui.css:139 .modal-head h2` (0,1,1), 20px; `web1-press.css:1 .w1p-detail-head h2` (0,1,1), 16px; `topbar-actions.css:19 .theme-panel h2` (0,1,1), title 토큰. 대상은 (1,1,1). | b → workspace-ui | 동일, 26 |
| 196 소제목 | `project-system-v3.css:33,149 .ps3-section-head h3` (0,1,1), 15/14px; `meeting-ui.css:2 .meeting-entry-section legend` (0,1,1), 12px; `google-tasks.css:75 .gt-links legend` (0,1,1), 12px; `workplace-detail.css:4,13 .wd-head h3/.wd-aff-group>b` (0,1,1), 15/12px; `suborganizations.css:13 .so-org-box>b` (0,1,1), 12px. 대상 (1,1,1). | b → workspace-ui | 동일, 25 |
| 197 본문·입력 | `base-ui.css:53 button,input,select,textarea` (0,0,1), font:inherit; `project-system-v3.css:43,68,77 .ps3-summary/.ps3-content-body/.ps3-content-table-wrap table` (0,1,0)/(0,1,1), 11/11/10px; `workplace-detail.css:7 .wd-basic-grid dd` (0,1,1), 11.5px; `base-ui.css:144 .revision-box` (0,1,0), 12px. 대상 (1,1,1). 안내 본문 p와 200의 메타 역할이 겹칠 때는 200이 우선. | b → workspace-ui | 동일, 130 |
| 198 label·dt | `base-ui.css:77 label` (0,0,1), 12px/muted; `calendar-ui.css:77 .calendar-color-label` (0,1,0), 11px/ink; `workplace-detail.css:7 .wd-basic-grid dt` (0,1,1), 9.5px/muted; `project-system-v3.css:81 .ps3-content-editor label` (0,1,1), 10px. 대상 (1,1,1). | b → workspace-ui | 동일, 100 |
| 199 메타·보조색 | `base-ui.css:69,111,112,121 .eyebrow/.badge/.badge.published/.updated` (0,1,0)/(0,2,0), 11px/link·muted·success·faint; `project-system-v3.css:54,64,150,165 .ps3-row small/.ps3-content-heading small/.ps3-count/.ps3-pg-count` (0,1,1)/(0,1,0), 9/9/12/11px, muted·faint; `workplace-detail.css:12 .wd-aff-chip.taskforce` (0,2,0), warning; `library-upload.css:20,22 .library-selected-file.error/.unknown .library-upload-state` (0,3,0), danger/warning; `google-tasks.css:60 .gt-meta` (0,1,0), 10px/muted. 대상 (1,1,1). | b → workspace-ui | 동일, 40 |
| 200 안내·상태 | `library-upload.css:34 .library-picker-hint` (0,1,0), **10.5px!important**; `workflow-ai-v3.js:10 #wfTaskRule`와 `:13 #wfMeetingDraft p.muted`의 **인라인 11/10.5px**; `google-tasks.css:69,72,73 .gt-status/.gt-scope-note/.gt-muted` (0,1,0), 11px; `project-system-v3.css:38 .ps3-section-head p` (0,1,1), 10px; `library-upload.css:23 .library-multi-note` (0,1,0), 10.5px; `base-ui.css:93,96 .status/.notice` (0,1,0), 12px. 대상 (2,0,0), `#wfTaskRule`를 포함한 기존 :is 강도 그대로. | **a** hint와 workflow 인라인을 meta 토큰으로 정렬; **b** → workspace-ui | 동일, 47 |
| 201 프로젝트 본문 b | `project-system-v3.css:41 .ps3-stat-grid b` (0,1,1), 18px; `:51,178 .ps3-row-main>b/.ps3-row-title b` (0,1,1), 11/12px; `.ps3-summary`의 11px 상속. 대상 (1,1,1). | b → project-system-v3 | 동일, 5 |
| 202 진행·목표 본문 | `project-system-v3.css:140 .ps3-objective` (0,1,0), 12px; `:166 .ps3-pg-line2` (0,1,0)의 12px 상속; `:175 .ps3-pg-record p` (0,1,1), 12px; 원래 base 200의 .muted 역할 (2,0,0), meta!important. 대상 (2,0,0), 200 뒤의 본문 예외 유지. | b → project-system-v3 | 동일, 3 |
| 203 상세 유형 | `project-system-v3.css:118,119 .ps3-type-row b/small` (0,1,1), 11/9.5px; 원래 base 199 small (1,1,1), meta!important. 대상 (1,1,1). 현 템플릿은 유형 줄을 생성하지 않지만 보존된 역할 구조로 비교. | b → project-system-v3 | 동일, 2 |
| 204 조직 연도 | `workplace-detail.css:11 .wd-year` (0,1,0), 11px. 대상 (1,1,0). | b → workplace-detail | 동일, 1 |
| 205 자료실 드롭존 제목 | `library-upload.css:6 .library-dropzone strong` (0,1,1), 13px. 대상 (1,1,1). | b → library-upload | 동일, 1 |
| 206 회의 자료 label span | `meeting-ui.css:8 .meeting-materials-block label span` (0,1,2), 11px/muted. 대상 (1,1,2). | b → meeting-ui | 동일, 1 |
| 207 보관 프로젝트 메타 | `list-row.css:7 .kptu-list-summary` (0,1,0), 12px/muted. 이미 값이 같고 ID보다 약하다. 대상 (1,1,0). | b → project-system-v3 | 동일, 1 |
| 208 생성 유형 | `project-system-v3.css:118,119 .ps3-type-row b/small` (0,1,1), 11/9.5px; 원래 base 199 small (1,1,1), meta!important. 현 템플릿은 생성하지 않지만 보존된 역할 구조로 비교. 대상 (1,1,1). | b → project-system-v3 | 동일, 2 |
| 209 할 일 연결 상태 | `google-tasks.css:87 .gt-linked-msg` (0,1,0), 11px. 대상 (1,1,0). | b → google-tasks | 동일, 1 |
| 210 게시판 상세 제목 | `web1-board.css:12 .w1b-detail-head h2` (0,1,1), 16px. 대상 (1,1,1). 모바일 제목의 숨김·배치 규칙은 건드리지 않음. | b → web1-board | 동일, 1 |

16개는 규칙 줄 수이고, 실제 `!important` 선언은 20개였다(198·199·206·207은 font-size와 color 둘 다). base-ui.css **24→4**. 55~57행 원문은 그대로이며 57행에 visibility와 pointer-events 두 선언이 있어 숨김 3줄의 중요도는 4개다. 다른 파일의 기존 중요도 개수는 유지된다. `#wfMeetingAiModal`을 포함한 모든 원래 선택자를 문자열 그대로 보존한다. workflow 모듈은 여전히 로더에서 불러오지 않는다.

캐시 변경:

| 파일 | 전 → 후 | 참조 갱신 |
| --- | --- | --- |
| base-ui.css | 15 → 16 | styles.css, critical.css, index.html preload |
| workspace-ui.css | 10 → 11 | styles.css, critical.css, index.html preload |
| project-system-v3.css | 24 → 25 | styles.css, view-loader.js |
| workplace-detail.css | 6 → 7 | styles.css, view-loader.js |
| library-upload.css | 4 → 5 | styles.css, view-loader.js |
| meeting-ui.css | 12 → 13 | styles.css, view-loader.js |
| google-tasks.css | 24 → 25 | styles.css, view-loader.js (home/tasks/projects/meetings/team/background) |
| web1-board.css | 5 → 6 | styles.css, view-loader.js |
| styles.css | 73 → 74 | login/index.html |
| critical.css | 25 → 26 | index.html |
| view-loader.js | 104 → 105 | loader-v2.js |
| loader-v2.js | 336 → 337 | app.js, index.html modulepreload |
| app.js | 224 → 225 | index.html |

workflow-ai-v3.js는 로더 미참조이므로 올릴 버전이 없다. 정적 smoke의 존재 확인만 유지한다. fixture에 이 변경 버전의 고정 참조가 없어 fixture 변경은 없다. workflow 3파일은 D-6c의 실행 범위·권한 변경을 포함하지 않으며 아래 기존 기대 문자열만 올렸다.

테스트 변경 줄(최종 파일 기준):

- `tests/app-e2e/modal-typography.spec.mjs:190~257`: 새 검사 3개. 고정 main의 **전체 CSS/JS/HTML 응답**과 현재 파일을 동일 mock으로 부팅하여 390px·1280px 각각 16개 선택자가 매칭하는 **모든** 요소의 font-size/color를 정확히 비교한다. 줄별 매칭이 0이면 실패하며, actual template 외 연도·유형·진행·오류색 등 조건부 역할을 같은 DOM 구조로 양쪽에 보충한다. 미로딩 workflow HTML은 각 소스에서 따로 추출하므로 인라인 토큰 수정도 검사된다. 숨김 원문·선택자 보존과 소유 CSS의 중요도 개수 증가 금지도 검사한다. 기존 D-3e/D-4b 검사는 수정하지 않았다.
- `calendar-hotfix.spec.mjs:36~37`, `task-layout-groups.spec.mjs:229~232`, `suborganization-filters.spec.mjs:36`, `meeting-entry.spec.mjs:914,927`, `startup-performance.spec.mjs:55,57,62,67,83~90`: 기존 정확한 버전 기대값만 변경. matcher·timeout·retry·기능 기대값을 약화하지 않았다.
- `.github/workflows/app-smoke-check.yml:71,123,129~131,133,194~196,199,231`, `suborganization-filters-e2e.yml:58`, `workplace-detail-static-check.yml:35`: 동일하게 캐시 기대 문자열만 변경.

검증·PR/CI 상태는 이 문서와 같은 PR의 roadmap D-6b 행 및 PR 본문에 기록한다. 범위 밖: 다른 CSS/JS의 기존 !important, D-6c, Edge·DB·운영 접근. 390px·1280px font-size/color와 관련 회귀 검사는 화면 변화 0의 증거이며 모든 기기·모든 사용자 콘텐츠에 대한 픽셀 전수 비교는 아니다. merge하지 않는다.

검증 기록(2026-10-09): Node335/335, D-6b 새 Chromium3/3 및 각3회 반복9/9. 정적 smoke 실행 블록12개·HTTP34경로, 조직 정적 관문2개, 저장 정책 검사 통과. 리뷰에서 발견된 login/index.html의 styles.css 부모 버전 누락은 73→74로 수정하여 캐시 검사 통과. 관련 Chromium181개 첫 실행179통과·게시판 iframe2실패(모바일 원문/내부 링크); clean main에서 동일2개를 단독 실행하면2/2 통과, 수정 브랜치 단독 재실행도2/2 통과. 최초 실패 원인은 확정하지 않았고 기존 테스트를 바꾸거나 retry를 추가하지 않았다. 관련181 최종 재검사도179통과·2실패(iframe 내부 링크, 실패 시 오류 안내 대신 로딩 문구 잔류). clean main 게시판 spec 전체는7/8통과·원문표시1실패(private-rail의 iframe 원문 요소 관측 실패)였다. 단독2개는 양쪽에서 통과하지만 전체 실행은 녹색이 아니며 원인은 미확정이다. 이 상태로 완료/CI 통과를 주장하지 않는다.

원격 상태: `codex/d6b-important-cleanup`에 결과 보존. GitHub API는 CONNECT403으로 차단되어 PR 미생성·번호 없음·CI 조회/검증 불가. git push는 사용 가능하다. 요청한 새PR1개와CI통과는 미충족이며 merge하지 않았다. PR 원장 칸을 추측으로 채우지 않았다.
