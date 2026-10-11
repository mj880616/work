# UI-자료종류정리 검토

📱 폰 가능 (Codex 웹), 2026-10-11 사용자 결정.

시작 main: `74e54ae6043bc0dcf5f285d624ea22b8f16dbd61`. 브랜치: `codex/library-view-two`.

자료 종류는 `general`(meeting_id 미연결)과 `meetings`(meeting_id 연결)만 제공한다. 분류명이 “회의자료”여도 회의에 연결되지 않았다면 일반 자료다. 프로젝트 필터의 `all`과 분류 수정 목록의 전체 자료는 유지한다. 자료실 재진입·새로고침 시 기본값은 일반 자료이고 선택값은 저장하지 않는다.

## 사용 경로 조사

`luDocumentView`의 유일한 소유자는 `app/library-upload.js`다. 자료 종류 `all`을 지정하는 다른 앱 링크·이벤트는 없다. `project-system-v3.js`의 `goLibrary()`는 프로젝트 필터만 지정하고 자료실로 이동한다. 기존 router 초기화로 일반 자료가 선택되며, 공용 필터 E2E에서 프로젝트 상세→자료실의 기본값과 일반 행·회의 행 제외를 확인한다.

## 테스트 변경 이유

`library-row-list.spec.mjs`와 `ui-filter-chips.spec.mjs`의 일반+회의 혼합 `all` 검사는 사용자가 폐기한 보기이므로 제거했다. 테스트 사례는 삭제하지 않았다. 두 필터 각각의 실제 자료 ID·결과 수, 프로젝트와 검색의 교집합, 분류명보다 meeting_id로 구분하는 동작, 터치·키보드 전환, 관리 목록의 전체 자료, 저장소 불변, 재진입·새로고침 초기화, 회의 연결·해제·열린 회의 자료 갱신 검사를 유지하거나 보강했다.

변경 전 390/1280px 두 기대 목록 검사가 기존 ‘회의자료 포함’ 때문에 실패하는 것을 확인했다. 변경 후 자료실 15건, 공용 필터와 프로젝트 진입 회귀를 확인한다. Node 전체 검증은 일반 Node 527건과 임시 로컬 PostgreSQL 59건으로 구성된다. 자동 CI 및 최종 SHA 전체 Chromium 결과는 PR 댓글의 12항목 보고를 기준으로 확인한다.

## 캐시

`library-upload.js?v=26` → `view-loader.js?v=125` → `loader-v2.js?v=358` → `app.js?v=246` → `index.html`.

버전 기대 테스트 3개와 app-smoke-check 고정 문자열을 함께 갱신했다. 캐시 검사 운영 참조 410개, Node 전체, 정적 smoke 및 로컬 HTTP smoke를 검증한다. 운영·DB/RLS·Edge·workflow 수동 실행·merge는 수행하지 않는다.

`codex/ui-seoul-time`과 캐시 연쇄 파일이 겹칠 수 있다. 나중에 merge되는 쪽이 최신 main을 받아 충돌을 해소하고 캐시 연쇄·기대 테스트·smoke를 다시 검증해야 한다. 상대 브랜치는 수정하지 않는다.

## 화면 캡처

테스트용 자료와 요청을 사용한 로컬 Chromium 151 캡처다. 운영 자료는 사용하지 않았다. 두 폭 모두 알약 2개·해당 자료만 표시·가로 넘침 없음·정상 흐름 console/pageerror 0을 검사한다.

| 선택 | 390px | 1280px |
| --- | --- | --- |
| 일반 자료 | [캡처](general-390.png) | [캡처](general-1280.png) |
| 회의자료만 | [캡처](meetings-390.png) | [캡처](meetings-1280.png) |

사용자 폰 확인: 자료실의 자료 종류 알약이 2개인지, ‘회의자료만’을 누르면 회의 연결 자료만 나오는지 확인한다. PR merge와 실제 반영 후 확인하며 이번 작업은 PR 준비까지만 한다.

## #498 반영 후속

최신 main `f70a993ae8a32fa432ec8b69506126767e445350`을 같은 `codex/library-view-two` 브랜치에 merge했다(rebase·force push·새 PR 없음). 한국 시간 구현·테스트와 UI-한국시간 원장 행은 main 그대로 유지한다. 충돌한 smoke·원장·버전 기대 테스트 3개는 main의 한국 시간 관련 값·검사를 유지하고 두 알약의 라이브러리 참조 및 최종 캐시 연쇄만 맞췄다. main의 자료실25·view-loader124·loader-v2357·app245보다 각 한 단계 높은26·125·358·246을 사용한다. 충돌 파일별 표와 최종 SHA 검증 결과는 #497 후속 댓글에 기록한다.
