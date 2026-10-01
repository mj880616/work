# D-1 촬영 및 측정 기록

## 기준과 방법

- 시작 `origin/main`: `223ed8f5c0686ae06a120f2668f1d24f7d379b40` (#381 merge 포함).
- `scripts/design-audit/capture.mjs`가 **이 worktree만** 루트로 삼은 `127.0.0.1` 정적 서버를 열어 사용한다. 인증과 데이터 요청은 `tests/app-e2e`의 E2E 방식처럼 Playwright `page.route()`로 모의 응답한다. 조직명과 묶음은 `organization-detail-tasks.spec.mjs`의 시험 목록을 따른다. 실제 계정·토큰·비밀번호, 운영 주소는 사용하지 않았다.
- 기본 폭은 `360, 412, 720, 884, 1280, 1440px`, 높이는 모두 `900px`이다. 경계 확인용으로 `759, 760, 761px`을 추가했다. JPEG 품질 50, `fullPage: true`로 촬영했다. 내부 스크롤이 있는 편집창·일정 조직 목록은 해당 내부 영역을 스크롤한 별도 사진을 남겼다.
- 기본 6폭에서 폭마다 18장(로그인, 캘린더·등록창·조직 영역, 할 일 목록·편집창 상·하단, 프로젝트 목록·상세, 회의 목록·상세·새 창, 담당조직 목록·상세, 자료실, 성명·보도자료, 게시판, 현재 메뉴)을 촬영했다. 경계 3폭의 로그인·메뉴 6장을 합쳐 **114장**, 약 **3.85MB**다. 20MB 제한으로 뺀 사진은 없다.
- `measurements.json`은 각 사진의 computed style 종류·빈도와 버튼 크기·문서 가로 넘침·메뉴 스크롤 폭을 기록한다. 색 35종은 보이는 요소의 전경색과 불투명 배경색의 합집합이다. 버튼 높이 32종은 실제 `<button>`의 화면상 높이이며 달력 날짜 셀처럼 큰 버튼도 포함한다.

## 못 찍은 화면·상태

| 요청 항목 | 이유 |
| --- | --- |
| 홈 | 현행 라우터가 `?view=home`을 캘린더로 바꾸고, `homeView`는 비어 있다. 독립된 홈 화면을 촬영할 수 없다. |
| 설정 | 현행 메뉴와 라우터에 설정 진입점이 없다. `profileView` 코드는 있으나 설정 화면으로 연결되지 않는다. |
| 상단·하단 메뉴 **열린 상태** | 현행 메뉴는 가로 스크롤 또는 왼쪽 세로 메뉴이며 열림 상태가 없다. 현재 표시된 메뉴 사진(`navigation-*`)만 촬영했다. |

## 실행

로컬 정적 서버를 이 worktree 루트에서 띄운 뒤 실행한다. Playwright 패키지 설치 경로는 환경 변수로 지정할 수 있다. 스크립트는 로컬 loopback 외 HTTP origin을 거부하고 Supabase URL 요청은 전부 모의 응답하며 다른 외부 요청은 차단한다.

```powershell
python -m http.server 8124 --bind 127.0.0.1
$env:APP_E2E_ORIGIN='http://127.0.0.1:8124'
$env:DESIGN_AUDIT_PLAYWRIGHT='<installed-playwright-package-directory>'
node scripts/design-audit/capture.mjs
```

## 측정 요약

| 항목 | computed style 종류 수 | 비고 |
| --- | ---: | --- |
| 양수 글자 크기 | 24 | 7–28px; 목표 4단계 |
| 전경·불투명 배경색 | 35 | 모든 촬영 화면의 합집합 |
| 0이 아닌 모서리 반경 | 6 | `6px`, `8px`, `12px`, `14px`, `999px`, 상단만 둥근 복합값 |
| 실제 `<button>` 높이 | 32 | 13–140px; 달력 날짜 셀 포함 |

문서 가로 넘침은 촬영 9개 폭 모두 0px이었다. 360px 메뉴는 `scrollWidth 560px / clientWidth 338px`이며, 독립 가로 스크롤을 사용한다. 측정과 사진은 Chromium 로컬 fixture 결과이며 폴드 실기기와 운영 데이터 상태의 검증은 남아 있다.
