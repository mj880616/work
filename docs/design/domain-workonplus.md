# 새 주소 workonplus.com 연결 (DOMAIN-workonplus)

2026-11-21 사용자 요청: 앱 이름이 WORK ON+(11/21 07:35 확정, `AGENTS.md` 5절)로 바뀌어 주소도 `workonplus.com`으로 옮긴다(사용자가 가비아에서 삼, 같은 Cloudflare 계정에 존을 더함). `nojoplus.com`에 오는 사람에게는 '개인 업무 앱으로 바뀌었고 노동조합+는 집행부·조합원 공간 중심으로 다시 출시 예정'이라는 안내와 새 주소로 가는 링크 하나를 보여 준다. 방식은 [`domain-nojoplus.md`](domain-nojoplus.md) 1단계와 같다. 운영 반영(Worker 배포·Edge 배포·Supabase Auth·구글 OAuth·폰 앱 릴리스)은 커맨드센터가 한다.

작업은 PR 둘로 줄 세운다.

- **PR-A(이 문서와 함께)**: `workonplus.com`을 Web2 주소로 더한다. 옛 주소(`bokdoong.com`·`nojoplus.com`·desk·work·arsenal)의 동작은 그대로다. 폰 앱 새 판(0.5.17)은 처음부터 `workonplus.com`을 연다.
- **PR-B(PR-A 브랜치 위)**: `nojoplus.com/`·`/work/app/**`을 안내 한 장으로 바꾼다. PR-A merge와 운영 확인(새 주소에서 구글 로그인 성공) 뒤에만 merge한다.

## 1. 주소 설계

| 주소 | PR-A | PR-B |
| --- | --- | --- |
| `workonplus.com/` | `workonplus.com/work/app/`로 302(`?쿼리` 유지) | 같음 |
| `workonplus.com/work/app/**` | Web2. `nojoplus.com`과 똑같은 응답(같은 Pages 원본, HTML 15초 새로 받기, 검증된 `?v=` 파일만 오래 보관, 보고 전용 CSP·보안 헤더, 판마다 한 번 캐시 비우기) | 같음 |
| `www.workonplus.com/**` | 같은 경로·`?쿼리`로 `workonplus.com`에 301(http도 한 번에 https) | 같음 |
| `workonplus.com/work/about/**` | Pages의 `about/` 그대로 | 같음 |
| `workonplus.com/s/<짧은 주소>` | `work.bokdoong.com/work/share/?s=…`로 302(미리보기 수집기는 제목 카드) | 같음 |
| `workonplus.com/work/**` 그 밖 | `work.bokdoong.com` 같은 경로로 302 | 같음 |
| `workonplus.com` 그 밖 | 404 | 같음 |
| `nojoplus.com/`·`/work/app/**` | 지금 그대로(Web2) | 안내 한 장(아래 4절). 자동 이동 없음 |
| `nojoplus.com/s/<짧은 주소>`·`/work/about/**` | 그대로 | 그대로(이미 나간 공유 링크·구글 동의 화면 검토 중 링크) |
| `www.nojoplus.com/**` | 그대로(`nojoplus.com`에 301) | 같음 |
| `bokdoong.com/**`·desk·work·arsenal | 그대로 | 그대로 |
| `work.bokdoong.com/work/share/**` | 그대로(공유 화면은 앱과 다른 출처, `domain-nojoplus.md` 1절) | 그대로 |

경로 `/work/app/`는 그대로 둔다(`domain-move.md` 1.1절과 같은 이유).

## 2. 주소를 박아 둔 곳과 PR-A 처리

| 곳 | 지금 | PR-A |
| --- | --- | --- |
| Worker `cloudflare/bokdoong-router.mjs`·`wrangler.toml` | bokdoong 4개 + `nojoplus.com`·www | `workonplus.com`·`www.workonplus.com` 더함. `nojoplus.com`과 같은 규칙(자기 `/work/app/`로 넘김, about, `/s/`, www 301) |
| CSP `cloudflare/web2-csp.mjs` | `'self'` 기준 | 바꿀 것 없음 |
| Edge 허용 출처 `_shared/web-cors.ts` | bokdoong 3개 + github.io + nojoplus | `https://workonplus.com` 정확히 하나 더함 |
| Edge `auth-handoff` | 같음 | `https://workonplus.com` 더함 |
| Edge `public-policy-drive`(Google 연결 돌아오기) | `nojo` 칸이면 `nojoplus.com`, 그 밖은 `bokdoong.com` | 허용 출처에 더하고, **`workonplus.com`에서 시작한 연결은 `won` 칸**(요청 Origin 정확히 일치일 때만)으로 `workonplus.com`에 돌아옴. `google-calendar`·`google-tasks`가 state를 만듦 |
| Edge `share-page-read` | `work.bokdoong.com`만 | 그대로 |
| Edge `public-page-edit`·`pc0921-board`(옛 Web1) | 새 주소 없음 | **안 더함**(시험 `tests/domain/supabase-origin.test.mjs`가 고정) |
| 로그인 복귀(`app/auth-service.js`) | `location.origin` 기준 | 바꿀 것 없음 — Supabase Redirect URLs 줄만 추가(운영 ④) |
| 짧은 공유 주소(`app/share-html-model.mjs`) | 연 주소(bokdoong·nojoplus)를 따름 | `workonplus.com`도 더함 |
| 공유 링크(`app/share-pages-model.mjs` `SHARE_ORIGIN`) | `work.bokdoong.com` | 그대로 |
| github.io 넘기기(`app/origin-redirect.js`) | `bokdoong.com`으로 | 그대로(나중 정리) |
| 원드라이브 돌아올 주소(Edge 비밀값·Azure 등록) | `bokdoong.com/...` | 그대로 — 원드라이브 연결은 당분간 `bokdoong.com`에서 |
| 폰 앱(`android-app` `ShellRules`) | 처음 여는 주소 `bokdoong.com`, 안쪽 호스트 5개 | **처음 여는 주소·위젯 Origin·알림 주소를 `workonplus.com`으로**, 안쪽 호스트에 더함(옛 주소들도 안쪽 그대로). `nojoplus.com` 앱 주소로 가는 앱 안 이동은 같은 경로·쿼리의 `workonplus.com`으로 바꿔 연다(`movedToHome`, PR-B 안내 대비). 0.5.17(74) |
| 폰 앱 OAuth 복귀 | `kptuwork://auth` | 바꿀 것 없음(앱 로그인 복귀 화면 `workonplus.com/work/app/native-callback.html`이 Redirect URLs에 있어야 함) |
| 바구니 PC(`basket-pc` `PcDoor.AllowedOrigins`) | bokdoong 3개 + nojoplus | `https://workonplus.com` 더함(다음 판에 포함, 판 번호는 릴리스 때) |
| 바구니 PC [열기] 주소(`LaunchArgs.AppUrl`) | `nojoplus.com/work/app/` | `workonplus.com/work/app/`으로(PR-B 뒤 nojoplus는 안내만 보여 주므로 미리. 다음 판에 포함) |
| Worker 배포 확인(`cloudflare-worker-deploy.yml`) | nojoplus 확인 | `workonplus.com` 302·www 301·앱·about 200 확인 더함 |

