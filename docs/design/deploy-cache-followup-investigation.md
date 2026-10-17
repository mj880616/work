# BUG-배포캐시-후속 조사: 머지 뒤 새 버전 알림이 늦게 뜨는 문제

📱 폰 가능 — 이 문서는 조사·제안만 한다. 앱 코드·Worker·workflow·Pages 설정·`docs/roadmap.md` 변경 없음.

조사 기준: `main` bd7a19d(2026-10-18). 운영 주소(`desk.bokdoong.com`, `mj880616.github.io`) 직접 접속은 이 세션(Claude Code 웹)의 네트워크 제한으로 막혀 응답 헤더를 실측하지 못했다. 아래 운영 동작은 저장소 코드·workflow·테스트에 남은 근거로 판단했고, 실측이 필요한 곳은 "확인 방법"에 적었다.

## 0. 일상어 요약

- **무엇이 늦나**: 머지 뒤 Pages 배포는 1분 안팎에 끝나는데, 앱이 "새 버전이 있습니다"를 늦게 띄운다. 앱을 새로 열어도 한동안 옛 화면이 뜬다.
- **가장 유력한 원인**: GitHub Pages 앞단 보관소(GitHub이 쓰는 CDN)가 `index.html`을 최대 10분 동안 옛것으로 내준다. 우리 Worker는 이 보관소를 건너뛰지 않고 그대로 받아 오므로, 앱의 새 버전 확인도, 새로 연 화면도 옛 `index.html`을 받는다. 저장소의 다른 곳(Worker의 목록 받기, Worker 배포 대기 단계)은 이미 주소 끝에 매번 다른 값(`?t=`, `?deploy=`)을 붙여 이 보관소를 피하고 있다 — 같은 문제를 이미 알고 피해 간 흔적이다.
- **원인이 아닌 것**: 브라우저 보관(앱이 `no-store`로 받고, Worker가 HTML을 `no-cache`로 내려줌), Cloudflare 보관(Worker는 HTML을 보관하지 않음), 서비스워커(`sw.js`는 아무것도 보관하지 않음).
- **덤으로 늦는 것**: 앱은 "열 때·화면 복귀·창 선택·10분마다"에만 확인한다. 화면을 켜 둔 채 가만히 있으면 최대 10분 더 기다린다.
- **추천**: Worker가 desk의 HTML을 Pages에서 받을 때만 주소 끝에 짧은 시간 단위 값(예: 15초마다 바뀌는 값)을 붙여 보관본을 건너뛰게 한다(안 A). 새로 연 화면과 새 버전 확인이 함께 고쳐지고, #589의 자산 보관 규칙은 건드리지 않는다. **Worker 배포가 필요하므로 merge가 §6 정지 지점**이다.

## 1. 새 버전 확인 흐름(지금 코드)

| 단계 | 근거 | 내용 |
| --- | --- | --- |
| 시작 | `app/app.js:2`, `app/loader-v2.js:193-194` | `app.js`가 자기 주소(`app.js?v=<해시>`)를 기억 → 첫 화면이 뜬 뒤 `startVersionNotice` 시작 |
| 비교 대상 | `app/version-notice.js:5-8` | 지금 실행 중인 `app.js`의 `?v=` 값과, 같은 폴더의 `index.html` |
| 언제 확인 | `app/version-notice.js:96-98`, `:82-85` | `visibilitychange`(화면 복귀)·`focus`(창 선택)·10분 타이머. 화면이 보이고 온라인일 때만, 1초 안 중복은 한 번으로 |
| 무엇을 받나 | `app/version-notice.js:88` | `fetch(<desk>/work/app/index.html, {cache:'no-store'})` — 브라우저 보관은 건너뜀. 주소에 매번 다른 값은 **붙이지 않음** |
| 비교 | `app/version-notice.js:71-80`, `:60-61` | 받은 HTML의 `<script src="./app.js?v=…">`가 하나일 때 그 값이 지금과 **다르면** 알림(D3). 닫은 값은 이 탭에서 다시 안 띄움 |

