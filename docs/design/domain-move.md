# 주소 이전 설계 (DOMAIN-주소이전 ①~④)

- 상태: **설계만**. 이 문서를 올린 PR은 운영(Cloudflare·DNS·Supabase·Edge·DB·Azure·Google)을 하나도 바꾸지 않는다.
- 요청 원문: Drive 'Web2 요청함' 2026-10-28 01:08 주소 이전 ①②③④와 07:30 추가(원드라이브 돌아올 주소).
- 기준 문서: [`docs/bokdoong-domain.md`](../bokdoong-domain.md)(지금 주소 구조), [`docs/web2-expand-deploy-verify-contract.md`](../web2-expand-deploy-verify-contract.md)(Expand → Deploy → Verify → Contract 원칙), [`docs/design/diary-onedrive.md`](diary-onedrive.md) 10.4(원드라이브 돌아올 주소).
- 시안: [`mockups/domain-move.html`](mockups/domain-move.html)(옛 주소 안내 한 줄, 다시 로그인 안내, 아스날 메뉴 자리).
- 순서(명진 결정 01:08): ① 주소 이전 → ② 아스날 메뉴 → ③ 노트에 읽생기 아이디어 → ④ Web1 삭제. 읽생기 사이트 닫기(③의 ⑥)는 '바로' 요청이라 ③-0으로 따로 떼어 언제든 할 수 있게 했다.
- 표시: **⏸ 결정 대기** = 커맨드센터 승인·명진 결정 전에는 하지 않음. 모든 운영 단계는 ⏸이다.

## 0. 지금 구조에서 확인한 사실 (2026-10-28 main `2be017bd`)

1. `bokdoong.com`·`work`·`desk`·`arsenal` 네 호스트는 **이미 Cloudflare Worker `bokdoong-router`의 Custom Domain**이다(`cloudflare/wrangler.toml`). 그래서 이번 이전에는 **DNS 레코드를 새로 만들거나 바꿀 일이 없다**. 바뀌는 것은 Worker 코드뿐이다.
2. Worker는 `main`에 `cloudflare/**`가 바뀌어 들어가면 `.github/workflows/cloudflare-worker-deploy.yml`이 **자동 배포**한다. 즉 "Worker PR merge = Cloudflare 운영 변경"이다. 그래서 Worker PR은 세션이 스스로 merge하지 않고 커맨드센터 승인 뒤 merge한다(AGENTS.md 6절 정지 지점).
3. 지금 Web2는 `desk.bokdoong.com/work/app/`에서 열리고, `work.bokdoong.com/work/app/`·`mj880616.github.io/work/app/`에서도 열린다. 포털은 `bokdoong.com/`(원본 `personal/portal/`).
4. Web2 화면 코드는 주소를 거의 고정하지 않는다: 로그인 돌아올 주소는 `app/auth-service.js`가 지금 주소(`location.origin` + `/…/app/`)로 만들고, 앱 설치 정보(`app/windows-manifest.json`)와 서비스워커는 `./` 상대경로다. **고정 주소가 박힌 곳은 1.3절 목록뿐이다.**
5. 로그인 정보(Supabase 세션)·작은 그림 사본(`app/od-thumb-cache.js`)·캐시 정리 쿠키는 **주소(호스트)마다 따로** 저장된다. 그래서 새 주소에서는 **한 번 다시 로그인**해야 하고, 설치한 앱은 **다시 설치**해야 한다. 서버에 저장된 자료·화면 설정(`view_prefs`)은 그대로다.
6. Supabase 비밀값은 **프로젝트 전체 공용**이다(Web2·읽생기 함수가 같은 값을 읽음). 읽생기를 닫을 때 `OPENAI_API_KEY` 같은 비밀값을 지우면 Web2 AI도 멈춘다 → ③-0에서 비밀값은 지우지 않는다.

## 1. ① bokdoong.com = Web2, 포털 삭제

### 1.1 주소 모양 (추천)

