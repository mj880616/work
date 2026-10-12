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
- 성공 시 기존 짧은 완료 안내만 표시한다. 실패 시 읽기 전용 상자 위 닫기 버튼을 표시한다. 닫기 후 글/상태를 비우고 맡기기 버튼으로 초점을 돌린다.
- 재클릭·보기 전환·결과 넣기·메모 열기·다른 메뉴로 나가기 때 상자를 닫고 비운다. 진행 중 handoff만 취소하고 다른 저장/분류 작업의 busy 잠금은 해제하지 않는다. 취소된 조회의 늦은 결과가 상자를 되살리지 못한다.
- #500 담당조직 필터·#502 프로젝트 경로·복사 글 전문·파서·RPC·첨부 링크 형식 유지. 비공개 글을 localStorage/sessionStorage에 저장하지 않는다. DB/RLS·Edge·Drive 사본·인증/권한 변경 없음. 운영 접속·workflow 수동 실행·merge 없음.
- 캐시: basket-ai-handoff6 → basket13 → view-loader128 → loader-v2361 → app249 → index.html. 정확한 버전 기대 테스트와 smoke도 함께 갱신.

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
| 복사 거부·닫기 상자 | [대체 상자](fallback-390.png) | [대체 상자](fallback-1280.png) |

## 사용자 폰 확인

merge/배포는 사용자가 별도로 판단한다. 반영 후 안드로이드 크롬에서 AI에게 맡기기 한 번으로 “복사했어요” 문구가 뜨는지, 실패하면 닫기로 글 상자가 사라지는지 확인한다. 재클릭·다른 화면 이동 후 이전 글이 남지 않는지도 확인한다.

BASKET-사진글자(2026-10-12 승인, Google Drive OCR로 메모에 글 붙이기, 10/9 “첨부는 링크만” 변경, 4b-1 앞)·BASKET-삭제(연결 없는 메모만, 첨부 Drive 휴지통, 확인1회, 착수 때 결정·급하지 않음)는 원장 대기 등록만 했다.