즉 알림이 제때 뜨려면 **"확인 시점"에 "Worker가 Pages에서 받아 온 `index.html`"이 새 배포본이어야** 한다.

## 2. 요청이 지나가는 길과 보관(캐시) 헤더

`브라우저 → Cloudflare Worker(desk) → GitHub Pages 앞단 보관소(CDN) → GitHub Pages 원본`

| 층 | 근거 | HTML(`index.html`)에 대한 동작 |
| --- | --- | --- |
| 브라우저 HTTP 보관 | `app/version-notice.js:88`, `cloudflare/bokdoong-router.mjs:141-144` | 알림 확인은 `no-store`라 보관 안 씀. 페이지 열기도 Worker가 `Cache-Control: no-cache, must-revalidate`로 덮어써 매번 Worker에 다시 묻는다(Pages의 `max-age=600`은 브라우저까지 오지 않음). 배포 workflow가 운영에서 이 헤더를 검사(`.github/workflows/cloudflare-worker-deploy.yml:284-303`) |
| 서비스워커 | `app/sw.js:1-3`, `app/pwa.js:2` | `fetch` 처리기가 비어 있어 응답을 가로채거나 보관하지 않음. `sw.js` 자체도 보관 대상에서 제외(`cloudflare/bokdoong-router.mjs:104`) |
| Worker 엣지 보관(`caches.default`) | `cloudflare/bokdoong-router.mjs:102-120`, `:162-165` | `?v=`가 붙은 js·css·이미지 중 목록과 SHA-256이 같은 것만 보관. **HTML은 보관하지 않음** |
| Worker → Pages 요청 | `cloudflare/bokdoong-router.mjs:95-101`, `:121-126` | 들어온 주소·쿼리를 **그대로** Pages로 보냄(`originUrl.search = incoming.search`). `cache:'no-store'`는 Cloudflare 쪽 보관만 끈다(`cloudflare/wrangler.toml:4` 호환 날짜 2026-09-20). Pages 앞단 보관소에는 영향 없음 |
| Pages 앞단 보관소 | 아래 3장 근거 | Pages가 HTML에 `max-age=600`을 주고, 앞단 보관소가 같은 주소(쿼리 포함)에 보관본을 내줄 수 있음 |

## 3. 지연 원인 후보와 근거

| 후보 | 판단 | 근거 |
| --- | --- | --- |
| ① Pages 앞단 보관소가 `index.html`을 최대 10분 옛것으로 내줌 | **가장 유력(추정, 실측 전)** | (a) 원장 행의 사용자 관찰: Pages HTML `max-age=600`. 라우터 테스트도 Pages 응답을 `Cache-Control: max-age=600`으로 흉내 냄(`tests/domain/bokdoong-router.test.mjs:127`). (b) 저장소가 이미 이 보관소를 피하려고 매번 다른 쿼리를 붙인다: Worker의 목록 받기 `asset-manifest.json?t=<시각>`(`cloudflare/bokdoong-router.mjs:32`), Worker 배포의 "Pages가 이 커밋과 같은지" 대기 `?deploy=<SHA>&attempt=<n>`(`.github/workflows/cloudflare-worker-deploy.yml:110`, `:43`). 반대로 desk HTML 요청과 알림 확인 요청에는 이런 값이 없다. (c) 설계 문서도 "HTML 10분 보관은 Actions 배포에서도 같은 헤더라 별도 과제"로 남겼다(`docs/design/ci-version-automation.md:176`, `:203`) |
| ② 확인 주기 | **보조 원인(확실)** | 화면을 켜 둔 채 조작만 하면 `visibilitychange`·`focus`가 안 일어나 최대 10분 타이머를 기다린다(`app/version-notice.js:96-98`). ①과 겹치면 최악 약 20분 |
| ③ Pages 배포 자체 시간 | 작음(확실) | 최근 `pages-deploy.yml` push 실행 8회가 47초~3분 12초(대부분 1분 안팎, GitHub Actions 기록). 머지 직후 1분은 피할 수 없음 |
| ④ Worker 엣지 보관 | 원인 아님 | HTML은 `caches.default`에 넣지 않음(`cloudflare/bokdoong-router.mjs:106`, `:162`) |
| ⑤ 브라우저 보관 | 원인 아님 | 알림 확인은 `no-store`, 화면 열기는 Worker가 `no-cache`로 내려줌(2장) |
| ⑥ 서비스워커 | 원인 아님 | 빈 `fetch` 처리기(`app/sw.js:3`) |