| 들어오는 주소 | 지금 | 이전 뒤 |
| --- | --- | --- |
| `bokdoong.com/` | 포털 | `bokdoong.com/work/app/`로 넘김(302) |
| `bokdoong.com/work/app/**` | 없음(404) | **Web2** (원본 `/work/app/**`) |
| `bokdoong.com/work/<Web2 밖>` | 없음 | `work.bokdoong.com` 같은 경로로 넘김(지금 desk와 같은 규칙) |
| `desk.bokdoong.com/` · `/work/app/**` | Web2 | `bokdoong.com` **같은 경로·같은 ?뒤**로 넘김(302). `#` 뒤는 브라우저가 그대로 붙여 감 |
| `work.bokdoong.com/work/app/**` | Web2 | `bokdoong.com` 같은 경로로 넘김(302) |
| `work.bokdoong.com/work/share/` | 공유 페이지 | **그대로**(4.3절: 공유 페이지는 Web2와 다른 주소에 두는 편이 안전) |
| `arsenal.bokdoong.com/**` | 아스날 기록 | ② 단계에서 `bokdoong.com/work/app/?view=arsenal`로 넘김 |
| `read.bokdoong.com` | 읽생기(다른 Worker) | 이 건에서 건드리지 않음(③-0) |
| `mj880616.github.io/work/app/**` | Web2 | 브라우저로 열면 `bokdoong.com` **같은 경로·같은 ?뒤·같은 #뒤**로 넘김(SEC-github.io넘기기, 2026-10-30). Worker가 아니라 Pages 화면 맨 앞 `app/origin-redirect.js`가 넘긴다(github.io는 Cloudflare 밖). 설치 앱(윈도우 `KPTUWindows/`·안드로이드 `KPTUAndroid/`)은 넘기지 않음 — 윈도우 앱이 github.io만 안쪽 주소로 보기 때문(1.3절). 윈도우 앱을 새 주소로 옮긴 뒤 예외와 `auth-handoff`의 github.io 허용을 지운다 |

- 경로 `/work/app/`를 그대로 두는 이유: 서비스워커 범위, 상대경로, 원드라이브 돌아올 주소 경로(`/work/app/onedrive-return.html`), 시험·빌드 스크립트를 한꺼번에 바꾸지 않아도 된다. 주소창이 `bokdoong.com/work/app/`로 보이는 것이 싫으면 뒤에 따로(질문 Q1).
- 넘김은 **302(임시)** 로 한다. 301은 브라우저가 영구 기억해 되돌리기가 어렵다. Contract 뒤에도 302 유지를 추천(질문 Q2).
- 지금 desk에만 걸린 Worker 동작(HTML 15초 새로 받기, `?v=` 자산 확인 뒤 오래 보관, 캐시 정리 1회 `Clear-Site-Data`)을 `bokdoong.com`의 `/work/app/`에도 똑같이 건다. 빠뜨리면 새 주소에서 배포가 늦게 보인다.

### 1.2 단계표

