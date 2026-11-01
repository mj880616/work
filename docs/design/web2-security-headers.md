# SEC-보안헤더: Web2 응답 보안 헤더와 CSP 실제 적용 순서

근거: 실사용 전수점검(main `156a4f5`, 2026-11-01 응답 헤더 실측). 원장 행 SEC-보안헤더. 1단계 보고 전용 CSP는 SEC-Web2CSP(#1543).

## 1. 헤더가 붙는 곳

- GitHub Pages는 응답 헤더를 바꿀 수 없고, `<meta>` CSP는 `frame-ancestors`를 무시한다(CSP3 명세).
- bokdoong.com 앞의 Cloudflare Worker(`cloudflare/bokdoong-router.mjs`, 정책 문자열은 `cloudflare/web2-csp.mjs`)가 응답 헤더를 붙인다. 저장소 코드이고, main merge 뒤 `.github/workflows/cloudflare-worker-deploy.yml`이 배포한다. Cloudflare 대시보드 규칙은 쓰지 않는다.

## 2. 이번에 넣은 것(막는 헤더, 바로 적용)

| 헤더 | 값 | 붙는 곳 | 이유 |
| --- | --- | --- | --- |
| `Content-Security-Policy` | `frame-ancestors 'self'` | bokdoong.com `/work/app/**` 모든 응답(304·오류·저장본 포함) | 다른 사이트가 로그인된 Web2를 자기 페이지 안에 끼워 넣지 못하게(클릭재킹) |
| `X-Frame-Options` | `SAMEORIGIN` | 같음 | `frame-ancestors`를 모르는 옛 브라우저용 |
| `X-Content-Type-Options` | `nosniff` | 같음 | 파일 형식과 다르게 해석해 스크립트·스타일로 실행하는 것 방지 |

- 막는 CSP는 `frame-ancestors` 한 줄뿐이다. 1단계 정책 전체(`WEB2_CSP`)는 계속 `Content-Security-Policy-Report-Only`(첫 화면·로그인 화면)다. 두 헤더는 따로 평가된다.
- 같은 주소 안 칸막이는 그대로 된다: 내 업무 현황(`app/my-work.html`의 `src="../"`), HWP 편집기(`app/hwp-frame.js`, Web2 화면이 같은 주소의 studio를 연다. studio 안에는 다시 iframe이 없다). srcdoc 칸막이는 주소를 불러오지 않으므로 헤더와 무관하다.
- 폰 앱(`android-app`)은 WebView에서 `bokdoong.com/work/app/`을 최상위로 연다(iframe 아님). SAMEORIGIN의 영향이 없다. 바구니 PC·윈도 앱도 Web2를 iframe으로 띄우지 않는다.
- Web2 밖(공유 페이지 `/work/share/`, Web1)에는 이번 헤더를 붙이지 않는다. 공유 페이지는 자기 meta CSP가 있다.
- HSTS는 이미 있다(이전 점검 정정).

되돌리기: `cloudflare/bokdoong-router.mjs`의 `WEB2_SECURITY_HEADERS` 두 곳(응답·저장본)을 빼는 PR → merge → Worker 배포 workflow. 또는 이 PR 이전 main 커밋으로 Worker를 다시 배포한다.

배포 뒤 확인: `curl -sI https://bokdoong.com/work/app/`에 세 헤더가 보이는지, 폰 앱·PC에서 첫 화면·HWP 편집기·내 업무 현황이 열리는지.

## 3. HTML 공유 칸막이

- `HTML_SANDBOX`(`app/share-html-model.mjs`, `share/share.js` 같은 값): `allow-scripts allow-popups`. `allow-popups-to-escape-sandbox`·`allow-forms`를 뺐다.
- 링크는 새 창으로 열리지만 그 창도 칸막이(이름 없는 주소) 안이다. 칸막이 밖 정상 탭이 필요한 링크는 사용자가 주소를 복사해 연다.
- 파일 안 입력 양식은 제출되지 않는다(스크립트로 처리하는 계산기는 그대로 돈다).
- 시험: `tests/security/sec-low-hardening.test.mjs`(두 사본 같음·금지 권한), `tests/app-e2e/share-html-pages.spec.mjs`(Web2 미리 보기·공유 페이지 sandbox 값).

## 4. CSP 실제 적용(enforce) 순서 — 설계만

지금은 1단계(보고 전용, 보고 받을 곳 없음)다. 막는 단계로 가는 순서:

1. **보고 받을 곳**: 보고 전용 CSP에 `report-to`를 붙인다. 받을 곳은 Worker 안 작은 경로(예: `/work/app/__csp`)로 두고, 받은 위반의 지시어·막힌 주소 출처(origin)만 Cloudflare 로그 없이 집계한다(쿼리·토큰·개인정보 저장 금지, 공유 링크 값 보호 위해 Worker 로그는 꺼져 있음). 결정 필요: 집계를 어디에 남길지(Supabase 표 vs 세지 않고 E2E로만).
2. **위반 0 확인 기간**: 실사용 1~2주 + 기존 E2E(`tests/app-e2e/web2-csp-report-only.spec.mjs`, 16개 메뉴 위반 0개).
3. **스타일 정리**: `style-src 'unsafe-inline'` 대상(화면 코드 `style=` 약 50곳, JS가 만드는 `<style>` 7곳, 편집기·KaTeX·mermaid). 막는 단계 첫 판은 `'unsafe-inline'`을 유지하고 스크립트 쪽만 막는다.
4. **스크립트 쪽 enforce**: `Content-Security-Policy`로 `script-src 'self' <테마 해시> 'wasm-unsafe-eval'`, `script-src-attr 'none'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`부터. 같은 문자열을 E2E가 막는 헤더로 붙여 16개 메뉴를 다시 돈다.
5. **나머지 지시어 enforce**: `connect-src`·`img-src`·`media-src`(원드라이브 주소 묶음 실기기 확인 뒤), `form-action`.
6. **범위 넓히기**: 첫 화면·로그인 → `/work/app/` 나머지 HTML(my-work, onedrive-return, native-callback). HWP studio는 외부 라이브러리라 별도 판단.

각 단계는 Worker 한 PR, 되돌리기는 이전 커밋 Worker 재배포. 단계마다 폰 앱·PC 실기기 확인.
