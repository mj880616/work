# Web2 개발 작업 원장 (Roadmap)

- 최종 갱신일: 2026-09-26
- 기준 main SHA: `100f97d` (Merge pull request #301)
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

## 작업 표

완료·종료 행 아래의 진행중·대기 행은 위에서부터 순서대로 진행한다(RTW-1·RTW-2 최우선). DB-1·DB-2는 비고의 작업에서 함께 처리하고, ENV-4는 수시로 진행한다. PR 칸은 `git log` 또는 GitHub PR 목록으로 확인된 번호만 적는다. 확인되지 않은 칸은 비워 둔다.

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
| 16 | 프로젝트 진행상황 UI 압축 | 대기 | | |
| 15b | 프로젝트 파일 업로드(project-files.js) 실패 처리 정규화 | 대기 | | |
| 17 | 주요 화면 정보밀도 정리 | 대기 | | |
| 18 | 담당조직 자유입력 Inbox | 대기 | | |
| 19 | 단일사용자 전환 전 snapshot | 대기 | | 26의 조사와 DB-1 포함. 화면·코드·DB 전체 목록 |
| DB-1 | 반복 DB 오류 조사 | 대기 | | 19에 흡수. app_workspace_members.email 없는 열 조회, app_project_publication_state 권한 거부 |
| 20 | signup/invite/access/FIRST ADMIN UI 제거 | 대기 | | |
| 21 | Tasks 협업 active code 제거 | 대기 | | |
| 22 | Events attendee/invite active code 제거 | 대기 | | |
| 23 | Projects member/invitation active code 제거 | 대기 | | Edge canEditProject의 보관 프로젝트 서버 거부 포함 |
| 24 | 담당조직 canonical 구조 통합 | 대기 | | |
| 25 | team-ai → 개인 업무 AI 전환 | 대기 | | |
| ENV-3 | migration 시험 환경 결정 | 대기 | | Docker 도입 또는 PGlite 표준화 |
| 26 | collaboration DB/RPC/trigger 감사 | 대기 | | 19 결과 재확인 + DB-2 결정 |
| DB-2 | 삭제 시 수정 이력 보존 설계 | 대기 | | 26에서 결정. 페이지 삭제 시 app_page_revisions cascade 삭제, 다른 삭제 경로 포함. 보류 가능 |
| 27 | 확인된 collaboration DB/RPC/trigger 제거 | 대기 | | |
| 28 | workspace_members/role 체계 제거 | 대기 | | |
| 29 | Tasks assignment schema 정리 | 대기 | | |
| 30 | 보조 Auth 계정 제거 | 대기 | | |
| 31 | collaboration dead code/API/CSS 정리 | 대기 | | app/project-archive.js 미사용 파일 제거 포함. task12a-fingerprint.sql의 app_delete_pages 잔존 정리 |
| Web1-3 | bus-strike-publicness-internal-archive-202609 흔적 정리 | 대기 | | 범위: app_public_post allowlist에서 slug 제거(migration 필요, 적용 직전 정지), redirect 셸 처리 방침 결정, E2E 7번째 redirect 검사와 supabase/tests/authz_* 의 7행 가정 수정. 위험: 같은 slug로 새 글이 생기면 allowlist 때문에 자동 링크 공개됨 |
| RTW-분리 | 읽생기 별도 Supabase 프로젝트 분리 결정 (플레이스토어 출시 전) | 대기 | | 무료 요금제 제약 조사 포함 |
| RTW-출시준비 | 플레이 정책 대응: 웹 탈퇴 요청 링크, 테스트 계정으로 탈퇴 실동작 확인 | 대기 | | Web2 확인 테이블 4개 한계 검토 포함 |
| RTW-3 | rtw-personal-write secret/권한 점검 | 대기 | | Task 32 전 완료. rtw_* 5개 테이블 anon GRANT 흔적 정리 |
| 32 | 전체 최종 회귀검증 | 대기 | | RTW-1~3 완료 후 착수 |
| ENV-4 | 브랜치 정리 | 대기 | | 수시. merge·close된 브랜치 대상. 급하지 않음 |
| 일정 인증-1 | google-calendar 인증 실패 응답 400→401 정리 | 대기 | | 우선순위 낮음 |

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

## 갱신 규칙

- 작업 PR은 해당 행의 상태·PR 번호를 같은 PR에서 갱신한다.
- 새 작업은 이 표에 행을 추가한 뒤 시작한다.
- 공개 저장소다. 이메일, 계정명, 키, 토큰, 개인정보를 쓰지 않는다.
