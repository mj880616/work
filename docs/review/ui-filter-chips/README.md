# UI-필터알약 검토 자료

📱 폰 가능 — Codex 웹·클라우드. 시작 `origin/main`: `2837b9b051db61ee427cee0afff700009acc5420`. 브랜치 `codex/ui-filter-chips`. [PR #494](https://github.com/mj880616/work/pull/494).

회의명·자료 종류·프로젝트 목록 필터가 공용 `renderFilterChips`를 사용한다. 홈의 기존 30px·12px 알약 선언을 `quick-controls.css`로 옮겨 재사용했다. 알약 줄은 줄바꿈 없이 가로 스크롤되며 44px 터치 영역, radiogroup/aria-checked, 좌우·Home/End·Enter/Space, 포커스 표시와 선택 항목 자동 노출을 제공한다. 하위 프로젝트는 26px 작은 알약이며 터치 영역은 44px다.

자료실 상위 선택은 기존처럼 상위 ID에 직접 연결된 자료만 찾는다. 하위 선택은 그 하위 ID, 전체는 모든 프로젝트다. 보관·이전·확인 불가 프로젝트에 연결된 자료의 필터 선택도 유지한다. 자료 종류 기본값 `general`, `all`/`meetings`, 검색 조합, 재진입 기본값, stale 값 정리와 모달 select를 유지했다. 자료실 행 템플릿은 변경하지 않았다. 프로젝트 상세 자료 “전체 보기” 연결도 새 필터 상태를 사용한다.

회의 색은 기존 이름 정규화·해시 코드를 재사용한 8색이며 이름만으로 결정된다. 행 색줄과 필터 점은 같은 함수를 사용하고 미지정은 `#808080`이다. 흰색·어두운 남색·검정 표면에서 3:1 이상 대비와 팔레트 간 구분을 기존 테스트로 확인한다. 8색 고정 팔레트이므로 서로 다른 이름도 해시가 겹치면 같은 색일 수 있다. 전체 이름에 대한 고유색은 유한 팔레트로 보장할 수 없으며, 대표 세 회의명은 서로 다른 색임을 검사한다. 회의 행 간격은 4px로 늘렸다.

`meeting-time.js`가 회의 목록·상세·회의명 선택 레이블·프로젝트 회의 이력의 한국 시간 표시, 새 회의·수정·미로딩 AI 초안의 한국 시각→ISO 변환, 수정 입력값 역변환을 맡는다. Rome/Seoul/UTC에서 `10:00`은 `01:00Z`, 한국 `00:30`은 전날 `15:30Z`로 저장된다. 기존 DB 데이터와 결정 시각 등 회의 밖 시간은 변경하지 않는다. 현재 AI 모듈은 로더에서 제외되어 있으며 다시 연결하지 않았다.

## 전후 캡처

설치 Chromium 151.0.7922.173, 390×900·1280×900 viewport. 전체 페이지 캡처라 데스크톱 홈 이미지 높이는 980px다. 동일한 합성 로그인·프로젝트·자료·회의 데이터와 고정 시각을 사용했다. 운영 서버·DB를 호출하지 않았다.

| 화면 | 390px 전 | 390px 후 | 1280px 전 | 1280px 후 |
| --- | --- | --- | --- | --- |
| 회의 목록 | [전](before/meetings-390.png) | [후](after/meetings-390.png) | [전](before/meetings-1280.png) | [후](after/meetings-1280.png) |
| 자료실 목록 | [전](before/library-390.png) | [후](after/library-390.png) | [전](before/library-1280.png) | [후](after/library-1280.png) |
| 프로젝트 선택·2단 펼침 | [전: 상위 선택](before/project-390.png) | [후: 2단](after/project-390.png) | [전: 상위 선택](before/project-1280.png) | [후: 2단](after/project-1280.png) |
| 홈 비교 | [전](before/home-390.png) | [후](after/home-390.png) | [전](before/home-1280.png) | [후](after/home-1280.png) |

홈 RGB 픽셀 차이는 두 폭 모두 **0**이다([비교](home-comparison.json)). 캡처의 console error/pageerror는 전후 모두 **0**이다. [390px 실측](after/metrics-390.json)·[1280px 실측](after/metrics-1280.json)에서 알약 높이 30px, 터치 영역 44px, 가로 스크롤을 확인할 수 있다.

재현: `node docs/review/ui-filter-chips/capture.mjs after http://127.0.0.1:8123`. `@playwright/test`와 설치 Chromium을 사용한다. before는 시작 SHA를 별도 로컬 디렉터리로 펼친 정적 서버에서 같은 스크립트를 실행했다.

## 최초 구현 검증과 캐시 (2837b9b 기준)

- Node: `node --test tests/*.test.mjs tests/domain/*.test.mjs tests/security/*.test.mjs scripts/*.test.mjs` **512/512 통과**. 회의 한국 시간 6건 포함. DB 연결이 필요한 테스트는 실행하지 않았다.
- 신규 UI 6건: 두 폭의 필터 결과·가로 스크롤·자동 노출·키보드·터치·색점/색줄·상위/하위·검색, 세 기기 시간대의 표시/새 저장/수정 왕복, 프로젝트 상세→자료실 연결 통과.
- 확대 브라우저 회귀 **275/275 통과**(16개 spec, 설치 Chromium). 회의·자료실·프로젝트·접근성·업로드 실패/전송·자료 선택/삭제·테마·시작 로딩·일정·할 일·기존 AI 은퇴 경로를 포함한다. 처음 확대 실행에서 새 테스트 보조 코드의 숨김 하위 필터 열거 2건이 실패해 수정한 뒤, 전체 275건을 다시 실행해 통과했다. 기존 main 실패로 분류한 항목은 없다.
- 추가 모달·목록 스타일 검증 **9/9 통과**. 최초 자동 전체 CI는 1,166/1,168 통과했고 `modal-typography` 390/1440 두 건이 옛 select 레이블과 새 알약을 그대로 비교해 실패했다. 해당 세 필터만 전용 검증으로 옮겨 radiogroup·단일 선택과 홈 알약의 9개 스타일 속성을 정확히 비교한다. 나머지 모든 목록 역할 스냅샷과 모달 감사는 유지했으며 독립 리뷰에서 테스트 약화 없음 확인. 로컬 확대 중 역사 기준 할 일 제목의 빈 computed style이 한 번 나왔고, 좁힌 재검사 2건과 최종 파일 전체 9건은 통과했다. 최종 자동 CI 결과는 [PR Checks](https://github.com/mj880616/work/pull/494/checks)에서 확인한다.
- 정적 smoke 12블록·JavaScript 77파일 문법·로컬 HTTP 109자산 통과. 저장소의 브라우저 저장·알림 제거·조직 상세 정적 감사 통과. GitHub workflow를 실행하지 않고 로컬 검사 명령만 사용했다.
- 캐시 검사 `node scripts/check-loader-cache.mjs --base 2837b9b051db61ee427cee0afff700009acc5420`: 운영 참조 **409개** 통과. diff 공백 검사 통과.
- 독립 리뷰에서 발견한 프로젝트 상세의 옛 select 연결을 수정하고, 수정 전 실패·수정 후 통과를 확인했다. 최종 리뷰에 중요 지적 없음.

캐시: `filter-chips.js/css`·`meeting-time.js`·`quick-controls.css` 각1, `team.js`67, `library-upload.js`25, `meeting-round-detail.js`25, `project-system-v3.js`43, `meeting-ui.css`15, `home-read.css`13, `view-loader.js`121, `loader-v2.js`354, `app.js`242 → `index.html`. `styles.css`의 meeting-ui 참조도15로 맞추고 로그인에서 styles79로 전파했다. 버전 기대 테스트와 `app-smoke-check.yml` 고정 문자열을 같은 PR에서 갱신했다. `workflow-ai-v3.js`는 활성 로더 참조가 없어 올릴 버전이 없다.

## 병행 작업·운영 경계

최초 구현 당시 BASKET-버튼정리 #493과 `quick-controls.css`, `home-read.css`, `view-loader.js`, `loader-v2.js`, `app.js`, `index.html`, 버전 기대 테스트·smoke·원장이 겹친다. 새 공용 CSS는 홈·목록 필터 선언만 포함한다. #493의 바구니 기능 파일은 수정하지 않았다. 커밋 전 원격 main을 다시 fetch했으며 시작 SHA와 동일했다. 확인 당시 #493은 미병합이고 BASKET-붙여넣기수정의 공개 원격 브랜치·열린 PR은 확인되지 않았다. 이 작업 이후 병합 순서가 정해지면 뒤에 병합하는 PR의 공용 CSS·캐시를 먼저 병합된 main 기준으로 조정해야 한다.

운영 접속·DB·RLS·Edge·데이터 이관·workflow 수동 실행·merge 없음. 인증 게이트·권한 검사·API 엔드포인트·저장 데이터 구조를 변경하지 않았다. 앞으로 저장하거나 수정하는 회의의 일시 해석만 요청대로 한국 고정이다. 복구는 커맨드센터에서 이 PR을 되돌리는 파일 PR로 진행하며 DB 복구 작업은 없다.

회의 밖 시간대 현황: 홈 날짜·주 범위·홈 일정 표시와 달력 목록 조회 범위는 한국 기준이다. 달력 월 배치·일정 입력과 일부 상세 시각은 기기의 Date/getHours와 local ISO 변환을 사용하는 기존 경로가 남아 있다. 프로젝트 주요 일정 입력·결정 기록 표시도 기존 기기 시간대 경로다. 이번 PR에서는 고치지 않았다. 프로젝트 `decisions()` 회의 이력 포맷을 한국 시간으로 맞췄지만 이 렌더러는 현재 상세 본문에서 호출되지 않는다.


## #493 병합 후속 검증

최신 main `ed1c85f3cb443c23fb95b2b70ba569811bc20373`(#493 merge)을 같은 `codex/ui-filter-chips` 브랜치에 merge했다. PR은 #494를 유지한다. 공용 CSS는 main의 `quick-pill-button`, `quick-mode-group`, `quick-pill-primary`, `quick-text-link`를 유지하고 필터가 앞의 두 클래스를 사용하도록 맞췄다. `home-quick-modes`, `home-basket-link`는 기존 홈 선택자로 유지한다. 필터 전용 클래스는 스크롤·포커스·색점·하위 크기만 맡으며 공용 44px 터치 영역을 중복 정의하지 않는다. #493의 바구니 ID 선택자·선언은 모두 유지했다.

| 충돌 파일 | 해결 |
| --- | --- |
| `app/quick-controls.css` | main의 공용 클래스·바구니 선언을 기준으로 일반 필터 선택자와 `aria-checked` 선택 상태만 통합 |
| `app/home-read.css` | main의 공용 CSS 분리와 #494의 중복 홈 링크 선언 제거를 함께 유지; main 대비 import 버전만 변경 |
| `app/view-loader.js` | main의 basket CSS/JS와 #494의 필터·회의 모듈 참조를 함께 유지, 최종 캐시 버전 전파 |
| `.github/workflows/app-smoke-check.yml` | 양쪽 검사 유지, 필터·한국 시간 자산과 최종 고정 버전 통합 |
| `tests/app-e2e/startup-performance.spec.mjs` | 양쪽 시작 로딩 검사 유지, 최종 버전 기대값으로 통합 |
| `tests/app-e2e/task-layout-groups.spec.mjs` | 양쪽 회귀 검사 유지, 최종 버전 기대값으로 통합 |

main 대비 캐시를 각각 한 단계 올렸다: `quick-controls.css` 1→2, `home-read.css` 13→14, `basket.css` 5→6, `view-loader.js` 121→122, `loader-v2.js` 354→355, `app.js` 242→243 및 `index.html`. 필터 JS/CSS는 2, 회의·자료실 기능 모듈은 최초 #494의 main+1 버전을 유지한다. 버전 기대 테스트·smoke 고정 문자열을 같은 최종값으로 맞췄다.

검증: Node **512/512**, 설치 Chromium 회귀 **258/258**(18 spec, #493 `basket-button-compact` 포함), 정적 smoke **12블록**, 로컬 HTTP **109자산**, 캐시 **410참조**, diff 공백·충돌 표시 검사 통과. 2단 작은 알약 26px·공용 터치 영역 44px의 실제 계산값 검사를 추가했다. 기존 테스트 삭제·약화 없음. 독립 리뷰에서 중요 지적 없음. 자동 전체 CI는 push 후 [같은 PR Checks](https://github.com/mj880616/work/pull/494/checks)에서 최종 SHA 결과를 확인한다.

### main #493 대비 390/1280px 캡처

같은 합성 데이터·고정 시각·설치 Chromium, 운영 요청을 모두 mock 처리했다. 홈은 카드 로드 완료 후 900px viewport를 비교하며 다른 화면은 전체 페이지 캡처다. 렌더링 조건과 캡처 순서는 양쪽에 동일하게 적용한다.

| 화면 | 390px main | 390px #494 | 1280px main | 1280px #494 |
| --- | --- | --- | --- | --- |
| 회의 목록 | [전](main493-before/meetings-390.png) | [후](main493-after/meetings-390.png) | [전](main493-before/meetings-1280.png) | [후](main493-after/meetings-1280.png) |
| 자료실 목록 | [전](main493-before/library-390.png) | [후](main493-after/library-390.png) | [전](main493-before/library-1280.png) | [후](main493-after/library-1280.png) |
| 프로젝트 선택·2단 펼침 | [전](main493-before/project-390.png) | [후](main493-after/project-390.png) | [전](main493-before/project-1280.png) | [후](main493-after/project-1280.png) |
| 홈 | [전](main493-before/home-390.png) | [후](main493-after/home-390.png) | [전](main493-before/home-1280.png) | [후](main493-after/home-1280.png) |
| 바구니 목록 | [전](main493-before/basket-390.png) | [후](main493-after/basket-390.png) | [전](main493-before/basket-1280.png) | [후](main493-after/basket-1280.png) |
| 바구니 분류 펼침 | [전](main493-before/basket-panel-390.png) | [후](main493-after/basket-panel-390.png) | [전](main493-before/basket-panel-1280.png) | [후](main493-after/basket-panel-1280.png) |

홈·바구니 목록·바구니 분류 펼침의 RGB 픽셀 차이는 두 폭 모두 **0**이다([비교 JSON](main493-comparison.json)). 전후 console error/pageerror는 모두 **0**이다. 홈 로드 완료·network idle·폰트 준비를 기다리고 소프트웨어 렌더링을 사용한다. 초기 캡처의 이전 화면 전체 페이지 높이 영향·미완료 카드 로딩·둥근 테두리의 미세한 재페인트 차이를 제거하도록 두 서버에 같은 촬영 조건을 적용했다. 제품의 홈·바구니 모양을 수정하지 않았다.

재현: main을 별도 디렉터리에 `git archive`로 펼쳐 8125 로컬 서버를 열고, 작업 브랜치를 8123에서 연 뒤 `node docs/review/ui-filter-chips/capture.mjs main493-before http://127.0.0.1:8125`, `node docs/review/ui-filter-chips/capture.mjs main493-after http://127.0.0.1:8123`를 실행한다. 운영·DB·Edge·수동 workflow 실행 없음. 원장의 BASKET-버튼정리 행은 완료(#493 merge ed1c85f), UI-필터알약 행은 진행중(#494)으로 함께 유지했다. main merge는 커맨드센터에 남긴다.
