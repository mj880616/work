# Web2 개발 작업 원장 (Roadmap)

- 최종 갱신일: 2026-09-26
- 기준 main SHA: `a3666fb` (#322)
- 이 문서가 Web2 개발계획·진행상태의 source of truth다. 채팅 기록보다 이 원장을 따른다.

상태값 정의

| 상태 | 의미 |
| --- | --- |
| 완료 | PR이 `main`에 merge되고 배포·검증까지 끝남 |
| 진행중 | 작업 branch 또는 PR이 열려 있고 작업 중 |
| 대기 | 순서가 정해졌으나 아직 시작하지 않음 |
| 보류 | 결정·선행조건 부족으로 중단. 비고에 사유를 적는다 |
| 종료 | 작업 없이 닫음(대상 없음·소유자 결정 등). 비고에 사유를 적는다 |

## 제품 방향

- Web2: 개인 비공개 업무 도구. 공개·공유 경로를 두지 않는다.
- Web1: 외부 공개 채널.
- RTW(읽생기): Web2와 분리된 별도 제품.
- Web2 업무 기록 원칙: 메모 → 분류 제안 → 확정 → 보고서 산출. 입력할 때 분류를 강요하지 않고 원문은 한 번만 저장해 여러 곳에서 연결로 참조한다. AI는 연결된 기록만 근거로 제안하고 사용자가 확정한다. 할 일 원본은 Google Tasks, 일정 원본은 Google Calendar이며 Web2는 Google 기능을 다시 만들지 않는다. 역할: 프로젝트=사업 진행, 담당조직=조직 변화, 인박스=미분류 메모, 개인 업무 AI=분류·연결·보고서 재구성.

## 결정사항

- 2026-09-26 할 일: 할 일 원본은 Google Tasks(목록 1개)로 단일화한다. Web2 자체 할 일 기능은 제거 예정이다. Web2는 할 일↔프로젝트·회의·담당조직 연결 정보만 보관한다. 구조는 TASK-설계, 구현은 TASK-구현, 기존 기능 제거는 21·29에서 한다. 기존 Web2 할 일 데이터는 보관 없이 삭제한다(사용자 확인).
- 2026-09-26 할 일 목록: Google 기본 목록 "내 할 일" 하나를 쓴다(묶음A 조사 문서 3.2 선택지 A).
- 2026-09-26 기존 할 일: Web2 할 일 58건(미완료 2건 포함)은 보관 없이 삭제한다. 미완료 2건도 따로 옮기지 않는다.
- 2026-09-26 연결 표: 할 일 연결과 메모 연결은 표 하나(묶음A 조사 문서 4.4 통합안 `app_record_links`)로 한다.
- 2026-09-26 팀 AI 기록 저장 오류(DB-1에서 새로 찾은 `app_ai_messages` usage 오류)는 따로 고치지 않고 25에서 처리한다.
- 2026-09-26 AI 제공사: 25에서 비교해 결정한다. 그전까지 현재 제공사를 유지한다.
- 2026-09-26 계정: 본인 외 계정 3개(보조 관리자 1, 비구성원 2)는 모두 본인 소유이며 전부 삭제한다. 대기 중 접근 요청 1건은 거절 후 삭제한다. 준비는 계정-1.
- 2026-09-26 Edge Function 정리 기준: Web1 것은 유지, Web2 찌꺼기는 삭제. 공개 페이지 함수 6개(9/14 기자회견, 9/21 공동투쟁, 수련회 선언, 10/7 대의원)는 Web1 공개 페이지라 유지.
- 2026-09-26 `wedding-mc-shared` 유지.
- 2026-09-26 `kptu-board-probe` 삭제.
- 2026-09-26 공개 페이지 함수 6개가 로그인 없이 비밀번호·출처(Origin) 확인으로만 막는 구조는 의도된 것이다.
- 2026-09-26 공개 페이지 편집 비밀번호는 현행 유지한다(사용자 판단: 피해 작음). 비밀번호가 든 함수 5개 원본은 사용자 PC 백업에만 보관하고 저장소에 올리지 않는다.
- 2026-09-26 게시판 수집 시험 페이지(`kptu-probe/`)와 수집 시험 작업(`kptu-board-probe.yml`)을 삭제한다(ENV-6c).
- 2026-09-26 도구: Claude Code와 Codex를 병행한다. 도구 전환은 작업 사이에서만 한다. 초기에는 배포·DB 변경은 Claude Code, 화면·문서 작업은 Codex도 가능. 준비는 ENV-7.
- 2026-09-26 Codex PC는 workspace-write로 운영한다(작업 폴더 밖 쓰기·네트워크는 승인 필요). 사용자 PC 설정에서 danger-full-access를 바꿈(ENV-7).
- 2026-09-26 Edge Function 삭제 후보: `document-ai-index`(Web2, 앱 코드 호출 없음, 보안 테스트에서만 참조). 다음 Edge 정리 때 삭제한다. 삭제는 정지 지점이며 되돌리기는 저장소 원본을 verify_jwt=true로 재배포([ENV-6b 문서](web2-env6b-edge-source.md) 5절).

디자인 전면 개선(2026-09-26 결정, 작업 표 "디자인" 행)

- 화면 폭 3단계: 접힌 <600px / 펼친 600~1023px / PC ≥1024px.
- 목록은 두 줄 칸으로 하고 수정·삭제는 ⋯ 메뉴에 둔다. 윗줄은 [검색·필터 + 추가 버튼].
- 메뉴: 접힌 화면 하단 탭은 홈·할 일·프로젝트·회의·담당조직. 나머지(자료실·성명·게시판·설정·로그아웃)는 우상단 메뉴. 펼친 화면·PC는 왼쪽 메뉴 전체, 자주 쓰는 5개를 위에 둔다.
- 홈 화면 신설(이번 주 탭 대체). 구성: 빠른 입력칸, D-day 띠(프로젝트 주요 일정 기준), 오늘 일정(공공운수노조 캘린더), 오늘·밀린 할 일, 회의 후속(미완료), 이번 주 업데이트 + 주간보고 초안. 선행: TASK-구현, 25.
- 홈 빠른 입력칸(2026-09-26 확정, 업무 인박스): 입력칸 1개, 입력할 때 분류하지 않고 원문을 보존한다. "할일 …"처럼 앞 단어로 구분하면 Google Tasks로 보내기를 제안한다. 나머지는 인박스 메모로 저장한다. 주간 정리 버튼(언제든 가능, 금~일 강조): AI가 한 주 메모를 사업보고/조직보고로 나누고 프로젝트·담당조직 연결을 제안 → 확인 화면 → 확정하면 주간보고 초안과 프로젝트·조직 현황에 반영. 메모 1건은 여러 곳과 연결될 수 있다. 주간보고 = 사업보고(프로젝트별 변화) + 조직보고(담당조직별 변화) + 일정(Google 캘린더), 가능하면 "이번 주 새 변화"와 "계속 진행 중"을 나눈다. 초안은 업무보고형(명사형 끝맺음, 표) 복붙용 출력을 기본 포함. 프로젝트 진행상황은 연결된 기록 기반 자동요약 + 수동 수정이며, 수동 수정분은 덮어쓰지 않고 새 초안을 옆에 제시해 사용자가 고른다. 요약에서 근거 원문으로 이동할 수 있다. 할 일·조직 정보는 각 화면 직접 입력도 유지한다. 구조 조사는 "인박스 조사" 행, 구현은 25. DB 변경 필요(새 표 최소안은 [조사 문서](web2-bundle-a-investigation.md) 4절).
- 일정(달력) 유지: 접힌 화면은 홈 "달력"으로 들어간다(하단 탭 5개 유지). 펼친 화면·PC 왼쪽 메뉴에는 "일정"을 별도 항목으로 유지한다. [목록|주간|월간] 전환, 기존 월간 달력 유지. 기본 보기는 접힌=목록, 펼친·PC=주간. 캘린더 기본 표시는 공공운수노조 캘린더이고 전체 캘린더를 켤 수 있다.

## 작업 표

완료·종료 행 아래의 진행중·대기 행은 위에서부터 순서대로 진행한다. 묶음 순서: 묶음A(19·TASK-설계·DB-1·인박스 조사, 문서 PR 1개) → 계정-1·ENV-6(후속 ENV-6b·ENV-6c) → ENV-7 → SEC-1 → 묶음B(20·22·23 + ENV-4, ENV-4는 별도 PR) → 묶음C(TASK-구현·21·일정 인증-1) → 25 개인 업무 AI → 후보 행(순서 미정) → 31-1 → 디자인(D-1~D-6, 17b-2 통합) → 이후 DB 정리(26+DB-2, 27~30) → 24 → 31-2 → 이름-2 → ENV-3 → ENV-5 → Web1-3 → RTW → 32. DB-2는 26에서 결정한다. PR 칸은 `git log` 또는 GitHub PR 목록으로 확인된 번호만 적는다. 확인되지 않은 칸은 비워 둔다.

| 번호 | 작업명 | 상태 | PR | 비고(의존관계) |
| --- | --- | --- | --- | --- |
| 1 | Google Calendar 일정 미표시 수정 | 완료 | | |
| 2 | 캘린더 개인화 1차·협업 참석자 UI 정리 | 완료 | | |
| 3 | Google Calendar 스타일 월간 UI | 완료 | | |
| 4 | Web2 홈 제거·shell 단순화 | 완료 | | |
| 5 | 데스크톱 topbar 제거, shell 동작을 sidebar로 통합 | 완료 | #271 | |
| 6 | 데스크톱 캘린더 확대, 일정 색상 preset | 완료 | #274 | |
| 7 | Google Tasks 오늘~6일 후 표시 | 완료 | #275 | |
| 8 | 프로젝트 마일스톤 Google 일관성 | 완료 | #277·#278 | #276은 #277·#278로 대체되어 close됨 |
| 9 | 회의 입력 구조 단순화 | 완료 | #279 | |
| 10 | Web2/Web1/RTW 보안·권한 전수감사 | 완료 | | |
| 11 | 비로그인 Web2 시작 차단 | 완료 | #280 | |
| 12 | sole-owner DB·Edge 권한 경계 | 완료 | #281·#282·#283·#284 | 12A DB / 12B Edge / 12C 보안 매트릭스 |
| 13 | Web2 공개·공유 경로 제거 | 완료 | #286·#287 | |
| 14 | 자료실 프로젝트 선택을 canonical 프로젝트 목록과 동기화 | 완료 | #288 | |
| 일정 UX-1 | 데스크톱 캘린더 주 높이 동적 조정 | 완료 | #285 | |
| 15 | 자료실 upload failure normalization | 완료 | #291 | library-files Edge v13 배포 2026-09-26, 실사용 업로드 확인 |
| 일정 성능-1 | Google Calendar 로딩 최적화 | 완료 | #299 | 기준 `fbf4a3a`. 클라이언트 범위만(status 캐시·포커스 최소화·월 재방문 캐시). 캘린더별 events 병렬화·colors 1회는 Edge 변경 필요로 미포함(일정 성능-2). 2026-09-26 실사용 확인 |
| Web1-1 | 공개 페이지 메타 생성기: 빈 조회 시 기존 메타 보존 (#202 재작업) | 완료 | #294 | withdrawn 목록으로 비공개 전환 명시, 빈 조회는 보존+실패. 원인 확정: 9/21 22:29 UTC 페이지 관리자 일괄 삭제 후 수동 복구. #202는 merge 후 close |
| Web1-2 | p/bus-strike-publicness-internal-archive-202609 셸 상태 확인 | 종료 | | 대상 글이 production app_pages·app_page_revisions에 없음(로컬 read-only 조회로 확인). anon app_public_post 빈 결과로 이미 링크 공개 종료 상태. 원본 없음, 복구하지 않기로 소유자 결정. 흔적 정리는 Web1-3 |
| Web1-4 | app_delete_pages RPC 제거 (9/22 빈 조회 원인 경로 차단) | 완료 | #296 | 2026-09-26 SQL Editor 적용, 로컬 사후 검증 통과. schema_migrations 기록 없음(ENV-2에서 정리) |
| ENV-1 | gh CLI 설치·로그인 | 완료 | | 2026-09-26 로컬 세션에서 gh 로그인 확인 |
| ENV-2 | migration 기록 불일치 정리 | 완료 | #298 | 방침 확정: 공유 DB이므로 db push·migration repair 영구 금지, 불일치는 대응표로 관리, 이후 적용 SQL에 기록 1행 insert. 대응표 [docs/migration-history.md](migration-history.md) |
| 일정 성능-2 | google-calendar Edge 로딩 최적화 | 완료 | #300 | google-calendar v14 배포 2026-09-26, 실사용 확인 |
| RTW-1 | 계정삭제 shared auth 위험 | 완료 | | 읽생기 #83, rtw-delete-account v4 배포 2026-09-26(verify_jwt=true 유지). Web2 계정은 읽생기 데이터만 삭제, 일반 사용자는 계정까지 삭제. 실계정 탈퇴 시험은 RTW-출시준비에서 |
| RTW-2 | beta RLS owner 격리 | 완료 | | 2026-09-26 조회, owner 조건 정책으로 이미 해결 |
| 16 | 프로젝트 상세 화면 요약형 재구성(진행상황 UI 압축 포함) | 완료 | #304 | 기준 `36ccc28`. UI만(DB·Edge 변경 없음). 제목+⋯ 메뉴, 할 일·자료 바로 추가, 하위 프로젝트·진행상황 목록 우선, 주요 일정·메모 접힘. 2026-09-26 실사용 확인 |
| 15b | 프로젝트 파일 업로드(project-files.js) 실패 처리 정규화 | 종료 | | 기준 `a2bd0e4`. 대상 없음: `project-files.js`는 어느 진입 경로에서도 로드되지 않는 비활성 파일(`loader-v2.js`·`view-loader.js` 미포함, app-smoke-check·project-v3-structure 검사가 재로드를 막음, 붙는 `#projectModal`도 없음). 현재 프로젝트 자료 추가는 자료실 업로드(`library-upload.js`, 프로젝트 미리 선택)로 가며 Task 15 실패 처리를 이미 거침. 코드 변경 없이 소유자 결정으로 종료 |
| 17a | 프로젝트 목록 화면 요약형 | 완료 | #305 | 기준 `05019e9`. UI만(DB·Edge 변경 없음). 테두리 목록 하나, 상위 프로젝트 2줄(이름 / 하위 포함 할 일·자료 합계 + 하위 N ▾ 접힘), 보관함 같은 형식. 개수는 16의 in.(...) 조회 재사용. 2026-09-26 실사용(휴대폰) 확인 |
| 17b-1 | 회의 목록 정리 | 완료 | #306 | 기준 `5b1b96a`. UI만(DB·Edge 변경 없음). 회의명별 왼쪽 색 띠: 회의명이 처음 등장한 순서(가장 이른 회의 일시)대로 12색 팔레트 차례 배정, 서로 다른 회의명은 같은 색 없음, 12개 초과분과 회의명 없음은 회색 띠. 두 줄(회의명 / 차수·날짜·자료, 프로젝트명 제외), 회의명 필터와 "+ 회의 결과" 한 줄. 2026-09-26 실사용(휴대폰) 확인 |
| 조직-1 | 조직 상세 소속 칩에서 종류 접두어(협의회 · / 사업단 · ) 제거 | 완료 | #308 | 기준 `a2bd0e4`. UI만(DB·Edge 변경 없음). app/workplace-detail.js wdRenderAff() 칩에 이름만 표시, 협의회/사업단 구분은 기존 taskforce 칩 스타일 유지. 2026-09-26 실사용(휴대폰) 확인 |
| 18 | 담당조직 자유입력 Inbox | 완료 | #309·#310 | 기준 `e6d607d`. UI만(DB·Edge 변경 없음). 조직 상세 맨 위 입력칸 하나 + 저장, 기존 `app_suborganization_updates` 저장 경로(workplace-ai-report.js "업데이트 추가"와 같은 요청)를 workplace-detail.js로 옮겨 최신순 "기록"으로 표시. "현재 상황 업데이트"·"+ 메모" 입력 제거, 기존 요약·메모는 접힌 칸 "기본 정보 · 소속 · 이전 요약"에서 읽기 전용, AI 초안 버튼도 그 칸으로 이동. canEdit 확인 유지. 배포 후 휴대폰에서 옛 화면 유지: `view-loader.js?v=16` 등 상위 로더 버전을 올리지 않아 edge·브라우저가 1년 immutable 캐시로 옛 로더를 계속 사용(후속 PR에서 view-loader v17·loader-v2 v237·app.js v125로 올림). 2026-09-26 실사용(휴대폰) 확인 |
| 18b | 담당조직 기록·메모 삭제 | 완료 | #315 | 기준 `99512a1`. UI만(DB·Edge 변경 없음). app/workplace-detail.js "기록"(`app_suborganization_updates`) 각 항목과 접힌 칸 예전 메모(`app_suborganization_status_items`) 각 항목에 삭제 버튼. 메모는 계속 읽기 전용, 삭제만 추가. 확인 1회, `id`+`organization_id` 조건 DELETE에 `return=representation`으로 지워진 행을 받아 0행·오류면 항목 유지 + 안내. canEdit 없으면 버튼 없음, 서버 권한은 기존 RLS(task12a_owner_all) 그대로. 최근 1달/올해 요약은 대상 아님. 캐시: workplace-detail v8·view-loader v18·loader-v2 v238·app.js v126. 2026-09-26 merge(`c28f76b`). 2026-09-26 실사용(휴대폰) 확인: 삭제 동작, 확인창 취소 시 삭제 안 됨 |
| 이름-1 | 앱 내부 "공공기관사업팀 Workspace"·"공공기관사업팀" 이름을 "웹2"로 교체 | 완료 | #318 | 기준 `c28f76b`. UI 문구·안드로이드 앱 이름만(DB·Edge 변경 없음). app/windows-manifest.json name·short_name·description, app/brand-logo.js 로고 대체 글자, app/legacy/startup-speed.js 기본값, app/ARCHITECTURE.md 제목, tests/app-e2e 모의 workspace 이름, 안드로이드 android:label·versionCode 14·versionName 0.1.13(MainActivity APP_VERSION·빌드 artifact 이름 함께). 제외: workspace/index.html·workspace/privacy/index.html(이름-2), supabase/functions 드라이브 폴더 이름, 원장 과거 기록. 캐시: index.html의 `windows-manifest.json?v=5`→`v6`. brand-logo.js·legacy/startup-speed.js는 어느 로더도 불러오지 않아 올릴 로더 버전 없음. 안드로이드 앱 이름은 새 APK 설치 후 반영 |
| 로그인-1 | 로그인 화면 "공공기관사업팀 · WORKSPACE" 문구 제거 | 완료 | #311 | 기준 `0a7850b`. UI만(DB·Edge·인증 흐름 변경 없음). app/login/index.html 상단 header 줄 제거, 탭 제목 "로그인". 로그인 전 다른 화면의 같은 문구는 고치지 않고 PR에 위치만 보고. 캐시 버전 올림 대상 없음: 바뀐 파일은 HTML(`?v=` 없음, 라우터가 no-cache)이고 JS·CSS·로더 변경 없음. 2026-09-26 실사용(휴대폰) 확인 |
| 19 | 단일사용자 전환 전 snapshot (묶음A) | 완료 | #319 | 기준 `806591e`. [조사 문서](web2-bundle-a-investigation.md) 1절. 26의 조사 겸함. 화면·코드·테스트·DB·Edge 전체 목록, 제거 담당 작업(20~31) 배정, 읽생기 공유 요소 표시. 조사만(코드·DB·Edge 변경 없음) |
| TASK-설계 | Google Tasks 연결 구조 설계 | 완료 | #319 | 묶음A. 조사 문서 3절. 설계만(코드·DB 변경 없음). 결정사항: 할 일 원본은 Google Tasks(목록 1개), Web2는 할 일↔프로젝트·회의·담당조직 연결 정보만 보관. 기존 google-tasks Edge·Google 연결 재사용, 새 권한 범위 없음. 연결 표는 SQL 초안만 |
| DB-1 | 반복 DB 오류 조사 | 완료 | #319 | 19에 흡수. 조사 문서 2절. 두 오류 모두 원인 코드 제거로 이미 멈춤: `email` 열 조회는 task-workflow.js(#250에서 제거, 마지막 발생 9/24), app_project_publication_state 호출은 project-system-v3.js(#226에서 제거, 마지막 발생 9/23). 새로 찾은 진행형 오류: team-ai 대화 메시지 저장 실패(usage NOT NULL), 25에서 처리 |
| 인박스 조사 | 업무 인박스 구조 조사(메모 → 분류 제안 → 확정 → 보고서) | 완료 | #319 | 묶음A. 조사 문서 4절. 구현 금지. 연결 표·필드, 새 표 필요 여부(메모 원문 1개 + 연결 1개 최소안), AI 제안 상태, 자동요약 결합, Google 원본 시 보관 범위, 25 전환안 |
| 계정-1 | 본인 외 계정 3개 삭제 준비 | 완료 | #320 | 기준 `8532bcb`. 사용자 실행 2026-09-26(1~6단계, 사후 확인 기대값 일치, 로컬 read-only 재확인은 ENV-6b). [조사 문서](web2-account1-env6-investigation.md) 1절. 조회·준비만(DB 쓰기·계정 삭제 없음). 삭제 대상 3개 모두 옮길 업무 자료·읽생기 자료 없음. 비구성원 계정 1개에 배정된 할 일 1건 때문에 계정 삭제가 트리거에 막힘 → 담당자를 본인으로 바꾼 뒤 삭제. 접근 요청 거절 후 삭제, Google 연결 정보 삭제 SQL 초안. 적용은 사용자가 SQL Editor·Supabase 화면에서 직접(정지 지점). 30의 계정 삭제를 앞당겨 처리 |
| ENV-6 | 저장소에 원본 없는 Edge Function 점검 | 완료 | #320 | 조사 문서 3절. 조회만(삭제·배포 없음). 배포 38개 중 17개가 두 저장소 원본·이력에 없음. 원본 복구 필요 8(auth-handoff·rtw-beta-status·공개 페이지 함수 6), 사용자 결정 2(wedding-mc-shared·kptu-board-probe), 삭제 후보 7(push-notifications·rtw-owner-claim·rtw-owner-setup·rail-1007-page·rail-1007-page-v2·pc0914-storage-test·pc-file-test). 복구·삭제는 별도 작업(Edge 변경, 정지 지점) |
| ENV-6b | 원본 없는 Edge Function 원본 확보 + 계정-1 사후 검증 | 완료 | #321 | 기준 `9e273e2`. [문서](web2-env6b-edge-source.md). 조회·내려받기만(배포·삭제·DB 쓰기 없음). 17개 내려받음: work 9·read-think-write 3 커밋(읽생기 #88), 비밀값이 박힌 공개 페이지 함수 5개(rail-1007-plan·rail-declaration-comments·rail-declaration-content·press-conference-files·joint-struggle-files)는 커밋 안 함(사용자 PC 보관). 함수별 verify_jwt를 문서 2.2에 기록. 판정 확정: 삭제 8·유지 9. 계정-1 사후 값 일치, 할 일 57 vs 58은 문서 1.1. 읽생기 #88. 발견사항(기록만): 원본 없던 공개 페이지 함수 6개 모두 verify_jwt=false(Origin·4자리 비밀번호·공개 업로드 키로만 막음), rtw-owner-claim 9/17~18 약 1,540회 집중 호출(이후 0회) |
| ENV-6c | 삭제 목록 함수 삭제(사용자 대시보드 실행) + 게시판 시험 페이지 정리 | 완료 | #322 | 기준 `a93cc40`. PR merge 후 사용자가 대시보드에서 함수 8개 삭제. 이 PR: `kptu-probe/` 시험 페이지와 `.github/workflows/kptu-board-probe.yml` 삭제(다른 곳에서 불러오거나 링크하지 않음, 캐시 버전 변경 대상 없음). 함수 원본 `supabase/functions/kptu-board-probe/`는 되돌리기용으로 유지. 삭제 대상: ENV-6b 문서 3.1의 8개(push-notifications·rtw-owner-claim·rtw-owner-setup·rail-1007-page·rail-1007-page-v2·pc0914-storage-test·pc-file-test·kptu-board-probe). 두 저장소 호출처 없음 확인. Edge 변경이라 정지 지점. 되돌리기는 저장소 원본을 같은 verify_jwt로 재배포. 사용자 대시보드 삭제 2026-09-26. ENV-7 조회로 삭제 8개 없음·남은 함수 30개·유지 9개 존재 확인(ENV-6b 문서 5.1) |
| ENV-7 | Codex 병행 준비 | 완료 | #323 | Codex CLI 조회 전용 연결 시험 통과 2026-09-26(사용자 확인). #323 main 반영 확인. AGENTS.md 규칙 단일화, 도구별 경계·캐시 버전 규칙 정리. production 함수별 verify_jwt는 [ENV-6b 문서](web2-env6b-edge-source.md) 5절. 비밀값은 저장소·Codex 웹 환경에 넣지 않음 |
| SEC-1 | auth-handoff 보안 점검 | 진행중 | #324 | 배포 대기. 기준 `8a6f4ec5`(#323). [조사·정지 지점](web2-sec1-auth-handoff.md). 1회 사용 보장에 DB 소비 기록 필요 → 사용자 지시 2(a)에 따라 SQL 초안에서 정지. 함수·앱 코드 수정, DB 적용, Edge 배포 미실행. 검토용 PR에서 조사·재현·SQL 초안·배포 준비만 정리 |
| 20 | signup/invite/access/FIRST ADMIN UI 제거 | 대기 | | 묶음B. 조사 문서 1.2. 화면만(가입 탭·초대 안내·FIRST ADMIN·접근요청 화면·access-approval.js·가입 요청 가로채기, 비활성 구성원 관리 파일, 관련 테스트). Auth 가입 설정은 읽생기 공유라 바꾸지 않음 |
| 22 | Events attendee/invite active code 제거 | 대기 | | 묶음B. 조사 문서 1.4. 일정 저장 시 참석자 행을 만드는 트리거(trg_app_add_event_creator_attendee) 삭제 포함(DB 변경, 정지 지점) |
| 23 | Projects member/invitation active code 제거 | 대기 | | 묶음B. 조사 문서 1.5. Edge canEditProject의 보관 프로젝트 서버 거부 포함. meeting-files·meeting-ai-draft·library-files의 app_space_members·구성원 역할 조회 제거(Edge 배포, 정지 지점) |
| ENV-4 | 캐시 버전 누락 자동검사 | 대기 | | 묶음B(별도 PR). 파일 수정 시 로더 캐시 버전(`?v=`) 올림 누락을 CI가 잡는 검사 추가: #309에서 `view-loader.js` 버전 누락으로 배포 후 옛 화면이 남은 사례(#310에서 수정). `.github/workflows/suborganization-filters-e2e.yml`이 없는 파일 `app/profile-workplace-sync.js`를 grep으로 검사함(경고만 나고 실패하지 않아 검사가 무의미) |
| TASK-구현 | 화면별 할 일 추가를 Google Tasks로, 연결 안 된 할 일 모음, 목록 개수 기준 변경 | 대기 | | 묶음C. TASK-설계 뒤. 조사 문서 3절. 첫 단계로 Google 할 일 미표시 원인 확인(같은 계정인데 Web2에 안 보임). 조사문서 5절 8번 로그인 복귀 주소 문제와 관련 가능. 할 일 화면 57건 vs DB 58건 차이 확인 결과 반영(ENV-6b 문서 1.1: 화면은 본인 담당 할 일을 거르지 않고 전부 표시, 차이 1건은 계정-1 A단계에서 본인에게 옮긴 회의 후속 할 일, 새로고침 후 58건 확인, 문제 없음) |
| 21 | Tasks 협업 active code 제거 | 대기 | | 묶음C. 범위 변경: Web2 할 일 기능 전체 제거. TASK-설계 결과를 따른다. 기존 할 일 데이터는 보관 없이 삭제(사용자 확인). 조사 문서 1.9 |
| 일정 인증-1 | google-calendar 인증 실패 응답 400→401 정리 | 대기 | | 묶음C. Google Tasks 단일화로 중요도 상향(할 일 원본이 Google 인증에 의존). google-tasks도 같은 400 응답이라 함께 정리(조사 문서 3.6) |
| 25 | team-ai → 개인 업무 AI 전환 | 대기 | | 인박스·주간 정리 버튼·자동요약·보고서 양식 포함, 배치는 묶음A 결과 후 결정. 주간 정리 시 회의·면담 메모의 후속조치(결정·담당·기한·다음 확인) 빠짐 표시 포함. 설계 근거는 조사 문서 4절. team-ai 메시지 저장 오류(DB-1 신규) 포함 |
| 후보-1 | 폰 공유하기로 인박스 넣기(안드로이드) | 대기 | | 후보, 순서 미정(25 이후). 인박스 생성 직후 가능 |
| 후보-2 | 주간 정리 시 일정 후보 → Google 캘린더 등록 제안 | 대기 | | 후보, 순서 미정(25 이후) |
| 후보-3 | 오래 기록 없는 프로젝트·조직 표시 | 대기 | | 후보, 순서 미정(25 이후) |
| 후보-4 | 쌓인 기록 기반 질문 답변(원문 링크 포함) | 대기 | | 후보, 순서 미정(25 이후) |
| 후보-5 | 회의 전 "이번에 결정할 것" 한 줄 입력과 회의 후 결과 비교 | 대기 | | 후보, 순서 미정(25 이후) |
| 후보-6 | 주간 정리 시 사례 후보 표시 → 장기기억 DB 쓰기요청으로 제출 | 대기 | | 후보, 순서 미정(장기기억 연결 이후). Web2에 사례 별도 저장 금지 |
| 31-1 | collaboration dead code·CSS 정리(코드·CSS분) | 대기 | | 31을 둘로 나눔. app/project-archive.js 등 비활성 파일(조사 문서 1.1)과 smoke·fixture 참조, CSS. 묶음A 조사 문서 5절 7번: app/ARCHITECTURE.md가 설명하는 없는 파일 notification-center-ui.js·프로젝트 초대 수락 E2E 정리 |
| 디자인 | 디자인 전면 개선(D-1~D-6: 전수검사→기준→공통부품→화면적용→넓은화면 목록+상세→덧칠정리·자동검사) | 대기 | | 17b-2(17b 나머지 목록 정리) 통합. 화면 폭 3단계·목록 형식·메뉴 배치·홈 신설(이번 주 탭 대체, 선행 TASK-구현·25)·홈 빠른 입력칸·달력 보기 전환은 결정사항 "디자인 전면 개선"을 따른다 |
| 17b | 나머지 주요 화면 목록 정보밀도 정리 | 대기 | | 17a 형식 기준. 17b-1 이후 나머지(17b-2)는 디자인 전면 개선에 통합 |
| 26 | collaboration DB/RPC/trigger 감사 | 대기 | | 19 결과 재확인 + DB-2 결정. 조사 문서 1절 표가 대상 목록 |
| DB-2 | 삭제 시 수정 이력 보존 설계 | 대기 | | 26에서 결정. 페이지 삭제 시 app_page_revisions cascade 삭제, 다른 삭제 경로 포함. 보류 가능 |
| 27 | 확인된 collaboration DB/RPC/trigger 제거 | 대기 | | 묶음A 조사 문서 5절 4번(app_workspace_members 역할 트리거의 고정 이메일)은 27~29에서 처리 |
| 28 | workspace_members/role 체계 제거 | 대기 | | app_workspace_members 역할 트리거의 고정 계정, app_spaces_create 역할 등급 정책 포함. 읽생기 탈퇴 판정이 이 표를 쓰므로 읽생기 쪽 선행 확인(조사 문서 1.10) |
| 29 | Tasks assignment schema 정리 | 대기 | | 범위 변경: Web2 할 일 기능 전체 제거에 맞춘 schema 정리. TASK-설계 결과를 따른다. 기존 할 일 데이터는 보관 없이 삭제(사용자 확인) |
| 30 | 보조 Auth 계정 제거 | 대기 | | 계정 삭제는 계정-1로 앞당김(계정-1 적용 뒤 이 행은 남은 확인만). 조사 문서 1.8. 보조 관리자 1, 비구성원 2(1명은 Google 캘린더 연결 행 남음). Auth는 읽생기와 공유, 계정 삭제는 사용자 결정 후 직접 |
| 24 | 담당조직 canonical 구조 통합 | 대기 | | 조사 문서 1.6. 담당조직 3중 저장(app_suborganization_assignees·app_profile_workplaces·default_assignee_name)과 동기화 트리거 3개 |
| 31-2 | collaboration dead code/API 정리(나머지) | 대기 | | task12a-fingerprint.sql의 app_delete_pages 잔존 정리, DB 정리 뒤 남는 API·테스트 참조 |
| 이름-2 | 서비스 소개·개인정보처리방침 페이지 이름 변경, 구글 앱 이름 변경 | 대기 | | 구글 앱 이름 변경은 사용자가 Google 설정 화면에서 직접 하는 작업 포함. 공개 페이지(press/, p/*, private-rail/ 등) 푸터·og:site_name의 '공공기관사업팀' 포함 |
| ENV-3 | migration 시험 환경 결정 | 대기 | | Docker 도입 또는 PGlite 표준화 |
| ENV-5 | 불안정 E2E 측정형 테스트 안정화 | 대기 | | 수시. 코드 변경과 무관하게 CI에서 가끔 실패: `calendar-google-loading.spec.mjs:77`(응답 시간 한도 600ms·200ms), `calendar-month-view.spec.mjs:187`(창 크기 변경 직후 배치 측정). 여러 테스트를 병렬로 돌릴 때 간헐 실패하는 로그인 세션 전환(`public-workspace-auth.spec.mjs`), Web1 게시판(`web1-board.spec.mjs`)도 포함. 2026-09-26 #310 CI에서 각 1회 실패, 재실행·로컬 반복은 통과. 테스트 삭제·건너뛰기 없이 대기 조건·한도를 원인에 맞게 고침 |
| Web1-3 | bus-strike-publicness-internal-archive-202609 흔적 정리 | 대기 | | 범위: app_public_post allowlist에서 slug 제거(migration 필요, 적용 직전 정지), redirect 셸 처리 방침 결정, E2E 7번째 redirect 검사와 supabase/tests/authz_* 의 7행 가정 수정. 위험: 같은 slug로 새 글이 생기면 allowlist 때문에 자동 링크 공개됨 |
| RTW-분리 | 읽생기 별도 Supabase 프로젝트 분리 결정 (플레이스토어 출시 전) | 대기 | | 무료 요금제 제약 조사 포함 |
| RTW-출시준비 | 플레이 정책 대응: 웹 탈퇴 요청 링크, 테스트 계정으로 탈퇴 실동작 확인 | 대기 | | Web2 확인 테이블 4개 한계 검토 포함. 묶음A 조사 문서 5절 6번: `DELETE /auth/v1/user/identities/<id>` 404 반복(9/25~26 11회, Web2 코드에 호출 없음) 읽생기 쪽 확인 |
| RTW-3 | rtw-personal-write secret/권한 점검 | 대기 | | Task 32 전 완료. rtw_* 5개 테이블 anon GRANT 흔적 정리 |
| 32 | 전체 최종 회귀검증 | 대기 | | RTW-1~3 완료 후 착수 |

비고: migration 버전 불일치 3건(enable_multiuser_personal_spaces, add_free_beta_controls, add_beta_access_status_rpc)은 RTW 작업(RTW-1~3) 소관이다. 읽생기 저장소 파일과 production 기록의 버전이 다르다. 대응은 [docs/migration-history.md](migration-history.md).

## 기타 문서 PR

| 내용 | PR |
| --- | --- |
| CLAUDE.md 신설 | #289 |
| CLAUDE.md 세션 구분·Edge 배포·완료보고 양식 추가, Task 15 완료 기록 | #292 |
| AGENTS.md 제품 구조 섹션을 현재 방향(Web2 sole-owner 비공개·Web1 공개 채널·RTW 분리)으로 재작성 (#273 대체) | #293 |
| roadmap 갱신: Web1-1 완료, Web1-2 종료, Web1-3 등록, 상태값 '종료' 정의 추가 | #295 |
| roadmap 갱신: Web1-4 완료, ENV-1~4·DB-1~2 등록, Task 31 비고 추가. CLAUDE.md production DB 적용 절차 추가 | #297 |
| ENV-2 방침 확정: migration-history.md 신설, CLAUDE.md db push·repair 영구 금지·적용 확인 절차 추가, ENV-1·ENV-2 완료 | #298 |
| roadmap 작업 표를 진행 순서로 재배열(RTW-1·2 최우선, DB-1은 19 흡수, DB-2는 26 결정, ENV-4 수시), 일정 인증-1 등록 | #301 |
| roadmap 갱신: RTW-1·RTW-2 완료, RTW-분리·RTW-출시준비 등록, RTW-3 비고 추가 | #303 |
| roadmap 갱신: 15b 종료(대상 파일 비활성), 17b-1 완료 | #307 |
| roadmap 갱신: ENV-5(불안정 E2E 테스트) 등록, 로그인-1 완료, ENV-4 로더 캐시 버전 검사 기록, 이름-2 등록 | #314 |

## 갱신 규칙

- 작업 PR은 해당 행의 상태·PR 번호를 같은 PR에서 갱신한다.
- 새 작업은 이 표에 행을 추가한 뒤 시작한다.
- 공개 저장소다. 이메일, 계정명, 키, 토큰, 개인정보를 쓰지 않는다.
