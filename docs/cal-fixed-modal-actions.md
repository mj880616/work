# CAL-버튼고정 조사·검증 보고

📱 폰 가능 · Codex 웹 · 2026-10-08

기준 main: `dc317dbb0236942e8bf210f86b8a9692d437a658` (원격 fetch 확인).
브랜치: `codex/cal-fixed-modal-actions`. PR: [#436](https://github.com/mj880616/work/pull/436).
0단계는 구현 전에 기록했다.

## 0단계 조사

| 창 | 스크롤 요소 | 버튼 줄 | 상태 위치 | 공통 구조 |
| --- | --- | --- | --- | --- |
| eventModal | .modal-card.small-card | #saveEventBtn.primary.wide | 버튼 뒤 #eventStatus | 정적 index.html, PR #434 일정/할 일 모드 공용 |
| ciGoogleModal | .modal-card.small-card.ci-card | .ci-actions (삭제→저장) | 버튼 줄 뒤 #ciGoogleStatus | calendar-interactions-v2.js가 생성 |
| taskModal | .modal-card.small-card | #taskModalActions (완료→삭제), #saveTaskBtn | 저장 뒤 #taskModalStatus | 정적 index.html, 기존 Web2 할 일 경로 |
| gtTaskModal | .modal-card.small-card, 안쪽 .gt-link-body도 별도 스크롤 | .gt-modal-actions (삭제→완료→저장) | 버튼 줄 뒤 #gtEditStatus | google-tasks.js가 생성 |

모두 .modal/.modal-card/.small-card와 .status를 사용한다. 공통 footer는 없다.
폰의 workspace-ui.css는 modal-card에 overflow-y:auto, 최대 100dvh 기반 높이,
아래 padding 24px을 적용한다. PC 기본 최대 높이는 94vh다.
일정의 조직 목록은 suborganizations.js가 메모 label 바로 뒤에 삽입한다.
조직 목록 자체와 삽입 위치를 바꾸지 않아도 footer 적용 가능하다.

같은 방식 적용 후보(이번에는 변경 없음): ps3CreateModal·ps3WorkstreamModal·
ps3ProgressModal·ps3MilestoneModal·ps3ArchiveModal·ps3DeleteModal,
meetingModal·meetingRoundDetailModal, wdModal·wdAffModal·wdTimeModal,
soEditModal·soAssignModal, libraryEditModal·libraryManageModal, warDraftModal.
이들은 modal-card 안에 입력/작업과 하단 저장·취소·삭제가 있는 구조다.
상세와 입력이 섞인 창은 실제 저장 영역을 별도로 결정해야 한다.

## 구현 계획

- [x] 360/1280에서 네 창의 최초 저장 노출, 마지막 입력·오류·44px 누름 범위 E2E를 먼저 실행해 실패 확인.
- [x] .modal-action-footer 공통 클래스 한 개에 상태→기존 버튼 순서로 묶기. sticky bottom, surface 바탕·위 border·safe-area 여백.
- [x] footer를 normal flow에 유지해 자체 높이만큼 본문 끝 공간 예약. 버튼 모양·색·순서 및 조직 배치 유지.
- [x] 기존 accessibility-dialog에서 폰 editable focus + visualViewport 축소를 확인해 data 속성으로 고정 해제. 닫기/키보드 복귀 시 정리.
- [x] 캐시 의존 체인과 버전 검사 갱신, 원장 지시 항목 반영.
- [x] PR #436 생성·원장 반영.
- [ ] 최종 head의 GitHub CI 확인 후 보고·정지. merge 없음.

## 검증 결과

첫 최종 로컬 관련 spec 95/95 + 일정 수정 삭제 확인 1/1 통과(합계 96).
이후 입력 자동 확대와 키보드가 함께 열린 경우를 추가했다. 해당 검사는 수정 전 실패했다.
최종 관련 spec 97/97 통과. 새 footer spec은 총 18개다.

- 새 E2E: 360·1280×640, 합성 담당조직 16개. 최초 저장·실제 저장 오류 노출, 마지막 입력/조직 항목 가림 없음, 버튼 44px 상하좌우 hit-test, 12px 이상 상태 문구 확인.
- eventModal 할 일 모드 및 진행 중 상태·줄바꿈 오류, 네 창의 visualViewport 축소·복귀, 회전·닫기/재열기·pinch zoom 검증을 포함한다.
- 수정 전 360px eventModal 저장 버튼 하단이 약 1952px로 640px 화면 밖에 있어 새 검사가 실패했다.
- 리뷰에서 회전 전 높이를 키보드 기준으로 잡는 오류를 발견했다. 해당 높이 저장을 제거했고 회전 검사는 수정 전 실패·수정 후 통과했다.
- 기존 관련 spec 최초 78개 중 76개 통과. 누락된 캐시 버전 기대값은 동일 기준의 새 버전으로 갱신했다.
- startup-performance의 `tab navigation waits for deferred feature data on first click`은 작업 브랜치 첫 실행 실패, 단독 재실행 통과, clean main dc317db 비교에서도 실패. 조건·대기 시간·기준값은 수정하지 않았다.
- 로컬 app-smoke 정적/구조·node 검사 17단계 통과(그 안 node --test 38개), 캐시 검사 단위 테스트 17개 통과. GitHub workflow를 수동 실행한 것이 아니라 저장소에 정의된 검사 명령만 로컬에서 실행했다.
- 전체 검증은 PR의 자동 GitHub CI 결과를 기준으로 한다. 배포 workflow 실행·merge 없음.

## 키보드 대응과 제한

폰 폭 760px 이하에서 입력/textarea/select에 포커스가 있고 visualViewport.height × scale이
현재 layout viewport보다 120px 이상 작아지면 footer를 static으로 바꾼다.
확대 배율을 보정해 iOS 입력 자동 확대와 키보드가 함께 열려도 고정을 푼다.
포커스 이동·키보드 복귀 때 sticky로 돌아가며 다른 창·기기 확대에는 적용하지 않는다.
layout viewport 자체가 줄어드는 브라우저는 기존 100dvh 제한 안에서 sticky를 유지한다.
실제 iOS/Android 키보드·안전영역 실기기 검증은 클라우드에서 하지 못했다.

공통 footer가 normal flow에서 실제 높이(여러 줄 상태 문구·safe-area 포함)를
차지하므로 마지막 입력 뒤에 그만큼 공간이 예약된다. 별도 고정 px 높이·
조직 목록 재배치·새 localStorage 키가 없다. 추가 !important는 0개다.
일정 삭제의 투명 44px 영역만 기존 D-3c 공통 selector에 포함했다.

## 클라우드 제약·범위 밖 발견

- Playwright 다운로드 도메인 403: 설치된 /usr/bin/chromium으로 관련 spec 실행.
- gh 인증 무효: GitHub 연결 도구로 PR 생성·CI 읽기. git fetch/push 결과는 별도 확인.
- 기존 로딩 문구 간헐 실패는 clean main에서도 재현되어 보고만 한다.
- 다른 입력 창 후보는 0단계 표 아래 목록에만 남겼다.
- DB·Supabase·Edge Function·Cloudflare·인증/권한 경계·운영 데이터 변경 없음.

## PR #436 추가 수정: 카드 하단 틈

- 기준 head d86c68a. 카드의 하단 padding 24px 때문에 footer 하단과 카드 하단이 테두리 포함 25px 떨어져 있었다. 360·1280 각각 네 창에서 새 경계 검사가 모두 실패해 재현했다.
- 공통 .modal-action-footer에 하단 padding만큼 음수 bottom·margin-bottom을 적용하고, 같은 크기를 footer padding-bottom에 더해 바탕색이 카드 하단까지 이어지게 했다. safe-area 여백·키보드 고정 해제·버튼 모양·순서는 유지한다.
- 기존 8개 폰/PC 창 검사에 최초 scrollTop=0에서 footer와 카드의 아래 경계 차이 ≤1px 검사를 추가했다. 마지막 입력 가림·오류·44px 누름 범위 검사는 그대로 유지한다.
- CSS 캐시 체인(base-ui → critical/styles → index/login)과 app-smoke 버전 기대값을 갱신했다. 새 !important·localStorage 키 없음.
- 추가 수정 로컬 검증: footer E2E 18/18(하단 경계 8조건 포함), app-smoke 정적/구조·node 17단계와 캐시 검사 단위 테스트 17개 통과(node 합계 55개). 캐시 의존 검사·git diff --check 통과. 추가 커밋의 전체 CI 결과는 PR #436에 기록한다. merge 없음.
