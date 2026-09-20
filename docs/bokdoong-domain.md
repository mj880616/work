# bokdoong.com 도메인 운영 설계

## 확인한 현재 구조

- `work` 저장소의 GitHub Pages 설정은 `main` 브랜치의 `/`(root)에서 배포함. 현재 주소는 `https://mj880616.github.io/work/`이며 GitHub Pages custom domain은 비어 있음. 배포는 GitHub의 `pages build and deployment` 작업이 수행함. 저장소 안에는 별도 Pages 배포 workflow나 `CNAME` 파일이 없음.
- 루트 `index.html`은 인증 게이트가 있는 Web1 진입점임. Web2 진입점은 `app/index.html`이며, 공개 화면과 인증 후 업무 화면을 구분함.
- 읽생기는 별도 `mj880616/read-think-write` 저장소에서 `https://mj880616.github.io/read-think-write/`로 배포함. 코드의 `APP_BASE`도 `/read-think-write/`임.
- 아스날 아카이브는 `personal/arsenal-match-archive/`에 있고 현재 Pages 주소에서 정상 응답함.
- Web1의 일부 링크와 자산은 `/work/...` 절대경로를 사용함. Web2 CSS/JS, PWA manifest, Service Worker는 `./` 상대경로를 사용하고 Service Worker 알림 기본 주소는 `/work/app/`임. 읽생기 내부 경로와 404 복구도 `/read-think-write/`를 전제로 함. 아스날 아카이브 CSS/JS는 `./` 상대경로임.
- Supabase URL은 `https://xmlkxfjeagycwttklxjw.supabase.co`이며 Web1/Web2 및 읽생기 클라이언트에서 직접 사용함. 현재 Supabase Auth Site URL은 기존 `https://mj880616.github.io/work/app/`이고 Redirect URLs 목록은 이 주소 한 개임. Web2 비밀번호 복구와 가입 확인의 기존 고정 주소는 새 호스트에서 동적 주소로 변경함.
- `public-page-edit`와 `pc0921-board` Edge Function은 기존 github.io Origin만 허용했음. 새 Web1/Web2 Origin 두 개를 정확히 추가하고 인증·관리자·DB 권한 검사는 유지함.
- Android와 Windows 래퍼는 기존 github.io 주소를 내부 호스트와 OAuth 복귀 경로로 사용함. 이번 변경 대상에서 제외함.

## 권장 연결 방식

GitHub Pages custom domain을 설정하지 않음. 기존 github.io URL을 계속 사용하게 하고, Cloudflare Worker 한 개를 다섯 개 Custom Domain에 연결함. Worker는 허용된 Pages 정적 경로만 GitHub Pages에서 가져오며 쿠키·Authorization 헤더를 전달하지 않음. Supabase 요청은 Worker로 보내지 않음.

| 호스트 | `/` 요청 | GitHub Pages 원본 |
| --- | --- | --- |
| `bokdoong.com` | 포털 페이지를 바로 제공 | `/work/personal/portal/` |
| `work.bokdoong.com` | `/work/`로 호스트 내부 이동 | `/work/**` |
| `desk.bokdoong.com` | `/work/app/`로 호스트 내부 이동 | `/work/app/**` |
| `read.bokdoong.com` | `/read-think-write/`로 호스트 내부 이동 | `/read-think-write/**` |
| `arsenal.bokdoong.com` | `/work/personal/arsenal-match-archive/`로 호스트 내부 이동 | 해당 아카이브 경로만 |

기존 경로를 유지하므로 CSS, JS, Web2 Service Worker 범위, 읽생기 SPA 경로를 일괄 변경하지 않아도 됨. `desk`의 Web1 공개 페이지 링크는 `work.bokdoong.com`의 같은 경로로 이동시켜 인증 앱과 공개 페이지의 새 Origin을 분리함. `lab`·`archive`를 추가하려면 Worker의 호스트별 경로 매핑과 Wrangler Custom Domain을 하나씩 추가하면 됨.

Cloudflare Worker Custom Domain을 배포하면 Cloudflare가 해당 호스트의 DNS 레코드와 인증서를 관리함. 기존 같은 이름의 CNAME이 있으면 먼저 충돌 여부를 확인해야 함. Worker 무료 플랜은 하루 100,000 요청 제한이 있으므로 트래픽을 관찰해야 함.

## 배포 순서와 되돌리기

1. GitHub Pages 코드와 두 Edge Function 코드를 배포하고 기존 github.io URL을 재검사함.
2. Supabase Auth Redirect URLs에 새 도메인 경로와 읽생기 기존 경로를 추가함. Site URL은 기존 값 그대로 유지함.
3. Cloudflare 공식 로그인 후 `cloudflare/wrangler.toml`로 Worker를 배포함. Custom Domain과 자동 DNS 레코드가 생성됐는지 확인함.
4. 다섯 새 URL과 주요 기존 URL을 데스크톱·모바일에서 검증함. OAuth·복구는 실제 계정 로그인/메일 흐름까지 별도로 확인함.

문제가 생기면 Cloudflare Custom Domain 연결을 해제하거나 이전 Worker 버전으로 되돌림. GitHub Pages custom domain과 기존 URL은 수정하지 않으므로 기존 링크는 별도로 유지됨. Supabase Auth Redirect URLs에서 새 주소를 제거해도 기존 Site URL은 유지됨.
