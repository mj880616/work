# 새 주소 nojoplus.com 연결 (DOMAIN-nojoplus)

2026-11-14 명진 결정: 서비스 이름은 '노동조합+'(S61-55), 주소는 `bokdoong.com`('너무 개인적') 대신 `nojoplus.com`. 도메인은 명진이 가비아에서 사고, 같은 Cloudflare 계정에 존을 더하고 네임서버를 바꿨다(활성 대기). 이 문서는 주소 설계와 두 단계 순서·되돌리기다. 운영 반영(Worker 배포·Edge 배포·Supabase Auth 설정)은 커맨드센터가 한다.

## 1. 주소 설계

| 주소 | 1단계(이 PR) | 2단계(나중) |
| --- | --- | --- |
| `nojoplus.com/` | `nojoplus.com/work/app/`로 302 (`?쿼리` 유지) | 같음 |
| `nojoplus.com/work/app/**` | Web2. `bokdoong.com`과 똑같은 응답(같은 Pages 원본, HTML 15초 새로 받기, 검증된 `?v=` 파일만 오래 보관, 보고 전용 CSP·보안 헤더, 판마다 한 번 캐시 비우기) | 같음 |
| `www.nojoplus.com/**` | 같은 경로·`?쿼리`로 `nojoplus.com`에 301 (http도 한 번에 https) | 같음 |
| `nojoplus.com/work/about/**` | Pages의 `about/` 그대로(소개·개인정보 처리방침·이용약관) | 구글 동의 화면 링크를 이 주소로 바꿈 |
| `nojoplus.com/s/<짧은 주소>` | `work.bokdoong.com/work/share/?s=…`로 302(미리보기 수집기는 제목 카드) — `bokdoong.com/s/`와 같음 | 같음 |
| `nojoplus.com/work/**` 그 밖 | `work.bokdoong.com` 같은 경로로 302(공유 화면·옛 Web1 안내) — `bokdoong.com`과 같음 | 같음 |
| `nojoplus.com` 그 밖(`/robots.txt` 등) | 404 | 같음 |
| `bokdoong.com/**` | 지금 그대로(Web2) | 같은 경로·`?쿼리`로 `nojoplus.com`에 301 |
| `desk.bokdoong.com`·`work.bokdoong.com/work/app/**`·`arsenal` | 지금 그대로(`bokdoong.com`으로 302) | 넘기는 곳을 `nojoplus.com`으로 |
| `work.bokdoong.com/work/share/**`·`/work/about/**` | 그대로 | 그대로(이미 나간 공유 링크가 열려야 함) |

경로 `/work/app/`는 그대로 둔다(서비스워커 범위, 상대경로, 원드라이브 돌아올 주소, 시험·빌드를 한꺼번에 바꾸지 않으려고. `domain-move.md` 1.1절과 같은 이유).

### 공유 페이지 위치(추천: 지금 경로 유지)

- **추천: `work.bokdoong.com/work/share/` 유지.** 공유 화면은 로그인한 앱과 **다른 출처**여야 한다. 받은 사람이 여는 HTML 공유 파일·공유 본문이 앱의 로그인 정보(브라우저 저장소)와 같은 출처에 있으면 안 되기 때문이다(`bokdoong-domain.md` "인증 앱과 공유 페이지의 Origin을 분리"). `nojoplus.com/share/…`는 앱과 같은 출처라 이 경계를 무너뜨린다.
- 이미 밖으로 나간 링크(`work.bokdoong.com/work/share/?t=…`, `bokdoong.com/s/…`)는 1·2단계 모두 그대로 열린다. `share-page-read` 허용 출처(`work.bokdoong.com`)도 그대로다.
- 새로 만드는 짧은 주소는 화면이 열린 주소를 따른다: `nojoplus.com`에서 만들면 `nojoplus.com/s/…`, `bokdoong.com`에서 만들면 지금처럼 `bokdoong.com/s/…`(`app/share-html-model.mjs` `shortBase`). 새 주소 화면이 열렸다는 것은 Worker가 그 주소를 받는다는 뜻이라, 아직 연결 안 된 주소로 링크가 나가지 않는다.
- 공유 화면 자체를 `bokdoong` 없는 주소로 옮기려면 나중에 **별도 하위 주소**(예: `share.nojoplus.com`, 다른 출처)를 따로 정한다. 이 PR 범위 밖이다.

## 2. 주소를 박아 둔 곳과 1단계 처리

