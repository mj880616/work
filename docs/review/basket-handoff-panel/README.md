# BASKET-맡기기창정리 검증

📱 폰 가능 · Codex 웹 · PR [#504](https://github.com/mj880616/work/pull/504)

시작 main: `b4c08cd7dc2ee5757146c8e77b9613caf995db1e`(새 fetch, #502 merge `e1d7483` 조상). 브랜치: `codex/basket-handoff-panel`. 최종 SHA·자동 CI·전체 브라우저 판정은 PR의 12항목 댓글에 기록한다.

## 원인: 사실과 추정

- 사실: 기존 호출 순서는 클릭 → readBasket → 프로젝트 모듈/카탈로그·조직/담당 조회 → writeText였다. readHandoff·복사 글 생성/형식은 이번에 그대로 유지했다.
- 사실: clean main 코드 + 로컬 Chromium 151 + 합성 API에서 메모 조회를 6.1초 지연시키면 실제 writeText 호출 시 `navigator.userActivation.isActive=false`, `NotAllowedError`로 실패했고 대체 상자가 나왔다. 지연 중 Playwright 폴링/브라우저 평가가 user gesture를 갱신해 실패를 가리는 것을 발견하여, 6.8초간 브라우저 평가를 하지 않는 재현으로 확인했다. 수정 후 같은 재현은 `write`, `active=true`로 시작하고 실제 복사 내용까지 확인했다. clipboard-write 권한을 별도로 부여하지 않은 지연 사례다.
- 사실: 실패 상자에 닫기가 없었고 목록 필터·분류 결과·메모·다른 메뉴 이동 때 글을 지우지 않았다. 모듈은 화면 전환 때 제거되지 않아 글이 남았다. 기존 재클릭은 clear부터 시작했지만, 완료된 상자를 화면 전환에서 제거하지 못했고 조회 중 busy가 화면 내부 이동을 막았다.
- 추정: 보고된 안드로이드 크롬도 조회 지연에 따른 사용자 동작 만료로 실패했을 가능성이 높다. 운영 접속·폰 로그·권한 설정은 확인하지 않았으므로 사용자 폰의 직접 원인으로 단정하지 않는다. 브라우저가 복사를 거부하면 대체 상자가 계속 필요하다.

## 변경과 경계

- ClipboardItem의 text/plain 데이터에 Promise를 넣고 첫 클릭 호출 스택에서 clipboard.write를 시작한다. 빈 메모·취소·세션 변경은 데이터를 거절해 클립보드를 덮어쓰지 않는다. 지원 API가 없는 브라우저는 기존 writeText와 수동 복사 경로를 쓴다.
- 일부 브라우저는 글 준비가 끝날 때 사용자 동작을 다시 검사한다. 자동 복사가 실패한 상자 위에 복사하기를 추가했다. 두 번째 탭은 준비된 글에 writeText를 즉시 호출하며, 성공하면 상자를 숨기고 글을 비운다. 재거부 시 수동 선택 상자는 유지한다. 추가 조회·저장소 쓰기·권한 우회 없이 처리한다.
- 성공 시 기존 짧은 완료 안내만 표시한다. 실패 시 읽기 전용 상자 위 닫기 버튼을 표시한다. 닫기 후 글/상태를 비우고 맡기기 버튼으로 초점을 돌린다.
- 재클릭·보기 전환·결과 넣기·메모 열기·다른 메뉴로 나가기 때 상자를 닫고 비운다. 진행 중 handoff만 취소하고 다른 저장/분류 작업의 busy 잠금은 해제하지 않는다. 취소된 조회의 늦은 결과가 상자를 되살리지 못한다.
- #500 담당조직 필터·#502 프로젝트 경로·복사 글 전문·파서·RPC·첨부 링크 형식 유지. 비공개 글을 localStorage/sessionStorage에 저장하지 않는다. DB/RLS·Edge·Drive 사본·인증/권한 변경 없음. 운영 접속·workflow 수동 실행·merge 없음.
- 캐시: basket-ai-handoff8 → basket16 → view-loader131 → loader-v2364 → app252 → index.html. 정확한 버전 기대 테스트와 smoke도 함께 갱신.

## 검증

- clean main Node 전체: 544/544. 초기 Deno 미설치로 격리 검사 실행 불가; 환경에 Deno 2.9.6을 설치한 뒤 전체 통과. 저장소 소스/테스트 변경으로 우회하지 않았다.
- 수정 Node 전체: `PATH="$PWD/node_modules/.bin:$PATH" node --test $(rg --files tests scripts -g '*.test.mjs' -g '!tests/auth-handoff/**')` → 547/547. 신규 3개(클릭 내 시작·빈 메모·취소된 데이터 거절)는 수정 전 RED, 수정 후 GREEN. DB 변경이 없어 임시 PostgreSQL 별도 패키지는 이번 범위에서 실행하지 않았다.
- Chromium 151: basket-classification·basket-org-mine·basket-handoff-panel 관련 34/34, 리뷰 보완 후 패널 14/14. 390/1280px, 실제 clipboard 허용/거부, 조회 6.1초 지연, 닫기(Enter/터치), 재클릭 중 이전 글 즉시 비움·새 글 교체, 필터/결과 넣기/메모/홈/달력 전환, 조회 중 전환 6사례, 늦은 data Promise 완료까지 확인, 브라우저 저장소 전문 미저장, 정상 콘솔 오류0·가로 넘침 없음.
- 리뷰 발견: handoff 조회 중 화면 내부 버튼이 공통 busy에 막힘. 신규 회귀 RED 확인 후 handoff 소유 잠금만 전환 전에 해제. 후속 별도 리뷰로 확인한다.
- app-smoke-check의 모든 run 단계를 로컬에서 실행(기존 로컬 HTTP8123 재사용) → 통과. workflow를 실행한 것이 아니며 운영 호출 없음.
- `node scripts/check-loader-cache.mjs --base b4c08cd7dc2ee5757146c8e77b9613caf995db1e` → 운영 참조425개 통과. 변경 JS 문법·git diff 공백 검사 통과.
- 전체 브라우저는 최종 SHA의 자동 App browser E2E check로 판정한다. 리뷰 수정 전 시작한 로컬 전체 실행은 22개 통과 뒤 중단했으며 전체 통과로 세지 않는다. 기존 테스트 삭제·약화 없음.

## 캡처(합성 데이터만)

| 화면 | 390px | 1280px |
| --- | --- | --- |
| 복사 성공 | [성공](success-390.png) | [성공](success-1280.png) |
| 복사 거부·복사하기/닫기 상자 | [대체 상자](fallback-390.png) | [대체 상자](fallback-1280.png) |
| 복사하기 재실패·전체 선택 | [재실패](retry-failed-390.png) | [재실패](retry-failed-1280.png) |

## CI 후속 발견과 호환 보완

- 초기 SHA `d44cf7a` 자동 전체 회귀는 1212/1214(24.1분). 신규 지연 복사390/1280 두 사례만 실패했고 기존1200과 나머지 새 사례는 통과했다. CI는 Chromium Headless Shell140.0.7339.16을 사용했다. 첫 write의 activation은 true였지만 deferred data 준비 뒤 NotAllowedError였다. 로컬 Chromium151에서는 같은 무권한 지연 프로브가 성공했다. 버전/빌드 차이의 세부 원인은 단정하지 않는다.
- 사용자가 허용한 두 번째 탭 경로로 보완: 실패 상자의 복사하기 → 이미 준비된 글에 새 동작에서 writeText → 실제 복사 성공 시 상자/글 비움. 진짜 권한 거부에서는 그대로 수동 복사/닫기 가능하다.
- Playwright clipboard-write 단독은 allowWithoutGesture=true 권한 조회가 denied인 것을 RED로 확인했다. 기존 실제 복사 테스트와 같은 clipboard-read/write 명시 허용으로 맞추고 실제 granted 상태를 먼저 assertion한다. 동작 필요 native/재검사 모델은 제한된 허용 상태를 명시하여 보안 경계를 우회하지 않고 두 번째 동작으로 완료하는지 확인한다.
- 지연 자동 성공 테스트는 명시 clipboard-read/write 허용 사례로 유지하여 첫 write active=true/실제 내용/상자 미표시를 모두 확인한다. 동작 필요 실제 native 지연 사례를 별도로 추가해, 처음 성공하거나 준비된 글에 새 탭을 누른 뒤 실제 복사 완료를 반드시 확인한다. activation을 data 준비 뒤 검사하는 모델은 실제 writeText를 사용하며 첫 거부→필수 두 번째 터치→실제 클립보드 내용과 상자 비움을 검증한다. 기존 main1200 테스트는 삭제·약화하지 않았다.
- 후속 로컬 Node547/547·관련Chromium44/44. 최종 패널18/18 별도 통과. 결과를 PR 댓글에 기록한다. 권한 거부 때 복사하기 Enter를 눌러도 상자/글을 유지하는 assertion을 추가했다. 늦은 결과를 기다리는 CDP polling은 userGesture=false로 수행해 동작 만료를 가리지 않는다.
- 두 번째 복사 원문 보존: textarea.value의 CRLF→LF 정규화가 실제 복사에 반영되는 RED를 추가로 재현했다. 원래 준비한 문자열을 handoff 메모리에만 유지하고 모든 clear에서 함께 비워, 실제 CRLF 복사 GREEN·최종 패널18/18·Node547/547을 확인했다. 추가 리뷰 중요 지적 없음.
- 로컬 smoke 재실행·캐시425참조·문법/공백 통과. 추가 별도 리뷰 중요 지적 없음, 느린 준비 완료를 기다리라는 테스트 보완 반영.
- 공식 CI 동일 버전 바이너리 다운로드는 클라우드 네트워크 정책403으로 실행 불가. 허용된 npm의 Lambda용140 바이너리는 로컬 renderer가 crash하여 검증 근거로 세지 않는다. 최종 CI의 실제140 회귀 결과로 판정한다.

- 역방향 이동도 RED로 재현: 메모/결과 넣기 화면에서 새 복사 상자를 열거나 조회 중인 상태로 목록으로 돌아가면 비움이 빠져 있었다. 메모 닫기/결과 넣기 닫기 콜백에 같은 clear를 연결하고, 메모 닫기는 busy guard 전에 handoff만 취소한다. 수정 중 글 확인·다른 저장/분류 잠금 유지. 390/1280px 완료 상자와 지연 조회 양쪽의 역방향 회귀4사례를 추가했다. 별도 리뷰 중요 지적 없음. 최종 관련48/48·바구니 인접37/37·Node547/547·smoke/캐시425참조 통과. 결과는 PR 댓글에 기록한다.

## 사용자 폰 확인

merge/배포는 사용자가 별도로 판단한다. 반영 후 안드로이드 크롬에서 AI에게 맡기기 한 번으로 “복사했어요” 문구가 뜨는지 확인한다. 첫 자동 복사가 실패하면 상자 위 복사하기로 두 번째 탭 복사가 되는지, 닫기로 글 상자가 사라지는지 확인한다. 재클릭·다른 화면 이동 후 이전 글이 남지 않는지도 확인한다.

BASKET-사진글자(2026-10-12 승인, Google Drive OCR로 메모에 글 붙이기, 10/9 “첨부는 링크만” 변경, 4b-1 앞)·BASKET-삭제(연결 없는 메모만, 첨부 Drive 휴지통, 확인1회, 착수 때 결정·급하지 않음)는 원장 대기 등록만 했다.

## 최종 테스트 권한 상태 확인

- 중간 `8b3501a` CI는 1214/1218(24.6분): 명시 허용 지연은 통과했지만 미지정 권한을 “새 동작이면 허용”으로 가정한 추가 native/model4사례가 실패했다. 기존 main1200·명시 거부·상자 수명은 통과했다.
- 로컬 Lambda용140.0.7339.0에서 기본 권한은 두 descriptor 모두 prompt였다. focus=true·active=true·trusted=true의 plain-button writeText도 “Write permission denied”였다. clipboard-write만 명시하면 allowWithoutGesture=false는 granted, true는 denied이며 새 터치 쓰기는 성공했다. 따라서 미지정 권한을 조건부 허용으로 가정하지 않는다. CI의 기본 prompt 거부가 실패 원인이라는 해석은 이 진단과 일치하지만 폰 원인과는 구분한다.
- 추가 native/model 테스트는 gestureWriteAllowed로 위 두 상태를 먼저 assertion한다. 전체 허용·새 동작에서만 허용·명시 거부를 따로 검증하고, 모델의 첫 거부→필수 새 터치→실제 복사·CRLF 보존·상자/글 비움은 유지한다. 앱에서 권한을 부여하거나 경계를 바꾸는 코드는 추가하지 않는다. Chromium151 최종 패널22/22, 별도 테스트 검토 지적 없음.
- 초기 Lambda 실행의 single-process 옵션을 제거해 기본 터치/권한 probe와 native 조건부 복사2개를 실행할 수 있었다. Lambda 패널 전체는18/22(명시 거부2개가 override와 다르게 동작, getType 모델2개 timeout)여서 공식 CI의 대체 통과 근거로 세지 않는다. 전체 완료 판정은 최종 SHA의 공식 자동 CI로 한다.


## CC 검토 보완(2026-10-12)

- 같은 브랜치·PR #504에서 시작 SHA `6e25f900879763c2f882592bda94af56cb22fbc0`, 새 fetch main은 `b4c08cd7dc2ee5757146c8e77b9613caf995db1e`로 동일. CC는 코드 수정 없음.
- 첫 자동 복사 실패 안내: “아래 '복사하기'를 눌러 주세요”. 복사하기에 기존 quick-pill-primary를 적용하고 버튼 순서 복사하기 → 닫기 유지.
- 복사하기 재실패는 상자와 원문을 유지하고 “복사가 안 되면 길게 눌러 전체 선택 → 복사” 안내 뒤 textarea에 focus/select. 기존 epoch/scope current 검사 안에서만 처리하며 fallbackText 원문 문자열·CRLF 복사 유지.
- 기존 거부 테스트390/1280에 기본 안내·강조 클래스·버튼 순서·키보드 Enter/실제 터치 재실패의 초점과 전체 선택을 추가. 미리 선택을 접어 이전 선택 상태로 통과하지 않도록 검증한다. 변경 전 기본 안내 RED2/2, 안내 변경 뒤 실제 focus 누락 RED2/2, 수정 후 패널22/22·관련46통과/2실패(인접 분류 테스트의 옛 안내 기대값). 해당 기대값만 요구대로 갱신해 최종 관련48/48(1.7분) 통과. ArrowLeft로 선택이 접히지 않아 사전 조건만 setSelectionRange(0,0)으로 조정했으며 실제 focus/select 검증은 유지했다. 기존 회귀22와 CRLF·늦은 결과 취소 유지, 테스트 삭제/약화 없음.
- Node 전체547/547·로컬 smoke 모든 run·캐시425참조·구문/공백 통과. readHandoff/buildHandoff는 보완 시작 SHA와 동일. 별도 읽기 전용 리뷰 중요 지적 없음.
- 캐시: handoff9 → basket17 → view-loader132 → loader-v2365 → app253 → index.html. 기대 테스트·smoke 동일 갱신.
- 위 캡처6장을 현재 보완 코드의 합성 데이터로 교체/추가했다. 정상 콘솔 오류0·가로 넘침 없음.
- BASKET-연결보기 대기(연결 요약 저장·수정, 조직·프로젝트·홈에 바구니 연결 기록 표시, 2026-10-12 사용자 요구)를 사진글자 앞에 등록. 사진글자는 연결보기 뒤·4b-1 앞. 이번에는 원장 등록만.
- 최종 SHA의 자동 CI·전체 브라우저 결과는 PR의 12항목 댓글에 확정한다. 운영 접속·DB/RLS·Edge 배포·workflow 수동 실행·merge 없음.
