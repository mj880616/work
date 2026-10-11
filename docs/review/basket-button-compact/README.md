# 📱 폰 가능 — BASKET-버튼정리 검증

Codex 웹·클라우드, 화면 전용 파일·PR 작업. 원격 `origin/main`을 새로 fetch한 실제 시작 SHA는 `2837b9b051db61ee427cee0afff700009acc5420`(#492 merge)다. 브랜치 `codex/basket-button-compact`. PR·최종 SHA·자동 CI 결과는 PR과 완료 보고에서 기록한다. merge는 커맨드센터에서 판단한다.

기존 `#basketView button`은 모든 버튼을 최소 44px·본문 16px·8px 모서리로 그렸다. 홈 빠른 입력 모드는 30px·12px·알약 모서리였다. `home-quick.js`의 마크업은 그대로 두고 `home-read.css`의 모드 묶음·선택 상태·글자 링크 선언 네 개를 `app/quick-controls.css`로 옮겼다. 홈과 바구니 CSS가 같은 파일을 import한다. 홈 선택자·선언은 보존했다.

바구니 필터·AI 두 버튼·결과 패널의 목록으로/확인/연결하기에만 작은 알약 클래스를 붙였다. 필터의 `aria-pressed`·기존 키보드 focus-visible·busy/disabled·연결 로직은 유지한다. “홈에서 입력 ›”는 홈의 글자 링크와 같은 12px·44px 높이·색·투명 배경·padding이다. 연결하기는 기존 `--kptu-primary`/`--kptu-on-primary`를 쓴다. 다른 화면, 상세 편집·첨부 버튼, 인증·API·DB·Edge는 변경하지 않았다.

30px 버튼의 투명 `::after`가 위아래 7px씩 확장하여 44px 터치 높이를 유지한다. 그룹/액션에는 7px 상하 공간과 줄바꿈 때 14px 행 간격을 두어 확장 영역끼리 겹치지 않게 했다. 실제 그림 바깥 5px를 터치해서 필터와 연결 동작을 검증했다.

## 실측

설치 Chromium `151.0.7922.173`, Playwright `1.55.0`, 390×1000·1280×1000 viewport, 로컬 정적 서버·합성 로그인/API. 운영 요청은 fixture에서 차단한다. 두 폭의 모든 대상 버튼을 `getBoundingClientRect()`·computed style로 측정했다.

| 대상 | 변경 전(두 폭) | 변경 후(두 폭) | 홈 기준 |
| --- | --- | --- | --- |
| 필터 3개 | 44px / 16px / radius 8px | 30px / 12px / radius 999px | 30px / 12px / radius 999px |
| AI 두 버튼 | 44px / 16px | 30px / 12px, 한 줄 | 30px / 12px |
| 목록으로·확인·연결하기 | 44px / 16px | 30px / 12px | 30px / 12px |
| 실제 터치 높이 | 44px | 44px | 바구니 기존 기준 유지 |
| 홈 입력 링크 | 44px / 16px / 테두리 | 44px / 12px / 글자 링크 | 44px / 12px / 글자 링크 |

변경 후 AI 두 버튼 y는 390px에서 모두 147.1875px, 1280px에서 모두 29.09375px이다. 원시 측정값은 각 before/after 폴더의 `metrics-390.json`·`metrics-1280.json`에 있다.

## 전후 캡처

최종 동일 fixture를 깨끗한 시작 SHA의 `git archive`와 수정 브랜치에서 실행했다. 홈 전체 캡처는 390(390×1024 이미지)·1280(1280×1485 이미지) 모두 **다른 픽셀 0**이다. [대조 결과](home-comparison.json).

| 화면 | 390 변경 전 | 390 변경 후 | 1280 변경 전 | 1280 변경 후 |
| --- | --- | --- | --- | --- |
| 바구니 목록 | [전](before/basket-list-390.png) | [후](after/basket-list-390.png) | [전](before/basket-list-1280.png) | [후](after/basket-list-1280.png) |
| 결과 넣기 패널·선택 후 | [전](before/basket-panel-390.png) | [후](after/basket-panel-390.png) | [전](before/basket-panel-1280.png) | [후](after/basket-panel-1280.png) |
| 홈 전체 | [전](before/home-390.png) | [후](after/home-390.png) | [전](before/home-1280.png) | [후](after/home-1280.png) |

## 검증

- 새 브라우저 검사 2/2: 모든 대상 버튼의 홈 높이·글자·모서리 비교, AI 한 줄, 링크 스타일, primary 색, 44px 영역, Tab focus·Enter·Space, 필터·복사·입력·확인·체크·연결 및 목록 반영, 넘침 없음·콘솔/pageerror 0·외부 미처리 요청 0. clean main에서는 두 검사 모두 기대한 높이 차이 14px로 실패했다.
- 홈 재진입은 내부 콘텐츠 픽셀 정확일치와 크기·스타일 직접비교를 함께 검사한다. 모바일 카드 바깥 모서리는 fractional 좌표에 따른 8픽셀 차이를 확인해 테두리 2px만 콘텐츠 비교에서 제외했다. **변경 전/후 홈 전체 대조는 제외·허용 없이 0차이**다.
- Node 전체(로컬 DB 시험 제외) 506/506: `node --test tests/*.test.mjs tests/security/*.test.mjs tests/domain/*.test.mjs scripts/*.test.mjs`. clean main도 506/506.
- 관련 Chromium 137/137: 기존 바구니·AI/분류·첨부/클립·홈 빠른 입력/홈 읽기/레이아웃/선택기/내비게이션·캐시 기대 spec에 신규 2개를 포함했다. 기존 1440px 이름 사례만 로컬 실행에서 제외했고 검사는 변경하지 않았다. 새 치수·캡처 목표 폭은 390/1280px이며 기존 회귀의 추가 경계 폭도 함께 실행했다.
- 정적 16개 블록 통과: app-smoke의 JS 구문·의존 그래프·디자인·인증 경계·HTTP 및 저장소 감사·조직 정적·notification 제거 검사. GitHub workflow를 실행한 것이 아니라 해당 검증 명령을 로컬에서 실행했다. HTTP 검사에는 이미 실행한 로컬 서버를 사용했다.
- `git diff --check`·재귀 캐시 검사 402참조 통과. 독립 읽기 전용 리뷰와 후속 테스트 리뷰에서 중요한 지적 없음.
- 기존 테스트 삭제·약화 없음. 버전 기대 테스트는 캐시 문자열만 갱신했다. 기존 함수 없음 회귀는 의도한 404를 주입하고 해당 네트워크 콘솔 오류 한 개를 정확히 검증한다. 정상 흐름은 콘솔 오류 0이다.

## 캐시·원장·후속 확인

`basket-classification-ui` 3→4 → `basket` 8→9, `basket.css` 4→5, `home-read.css` 12→13(둘 다 새 `quick-controls.css?v=1` import) → `view-loader` 120→121 → `loader-v2` 353→354 → `app` 241→242 → index preload/script. 버전 기대 spec 3개와 `app-smoke-check.yml` 고정 버전도 맞췄다.

[원장](../../roadmap.md)에 BASKET-버튼정리 진행중·이 PR 행을 추가한다. 사용자 폰의 실제 터치·키보드·AI 두 버튼 한 줄·결과 패널·홈 외형을 merge 후 확인한다. 아직 실기기 확인은 하지 않았다. 운영/DB/Edge 접속·workflow 수동 실행·environment 승인·merge 없음. 되돌릴 때는 이 화면 PR을 revert하고 같은 캐시 규칙을 적용한다.