| 단계 | 할 일 | 누가 | 상태 |
| --- | --- | --- | --- |
| E1 코드 | Edge 허용 주소에 `https://bokdoong.com` **추가만**: `public-policy-drive`(Web2 자료실 올리기·지우기가 씀), `auth-handoff`(Web2 로그인 전달), `public-page-edit`·`pc0921-board`(Web2 안 Web1 편집, ④까지). 지금 주소는 지우지 않음 | 작업 세션 PR | ⏸ |
| E2 Edge 배포 | E1 함수 4개를 승인형 workflow로 하나씩, `verify_jwt=keep`(넷 다 false 유지, `docs/web2-env6b-edge-source.md` 5절) | 커맨드센터 시작 → 명진 승인 | ⏸ |
| E3 로그인 주소 | Supabase Auth **Redirect URLs에 bokdoong.com 줄 추가**(1.4-가). Site URL은 아직 그대로 | 명진(화면) | ⏸ |
| E4 원드라이브 | Azure 앱 등록에 **새 돌아올 주소 추가**(1.4-나). 옛 주소는 지우지 않음. 비밀값은 아직 그대로 | 명진(화면) | ⏸ |
| E5 Worker | `bokdoong.com/work/app/**`에서도 Web2가 열리게(포털 `/`는 아직 그대로, desk도 그대로) + 1.1절 캐시 동작 | 작업 세션 PR → 커맨드센터 승인 merge(자동 배포) | ⏸ |
| V1 확인 | 새 주소에서 Google 로그인, 앱 열기·뒤로가기, 자료실 올리기, 일정 연결 다시 하기, 공유 링크 만들기, 폴드·PC. 옛 desk도 여전히 되는지 | 커맨드센터 + 명진 폰 | ⏸ |
| D1 코드 | Worker: `bokdoong.com/` → Web2, desk·work의 `/work/app/**` → bokdoong.com. `public-policy-drive`의 돌아갈 화면 주소(`DRIVE_APP_URL`·`CALENDAR_APP_URL`) → bokdoong.com. 시험·확인 스크립트(`tests/domain/bokdoong-router.test.mjs`, `scripts/cloudflare-check-urls.mjs`, `scripts/check-pages-build.mjs`, worker 배포 workflow 확인 주소) 갱신 | 작업 세션 PR 2개(Worker / Edge) | ⏸ |
| D2 배포 | Edge `public-policy-drive` 배포 → Worker PR merge(자동 배포) | 커맨드센터 → 명진 승인 | ⏸ |
| D3 원드라이브 비밀값 | `ONEDRIVE_REDIRECT_URI`를 새 주소로(1.4-다). D2 직후 | 명진(화면) | ⏸ |
| V2 확인 | 옛 즐겨찾기(desk·work) → 새 주소, 다시 로그인 1회, 원드라이브 다시 연결, 사진 보기, 공유 링크(옛·새) 열림, 안드로이드·윈도우 앱(github.io) 그대로, 앱 다시 설치(아이콘 바꾸기 재설치와 한 번에) | 커맨드센터 + 명진 | ⏸ |
| C1 정리(30일 뒤 추천) | `personal/portal/` 삭제, Worker의 포털·favicon 분기 삭제, Supabase Site URL을 새 주소로, Redirect URLs의 desk·work Web2 줄 삭제, Azure 옛 주소 삭제, Edge 허용 주소에서 desk 삭제, `basket-pc` 바로가기 주소 다음 판에 새 주소, AGENTS.md 1절 폰 진단 주소·`docs/bokdoong-domain.md` 갱신 | 작업 세션 PR + 명진 화면 | ⏸ |

일상어 3줄 (단계별):

- **E1~E2 Edge** — 바뀌나: 서버 함수 4개가 새 주소에서 온 요청도 받아 줌. / 잘못되면: 그 함수(자료실 올리기 등)가 옛 주소에서도 안 될 수 있음. / 되돌리기: 배포 전 기록한 이전 코드(SHA)로 같은 버튼 재배포.
- **E3 로그인 주소 추가** — 바뀌나: 새 주소로 로그인 뒤 돌아올 수 있게 됨. / 잘못되면: 새 주소 로그인만 실패, 옛 주소는 영향 없음. / 되돌리기: 추가한 줄 삭제.
- **E4 Azure 주소 추가** — 바뀌나: 원드라이브가 새 주소로도 돌려보낼 수 있게 됨. / 잘못되면: 영향 없음(아직 안 씀). / 되돌리기: 추가한 줄 삭제.
- **E5 Worker** — 바뀌나: bokdoong.com/work/app/에서도 Web2가 열림(다른 주소는 그대로). / 잘못되면: 네 주소 전체가 잠깐 안 열릴 수 있음. / 되돌리기: 그 PR을 되돌리는 PR merge(자동 재배포) 또는 Cloudflare 화면에서 이전 버전 되돌리기(1.4-라).
- **D2 Worker 넘김** — 바뀌나: bokdoong.com이 Web2, 포털이 안 보임, desk로 들어가면 bokdoong.com으로 넘어감. / 잘못되면: Web2가 안 열리거나 로그인이 돌고 돎. / 되돌리기: 위와 같이 이전 Worker로(포털·desk가 바로 돌아옴, 자료 영향 없음).
- **D3 원드라이브 비밀값** — 바뀌나: 원드라이브 연결이 새 주소로 돌아옴. / 잘못되면: 원드라이브 '다시 연결'만 실패(이미 받아 둔 연결은 유지). / 되돌리기: 비밀값을 옛 주소로 다시 저장(Azure에 옛 주소가 남아 있으므로 바로 됨).
- **C1 정리** — 바뀌나: 포털 파일과 옛 허용 주소가 없어짐. / 잘못되면: 옛 주소 일부 즐겨찾기가 안 넘어갈 수 있음. / 되돌리기: 이름표(4.1절과 같은 방식 `portal-last`) 시점 파일 되살리기 PR, 지운 허용 줄 다시 추가.