| 곳 | 지금 | 1단계 | 2단계 |
| --- | --- | --- | --- |
| Worker `cloudflare/bokdoong-router.mjs`·`wrangler.toml` | bokdoong 호스트 4개 | `nojoplus.com`·`www.nojoplus.com` 더함(옛 호스트 동작 그대로) | `bokdoong.com`·desk·work Web2 → `nojoplus.com` 301 |
| CSP `cloudflare/web2-csp.mjs` | `'self'` 기준 | 바꿀 것 없음(`'self'`가 새 주소를 뜻함) | 같음 |
| Edge 허용 출처 `_shared/web-cors.ts`(25개 함수) | bokdoong 3개 + github.io | `https://nojoplus.com` 정확히 하나 더함 | 옛 주소 정리는 C1 때 |
| Edge `auth-handoff` | 같음 | `https://nojoplus.com` 더함 | 같음 |
| Edge `public-policy-drive`(Google 연결 돌아오기) | 돌아갈 화면 `bokdoong.com` 고정 | 허용 출처에 더하고, **새 주소에서 시작한 연결은 새 주소로 돌아옴**(state에 `nojo` 칸, 요청 Origin 정확히 일치일 때만). `google-calendar`·`google-tasks`가 state를 만듦 | 기본 돌아갈 화면을 `nojoplus.com`으로 |
| Edge `share-page-read` | `work.bokdoong.com`만 | 그대로(공유 화면 출처) | 그대로 |
| Edge `public-page-edit`·`pc0921-board`(옛 Web1) | bokdoong 3개 + github.io | **안 더함**(Web2가 부르지 않음, 시험이 고정) | 함수 삭제는 별도 |
| 로그인 복귀(`app/auth-service.js`) | `location.origin` 기준 | 바꿀 것 없음 — Supabase Redirect URLs에 새 주소 줄만 추가(운영) | Site URL을 새 주소로 |
| 짧은 공유 주소(`app/share-html-model.mjs`) | `bokdoong.com/s/` 고정 | 화면이 열린 주소를 따름(위 1절) | 같음 |
| 공유 링크(`app/share-pages-model.mjs` `SHARE_ORIGIN`) | `work.bokdoong.com` | 그대로(공유 화면 출처) | 그대로 |
| github.io 넘기기(`app/origin-redirect.js`) | `bokdoong.com`으로 | 그대로 | `nojoplus.com`으로 |
| 로그인 화면 소개 링크(`app/login/index.html`)·`about/` canonical | `work.bokdoong.com/work/about/` | 그대로(S61-55와 같은 줄 피함) | 새 주소로 |
| 서비스워커 알림 기본 주소(`app/sw.js`) | 상대경로 `/work/app/` | 바꿀 것 없음 | 같음 |
| 원드라이브 돌아올 주소(Edge 비밀값 `ONEDRIVE_REDIRECT_URI`, Azure 등록) | `bokdoong.com/work/app/onedrive-return.html` | 그대로 — **원드라이브 연결은 1단계 동안 `bokdoong.com`에서** 한다(새 주소에서 시작하면 `bokdoong.com`으로 돌아가 로그인부터 다시) | Azure에 새 주소 등록 + 비밀값 바꿈(운영) |
| 폰 앱(`android-app` `ShellRules`) | 처음 여는 주소 `bokdoong.com`, 안쪽 호스트 4개 | 안쪽 호스트·맨 앞 `/` 넘김에 `nojoplus.com` 더함, 0.5.9(66). 처음 여는 주소·위젯 Origin은 그대로 | 처음 여는 주소·위젯 Origin을 새 주소로(새 판) |
| 폰 앱 OAuth 복귀 | `kptuwork://auth` | 바꿀 것 없음 | 같음 |
| 바구니 PC(`basket-pc` `PcDoor.AllowedOrigins`) | bokdoong 3개 | `https://nojoplus.com` 더함(다음 판에 포함, 판 번호는 릴리스 때) | 바로가기 주소(`AppPaths.BasketUrl`)를 새 주소로 |
| Worker 배포 확인(`cloudflare-worker-deploy.yml`) | bokdoong만 | 새 주소 2개·www 301 확인 더함 | 넘김 확인으로 바꿈 |

## 3. 두 단계 순서와 되돌리기

| 단계 | 할 일 | 누가 | 되돌리기 |
| --- | --- | --- | --- |
| 1-0 | Cloudflare에서 `nojoplus.com` 존이 **활성**인지 확인 | 커맨드센터 | — |
| 1-1 | 이 PR merge. **merge가 곧 Worker 자동 배포**(`cloudflare/**` 바뀜). 그래서 1-0 확인 뒤에만 merge | 커맨드센터 | 이전 Worker 버전으로 되돌리기(옛 호스트 동작은 바뀌지 않음) |
| 1-2 | Edge 함수 배포(아래 목록, 한 번에 하나씩, 되돌리기 ref 기록) | 커맨드센터 | 기록한 이전 ref로 같은 workflow 재실행 |
| 1-3 | Supabase Auth Redirect URLs에 새 주소 줄 추가(Site URL 그대로) | 커맨드센터(대시보드) | 추가한 줄 삭제 |
| 1-4 | 확인 주소 점검 + 명진 실기기: `nojoplus.com`에서 구글 로그인·캘린더 연결 | 커맨드센터 + 명진 | 위 각각 |
| 1-5 | 폰 앱 0.5.9 릴리스(새 주소 링크도 앱 안에) | 커맨드센터 | 옛 판 APK 다시 설치 |
| 2 | 로그인·폰 앱·바구니 PC가 새 주소로 옮긴 뒤: Worker에서 `bokdoong.com`·desk·work Web2 → `nojoplus.com` 301, Site URL 변경, 원드라이브·Google 돌아갈 화면 기본값 변경, 폰 앱 처음 주소 변경 | 별도 작업 PR + 커맨드센터 | 이전 Worker 버전(301 해제), Site URL 원래 값 |

2단계 주의: 로그인 정보는 주소마다 따로 저장된다. `bokdoong.com`에서 로그인해 둔 사람은 `nojoplus.com`으로 넘어가면 **한 번 다시 로그인**해야 한다(자료는 서버에 있어 그대로).