①이 맞다면 증상은 "알림이 늦다"만이 아니다. 머지 직후 앱을 **새로 열어도** 옛 `index.html` → 옛 `app.js?v=`가 뜬다(그 `?v=`는 목록과 맞으므로 정상 동작하는 옛 화면). 알림은 이 옛 화면과 옛 `index.html`을 비교하니 "같음"으로 판단해 조용하다.

### ① 실측 확인 방법(읽기 전용, 데이터 변경 없음)

Claude Code 로컬 세션 또는 PC 터미널에서, 머지·Pages 배포 성공 직후 1~2분 안에:

```
curl -sI https://mj880616.github.io/work/app/index.html
curl -sI "https://mj880616.github.io/work/app/index.html?probe=$(date +%s)"
```

첫 줄 결과에 `Cache-Control: max-age=600`과 `Age`(0보다 큼)·`X-Cache: HIT` 등 보관본 표시가 있고 `Last-Modified`가 배포 전 시각이면, 두 번째(쿼리 붙임)는 `Last-Modified`가 새 시각이면 ①이 확정된다. 결과는 PR 댓글로 남긴다.

## 4. 해결안

### 안 A(추천): Worker가 desk HTML을 Pages에서 받을 때 시간 단위 값을 붙임

- **무엇이 바뀌나**: `cloudflare/bokdoong-router.mjs`에서 `desk.bokdoong.com`의 **HTML 요청으로 보이는 주소**(`/work/app/`로 끝나거나 `.html`, `?v=` 없음)만, Pages로 보내는 주소에 짧은 값(예: `__fresh=<15초 단위 시각>`)을 **덧붙인다**(기존 쿼리 유지). 브라우저 주소·화면 코드는 그대로. 앱 열기와 알림 확인(`/work/app/index.html`)이 모두 이 길을 지나므로 둘 다 고쳐진다.
  - 매 요청마다 다른 값 대신 15초 단위로 하는 이유: 보관소를 거의 매번 건너뛰면서도, 같은 15초 안 요청은 보관소가 한 번만 원본에 묻게 해 원본 부담·속도 손해를 줄인다.
  - Pages가 `Location`(폴더 이동 응답)에 이 값을 되돌려 줄 수 있으므로 `Location` 고쳐 쓰기(`cloudflare/bokdoong-router.mjs:145-152`)에서 이 값을 지운다.
- **기대 효과**: 머지 뒤 지연이 "Pages 배포 1분 + 15초 + 확인 시점"으로 준다.
- **위험**: (1) desk HTML이 매번(15초 단위) 원본까지 가서 첫 화면 HTML 받기가 조금 느려질 수 있음(24KB 한 파일, 1인 사용이라 원본 부담은 무시할 수준 — 실측은 구현 PR에서). (2) 배포 전파 중 새 HTML이 아직 옛 내용의 새 `?v=` 자산을 부를 수 있음 → 지금도 Worker 목록 검사가 막는 경우(`no-cache`로만 내려주고 보관 안 함)라 새 위험 아님. (3) HTML로 판정하는 주소 규칙이 틀리면 Web1·arsenal에 번질 수 있음 → desk 호스트·경로로만 한정하고 라우터 테스트로 고정.
- **#589 방어와 충돌**: 없음. 자산 보관 분기(`:102-120`, `:137-144`, `:162-165`)·목록 검사·`Clear-Site-Data`(`:153-160`)는 손대지 않는다. HTML은 지금처럼 `no-cache, must-revalidate`. 배포 workflow의 운영 검사(`cloudflare-worker-deploy.yml:255-303`)도 그대로 통과해야 한다.
- **Worker 배포**: **필요**. `cloudflare/**` 변경은 main push 때 자동 배포(`cloudflare-worker-deploy.yml:3-8`)라 **merge 자체가 §6 정지 지점**(사용자 승인 후 merge).
- **되돌리기**: 그 커밋을 되돌리는 PR을 merge하면 Worker가 자동 재배포되어 지금 동작으로 돌아감(데이터 변경 없음). 급하면 사용자가 Worker 배포 workflow를 이전 커밋으로 수동 실행.
- **검사**: `tests/domain/bokdoong-router.test.mjs`에 "desk HTML 요청은 Pages 주소에 값이 붙고, `?v=` 자산·Web1·arsenal은 안 붙는다", "Location에 값이 새지 않는다"를 추가.