### 1.3 고정 주소가 박힌 곳 전수 (저장소, Web1 페이지 본문 제외)

| 곳 | 지금 값 | 이전 때 |
| --- | --- | --- |
| `cloudflare/bokdoong-router.mjs`, `cloudflare/wrangler.toml` | 네 호스트 | E5·D1·C1 |
| `.github/workflows/cloudflare-worker-deploy.yml` 확인 주소 | 포털·desk·work·arsenal | D1·C1 |
| `scripts/cloudflare-check-urls.mjs`, `scripts/check-pages-build.mjs` | desk 자산 주소 | D1 |
| `tests/domain/bokdoong-router.test.mjs` 등 시험 | desk·포털 | E5·D1 |
| `supabase/functions/public-policy-drive` | 허용 주소(github.io·work·desk), 돌아갈 화면 desk | E1·D1 |
| `supabase/functions/auth-handoff` | 허용 주소(desk·work·github.io) | E1 |
| `supabase/functions/public-page-edit`, `pc0921-board` | 허용 주소(github.io·work·desk) | E1, ④에서 함수째 정리 |
| `supabase/functions/share-page-read` | 허용 주소 work만 | 바꾸지 않음(공유 페이지는 work에 남음) |
| `app/share-pages-model.mjs` `SHARE_ORIGIN` | work | 바꾸지 않음(질문 Q3) |
| `app/web1-board.js` `WORK_ORIGIN` | work | ④에서 화면째 정리 |
| `basket-pc/src/BasketDrop/AppPaths.cs` | desk | C1(다음 판, 그 전에도 넘김으로 동작) |
| `android-app/…/MainActivity.java`, `windows-app/MainForm.cs` | github.io | 바꾸지 않음(github.io 주소는 계속 됨). 새 주소로 옮길지는 뒤에 따로 |
| `AGENTS.md` 1절 폰 진단 | desk | C1 |
| Google 연결(드라이브·일정·할 일) 돌아올 주소 | Supabase 함수 주소(`…/functions/v1/public-policy-drive/callback`) | **Google 화면은 바꿀 것 없음**(돌아올 주소가 우리 주소가 아님). 마지막에 돌아갈 화면만 D1에서 바뀜 |
| 원드라이브 돌아올 주소 | 비밀값 `ONEDRIVE_REDIRECT_URI` + Azure 등록, 둘 다 desk | E4·D3·C1 |
| Supabase Auth Site URL·Redirect URLs | github.io·desk·work | E3·C1 |
| 웹 알림 구독 | 화면 코드에서 구독하는 곳 없음(확인) | 해당 없음 |

D1 PR은 이 표를 다시 `grep`(`bokdoong.com`, `github.io`)으로 전수 확인해 빠진 곳이 없음을 본문에 적는다.

### 1.4 명진이 화면에서 바꾸는 단계 (비밀번호·값은 채팅에 보내지 않음)

