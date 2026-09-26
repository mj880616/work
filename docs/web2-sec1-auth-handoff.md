💻 PC 로컬 필요 — 배포·DB 변경은 Claude Code 로컬 절차만. 이 PR에서는 실행 금지.

# SEC-1 auth-handoff 조사·SQL 초안·정지 지점

## 1. 결과와 범위

- 시작 main: `8a6f4ec58d57e8a39f952eb6d7398e1ae34435ae`(#323), 브랜치 `security/sec1-auth-handoff`.
- 실제 조사 도구: Codex CLI 로컬. 운영 접근은 Supabase 조회만 사용했다.
- **미해결 / 배포 대기.** 사용자 지시 2(a)의 “필요한 저장 구조가 DB 변경을 요구하면 SQL 초안만 작성하고 멈춤”에 도달했다. 이 PR은 조사·재현 도구·SQL 초안·원장만 포함한다. Edge·브라우저·안드로이드 코드, migration, Auth 설정을 변경하지 않는다.
- `auth-handoff` 운영 조회: ACTIVE, v3, `verify_jwt=false`, 마지막 배포 2026-09-12 00:13:10.751 UTC. [기존 기록](web2-env6b-edge-source.md)과 같은 버전·설정이다.
- 로컬 원본 SHA-256(LF 정규화): `10b516c07eb7ddf2a2c582e1113c06e1a79dbd7658e8e9395f4e1956556b78cb`. 운영 원본도 조회하여 아래 흐름을 확인했다. 번들 해시와 소스 파일 해시는 다른 값이다.
- 새 소비 표/RPC가 없다는 조회 결과, 기존 저장 구조, 로그 범위는 [snapshot](security/sec1-auth-handoff-snapshot.md)에 남긴다. 개인정보·실제 토큰·로그 본문은 보관하지 않는다.

## 2. 역할과 호출 흐름

1. `android-app/app/src/main/java/kr/or/kptu/work/MainActivity.java:24`의 HOME을 WebView로 연다. JS·DOM storage 사용, 파일 접근 금지, WebView 디버깅 비활성이다.
2. 현재 로그인은 `app/login/index.html:44` → `app/login/native-google-return.js` → `app/auth-service.js`의 `APP_ROOT`를 기준으로 네이티브 callback URL을 만든다. Android UA를 감지하면 Google 인증을 외부 브라우저에서 거쳐 `native-callback.html?native=android`로 돌아온다.
3. `app/native-callback.html:11`이 `native-auth-bridge.js?v=4`를 실행한다. 이 모듈은 `app/loader-v2.js:6`에서도 불러온다(`app/index.html:22` preload). hash의 access/refresh 값을 읽고 **직접 호출 1**: `app/native-auth-bridge.js:17`이 `action=seal` 요청을 보낸다.
4. 함수는 `/auth/v1/user`로 access token을 확인한 뒤 `{sub,rt,iat,exp}`를 AES-GCM으로 봉인한다. 수명은 5분이며 키는 service role 키에서 파생한다. 서버 저장은 없다.
5. 웹 callback은 `intent://auth?handoff=…`로 앱을 연다. Manifest의 `kptuwork://auth` intent와 `MainActivity.loadFromIntent()`가 HOME의 `?handoff=…`로 전달한다. Java에서 이 Edge 함수를 직접 호출하지 않는다.
6. `app/loader-v2.js:12` → **직접 호출 2**: `app/auth-handoff-client.js:9`가 `action=consume` 요청을 보낸다. 함수는 복호화·만료 검사 후 `/auth/v1/token?grant_type=refresh_token`을 호출해 session을 반환한다.
7. 클라이언트는 session 전체를 `kptu_collab_session_v1` localStorage에 기록하고 **성공한 경우에만** URL의 handoff를 삭제한다. 이후 loader가 세션과 Web2 접근을 검사한다.

인접·보존 경로: `app/auth-ui.js`와 `app/auth-login-fallback.js`에도 고정 GitHub Pages callback 생성 코드가 있다. `windows-app/MainForm.cs`도 같은 HOME·payload 처리 코드를 보유하지만 `windows-app/README.md`에서 wrapper 개발 중단을 명시한다. `native-auth-bridge.js`는 여전히 windows 분기를 갖는다. 이 PR에서 제거하지 않는다.

## 3. 재현 및 추가 발견

실제 함수 소스를 Node 24에서 실행하고 Auth HTTP만 합성 응답으로 대체했다. 실제 계정·네트워크·DB 쓰기는 없다.

```powershell
node docs/security/sec1-auth-handoff-reproduce.mjs
node docs/security/sec1-auth-handoff-reproduce.mjs --enforce
```

첫 명령의 exit 0은 조사 도구 실행 성공이지 보안 통과가 아니다. `--enforce`는 현재 미해결 항목 때문에 exit 1이어야 한다. 기존 CI를 우회하거나 실패 테스트를 삭제하지 않는다.

| 항목 | 확인된 결과 | 의미·한계 |
| --- | --- | --- |
| 순차 재사용 | 같은 봉인 토큰 2회 모두 200 | 함수가 소비 사실을 기억하지 않음 |
| 별도 인스턴스 동시 재사용 | 독립 handler 2개 모두 200 | 프로세스 메모리 Set으로 고쳐도 분산 실행 보장 불가 |
| 임의 Origin | OPTIONS 200, `Allow-Origin: *`, consume POST 200 | 브라우저가 응답을 읽을 수 있도록 허용됨. 토큰 없이 로그인된다는 뜻은 아님 |
| 캐시 지시 | session 응답에 `Cache-Control` 없음 | `no-store`가 필요함. 실제 캐시에 저장되었다는 증거는 아님 |
| 주체 불일치 | 봉인 sub와 다른 Auth 응답 user도 200 | seal의 access/refresh 쌍이 같은 사용자라는 보장, consume 응답의 sub 비교 없음 |
| 오류 정보 | Auth의 원문 `error_description`이 그대로 반환됨 | 일반 오류 코드로 축약할 필요 |
| 기본 거부 | 만료 401·잘못된 access 401·잘못된 봉인 400 | 이 기본 검사들은 존재함 |

“5분 동안 여러 번 사용 가능”의 정확한 범위는 **만료 전 모든 재시도를 함수가 Auth에 전달할 수 있음**이다. 운영에서 매번 로그인 성공한다는 뜻은 아니다. Auth의 refresh 재사용 예외·회전에 좌우된다. [공식 세션 문서](https://supabase.com/docs/guides/auth/sessions)는 재사용 허용 구간과 활성 refresh의 부모 토큰 예외를 설명한다. 실제 프로젝트의 재사용 구간 설정은 조회하지 않았고 변경하지 않는다.

추가 코드 사실:

- `native-auth-bridge.js:26`은 seal 실패 시 원래 OAuth hash 전체를 `payload`로 앱 링크에 넣는다. 이 경로는 handoff의 1회 사용 제한을 거치지 않는다. CORS 강화로 seal이 실패할 때도 발생하므로 후속 웹 수정에서 원문 토큰 fallback을 제거해야 한다.
- callback은 원래 OAuth hash를 즉시 지우지 않는다. consume 실패 시 handoff query도 남는다. 새로고침·방문 기록·초기 페이지 요청 로그에 노출될 가능성이 있다. 실제 로그에 토큰이 남았다는 증거는 없다. 성공 시 JS로 query를 지워도 최초 페이지 요청은 되돌릴 수 없다.
- 지정한 함수와 두 브리지 JS에는 명시적인 토큰 console 출력이 없다. 예외 메시지와 upstream 오류를 그대로 응답하는 코드는 있다. `Cache-Control: no-store` 및 callback의 `Referrer-Policy: no-referrer`를 후속 변경 후보로 둔다.
- session의 localStorage 저장은 기존 앱 구조다. XSS 시 노출될 수 있으나 저장 방식을 전면 변경하는 것은 이 PR 범위가 아니다. `allowBackup=false`와 WebView debug 비활성은 Android Manifest/설정에서 확인했다.
- seal은 유효한 Supabase 사용자 여부만 확인하며 Web2 sole-owner 조건을 확인하지 않는다. RTW와 Auth를 공유하므로 Web2 업무 DB의 owner-only 경계가 유지된다는 사실과 handoff 자체의 인증 범위는 구분해야 한다. 이 조사에서 Web2 데이터 접근 우회를 입증한 것은 아니다.
- AES-GCM 키는 service role 키에 종속되어 있어 해당 키 교체가 진행 중 handoff를 무효화한다. 실제 키 값은 조회하지 않았다. 별도 키 도입은 별도 운영 결정이며 이번 초안에 추가하지 않는다.

## 4. 허용 Origin 후보와 근거

| 허용 후보 | 코드 근거 | 앱 변경 필요 여부 |
| --- | --- | --- |
| `https://desk.bokdoong.com` | `cloudflare/bokdoong-router.mjs:4`, `auth-service.js`의 현재 origin 기반 APP_ROOT | 웹 callback을 같은 origin에서 사용 가능 |
| `https://work.bokdoong.com` | router `:3`, `docs/bokdoong-domain.md`의 `/work/app/` 복귀 주소 | 기존 주소 호환 |
| `https://mj880616.github.io` | Android HOME/INTERNAL_HOST, auth-ui·fallback, Windows HOME | Android WebView의 실제 페이지 origin도 이것 |

Origin은 경로를 포함하지 않는다. 따라서 GitHub Pages의 `/work/app/`만 CORS로 허용할 수 없다. 같은 호스트의 다른 프로젝트도 같은 origin이라는 잔여 범위를 명시한다. [Origin 문서](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin).

후속 구현은 위 3개와 완전 일치하는 Origin만 허용하고 `Vary: Origin`을 설정한다. 임의 하위 도메인, `null`, Origin 누락, `file://`, `capacitor://`, custom scheme은 허용할 코드 근거가 없다. OPTIONS만이 아니라 **실제 POST 처리 전** 거부해야 한다. CORS는 네이티브 클라이언트가 위조할 수 있으므로 인증·소비 기록의 대체물이 아니다.

안드로이드 수정 없이 기존 query handoff 프로토콜을 유지할 수 있다는 것은 **소스 기준 판단**이다. 설치된 APK의 버전·origin·실제 로그인은 미확인이다. query를 fragment로 옮겨 최초 요청 로그 노출까지 없애려면 웹 브리지·소비 코드 수정과 Android intent 파싱·실물 호환성 검증이 필요하다. Java `loadFromIntent()`는 이미 fragment를 HOME hash로 전달하므로 Java 변경이 반드시 필요하다고 단정하지 않으며 검증 결과에 따라 결정한다. exported intent의 임의 payload 수신 방어도 Android 후속 검토 대상이다. 이번 PR에서 Android를 고치지 않는다.

## 5. 저장 구조 판단과 SQL 초안

기존 `app_google_oauth_states`는 Calendar·Tasks·Drive callback이 함께 사용한다. `app_drive_download_tokens`는 document FK가 있고, `app_bootstrap_tokens`는 workspace가 PK인 초기 설정 구조다. 목적·권한 경계가 다른 표에 handoff를 섞으면 기존 OAuth/문서 흐름에 영향을 준다. handoff용 표/RPC는 현재 없다.

[Edge 실행 구조](https://supabase.com/docs/guides/functions/architecture)는 여러 격리 인스턴스를 사용한다. 메모리 Set은 전역 1회 사용을 보장하지 않는다. TTL 축소도 재사용 방지가 아니다. 외부 Redis 같은 새 저장소를 도입하지 않고 PostgreSQL의 PK 충돌 처리를 사용하도록 제안한다.

- [SQL 초안](security/sec1-auth-handoff.sql): RLS가 켜진 `public.app_auth_handoff_consumptions`와 `service_role` 전용 `SECURITY INVOKER` RPC 1개. public schema라는 이름은 공개 접근을 뜻하지 않는다. PUBLIC·anon·authenticated 권한을 명시적으로 제거하고 client policy를 만들지 않는다.
- 서비스 역할은 현재 private schema USAGE가 없다. 기존 private 권한을 확대하지 않기 위해 새 표만 public schema에 두고 그 표의 select/insert/delete, 새 RPC execute만 서비스 역할에 준다.
- 새 봉인 payload v2에 난수 nonce·sub·iat·exp를 포함하고, **서명/복호화·주체·시간 검증 후** RPC로 소비를 선점한다. `INSERT … ON CONFLICT DO NOTHING` 결과가 true인 요청 하나만 Auth refresh를 호출한다. DB 실패·timeout·불명확한 RPC 결과는 거부하고 refresh로 진행하지 않는다. v1은 nonce가 없어 거부하고 재로그인을 안내한다.
- nonce 기준이므로 base64 padding·표현 차이로 소비 키가 달라지는 문제를 피한다. 표에는 실제 access/refresh/봉인 문자열을 넣지 않는다. 만료 기록만 1분 여유 후 정리한다.
- Auth 호출 실패나 응답 유실 때도 소비 기록을 되돌리지 않는다. 사용자는 새 로그인을 시작한다. 응답 성공 후 소비 표시를 하면 동시 재사용이 가능하므로 금지한다.
- refresh 응답 user와 봉인 sub를 대조하고 Web2 owner 판정은 기존 DB 경계에 연결해야 한다. 클라이언트가 준 user/workspace 값을 믿지 않는다. 이 항목의 구체적 인증 구현과 불일치 시 세션 처리 검증은 후속 코드 단계에서 필요하다.
- [rollback 초안](security/sec1-auth-handoff-rollback.sql) 포함. **둘 다 `rollback;`으로 끝나는 검토용 초안이며 production에서 실행하지 않는다.** migration 디렉터리 밖에 있고 이력 번호를 임의로 만들지 않았다. SQL 실행·동시성·역할 테스트도 미실행이다.

DB 변경을 검토할 때의 일상어 3줄:

1. 무엇이 바뀌나: 로그인 전달표의 사용 여부만 저장해 같은 전달표로 두 번 로그인하지 못하게 한다.
2. 잘못되면: 앱 로그인 전달이 실패할 수 있고, 중간에 통신이 끊기면 새 로그인이 필요하다.
3. 되돌리는 방법: 먼저 해당 전달 기능을 안전하게 중단하고 토큰 수명·여유 시간이 지난 뒤 새 표와 함수만 제거한다. 이전 취약 코드 복구는 별도 승인 대상이다.

승인 후에만 CLI로 정식 migration 파일을 생성한다. 그 파일명에 맞는 `supabase_migrations.schema_migrations` 기록 insert를 `commit;` 직전에 포함하고, 최신 snapshot·rollback·권한/동시성 테스트를 함께 검토한다. production SQL은 main의 확정 파일 원문을 사용자가 SQL Editor에서 실행한다. 커맨드센터 실행 승인, 끝의 `commit;`, 실행 Success를 확인한다. `db push`·`migration repair`는 사용하지 않는다.

## 6. 배포 준비 — 실행 금지

아래는 후속 코드·DB 검증, 별도 merge 승인·DB 적용·Edge 배포 승인이 모두 끝난 다음 **Claude Code 로컬 manual mode**에서 사용할 절차다. 현재 PR은 배포할 수정 코드를 포함하지 않는다. CLI 2.118.0의 `--help`로 옵션만 확인했으며 deploy/download는 실행하지 않았다.

### 백업과 사전 확인

저장소 밖에 새 백업 디렉터리를 만들고 그 디렉터리의 PowerShell에서 실행한다. 현재 함수 파일을 다운로드할 때 기존 작업 파일을 덮어쓰지 않는다. 토큰은 인자로 넣지 않는다.

```powershell
npx.cmd supabase functions list --project-ref xmlkxfjeagycwttklxjw -o json > functions-before.json
npx.cmd supabase functions download auth-handoff --project-ref xmlkxfjeagycwttklxjw --use-api
Get-FileHash -Algorithm SHA256 .\supabase\functions\auth-handoff\index.ts
```

버전·verify_jwt·배포 시각·백업 hash와 확정 commit을 기록한다. 배포 직전 `false`가 아니거나 조사 후 소스가 달라졌으면 멈추고 원인을 확인한다. 백업에는 실제 로그 본문·세션·키를 추가하지 않는다.

### 적용 순서와 명령

1. 합성 테스트와 로컬 DB에서 순차·동시·다중 연결 중복 소비, anon/authenticated 거부, 서비스 역할 성공, expiry·rollback을 검증한다. 같은 토큰 20개 동시 요청 중 Auth 호출이 정확히 한 번이어야 한다.
2. 브리지의 원문 payload fallback 제거, 즉시 URL 정리·일반 오류 표시·no-store/CORS·주체 검증을 구현하고 desktop/mobile 회귀를 확인한다. 네이티브 Java는 별도 범위다. 모든 웹 캐시 버전은 loader → app.js → index.html 및 native-callback.html까지 전파한다.
3. 승인받은 DB migration을 사용자가 실행하고 조회로 확인한다. 기존 서비스 기능·RTW 설정은 변경하지 않는다.
4. 웹 fallback 방어를 먼저 공개하고 구 캐시가 영향을 주지 않는지 확인한다. Edge 오류 시 구 브리지가 원문 토큰으로 fallback하는 상태에서는 배포하지 않는다.
5. Edge 배포 **직전에 다시 정지**하여 승인받는다. 승인된 소스 checkout 루트에서만 다음 명령을 사용한다.

```powershell
npx.cmd supabase functions deploy auth-handoff --project-ref xmlkxfjeagycwttklxjw --use-api --no-verify-jwt
```

함수명 생략·`--prune` 금지. [CLI 참조](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

### 배포 후 확인

- 함수 버전 증가·`verify_jwt=false` 유지 확인. 다른 함수 버전이 바뀌지 않았는지 확인한다.
- 세 허용 origin의 OPTIONS/POST, 거부 origin·누락·null, 인증 없는 seal, malformed/expired/사용된 토큰을 검사한다. consume은 세션을 얻기 위한 endpoint이므로 로그인 JWT 자체를 필수로 바꾸지 않는다. 봉인 토큰 없이 session을 반환하면 안 된다.
- 실물 Android 앱에서 새 로그인 → 외부 Google 인증 → 앱 복귀 → WebView 세션 → 허용된 Web2 화면을 확인한다. 뒤로 가기·새로고침·중복 intent에서 재사용이 거부되어야 하며, 실패 시 새 로그인 안내만 나타나야 한다. raw payload fallback과 토큰 포함 오류/URL 잔류도 확인한다.
- desktop 웹 로그인, 로그아웃, Google Calendar/Tasks의 기존 복귀를 확인한다. 실제 토큰/개인정보를 캡처·공유·커밋하지 않는다. 보안 검사는 실행 여부와 상태 코드·횟수만 기록한다.

### 장애 시 복구

DB가 적용됐지만 Edge가 배포되지 않았다면 새 구조를 사용하지 않으므로 당장 삭제할 필요가 없다. 수정 후 배포가 우선이다. 기능 중단이 필요하면 원문 fallback이 없는 상태에서 handoff 발급·소비를 함께 닫는 검증된 복구 버전을 사용한다(그 버전은 아직 작성하지 않음).

사용자가 취약점 재개방을 감수한 기존 코드 복구를 명시적으로 승인한 경우에만, 위에서 받은 **백업 디렉터리**에서 같은 명령으로 v3 소스를 재배포할 수 있다. 버전 번호는 감소하지 않고 새 배포 버전이 된다. 재사용·CORS * 문제가 돌아오므로 자동 복구 선택으로 삼지 않는다.

```powershell
npx.cmd supabase functions deploy auth-handoff --project-ref xmlkxfjeagycwttklxjw --use-api --no-verify-jwt
```

새 소비 표는 v2 발급·소비를 멈추고 마지막 발급 후 최소 6분 및 진행 요청 종료를 확인할 때까지 유지한다. 그 뒤에만 승인된 rollback으로 새 객체를 제거한다. 기존 표·정책·다른 함수·RTW는 복구 대상이 아니다.

## 7. 검증 상태와 사용자 결정

- clean main 기준 기존 보안 테스트 75/75 통과. 오프라인 재현에서 위 6개 보안 관찰 항목을 확인했다. `--enforce`의 실패는 해결되지 않은 현재 상태를 그대로 표시한다.
- SQL 초안은 실행하지 않았다. 문법/실제 DB 권한/동시성, 실제 Android 로그인, 운영 재사용 성공 여부는 미검증이다. 합성 Auth 응답 테스트는 이를 대신하지 않는다.
- 제품 코드 변경이 없으므로 캐시 버전 변경 대상 없음. 문서 PR은 자동 CI 경로 대상이 아니지만 기존 Authorization security check를 브랜치에 수동 실행하여 결과를 PR에 남긴다. 이는 수정 완료 판정이 아니다.
- 결정 필요: 새 소비 기록 구조와 통신 실패 시 재로그인 방침을 검토한 뒤 후속 구현을 승인할지. 이 PR merge, DB 적용, Edge 배포는 각각 별도 승인 대상이다.
- 사용자 할 일과 결정 항목은 PR 댓글에도 남긴다. roadmap ENV-7은 #323·사용자 제공 조회 시험 날짜로 완료, SEC-1은 진행중·배포 대기다.
- 범위 밖 발견: 기존 `workspace-drive` 다운로드 소비도 조회 후 나중에 사용 표시하는 구조다. 별도 동시성 점검 후보이며 이 PR에서는 수정·운영 재현하지 않는다.