### 안 B: 알림 확인만 고침(앱이 확인 주소에 매번 다른 값을 붙이거나, 작은 확인 파일을 `no-store`로 받음)

- **무엇이 바뀌나**: `app/version-notice.js:88`에서 `index.html?check=<시각>`으로 받거나, 빌드가 `app/version.json`(지금 `app.js?v=` 한 줄)을 만들고 그것을 받는다. Worker가 쿼리를 그대로 Pages에 넘기므로(`:96`) 보관본을 건너뛴다. 단 "작은 파일 + `no-store`"만으로는 부족하고 **쿼리 값이 반드시 함께 있어야** 한다(`no-store`는 브라우저 보관만 끔).
- **위험(결정적)**: 알림은 빨리 뜨지만, "새로고침"을 누르면 브라우저가 쿼리 없는 `/work/app/`을 다시 열고 그 요청은 여전히 10분 보관본을 받는다 → **옛 화면이 다시 뜨고 알림이 또 뜨는 반복**이 최대 10분 생긴다. 새로 연 화면 지연도 그대로.
- **#589 충돌**: 없음. **Worker 배포 불필요**(일반 앱 PR, Pages 배포만). 되돌리기: PR 되돌리기.
- 판단: 단독으로는 비추천. 안 A 뒤에는 필요 없음.

### 안 C: 안 A + 확인 주기 단축(선택)

- **무엇이 바뀌나**: 안 A에 더해 `app/version-notice.js:96`의 10분을 예컨대 3분으로 줄인다(화면이 보일 때만 도는 조건은 유지).
- **효과**: 화면을 켜 둔 채 쓰는 경우의 최악 대기가 10분 → 3분.
- **위험**: 화면이 켜져 있는 동안 3분마다 24KB 요청 1회(안 A로 원본까지 감). 알림 E2E의 "10분 시계" 검사(`tests/app-e2e/version-notice.spec.mjs:92`) 수정 필요.
- **Worker 배포**: 주기 변경 자체는 불필요(앱 PR). 안 A와 다른 PR로 나누면 Worker merge와 앱 merge를 따로 승인할 수 있다.
- 되돌리기: 숫자 한 줄 되돌리기.

### 추천

**안 A**를 먼저 한다. 원인 ①을 한 곳(Worker)에서 고쳐 새로 연 화면과 알림을 함께 해결하고, #589 자산 보관 규칙과 겹치지 않는다. 구현 전에 3장의 `curl` 두 줄로 ①을 실측하면 더 안전하다(실측에서 ①이 아니면 안 A를 멈추고 다시 조사). 확인 주기(안 C)는 안 A 적용 뒤 체감을 보고 따로 정한다.

## 5. 사용자 결정 항목

1. 안 A 진행 여부(추천). Worker 배포가 merge와 함께 자동으로 일어나므로 **merge가 §6 정지 지점**.
2. 구현 전 원인 ① 실측(3장 `curl`, Claude Code 로컬 또는 PC) 먼저 할지.
3. 보관소 우회 값의 시간 단위(추천 15초; 매 요청마다로 해도 됨).
4. 확인 주기 단축(안 C) 여부와 값 — 안 A 체감 뒤 결정 권장.

## 6. 범위 밖 발견사항

- `cloudflare/bokdoong-router.mjs:24` 주석이 이제 없는 `scripts/asset-manifest.mjs`를 가리킨다(목록은 `scripts/build-pages.mjs`가 만듦). 동작 영향 없음, 안 A PR에서 함께 고칠지는 커맨드센터 판단.