가. **Supabase 로그인 돌아올 주소 추가 (E3)**
1. Supabase 대시보드 로그인 → 이 프로젝트 선택.
2. 왼쪽 **Authentication** → **URL Configuration**.
3. **Redirect URLs**에서 지금 `https://desk.bokdoong.com/…`으로 시작하는 줄을 하나씩 본다.
4. 줄마다 **Add URL** → 같은 글자에서 `desk.bokdoong.com`만 `bokdoong.com`으로 바꿔 넣고 저장. (커맨드센터가 넣을 줄 목록을 미리 표로 준다.)
5. **Site URL은 건드리지 않는다**(C1에서).

나. **Azure 원드라이브 돌아올 주소 추가 (E4)**
1. Azure 포털 로그인 → 위 검색창에 `앱 등록` 입력 → 원드라이브 사진용 앱 선택.
2. 왼쪽 **인증(Authentication)** → **웹** 칸의 **리디렉션 URI** → **URI 추가**.
3. `https://bokdoong.com/work/app/onedrive-return.html` 를 글자 그대로 입력 → 아래 **저장**.
4. 옛 줄(`desk…`)은 지우지 않는다.

다. **원드라이브 비밀값 바꾸기 (D3)**
1. Supabase 대시보드 → 왼쪽 **Edge Functions** → **Secrets**(비밀값).
2. `ONEDRIVE_REDIRECT_URI` 줄의 수정 → 값에 `https://bokdoong.com/work/app/onedrive-return.html` → 저장. (주소일 뿐 비밀번호가 아님. 다른 비밀값은 건드리지 않음.)
3. Web2 일기 → 원드라이브 아이콘 → 다시 연결 한 번.

라. **Cloudflare (확인·되돌리기만)**
- 바꿀 화면 없음. 배포는 PR merge로 자동.
- 확인: Cloudflare 대시보드 → **Workers & Pages** → `bokdoong-router` → **설정 → 도메인 및 경로**에 `bokdoong.com`·`work`·`desk`·`arsenal` 네 줄이 그대로인지.
- 급히 되돌릴 때: 같은 화면 **배포(Deployments)** → 바로 전 버전 → **롤백**. 그 뒤 커맨드센터가 되돌림 PR로 저장소를 맞춘다.

마. **Google Cloud (확인만)**
- OAuth 클라이언트의 **승인된 리디렉션 URI**가 Supabase 주소(`…supabase.co/…`)뿐이면 바꿀 것 없음. `desk.bokdoong.com`이 적혀 있으면 커맨드센터에 알려 주면 같은 방식으로 추가 단계를 준다.

### 1.5 미리 알려 둘 것 (명진)

- 새 주소에서 **한 번 다시 로그인**. 원드라이브는 **한 번 다시 연결**.
- 폰·PC에 설치한 웹2 앱은 **새 주소로 다시 설치**(10/27 17:49 아이콘 바꾸기 재설치와 한 번에). 옛 앱 아이콘도 열면 새 주소로 넘어간다.
- 일기 사진 작은 그림 사본은 새 주소에서 처음 한 번 다시 받는다(조금 느림).

## 2. ② 아스날 경기 기록을 Web2 '아스날' 메뉴로

| 단계 | 할 일 | 상태 |
| --- | --- | --- |
| E1 화면 | Web2에 `?view=arsenal` 화면 추가. 자료는 지금 `personal/arsenal-match-archive/matches.js`를 `app/arsenal/`로 옮겨 **그 화면을 열 때만** 불러옴(첫 화면 속도 영향 없음). 모양은 Web2 기준(콤팩트·톤다운). 메뉴 창 맨 아래(메뉴 편집 요청이 들어오면 옮길 수 있게). 검사(`arsenal-archive-check.yml`, `validate-archive.mjs`) 경로도 함께 | ⏸ (①의 E5 뒤) |
| V1 | 새 주소·옛 desk에서 메뉴 열기, 경기 거르기·검색, 폴드·PC | ⏸ |
| D1 | Worker: `arsenal.bokdoong.com/**` → `bokdoong.com/work/app/?view=arsenal`(302). ①의 D1 Worker PR에 함께 넣어 Cloudflare 변경 한 번 | ⏸ |
| C1 | `personal/arsenal-match-archive/`·Worker 아스날 분기(favicon 포함) 삭제. `arsenal.bokdoong.com` 연결은 넘김용으로 유지 | ⏸ (30일 뒤) |

