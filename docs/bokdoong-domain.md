# bokdoong.com 도메인 운영 설계

## 확인한 현재 구조

- `work` 저장소의 GitHub Pages 설정은 `main` 브랜치의 `/`(root)에서 배포함. 현재 주소는 `https://mj880616.github.io/work/`이며 GitHub Pages custom domain은 비어 있음. 배포는 GitHub의 `pages build and deployment` 작업이 수행함. 저장소 안에는 별도 Pages 배포 workflow나 `CNAME` 파일이 없음.
- 루트 `index.html`은 인증 게이트가 있는 Web1 진입점임. Web2 진입점은 `app/index.html`이며, 공개 화면과 인증 후 업무 화면을 구분함.
- 읽생기는 별도 `mj880616/read-think-write` 저장소에서 `https://mj880616.github.io/read-think-write/`로 배포함. 코드의 `APP_BASE`도 `/read-think-write/`임.
- 아스날 아카이브는 `personal/arsenal-match-archive/`에 있고 현재 Pages 주소에서 정상 응답함.
- Web1의 일부 링크와 자산은 `/work/...` 절대경로를 사용함. Web2 CSS/JS, PWA manifest, Service Worker는 `./` 상대경로를 사용하고 Service Worker 알림 기본 주소는 `/work/app/`임. 읽생기 내부 경로와 404 복구도 `/read-think-write/`를 전제로 함. 아스날 아카이브 CSS/JS는 `./` 상대경로임.
- Supabase URL은 `https://xmlkxfjeagycwttklxjw.supabase.co`이며 Web1/Web2 및 읽생기 클라이언트에서 직접 사용함. 변경 전 Supabase Auth Site URL과 유일한 Redirect URL은 `https://mj880616.github.io/work/app/`였음. Site URL은 유지하고 Redirect URLs만 아래 범위로 추가함. Web2 비밀번호 복구와 가입 확인의 기존 고정 주소는 새 호스트에서 동적 주소로 변경함.
- `public-page-edit`와 `pc0921-board` Edge Function은 기존 github.io Origin만 허용했음. 새 Web1/Web2 Origin 두 개를 정확히 추가하고 인증·관리자·DB 권한 검사는 유지함.
- Android와 Windows 래퍼는 기존 github.io 주소를 내부 호스트와 OAuth 복귀 경로로 사용함. 이번 변경 대상에서 제외함.

## 권장 연결 방식

GitHub Pages custom domain을 설정하지 않음. 기존 github.io URL을 계속 사용하게 하고, Cloudflare Worker 한 개를 다섯 개 Custom Domain에 연결함. Worker는 허용된 Pages 정적 경로만 GitHub Pages에서 가져오며 쿠키·Authorization 헤더를 전달하지 않음. Supabase 요청은 Worker로 보내지 않음. 예외 하나: `work.bokdoong.com/work/share/?t=<링크 값>`을 미리보기 수집기(텔레그램·카카오톡 등, User-Agent로 판별)가 가져갈 때만 Worker가 `share-page-read`에 링크 값을 POST 본문으로 보내 제목 한 줄을 받아 `og:title`에 넣음(1.5초 상한, 실패·무효면 공통 카드, 응답 `no-store`, 링크 값은 Pages로 넘기지 않고 기록하지 않음, Workers Logs 꺼짐 — SHARE-미리보기제목). 짧은 공유 주소(SHARE-보관함·HTML공유): `bokdoong.com/s/<이름>-<무작위 8글자>`는 사람에게 302로 `work.bokdoong.com/work/share/?s=<같은 값>`(공유 화면은 Web2 주소 밖), 미리보기 수집기에는 그 자리에서 공통 카드에 제목만 넣어 줌(`{slug, head:true}`). 모양이 틀리거나 `?`가 붙으면 404이고 아무것도 묻지 않음.

