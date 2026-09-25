# Web2 개발 작업 원장 (Roadmap)

- 최종 갱신일: 2026-09-25
- 기준 main SHA: `30f50d2` (Merge pull request #291)
- 이 문서가 Web2 개발계획·진행상태의 source of truth다. 채팅 기록보다 이 원장을 따른다.

상태값 정의

| 상태 | 의미 |
| --- | --- |
| 완료 | PR이 `main`에 merge되고 배포·검증까지 끝남 |
| 진행중 | 작업 branch 또는 PR이 열려 있고 작업 중 |
| 대기 | 순서가 정해졌으나 아직 시작하지 않음 |
| 보류 | 결정·선행조건 부족으로 중단. 비고에 사유를 적는다 |

## 제품 방향

- Web2: 개인 비공개 업무 도구. 공개·공유 경로를 두지 않는다.
- Web1: 외부 공개 채널.
- RTW: Web2와 분리된 별도 제품.

## 작업 표

대기 행은 위에서부터 순서대로 진행한다. PR 칸은 `git log` 또는 GitHub PR 목록으로 확인된 번호만 적는다. 확인되지 않은 칸은 비워 둔다.

| 번호 | 작업명 | 상태 | PR | 비고(의존관계) |
| --- | --- | --- | --- | --- |
| 1 | Google Calendar 일정 미표시 수정 | 완료 | | |
| 2 | 캘린더 개인화 1차·협업 참석자 UI 정리 | 완료 | | |
| 3 | Google Calendar 스타일 월간 UI | 완료 | | |
| 4 | Web2 홈 제거·shell 단순화 | 완료 | | |
| 5 | 데스크톱 topbar 제거, shell 동작을 sidebar로 통합 | 완료 | #271 | |
| 6 | 데스크톱 캘린더 확대, 일정 색상 preset | 완료 | #274 | |
| 7 | Google Tasks 오늘~6일 후 표시 | 완료 | #275 | |
| 8 | 프로젝트 마일스톤 Google 일관성 | 완료 | #277·#278 | #276(별도 안, open)은 미merge |
| 9 | 회의 입력 구조 단순화 | 완료 | #279 | |
| 10 | Web2/Web1/RTW 보안·권한 전수감사 | 완료 | | |
| 11 | 비로그인 Web2 시작 차단 | 완료 | #280 | |
| 12 | sole-owner DB·Edge 권한 경계 | 완료 | #281·#282·#283·#284 | 12A DB / 12B Edge / 12C 보안 매트릭스 |
| 13 | Web2 공개·공유 경로 제거 | 완료 | #286·#287 | |
| 14 | 자료실 프로젝트 선택을 canonical 프로젝트 목록과 동기화 | 완료 | #288 | |
| 일정 UX-1 | 데스크톱 캘린더 주 높이 동적 조정 | 완료 | #285 | |
| 15 | 자료실 upload failure normalization | 완료 | #291 | library-files Edge v13 배포 2026-09-26, 실사용 업로드 확인 |
| 일정 성능-1 | Google Calendar 로딩 최적화 | 대기 | | |
| 16 | 프로젝트 진행상황 UI 압축 | 대기 | | |
| 17 | 주요 화면 정보밀도 정리 | 대기 | | |
| 18 | 담당조직 자유입력 Inbox | 대기 | | |
| 19 | 단일사용자 전환 전 snapshot | 대기 | | |
| 20 | signup/invite/access/FIRST ADMIN UI 제거 | 대기 | | |
| 21 | Tasks 협업 active code 제거 | 대기 | | |
| 22 | Events attendee/invite active code 제거 | 대기 | | |
| 23 | Projects member/invitation active code 제거 | 대기 | | Edge canEditProject의 보관 프로젝트 서버 거부 포함 |
| 24 | 담당조직 canonical 구조 통합 | 대기 | | |
| 25 | team-ai → 개인 업무 AI 전환 | 대기 | | |
| 26 | collaboration DB/RPC/trigger 감사 | 대기 | | |
| 27 | 확인된 collaboration DB/RPC/trigger 제거 | 대기 | | |
| 28 | workspace_members/role 체계 제거 | 대기 | | |
| 29 | Tasks assignment schema 정리 | 대기 | | |
| 30 | 보조 Auth 계정 제거 | 대기 | | |
| 31 | collaboration dead code/API/CSS 정리 | 대기 | | |
| 32 | 전체 최종 회귀검증 | 대기 | | RTW-1~3 완료 후 착수 |
| 15b | 프로젝트 파일 업로드(project-files.js) 실패 처리 정규화 | 대기 | | 순서 미정 |

### 별도 트랙: RTW

Task 32 착수 전 모두 완료한다.

| 번호 | 작업명 | 상태 | PR | 비고(의존관계) |
| --- | --- | --- | --- | --- |
| RTW-1 | 계정삭제 shared auth 위험 | 대기 | | Task 32 전 완료 |
| RTW-2 | beta RLS owner 격리 | 대기 | | Task 32 전 완료 |
| RTW-3 | rtw-personal-write secret/권한 점검 | 대기 | | Task 32 전 완료 |

## 기타 문서 PR

| 내용 | PR |
| --- | --- |
| CLAUDE.md 신설 | #289 |
| CLAUDE.md 세션 구분·Edge 배포·완료보고 양식 추가, Task 15 완료 기록 | #292 |

## 갱신 규칙

- 작업 PR은 해당 행의 상태·PR 번호를 같은 PR에서 갱신한다.
- 새 작업은 이 표에 행을 추가한 뒤 시작한다.
- 공개 저장소다. 이메일, 계정명, 키, 토큰, 개인정보를 쓰지 않는다.