- 자료 저장 방식 추천: **화면 파일 그대로**(지금처럼 새 경기는 PR로 `matches.js`에 추가, 검사가 형식 확인). 서버 저장은 DB 새 표·화면 입력이 필요하고 하루 몇 건 수준이라 이득이 적다(질문 Q4).
- 달라지는 점: 지금은 **로그인 없이** 보이는 공개 페이지인데, Web2 메뉴가 되면 **로그인해야** 보인다(Web2는 혼자 쓰는 비공개).
- 일상어 3줄 — 바뀌나: 아스날 기록이 Web2 메뉴 안으로, 옛 주소는 그 메뉴로 넘어감. / 잘못되면: 아스날 화면만 안 열림(다른 Web2 기능 영향 없음). / 되돌리기: Worker 이전 버전(옛 주소 바로 복구), C1 전까지 옛 파일이 남아 있음.

## 3. ③ 노트에 읽생기 아이디어 + ③-0 읽생기 사이트 닫기

### 3.0 ③-0 읽생기 사이트 닫기 (요청 '바로', ①과 독립)

- 대상은 **다른 저장소**(`read-think-write`의 화면·`rtw-router` Worker·글 추가 통로 `rtw-personal-write`)다. 이 저장소 작업 세션 범위 밖이라 커맨드센터가 그 저장소용 작업을 따로 띄운다.
- 순서: ① 비밀값 확인 — `OPENAI_API_KEY` 등은 **지우지 않는다**(0절 6번, 프로젝트 공용). ② `read.bokdoong.com`은 '더 이상 운영하지 않는 페이지입니다' 한 줄로(Worker 변경, ⏸). ③ `rtw-personal-write`는 함수 삭제(AGENTS.md 1절: 커맨드센터 승인 뒤 명진이 대시보드에서) 또는 항상 거절하는 판으로 재배포 중 택일(질문 Q6). ④ `rtw_*` 표·데이터(지인 글 포함)·Auth 사용자는 **보존**.
- 일상어 3줄 — 바뀌나: 읽생기 사이트가 한 줄 안내만 보이고 ChatGPT 글 추가가 막힘. / 잘못되면: 비밀값을 잘못 건드리면 Web2 AI가 멈춤(그래서 비밀값은 손대지 않음). / 되돌리기: Worker 이전 버전, 함수는 저장소 원본 재배포. 데이터는 지우지 않으므로 그대로.

### 3.1 노트 기능 (설계·시안 먼저 — 별도 상세 설계 PR)

| 단계 | 할 일 | 상태 |
| --- | --- | --- |
| 상세 설계 | 댓글(유형 생각·질문·인용, 유형 편집), 인용 댓글(본문 문장 선택), 댓글 모아 보기, 해시태그(폴더 유지, `[폴더/해시태그/댓글]` 칩), 주소로 가져오기, AI 읽기 → 시안 HTML로 명진 확인 | ⏸ 커맨드센터가 세션 띄움 |
| E1 DB | 새 표만 추가(기존 표 권한 넓히지 않음): 댓글·댓글 유형·노트 해시태그. 주인만 읽고 쓰기(`private.app_is_workspace_owner`), 짝 파일 5개, 승인형 DB workflow | ⏸ 정지 지점 |
| E2 Edge | 주소로 가져오기: 서버가 바깥 페이지를 읽음 — http·https만, 크기·시간 상한, 내부·사설 주소 차단, 넘김 횟수 상한. AI 읽기: 기존 `ai-assist`에 동작 추가(월 AI 상한 안, AI 사용량 줄에 표시, '~함. ~임.' 말투), 결과는 그 노트 댓글로 | ⏸ 정지 지점 |
| D1 화면 | 노트 읽기 화면 댓글 줄·댓글 쓰기, 목록 칩, 검색에 해시태그·댓글 포함. 저장 버튼 자리는 10/27 16:02 규칙 | ⏸ |
| V1 | 폴드·PC, 검색, AI 상한 | ⏸ |
| C1 | RTW-노트일원화 ⑤와 합칠지 결정 뒤 그 행 정리 | ⏸ |

