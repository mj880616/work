# 캐시 버전·자산 목록 자동 계산 설계 (CI-버전자동화 1단계)

📱 폰 가능 — 이 문서는 조사·설계만 한다. 앱 코드·workflow·Worker·GitHub Pages 설정·`docs/roadmap.md` 변경 없음.

- 작성: 2026-10-17, Claude Code 웹. 기준 main `ecbb878`.
- 원장 행: `docs/roadmap.md`의 CI-버전자동화.
- 관련: BUG-배포캐시(#589·#617), BUG-배포캐시-후속, `AGENTS.md` §4 캐시 버전, `app/ARCHITECTURE.md` 1절.

## 0. 요약

- **문제의 뿌리는 "버전 사슬"이다.** 잎 파일 하나를 고치면 `view-loader.js` → `loader-v2.js` → `app.js` → `index.html`의 `?v=`를 차례로 올려야 해서, 화면이 달라도 모든 UI PR이 같은 4줄을 고친다. 이 4줄과 그 버전을 그대로 적어 둔 검사(`tests/app-e2e/`)가 충돌 지점이다.
- **추천: 방안 B — GitHub Pages를 Actions 빌드 배포로 바꾸고, 배포 때 내용 해시로 `?v=`와 `app/asset-manifest.json`을 계산한다.** 저장소에는 번호가 남지 않아 서로 다른 화면을 고친 PR끼리 버전 때문에 충돌하지 않는다. 한 번의 배포 안에서 파일·버전·목록이 함께 나가므로 "새 `?v=`에 옛 내용" 사고가 구조적으로 생기지 않는다.
- **4단계로 나눈다.** 1단계(빌드 스크립트·검사만, 운영 영향 없음) → 2단계(Pages 배포 방식 전환 + Worker 배포 workflow 맞춤, **§6 정지 지점**) → 3단계(저장소에서 `?v=` 번호·목록 파일 제거, 규칙 변경) → 4단계(정리). 2단계는 설정 하나로 되돌릴 수 있고, 3단계 전까지는 저장소가 지금과 똑같이 동작한다.

## 1. 지금 구조 (조사 결과)

### 1.1 버전 사슬

| 단계 | 파일 | 버전이 적힌 곳 | 현재 값(예) |
| --- | --- | --- | --- |
| 1 | `app/index.html` | `<script src="./app.js?v=">`, `modulepreload`(loader-v2·runtime-client 등 4개), CSS·아이콘·manifest `<link>` | `app.js?v=301`, `loader-v2.js?v=413` |
| 2 | `app/app.js` | `import('./loader-v2.js?v=')` | `413` |
| 3 | `app/loader-v2.js` | 공용 코어·`team.js`·`view-loader.js` 등 20곳 | `view-loader.js?v=179` |
| 4 | `app/view-loader.js` | 화면별 JS·CSS 목록 46곳 | `ui-standard.css?v=10` 등 |
| — | Web1 HTML(`p/` 등) | `/work/app/web1-admin-auth.js?v=1` 등 | |

- 규칙(`AGENTS.md` §4): `?v=`로 불러오는 파일을 고치면 부르는 쪽 `?v=`를 올리고, 그 때문에 바뀐 부르는 쪽도 위에서 올려 `index.html`까지 간다. 즉 버전은 사실상 **내용 해시를 사람이 손으로 흉내 낸 것**(머클 사슬)이다.
- 숫자는 "이전보다 크기만 하면" 되는 수동 번호다. 그래서 동시에 진행된 #582·#584가 서로 다른 `view-loader.js`를 같은 `?v=173`으로 내보낸 일이 있었다(BUG-배포캐시 기록).
- 최근 2일(10-15~17) main에 `app/view-loader.js`를 고친 커밋이 12개다. 거의 모든 화면 PR이 사슬 4파일을 지난다.

### 1.2 검사

| 검사 | 위치 | 하는 일 |
| --- | --- | --- |
| 캐시 버전 검사 | `scripts/check-loader-cache.mjs`, workflow `loader-cache-check.yml`(PR) | PR 기준과 비교해, 내용이 바뀐 파일을 부르는 모든 곳의 `?v=`가 **이전에 쓰지 않은 값**으로 바뀌었는지 검사. HTML·JS·CSS를 acorn 토큰으로 읽어 참조 그래프를 만든다. |
| 자산 목록 최신 검사 | `scripts/asset-manifest.mjs --check`, `loader-cache-check.yml`(PR)·`app-smoke-check.yml`(main push 포함) | 위 그래프의 `app/` 대상마다 `{v:[...], sha256}`를 만들어 커밋된 `app/asset-manifest.json`과 같은지. 한 줄에 파일 하나라 다른 파일끼리는 줄 충돌이 없다. |
| 버전 문자열을 기대하는 검사 | `tests/app-e2e/` 약 15개 spec | 예: `startup-performance.spec.mjs`가 `app.js?v=301`, `loader-v2.js?v=413`, `view-loader.js?v=179`, CSS 목록 버전을 문자 그대로 기대. `calendar-hotfix`·`task-layout-groups`·`meeting-entry`·`suborganization-filters` 등도 같다. **사슬 파일 버전을 적어 둔 검사 자체가 두 번째 충돌 지점이다.** |
| Worker 회귀 검사 | `tests/domain/bokdoong-router.test.mjs` | 고정된 가짜 버전으로 Worker 동작만 검사(운영 버전과 무관). |

### 1.3 배포

- **GitHub Pages**: 저장소에 `_config.yml`(exclude 목록)이 있고 `.nojekyll`은 없다 → `main` 루트를 Jekyll로 빌드하는 **브랜치 배포**로 판단(사실: 파일 구성 / 추정: Settings 값은 저장소에서 볼 수 없어 사용자 화면에서 확인 필요). front matter가 있는 HTML은 없고, 루트 밖 `.md` 27개는 GitHub Pages 기본 플러그인이 HTML로 바꾼다.
- **Cloudflare Worker**(`cloudflare/bokdoong-router.mjs`): `desk.bokdoong.com`의 `?v=` 붙은 `js|css|svg|png|ico|webp`(sw.js 제외)를 받으면 Pages의 `app/asset-manifest.json`(30초 재사용)을 읽어 **그 `?v=`가 목록에 있고 SHA-256이 같을 때만** 엣지 보관 + 브라우저 `immutable` 1년. 아니면 `no-cache, must-revalidate`·보관 안 함. HTML에는 브라우저마다 한 번 `Clear-Site-Data: "cache"`(쿠키 `kptu_cache_epoch`, `CACHE_EPOCH`).
- **Worker 배포 workflow**(`cloudflare-worker-deploy.yml`): `cloudflare/**` 변경 main push 때 자동. 배포 전에 Pages의 `app/index.html`·`app.js`·`loader-v2.js`·`app-icon.svg`·`pwa.js`·`windows-manifest.json`·`asset-manifest.json`이 **저장소 파일과 같은 SHA-256**이 될 때까지 기다린다. 배포 뒤 `scripts/cloudflare-check-urls.mjs`가 **저장소 파일에서 읽은** `app.js?v=` 등 URL로 `immutable` 정책을 검사한다.
- **새 버전 알림**(`app/version-notice.js`): 열린 탭이 배포된 `index.html`을 다시 읽어 `app.js?v=`를 비교한다. **숫자만 인정하고 "더 큰 값"일 때만** 알린다(`/^\d+$/`). 해시 버전으로 바꾸면 이 비교가 꺼진다 → 함께 고쳐야 한다(§5 결정 D3).
- 서비스 워커(`sw.js?v=3`)는 fetch를 가로채지 않는다(캐시 없음). 안드로이드 앱은 WebView로 운영 주소를 연다(파일 내장 없음).

### 1.4 "옛 파일 보관 사고"(BUG-배포캐시)의 원인과 현재 방어

1. 원인: Pages 배포가 전파되는 동안 새 `index.html`(새 `?v=`)이 먼저 보이고, 그 URL로 받은 JS·CSS가 아직 옛 내용 → 엣지·브라우저가 그 옛 내용을 새 URL로 1년 보관.
2. 방어(#589): Worker가 목록의 SHA-256과 다르면 보관하지 않는다. 그래서 **목록이 파일과 함께, 같은 배포로 나가는 것**이 안전의 전제다.
3. 남은 약점: 목록이 낡으면(예: #617 직전, main의 목록이 실제 파일과 다름) 모든 새 버전이 `no-cache`로 떨어진다. 안전하지만 느리다. 또 사람이 번호를 매기므로 같은 번호 중복(#582·#584)은 목록이 막아 줄 뿐 원인은 남아 있다.

## 2. 무엇이 충돌하나

| 충돌 지점 | 원인 | 방안 B 후 |
| --- | --- | --- |
| `index.html`의 `app.js?v=`·modulepreload, `app.js`, `loader-v2.js`, `view-loader.js` 버전 줄 | 사슬 전파 | 저장소에 번호 없음 → 없음 |
| `app/asset-manifest.json` | 같은 파일을 고친 PR끼리만(줄 단위) | 저장소에 파일 없음 → 없음 |
| `tests/app-e2e/*`의 버전 문자열 | 사슬 파일 버전을 적어 둠 | 번호 없는 경로로 검사 → 없음 |
| 같은 잎 파일(예: 둘 다 `ui-standard.css`) | 실제 내용 충돌 | **그대로**(진짜 충돌이라 남는 게 맞음) |

## 3. 방안 비교

공통 전제: 버전 값은 사람이 매기지 않고 **내용 해시**(예: SHA-256 앞 10자)로 계산한다. 부르는 쪽의 해시는 고쳐 쓴 참조(자식 버전)까지 포함해 계산하므로, 잎이 바뀌면 사슬 위로 자동 전파된다(지금 규칙과 같은 결과를 기계가 낸다). 같은 내용이면 같은 버전이므로 번호 중복·되돌림 문제가 사라진다.

### 방안 A — 저장소에 해시 버전 + main push 뒤 봇이 갱신 커밋

- 흐름: PR은 코드만 고침(`?v=` 그대로) → merge → workflow가 해시로 `?v=`·목록을 다시 써서 main에 커밋 → Pages 재배포.
- 충돌 감소: 큼(PR에 번호 없음). 다만 봇 커밋이 main을 자주 바꾸므로 열린 PR이 main을 merge할 때 버전 줄이 다시 바뀌어 들어온다(PR에서 그 줄을 안 고쳤으므로 충돌은 없음).
- **배포 순서 위험: 있음.** merge 커밋(내용은 새것, `?v=`는 옛것)이 먼저 Pages에 나간다. 같은 옛 URL에 새 내용 → Worker는 목록 불일치로 보관하지 않지만, 이미 그 옛 URL을 `immutable`로 가진 브라우저는 옛 파일을 쓰고, 처음 받는 파일만 새것 → **봇 커밋이 배포될 때까지 몇 분간 옛/새 섞임**. 사고 1의 거울상이다.
- 그 밖: 봇이 보호된 main에 push하려면 우회 권한 토큰이 필요하다(기본 `GITHUB_TOKEN` push는 다른 workflow를 깨우지 않음 → Pages·Worker 연쇄가 끊김). "main 직접 push 금지" 규칙과도 부딪친다. merge마다 커밋이 둘이 되어 기록이 지저분하다.
- Worker 지문 검사: 그대로 사용. 되돌리기: 봇 workflow 끄기 + 사람이 번호 매기기로 복귀(쉬움). 작업량: 중.

### 방안 B — Pages를 Actions 빌드 배포로, 배포 때 계산 (추천)

- 흐름: 저장소는 번호 없는 경로(`./app.js`)를 쓴다 → main push 때 Pages workflow가 ① 지금과 같은 Jekyll 빌드(`actions/jekyll-build-pages`) ② 빌드 결과의 HTML·JS·CSS 참조를 해시 `?v=`로 고쳐 쓰고 ③ 같은 결과에서 `app/asset-manifest.json`을 만들어 ④ 한 번에 배포(`upload-pages-artifact` → `deploy-pages`).
- 충돌 감소: **가장 큼.** 저장소에 버전 줄·목록 파일이 없다. 남는 충돌은 같은 파일을 고친 진짜 충돌뿐이다.
- **배포 순서 위험: 가장 작음.** 파일·`?v=`·목록이 한 배포 묶음이라 "새 `?v=`에 옛 내용"을 저장소 쪽에서 만들 수 없다. 전파 중 옛 내용이 섞여 보여도 Worker 목록 검사(지금 그대로)가 보관을 막는다. 해시라서 같은 `?v=`에 다른 내용이 붙는 일 자체가 없다.
- Worker 지문 검사: **코드 변경 없음.** 목록 주소·형식이 같다(`/work/app/asset-manifest.json`, `{v,sha256}`). 다만 Worker 배포 workflow의 "Pages가 이 커밋과 같은지" 대기와 운영 URL 검사가 **저장소 파일 대신 빌드 결과**를 봐야 한다(빌드는 같은 커밋에서 같은 결과를 내도록 결정적으로 만든다).
- 그 밖: 브라우저 E2E는 지금처럼 저장소를 그대로 띄우면 번호 없는 경로로 돈다(캐시 검사 대상 아님). 빌드 결과를 띄우는 검사 1개를 더해 고쳐 쓰기를 확인한다. `version-notice.js`의 숫자 비교를 바꿔야 한다(§5 D3).
- 되돌리기: Settings → Pages → Source를 "Deploy from a branch(main, /)"로 되돌리는 설정 하나. 3단계 전에는 저장소에 번호·목록이 그대로 있으므로 지금과 똑같이 동작한다. 3단계 뒤에 되돌리면 번호 없는 경로로 동작한다(Worker가 모두 `no-cache` → 느리지만 정상).
- 작업량: 중~대(빌드 스크립트·Pages workflow·Worker workflow 대기 단계·검사 정리). 고쳐 쓰기 로직은 이미 있는 `check-loader-cache.mjs`의 참조 그래프를 재사용한다.

### 방안 C — PR에서 스크립트가 계산 + main이 바뀌면 PR 자동 재생성

- 흐름: 지금처럼 저장소에 버전을 두되, 해시로 계산하는 스크립트를 PR에서 돌리고, main이 바뀔 때마다 봇이 열린 PR 브랜치에 main을 merge하고 다시 계산해 push.
- 충돌 감소: **작음.** 사슬 4줄은 여전히 모든 PR이 고치므로 텍스트 충돌은 그대로이고, 사람 대신 봇이 푼다. PR마다 browser-e2e는 여전히 다시 돈다(목표의 절반 미달).
- 배포 순서 위험: 지금과 같음(목록 동봉 → #589 방어 유효). 해시라서 번호 중복은 사라진다.
- 그 밖: 봇이 남의 PR 브랜치에 push(쓰기 권한 토큰), 봇 push가 CI를 다시 깨우게 하려면 별도 토큰 필요. 같은 사슬 줄이라 봇 merge 자체가 충돌로 멈출 수 있어 "충돌 쪽을 버리고 다시 계산" 같은 특수 처리가 필요하다.
- Worker 지문 검사: 그대로. 되돌리기: 봇 끄기(쉬움). 작업량: 중.

### 방안 D — 버전을 한 표(import map)로 모으기 (구조 변경, 보조안)

- 흐름: 부르는 쪽은 번호 없는 경로를 쓰고, `index.html` 안 import map(파일당 한 줄)이 `./x.js` → `./x.js?v=…`로 바꿔 준다. CSS는 같은 표를 읽는 작은 함수로 붙인다. 부모 파일 내용이 자식 버전에 따라 바뀌지 않으므로 **사슬 전파가 사라진다.**
- 충돌 감소: 큼(표가 파일당 한 줄이라 다른 파일끼리는 줄 충돌 없음). 버전은 PR에서 스크립트로 계산.
- 배포 순서 위험: 지금과 같음(목록 동봉). 단 `index.html`이 모든 버전을 쥐므로, Pages 전파 중 새 `index.html` + 옛 JS 조합이 지금보다 넓게 생길 수 있다(Worker가 보관은 막음).
- 그 밖: `loader-v2.js`·`view-loader.js`의 모든 `import()`·CSS 목록, Web1 페이지의 앱 파일 참조를 바꾸는 **앱 코드 변경**이 크다. import map은 모듈 import에만 적용되어 `<link>`·CSS·아이콘은 별도 처리. 안드로이드 WebView 지원 확인 필요.
- 되돌리기: 앱 코드 revert(중간). 작업량: 대. B와 함께 쓸 이유가 없어(B가 번호를 저장소에서 아예 없앰) 단독 대안으로만 의미가 있다.

### 비교표

| | A 봇 커밋 | **B 빌드 배포** | C PR 자동 재생성 | D import map |
| --- | --- | --- | --- | --- |
| 다른 화면 PR끼리 버전 충돌 | 없음 | **없음** | 있음(봇이 풂) | 거의 없음 |
| 다른 PR merge 뒤 browser-e2e 재실행 | 필요 없음* | **필요 없음*** | 필요 | 필요 없음* |
| "새 `?v=`에 옛 내용" 보관 사고 | 안 생김(Worker) | **구조적으로 안 생김** | 안 생김(Worker) | 안 생김(Worker) |
| merge 직후 옛/새 섞임 | **있음(봇 커밋 전까지)** | 없음 | 없음 | 지금 수준 |
| 같은 `?v=` 중복 | 없음 | 없음 | 없음 | 없음 |
| Worker 코드 변경 | 없음 | **없음**(배포 workflow 대기 단계만) | 없음 | 없음 |
| 운영 배포 방식 변경 | 없음(봇 권한 필요) | **있음(§6)** | 없음(봇 권한 필요) | 없음 |
| 앱 코드 변경 | 버전 줄만 | 3단계에서 번호 제거 | 버전 줄만 | **큼** |
| 되돌리기 | 쉬움 | **설정 하나** | 쉬움 | 중간 |
| 작업량 | 중 | 중~대 | 중 | 대 |

\* 같은 파일을 고친 PR이거나 저장소 규칙상 "최신 main 기준 CI"를 요구하는 경우는 예외. GitHub의 "Require branches to be up to date" 설정을 켜 두었다면 어느 방안이든 재실행이 필요하므로 끄는 것을 함께 검토한다(§5 D4).

## 4. 추천안과 단계

**추천: 방안 B.** 목표(PR은 코드만, 다른 화면 PR끼리 충돌 없음)를 온전히 이루는 유일한 안이고, BUG-배포캐시의 안전 장치를 그대로 쓰면서 오히려 전제(목록이 파일과 함께 나감)를 구조로 보장한다. 봇이 main이나 남의 브랜치에 push할 필요도 없다.

### 1단계 — 빌드 스크립트와 검사 (운영 영향 없음, 일반 PR)

- `scripts/build-pages.mjs`(가칭): 입력 폴더(Jekyll 결과 또는 저장소 사본)를 받아 `check-loader-cache.mjs`의 `graph()`로 참조를 찾고, 잎부터 위로 해시를 계산해 참조를 `?v=<해시>`로 고쳐 쓰고, `app/asset-manifest.json`을 만든다. 저장소에 이미 있는 `?v=` 숫자는 무시하고 덮어쓴다(그래서 2단계 전환 때 저장소를 바꿀 필요 없음).
- 단위 검사: 결정성(같은 입력 → 같은 출력), 잎 변경이 `index.html`까지 전파, 템플릿 문자열·`${` 포함 참조는 건드리지 않음, Web1 HTML의 `/work/app/…` 참조 처리, 순환 참조 거부, 만든 목록이 고쳐 쓴 파일의 SHA-256과 일치.
- CI: PR마다 빌드를 돌려 결과 폴더를 띄우고 짧은 browser-e2e(첫 화면 기동·화면 전환 몇 개) 1개를 실행. 운영 배포는 지금 그대로.
- `version-notice.js` 대응(§5 D3)도 이 단계에서 넣는다(지금 숫자 버전에서도 동작해야 함).

### 2단계 — Pages 배포 전환 ⛔ §6 정지 지점

- 추가: `.github/workflows/pages-deploy.yml` — main push 때 `actions/jekyll-build-pages`(지금 브랜치 배포와 같은 Jekyll) → 1단계 스크립트 → `upload-pages-artifact` → `deploy-pages`. 동시 실행 묶음 1개(`cancel-in-progress: false`).
- 같은 PR에서 `cloudflare-worker-deploy.yml`의 "Pages가 이 커밋과 같은지" 대기와 `cloudflare-check-urls.mjs`가 **빌드 결과**를 보게 바꾼다(같은 스크립트를 로컬에서 돌려 기대값 계산). 이 workflow 파일 변경은 merge 때 Worker 재배포를 일으키므로 **Worker 배포도 이 단계의 정지 지점에 포함**된다.
- 순서(제안): ① PR 검토·승인 → ② merge(이때 새 workflow가 처음 돌지만 Source가 아직 branch라 배포 실패 또는 대기 — 실제 동작은 구현 때 dry-run 모드로 확인) → ③ 사용자가 Settings → Pages → Source를 "GitHub Actions"로 변경 → ④ workflow 수동 실행 → ⑤ 운영 확인: `desk.bokdoong.com/work/app/` 기동, `app.js?v=<해시>` 응답 `immutable`, Pages의 `asset-manifest.json`이 해시 버전, Web1 주요 페이지 200, `.md` 변환 페이지 유지 → ⑥ Worker 배포 workflow 수동 실행·통과 확인.
- 되돌리기: Source를 "Deploy from a branch / main / (root)"로 되돌림 → 저장소의 숫자 버전·커밋된 목록으로 지금과 똑같이 배포. 해시 URL로 이미 받은 파일은 내용과 일치하므로 보관돼도 무해하다. `CACHE_EPOCH` 변경 불필요.
- 이 단계 동안 PR은 아직 지금 규칙(숫자 올리기·목록 재생성)을 지킨다. 저장소 값은 빌드가 덮어쓰므로 운영에 영향은 없다.

### 2단계 구현 (2026-10-17, 전환 준비 PR — Source 변경 전)

| 파일 | 하는 일 |
| --- | --- |
| `.github/workflows/pages-deploy.yml` | main push·수동 실행 때 Jekyll → `build-pages.mjs` → `check-pages-build.mjs` → `cloudflare-check-urls.mjs <결과>` → `upload-pages-artifact`. 어느 단계든 실패하면 배포 job이 돌지 않는다. 배포 job은 Pages API의 `build_type`이 `workflow`(Source = GitHub Actions)일 때만 돈다. Source가 branch인 동안은 빌드·검사만 하고 배포를 건너뛴다(요약에 표시). 수동 실행의 `skip_deploy`로 전환 뒤에도 검사만 할 수 있다. |
| `.github/workflows/cloudflare-worker-deploy.yml` | 같은 커밋의 Jekyll 결과를 `build-pages.mjs`로 빌드해 두고, Pages의 7개 파일이 **저장소 파일 7개 모두** 또는 **빌드 결과 7개 모두**와 같아질 때까지 기다린다(섞이면 계속 대기). 맞은 쪽 폴더로 `cloudflare-check-urls.mjs`를 돌려 운영 URL을 검사한다. 전환 전후 모두 같은 workflow로 동작한다. |
| `scripts/cloudflare-check-urls.mjs [폴더]` | 읽을 폴더를 인자로 받는다(없으면 지금처럼 현재 폴더). |

- Source 변경(③)과 그 뒤 확인은 사용자 몫이다. 순서·확인·되돌리기는 PR 댓글에 둔다.

### 3단계 — 저장소에서 번호 빼기 (일반 PR, 규칙 변경 포함)

- 2단계가 며칠 안정적으로 돈 뒤.
- `app/`·Web1 HTML의 `?v=` 숫자 제거(번호 없는 경로), `app/asset-manifest.json` 삭제, `scripts/asset-manifest.mjs`는 빌드 스크립트에 흡수.
- `check-loader-cache.mjs`를 "저장소 소스에 손으로 쓴 `?v=`가 없을 것"으로 바꾸고, `app-smoke-check.yml`·`loader-cache-check.yml`의 목록 검사 제거.
- `tests/app-e2e/`의 버전 문자열 기대를 번호 없는 경로로 바꾼다(검사 의도 유지, 삭제 아님).
- `AGENTS.md` §4 캐시 버전 절과 `app/ARCHITECTURE.md` 1절을 새 방식으로 바꾼다(규칙 변경 → 사용자 승인).
- 되돌리기: 이 PR revert + 2단계 되돌리기. 3단계 뒤 Pages만 branch로 되돌리면 번호 없이 동작(전부 `no-cache`, 기능 정상).

### 3단계 구현 (2026-10-17, 저장소에서 번호·목록 빼기)

| 파일 | 하는 일 |
| --- | --- |
| `app/`·Web1 HTML·JS·CSS (137개) | 저장소 안 파일을 가리키던 손으로 쓴 `?v=` 502개를 지움(번호 없는 경로). `${…}` 동적 경로에 `?v=`가 박힌 곳은 없었음. 정적 분석에 안 잡히던 2곳(`app/workflow-ai-v3.js`의 `meeting-time.js?v=2` — 어느 로더도 안 부르는 파일, `private-rail/index.html`의 `fetch('./page.html?v=3',{cache:'no-store'})`)도 지움 |
| `app/asset-manifest.json`, `scripts/asset-manifest.mjs`(+test) | 삭제. 목록 생성(`buildManifest`)은 `build-pages.mjs`로 옮김 → 빌드 결과물에만 생김 |
| `scripts/build-pages.mjs` | 번호 없는 참조에도 `?v=<해시>`를 붙임(다른 query·`#`는 유지). 예외: 저장소에 없는 대상, 폴더 이름에 판 번호가 든 외부 라이브러리(`rhwp-0.8.7/` 등, 내부 import가 한 주소를 유지해야 함), 스크립트가 읽는 JSON(`press/archive.json` — 게시할 때마다 Web2 사슬이 바뀌지 않게) |
| `scripts/check-loader-cache.mjs` | "저장소 소스에 손으로 쓴 `?v=`가 없을 것"(로더가 안 부르는 파일 포함) + 기존 "삭제한 파일을 아직 부름" 검사 |
| `scripts/check-pages-build.mjs` | (a)에 "빌드가 붙여야 할 참조에 `?v=`가 없음"도 오류로 추가 |
| `scripts/cloudflare-check-urls.mjs` | 빌드 결과 폴더를 반드시 받음(저장소 checkout은 `?v=`가 없어 거부) |
| `.github/workflows/cloudflare-worker-deploy.yml` | 대기 단계에서 "저장소 파일과 일치" 경로 제거, "빌드 결과물과 일치"만 인정 |
| `loader-cache-check.yml`·`app-smoke-check.yml` | 목록 검사 제거. 다른 workflow의 `grep "x.js?v=N"`은 번호 없는 정확한 줄로 |
| `tests/app-e2e/` | 버전 문자열 기대를 번호 없는 경로로. 새 버전 알림 검사는 빌드처럼 `app.js?v=300`을 붙인 화면을 띄움(`helpers/built-shell.mjs`) |

- 대조: 같은 스크립트로 main(27d3a84, 운영과 같은 빌드)과 이 브랜치를 빌드하면 `app/` 아래 결과물(`asset-manifest.json` 포함)은 바이트까지 같다. 다른 곳은 Web1 페이지 14개(전에 번호가 없던 `favicon.svg`·`kptu-logo.svg`·`makinochaya-route.png`·`materials-data.js`에 해시가 새로 붙음)와 `private-rail/index.html`의 `page.html` fetch, 로더가 안 부르는 `workflow-ai-v3.js`뿐이다.
- 남은 손 번호(예외): 저장소에 없는 파일(`personal/portal`의 `/favicon.ico?v=…`·`/favicon.png?v=…`), 다른 주소(`https://…?v=20260920`), JSON 안 주소(`app/windows-manifest.json` 아이콘 `?v=20261027-memocheck`).
- Worker 코드(`cloudflare/bokdoong-router.mjs`)는 고치지 않았다(주석의 `scripts/asset-manifest.mjs` 언급도 그대로). workflow 파일 변경으로 merge 때 Worker 배포 workflow가 한 번 돈다(같은 코드 재배포).

### 4단계 — 정리

- `_config.yml`의 역할 확인(Jekyll을 빌드 workflow에서 계속 쓰면 유지), 문서·원장 정리. BUG-배포캐시-후속(HTML 10분 보관)은 Actions 배포에서도 같은 헤더라 별도 과제로 남는다.

### 4단계 조사 결과 (2026-10-18, 문서 전용 PR)

- 기준 main `a614255`. 2단계 전환(10/17) 뒤 `pages-deploy.yml`의 main push 실행 10회 모두 성공(배포 job 포함). 3단계(#635)는 10/18 merge.
- 이 PR은 문서만 고친다. workflow·스크립트·앱 코드·Worker·`_config.yml`·`docs/roadmap.md`는 고치지 않고 아래 정리안으로만 적는다.

#### `_config.yml`

- **유지.** Actions 배포도 Jekyll을 그대로 쓴다: `pages-deploy.yml`·`cloudflare-worker-deploy.yml`·`pages-build-check.yml`(jekyll-output) 모두 `actions/jekyll-build-pages`로 `_site`를 만든 뒤 `build-pages.mjs`를 돌린다. 공개 `analysis/`의 `.md`를 HTML로 바꾸는 일도 Jekyll이 한다. Jekyll을 빼려면 이 변환을 따로 만들어야 하므로 이득이 없다.
- **exclude 목록은 지금도 맞다.** `docs`·`tests`·`scripts`·`supabase`·`android-app`·`windows-app`·`cloudflare`·`AGENTS.md`·`CLAUDE.md` 모두 저장소에 있고 운영 화면이 부르지 않는다. `.github`·`.claude`는 점으로 시작해 Jekyll이 기본으로 뺀다. 3단계로 없어진 파일(`app/asset-manifest.json`, `scripts/asset-manifest.mjs`)은 목록에 원래 없었다.
- 선택 사항(결정 E4): `app/ARCHITECTURE.md`·`private-rail/ARCHITECTURE.md`·`app/legacy/README.md`가 개발 문서인데 Pages에 HTML로 나간다(공개 저장소라 새 노출은 아님). 빼려면 exclude에 경로를 더한다. 빼도 화면 동작에는 영향 없음.

#### 정리 제안 (이 PR에서 고치지 않음)

| 번호 | 대상 | 지금 상태 | 제안 | 배포 영향 |
| --- | --- | --- | --- | --- |
| C1 | `.github/workflows/publication-auto-merge.yml`의 `build-pages` job, `.claude/commands/게시반영.md` 5절 3번 | legacy용 Pages 빌드 API(`POST /pages/builds`)를 부르고 `pages/builds/latest`의 `built`를 기다린다. Actions 배포에서는 이 API가 새 배포를 만들지 않을 가능성이 크고, `GITHUB_TOKEN`의 자동 merge push는 `pages-deploy.yml`을 깨우지 않는다. **자동 게시 글이 merge만 되고 Pages에 안 나갈 수 있다**(전환 뒤 자동 게시가 아직 없어 미확인). | **고침(우선).** job을 "merge 확인 → `gh workflow run pages-deploy.yml --ref main`(workflow_dispatch는 `GITHUB_TOKEN`으로도 실행됨, `actions: write` 필요) → 그 실행 성공 대기 → 공개 주소 확인"으로 바꾸고, 게시반영 명령의 확인 단계도 맞춘다. `.github/**` 변경이라 사람이 확인 후 수동 merge. 고치기 전 게시는 merge 뒤 사용자가 `Deploy GitHub Pages`를 수동 실행하면 된다. | Pages 배포 경로. 정지 지점 아님(설정·비밀값 변경 없음) |
| C2 | `pages-build-check.yml` | job 2개가 같은 일을 겹쳐 한다: `build-output`(저장소 사본 빌드·검사·브라우저 기동)과 `jekyll-output`(Jekyll 빌드·검사). 운영은 Jekyll 결과만 쓴다. `jekyll-output`의 "저장소 파일과 Jekyll 결과 비교(보고만)"는 1단계 동등성 확인용이었고 이제 할 일이 없다. | **고침.** job 하나로 합친다: Jekyll → `build-pages.mjs` → `check-pages-build.mjs` → `cloudflare-check-urls.mjs` → 브라우저 기동(`tests/build-pages/`)을 Jekyll 결과에서. 저장소-Jekyll 비교 단계는 지움. 수동 `compare_live`(운영 Pages와 대조)는 진단용으로 **둠**. `scripts/compare-pages.mjs`는 `--live`가 남으므로 둠. | 없음(PR 검사만) |
| C3 | `pages-deploy.yml` 머리 주석 | "Safe before the switch… Production keeps serving the branch deployment until…" 전환 전 설명이 남음. | **고침(주석만).** `build_type == workflow` 조건은 Source를 되돌렸을 때 배포를 막는 안전장치이므로 **둠**. | merge 때 Pages 재배포 1회(같은 결과) |
| C4 | `cloudflare/bokdoong-router.mjs` 24줄 주석 | "generated by scripts/asset-manifest.mjs"(3단계에 삭제된 파일). 동작에는 영향 없음. | **고침(주석만).** "made by scripts/build-pages.mjs in the Pages build output"로. **⚠ Worker 파일 변경은 merge 때 `cloudflare-worker-deploy.yml`이 자동으로 Worker를 재배포한다(§6 정지 지점).** 따로 배포할 가치가 없으니 다음 Worker 변경 PR에 묶는 것을 추천. | Worker 재배포 |
| C5 | `app/version-notice.js` 머리 주석 | "numbers now, content hashes later" — 이제 해시만. | **고침(주석만)**, 다음 이 파일을 고치는 UI PR에 묶음. 동작 변경 없음. | 앱 해시만 바뀜 |
| C6 | `loader-cache-check.yml` 이름 "Loader cache version check", 스크립트 이름 `check-loader-cache.mjs` | 하는 일은 "손으로 쓴 `?v=` 금지"로 바뀜. | **둠.** job 이름 `loader-cache`를 게시 관문(`scripts/publication-pr-policy.mjs`)이 필수 검사로 기다리고, `build-pages.mjs`가 이 파일의 `graph()`를 가져다 쓴다. 이름만 바꾸는 비용이 이득보다 크다. | — |
| C7 | `scripts/public-page-meta.mjs`의 `EDITOR_VERSION_RE_GLOBAL` | 생성 페이지에서 손으로 쓴 `public-page-editor.js?v=`를 지움(3단계 전환용). | **둠.** DB에 저장된 옛 페이지 HTML이 다시 생성될 때 옛 번호가 되살아나지 않게 막는다. | — |
| C8 | `app-smoke-check.yml`의 옛 아이콘 번호(`20260913-3`, `20260924-unicorn2`)·`cacheEverything` 되돌림 검사 | 3단계 뒤에도 의미 있는 회귀 방지. | **둠.** | — |
| C9 | 과거 기록 문서(`docs/review/*/README.md`, `docs/superpowers/plans/*`, `docs/app-library-upload-fail-investigation.md`, `docs/design/press-to-web2-design.md` 1.2절 등의 `?v=` 번호, "캐시 버전 기대값만 변경" 같은 완료보고) | 그 시점의 사실 기록. | **둠.** 절차가 아니라 기록이라 고치면 오히려 사실이 흐려진다. | — |

#### 이 PR에서 바로 고친 문서

| 문서 | 고친 내용 |
| --- | --- |
| `docs/loader-cache-check.md` | 옛 "바뀐 파일을 부르는 쪽 `?v=`를 올렸는지" 설명을 지금 검사("손으로 쓴 `?v=` 금지" + "삭제한 파일을 아직 부름")와 예외·함께 도는 검사로 다시 씀 |
| `docs/hwp-editor.md` 3절 3번 | "`hwp-lab.js?v=`부터 캐시 버전 연쇄를 올린다" → 손으로 올리지 않음, 판 번호 폴더 이름이 곧 캐시 갱신 |
| `docs/markdown-view.md` 5절 3번·재사용 예시 | "`markdown-view.js?v=`부터 연쇄를 올린다" 제거, 예시 import에서 `?v=2` 제거 |
| `docs/design/journal-memo-diary-design.md` 단계 공통 | 새 모듈 `?v=` 사슬 올리기·e2e 기대값 맞추기 → 번호 없는 경로 |
| `docs/sec-publication-auto-merge.md` | "Pages는 현재 legacy 브랜치 빌드다" 아래에 전환 뒤 주의(C1) 덧붙임 |
| 이 문서 | 이 절 |

#### 결정 항목

| 번호 | 결정 | 추천 |
| --- | --- | --- |
| E1 | C1(자동 게시 → Pages 배포 연결) 고치기 | 예, 다음 게시 전에. 그 전 게시는 merge 뒤 `Deploy GitHub Pages` 수동 실행 |
| E2 | C2(`pages-build-check.yml` job 합치기, 저장소-Jekyll 비교 단계 삭제) | 예 |
| E3 | C4(Worker 주석) 시점 | 다음 Worker 변경 PR에 묶기(따로 재배포하지 않음) |
| E4 | `_config.yml` exclude에 `app/ARCHITECTURE.md`·`private-rail/ARCHITECTURE.md`·`app/legacy/README.md` 추가 | 선택. 하면 C2와 같은 PR에서 |

### 1단계 구현 (2026-10-17)

| 파일 | 하는 일 |
| --- | --- |
| `scripts/build-pages.mjs <입력> <출력>` | 입력 폴더의 `?v=`를 대상 파일 최종 바이트의 SHA-256 앞 10자로 잎부터 바꿔 쓰고 `app/asset-manifest.json`을 새로 만든다. 순환 참조는 거부, 바뀌지 않은 파일은 바이트 그대로 복사 |
| `scripts/check-pages-build.mjs <출력>` | (a) 모든 `?v=` = 대상 해시 (b) 목록 = 결과 파일 (c) Worker(`cloudflare/bokdoong-router.mjs`)가 목록의 모든 Web2 자산을 `immutable`로 판정 |
| `scripts/compare-pages.mjs <A> <B>` / `--live <폴더>` | Jekyll 결과와 다른 폴더 또는 지금 GitHub Pages 파일을 SHA-256으로 대조(보고만) |
| `.github/workflows/pages-build-check.yml` | PR마다 위 검사 + 결과물 브라우저 기동(`tests/build-pages/`), `actions/jekyll-build-pages` 결과에도 같은 검사. 수동 실행 시 운영 Pages 대조. 배포 없음 |

- 결과물의 자산 목록은 저장소 전체 그래프에서 만들므로, Web1 HTML만 부르는 `app/` 자산(예: `web1-admin-auth.js`)도 들어간다. 지금 커밋된 목록(`app/` 안 HTML만 읽음)보다 항목이 많다.
- 해시가 우연히 숫자만으로 될 수 있다(예: `6901432061`). 검사는 숫자 여부가 아니라 해시 값 일치로 본다.

## 5. 사용자 결정 항목

| 번호 | 결정 | 추천 |
| --- | --- | --- |
| D1 | 방안 선택 | **B** |
| D2 | 2단계(Pages Source를 GitHub Actions로 바꾸기)를 사용자가 Settings에서 직접 실행 | 예(설정 변경은 사용자만) |
| D3 | 새 버전 알림 비교 방식: 해시는 크기 비교가 안 됨 | 배포된 `app.js?v=`가 **지금과 다르면** 알림(이미 닫은 값은 다시 안 띄움). 되돌림 배포 때도 알림이 뜨는 것이 맞는 동작 |
| D4 | 저장소 보호 규칙의 "Require branches to be up to date before merging" | 켜져 있다면 끄기 검토(켜져 있으면 어느 방안이든 다른 PR merge 뒤 CI 재실행). 저장소에서 볼 수 없어 사용자 확인 필요 |
| D5 | 해시 길이 | SHA-256 앞 10자(16진). 충돌 확률 무시 가능, URL 짧음 |

## 6. 위험과 확인할 것

- **Jekyll 동등성**: Actions 빌드가 지금 브랜치 배포와 다른 결과를 내면 Web1 페이지가 달라질 수 있다. 1단계에서 `actions/jekyll-build-pages` 결과와 운영 Pages 파일 목록을 대조한다(`.md` 27개 변환, `_config.yml` exclude, `_` 시작 파일 제외 포함).
- **배포 중 HTML 10분 보관**(BUG-배포캐시-후속): 방식과 무관하게 남는다. B에서도 `index.html`은 `no-cache`로 Worker를 지나므로 사고 재발 요인은 아니다.
- **빌드 실패 = 배포 멈춤**: 빌드가 깨지면 Pages가 이전 배포를 유지한다(안전한 쪽). 브랜치 배포보다 실패 지점이 하나 늘어난다.
- **Worker 배포 workflow 대기 단계**: 2단계에서 빌드 결과 기준으로 바꾸지 않으면 Worker 배포가 "Pages가 커밋과 다름"으로 실패한다(배포는 안 되지만 이전 Worker 유지 — #589 때와 같은 안전 실패).
- **`?v=` 없는 파일**: 지금도 버전 없이 불리는 파일은 빌드도 손대지 않는다(현행 유지).
- **동적 경로**: `${…}`가 든 참조는 지금 검사처럼 건너뛴다. 이런 참조가 `?v=`를 손으로 쓰고 있다면 3단계에서 목록으로 찾아 바꾼다.

## 7. 이번 단계에서 하지 않은 것

- 앱 코드, workflow, Worker, Pages 설정, `docs/roadmap.md` 변경 없음. 2단계 이후는 사용자 승인 뒤 별도 PR.