## 3. 순서와 되돌리기 (CC 운영 할 일)

| 단계 | 할 일 | 되돌리기 |
| --- | --- | --- |
| ① | Cloudflare에서 `workonplus.com` 존이 **활성**인지 확인. **merge 전에**(merge가 곧 Worker 배포이고, 배포 확인이 새 주소를 부른다) | — |
| ② | PR-A merge = Worker 자동 배포(`cloudflare/**`). 배포 확인 단계가 새 주소 302·www 301·200을 본다 | 이전 Worker 버전으로 되돌리기(옛 호스트 동작은 바뀌지 않음) |
| ③ | Edge 함수 배포(한 번에 하나, 되돌리기 ref = 배포 전 main 커밋): `auth-handoff`, `public-policy-drive`, `google-calendar`, `google-tasks`, 그리고 `_shared/web-cors.ts`를 쓰는 Web2 함수 전부(`grep -l "web-cors" supabase/functions/*/index.ts`로 목록을 뽑아 차례로). verify_jwt는 함수마다 지금 값 유지(`keep`) | 기록한 이전 ref로 같은 workflow 재실행 |
| ④ | Supabase Auth → URL Configuration → Redirect URLs에 `https://workonplus.com/**` 줄 추가(Site URL 그대로) | 추가한 줄 삭제 |
| ⑤ | Google Cloud OAuth 동의 화면 → 승인된 도메인에 `workonplus.com` 추가(로그인 자체는 Supabase 콜백이라 새 리디렉션 URI는 필요 없음) | 추가한 도메인 삭제 |
| ⑥ | 확인 + 사용자 실기기: `workonplus.com`에서 구글 로그인·캘린더 연결이 `workonplus.com`으로 돌아오는지 | 위 각각 |
| ⑦ | 폰 앱 0.5.17 릴리스(④ 다음에만 — 앱 로그인 복귀 화면이 새 주소). 올린 뒤 앱에서 한 번 다시 로그인 | 옛 판 APK 다시 설치 |
| ⑧ | PR-B merge(⑥ 확인 뒤) = Worker 배포. `nojoplus.com` 앱 자리가 안내 한 장이 됨 | 이전 Worker 버전 |

주의: 로그인 정보는 주소마다 따로 저장된다. `nojoplus.com`·`bokdoong.com`에서 로그인해 둔 사람은 `workonplus.com`에서 **한 번 다시 로그인**한다(자료는 서버에 있어 그대로).

## 4. nojoplus.com 안내 (PR-B)

- `nojoplus.com/`, `/work/app`, `/work/app/**`(Web2 화면·파일 모두)에 같은 안내 HTML 한 장(200, `noindex`, 저장 안 함). Pages에서 아무것도 가져오지 않는다.
- 제목 'WORK ON+로 옮겼어요'. 본문: 개인 업무 관리 앱 WORK ON+로 바뀌어 새 주소에서 계속 쓸 수 있다(기록은 그대로, 새 주소에서 한 번 다시 로그인) / 노동조합+는 노조 집행부·조합원 공간 중심으로 바꾸어 다시 출시할 예정.
- 버튼 하나 [workonplus.com으로 가기] → 같은 경로·`?쿼리`를 유지해 `https://workonplus.com/work/app/…`(맨 앞 `/`는 `/work/app/`). 자동 이동은 하지 않는다(사용자 요청은 '안내 + 링크').
- 그대로: `nojoplus.com/s/<짧은 주소>`, `/work/about/**`, 그 밖 `/work/**` → `work.bokdoong.com` 302, `www` 301.
- 폰 앱 0.5.17(PR-A에 포함)은 `nojoplus.com/work/app/**`로 가려는 앱 안 이동을 같은 경로·쿼리의 `workonplus.com`으로 바꿔 연다(안내 대신 새 주소). 옛 판 사용자는 안내 화면의 버튼으로 옮긴다.