- 진행 중인 노트 화면 개편(#1392)과 같은 파일을 만지므로 **#1392 merge 뒤**에 시작한다.
- 일상어 3줄(E1 DB) — 바뀌나: 노트에 댓글·해시태그를 저장할 새 칸이 생김(기존 노트는 그대로). / 잘못되면: 새 기능만 저장 실패, 기존 노트 영향 없음. / 되돌리기: 새 표만 지우는 rollback SQL(적용 전에 준비).

## 4. ④ Web1 삭제 (맨 마지막, ①~③ 뒤)

### 4.1 삭제 전 되돌릴 이름표

- 삭제 PR merge **직전**의 main 커밋에 이름표 `web1-last-YYYYMMDD`(실행 날짜)를 단다. 되돌리기 = 그 이름표에서 필요한 폴더만 되살리는 PR. 저장소 지난 기록은 지우지 않는다(공개 저장소라 기록은 남음 — 명진 안내 완료).
- C1(포털) 때도 같은 방식 `portal-last-YYYYMMDD`.
- 이름표는 커맨드센터가 삭제 승인 때 단다(이 설계 PR에서는 달지 않음).

### 4.2 지우기 전 먼저 할 것

1. **성명·보도자료 대조**: 원장 PRESS-자료실편입이 '진행중(가져오기 → 대조 → Contract)'. `press/` 47건과 자료실 '성명·보도자료' 건수·제목을 대조표로 확인 → 맞으면 원장 상태를 고치는 안을 PR 본문 '원장 반영'에 적음. 안 맞으면 대조만 하고 빠진 것은 명진에게 보고.
2. **Web2가 Web1을 빌려 쓰는 곳 정리**(먼저 Web2 쪽 PR):
   - `app/web1-board.js`·`web1-board.css`(사업 게시판이 Web1 페이지를 띄움), `app/web1-page-capabilities.js`, `app/web1-admin-auth.js`, `app/public-page-editor.js`, `app/forum-flow-polish.js`·`.css`, `app/legacy/editable-page.js` → 메뉴·화면째 삭제(숨기지 않음).
   - 실행 세션이 `grep`(`/work/` 중 `/work/app/` 밖, `../` 상대경로, `work.bokdoong.com`)으로 다시 전수 확인.
3. **공유 페이지는 남긴다**: `share/`(Web2가 만드는 공유 링크 화면)는 `../app/`·`../favicon.svg`를 읽으므로 `share/`·`favicon.svg`·`app/`는 보존.

### 4.3 남기는 것 (보존 목록)

| 남김 | 이유 |
| --- | --- |
| `app/` 전체 | Web2 |
| `share/`, 루트 `favicon.svg` | 공유 페이지(바깥에 보낸 공유 링크). 주소 `work.bokdoong.com/work/share/` 그대로 — Web2와 다른 주소라 공유 페이지 화면이 Web2 로그인 정보에 닿지 않음 |
| `supabase/`(migrations·functions), `cloudflare/`, `scripts/` 중 Web2·공유·빌드용, `tests/` 중 Web2용, `docs/` | 운영·기록 |
| `android-app/`, `windows-app/`, `basket-pc/` | Web2 앱 |
| DB의 Web1 표·`app_public_post` 등 | **데이터는 지우지 않음**(DB 변경 없음). 정리는 뒤에 따로 결정 |
| `analysis/` | Web1 화면이 아니라 자료 분석 기록 — 보존 추천(질문 Q8) |

### 4.4 지우는 것

- 페이지: 루트 `index.html`(Web1 입구), `press/`, `2in1/`, `workforce/`, `rail-council/`, `private-rail/`, `p/`, `s/`, `public-policy/`, `sanbyeol/`, `wedding/`, `review/`, `workspace/`, `assets/`(Web1 전용 — 실행 세션이 Web2·share가 안 쓰는지 확인).
- 관문·명령·검사: `publication-gate.yml`, `publication-auto-merge.yml`, `sync-public-page-meta.yml`, `web1-editor-auth-check.yml`, `web1-file-dropzone.yml`, `private-rail-forum-state-e2e.yml`, `.claude/commands/게시반영.md`, Web1 전용 `scripts/`(`generate-public-pages.mjs`, `compare-pages.mjs` 등)·`tests/`. 필수 검사 설정에 걸린 것이 있으면 GitHub 규칙 변경이 함께 필요(명진 화면, ⏸).
- Edge 함수(Web1 전용, 대시보드 삭제는 명진): `public-page-edit`, `pc0921-board`, `pc0914-checklist`, `pc0914-storage-test`, `pc-file-test`, `rail-1007-page`, `rail-1007-page-v2`, `wedding-mc-shared`, `kptu-board-probe`(실행 세션이 Web2 사용처 없음을 다시 확인). **`public-policy-drive`는 Web2 자료실·Google 연결이 쓰므로 남김.**
- 옛 주소 처리: Worker가 `work.bokdoong.com`에서 `/work/share/` 밖 모든 경로에 '더 이상 운영하지 않는 페이지입니다' 한 줄(검색 제외). github.io 주소용으로 루트 `404.html`에도 같은 한 줄.
- 문서: AGENTS.md 5절 Web1 문단, `docs/bokdoong-domain.md`, `docs/web1-public-page-withdrawal.md` 갱신.

### 4.5 단계표

| 단계 | 할 일 | 상태 |
| --- | --- | --- |
| E1 | 성명·보도자료 대조(4.2-1) | ⏸ |
| E2 | Web2가 Web1 빌려 쓰는 화면 삭제 PR(4.2-2) | ⏸ |
| D1 | 이름표 → Worker 안내 한 줄 + 404.html PR(커맨드센터 승인 merge) | ⏸ |
| V1 | 공유 링크(옛·새)·Web2 전체·바깥에 보낸 Web1 링크 몇 개가 한 줄 안내로 | ⏸ |
| C1 | Web1 파일·관문·검사 삭제 PR, Edge 함수 삭제(명진 대시보드), 문서 갱신 | ⏸ |

일상어 3줄:

- **D1 안내 한 줄** — 바뀌나: 옛 Web1 주소가 한 줄 안내만 보임. / 잘못되면: 공유 링크까지 안내로 바뀔 수 있음(V1에서 먼저 확인). / 되돌리기: Worker 이전 버전(파일은 아직 남아 있어 바로 복구).
- **C1 파일 삭제** — 바뀌나: 저장소에서 Web1 파일이 없어짐. / 잘못되면: Web2·공유 화면이 Web1 파일을 몰래 쓰고 있었다면 그 부분이 깨짐. / 되돌리기: 이름표 `web1-last-…`에서 그 폴더만 되살리는 PR.
- **C1 Edge 삭제** — 바뀌나: Web1용 서버 함수가 없어짐. / 잘못되면: 남아 있던 Web1 사용처가 멈춤(화면은 이미 안내 한 줄). / 되돌리기: 저장소 원본으로 같은 이름·같은 verify_jwt 신규 배포.

## 5. 이 설계 뒤 작업 순서 (커맨드센터용)

1. ①-E1 Edge 허용 주소 PR → E2 배포 → E3·E4 명진 화면 → E5 Worker PR.
2. ②-E1 아스날 화면 PR(①-E5 뒤, 노트 #1392와 다른 파일).
3. V1 → ①·② D1(Worker 한 번, Edge 한 번) → D3 → V2.
4. ③-0 읽생기 닫기(다른 저장소, 언제든) / ③ 상세 설계(#1392 뒤).
5. ①·② C1(30일 뒤) → ④.