| 호스트 | `/` 요청 | GitHub Pages 원본 |
| --- | --- | --- |
| `bokdoong.com` | 포털 페이지를 바로 제공 | `/work/personal/portal/` |
| `work.bokdoong.com` | `/work/`로 호스트 내부 이동 | `/work/**` |
| `desk.bokdoong.com` | `/work/app/`로 호스트 내부 이동 | `/work/app/**` |
| `read.bokdoong.com` | (이 Worker 소관 아님) 2026-09-28 읽생기 전용 rtw-router로 이전 | 해당 없음 |
| `arsenal.bokdoong.com` | `/work/personal/arsenal-match-archive/`로 호스트 내부 이동 | 해당 아카이브 경로만 |

기존 경로를 유지하므로 CSS, JS, Web2 Service Worker 범위, 읽생기 SPA 경로를 일괄 변경하지 않아도 됨. `desk`의 Web1 공개 페이지 링크는 `work.bokdoong.com`의 같은 경로로 이동시켜 인증 앱과 공개 페이지의 새 Origin을 분리함. `lab`·`archive`를 추가하려면 Worker의 호스트별 경로 매핑과 Wrangler Custom Domain을 하나씩 추가하면 됨.

Cloudflare Worker Custom Domain을 배포하면 Cloudflare가 해당 호스트의 DNS 레코드와 인증서를 관리함. 기존 같은 이름의 CNAME이 있으면 먼저 충돌 여부를 확인해야 함. Worker 무료 플랜은 하루 100,000 요청 제한이 있으므로 트래픽을 관찰해야 함.

## 배포 순서와 되돌리기

1. GitHub Pages 코드와 두 Edge Function 코드를 배포하고 기존 github.io URL을 재검사함.
2. Supabase Auth Redirect URLs에 새 도메인 경로를 추가함. Site URL은 기존 값 그대로 유지함.
3. Cloudflare 공식 로그인 후 `cloudflare/wrangler.toml`로 Worker를 배포함. Custom Domain과 자동 DNS 레코드가 생성됐는지 확인함.
4. 다섯 새 URL과 주요 기존 URL을 데스크톱·모바일에서 검증함. OAuth·복구는 실제 계정 로그인/메일 흐름까지 별도로 확인함.

Supabase Auth Site URL은 기존 github.io 주소로 유지함. 운영 Redirect URLs에는 `desk`·`work`의 `/work/app/`와 `/work/app/confirmed.html`를 경로 단위로 등록함. 읽생기 주소는 읽생기 저장소가 관리하며 이 문서의 허용 목록에서 제외함. Web2 Google 로그인은 `view`, `invite`, `project` 쿼리로 현재 화면을 전달하므로 해당 앱 루트의 쿼리 패턴만 허용함. Web1 관리자 로그인은 정확한 페이지 경로로 복귀하고, 복귀 전 쿼리는 같은 탭의 sessionStorage에서 복원함. Web1 편집 페이지는 `/work/2in1/`, `/work/p/`, `/work/private-rail/`, `/work/rail-council/`, `/work/review/`, `/work/sanbyeol/`, `/work/workforce/`의 실제 경로 깊이에 한정한 단일 구간 `*` 패턴으로 허용함. 루트 포털과 아스날 아카이브는 인증 복귀 주소로 등록하지 않음.

문제가 생기면 Cloudflare Custom Domain 연결을 해제하거나 이전 Worker 버전으로 되돌림. GitHub Pages custom domain과 기존 URL은 수정하지 않으므로 기존 링크는 별도로 유지됨. Supabase Auth Redirect URLs에서 새 주소를 제거해도 기존 Site URL은 유지됨.

## 예정 변경 (설계만, 운영 반영 전)

- 2026-10-28 DOMAIN-주소이전: `bokdoong.com` = Web2(`/work/app/`), 포털 삭제, desk·work의 Web2 경로와 arsenal은 `bokdoong.com`으로 넘김, 공유 페이지는 `work.bokdoong.com/work/share/` 유지, 마지막에 Web1 삭제. 단계·되돌리기·명진 화면 단계는 [`design/domain-move.md`](design/domain-move.md). 운영에 반영되면 위 표를 그 상태로 고친다.
