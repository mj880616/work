💻 PC 로컬 필요 — 이 PR은 준비·격리 검증까지. production DB 적용·Edge 배포·merge 금지.

# SEC-1 auth-handoff 1회 사용 구현 및 운영 정지 지점

## 1. 현재 상태

- 기존 Draft PR #324 / `security/sec1-auth-handoff`를 이어서 작업했다. 최신 main `8a6f4ec58d57e8a39f952eb6d7398e1ae34435ae`, 후속 시작 `8226ce317f2a04a80268643becf150ba1ff87588`.
- **SEC-1 진행중 — DB 적용·Edge 배포 대기.** 제품 코드, CLI 생성 migration 후보, rollback, snapshot, 자동 테스트를 준비한다. 운영 로그인 시험·DB 쓰기·Edge 배포·merge는 하지 않는다.
- 핵심 격리 검증: PostgreSQL **17.6**, 독립 JS handler 20개와 DB backend 20개가 같은 handoff를 동시 소비 → **nonce 성공 1개 / Auth refresh 1회 / 거부 19개**. 실제 Edge 호스팅·Auth 대신 로컬 handler와 합성 Auth HTTP를 사용했다. DB는 mock이 아니다.
- seal 오류·네트워크 실패·잘못된 응답·consume 재사용 거부에서 웹 코드가 OAuth 원문 access/refresh를 앱 URL/payload에 전달하지 않는 것을 합성 실행 및 Chromium으로 검증한다. 성공 앱 링크에는 봉인 handoff만 포함된다.
- 기존 운영 조사: auth-handoff v3 / verify_jwt=false. 이 후속 작업에서 Edge 상태를 새로 조회하지 않았으므로 배포 직전 반드시 갱신한다. DB 조회는 [snapshot](security/sec1-auth-handoff-snapshot.md)에 별도로 구분했다.

## 2. 원인과 수정

기존 코드의 실제 handler 재현에서 같은 전달표의 순차·독립 인스턴스 소비가 모두 refresh에 도달했다. 서버 소비 기록이 없고, CORS `*`, 주체 불일치 session 반환, upstream 오류 노출이 있었다. 웹 브리지는 seal 실패 시 OAuth hash 원문을 `payload` 앱 링크로 넘겼다. 과거 재현 원문은 후속 시작 SHA의 `docs/security/sec1-auth-handoff-reproduce.mjs`에 보존되어 있다.

확정된 사용자 지시를 다음 순서로 구현·검증한다. 별도 제품 기능이나 권한 모델 변경은 없다.

| 순서 | 구현·검증 |
| --- | --- |
| 1 | 실제 Edge 소스 테스트를 먼저 실패시킨 뒤 v2·nonce 선점·CORS·일반 오류 구현 |
| 2 | CLI `migration new sec1_auth_handoff_once`로 후보 생성, PostgreSQL 역할·동시성·rollback/reapply 검증 |
| 3 | 웹 원문 fallback 제거, URL 즉시 정리, 기존 query 앱 링크 유지, callback referrer 차단 |
| 4 | loader 순서 및 모든 실제 상위 캐시 버전 전파, 기존 로그인/세션/Google 회귀 |
| 5 | 독립 코드 리뷰, 같은 Draft PR push, CI 확인 후 운영 적용 직전 정지 |

### Edge 계약

- AES-GCM 봉인 payload: `{version:2, nonce:crypto.randomUUID(), sub, rt, iat, exp}`. `rt`는 봉인 안에만 있고 DB에는 저장하지 않는다. 기존 키 파생 방식은 유지한다.
- `/auth/v1/user`로 확인한 user.id만 sub로 사용한다. 클라이언트 user/workspace는 사용하지 않는다. 복호화, v2, UUIDv4 nonce, UUID sub, refresh 값, 정수 시간, 최대 5분 수명 및 만료를 **DB 호출 전에** 검사한다. nonce 없는 v1은 거부하고 새 로그인을 안내한다.
- service credentials로 `app_consume_auth_handoff`를 호출하고 HTTP 성공·JSON **정확히 true**일 때만 refresh한다. DB 오류, false, 문자열/배열/불명확 값, 파싱 오류, 5초 timeout은 모두 거부한다. timeout은 응답 본문 읽기에도 적용한다.
- DB가 선점한 뒤 Auth 실패·네트워크 오류·응답 유실·주체 불일치가 생겨도 소비 기록을 복구하지 않는다. 사용자는 새 로그인을 시작한다.
- refresh 결과 user.id가 봉인 sub와 다르거나 session 토큰이 없으면 session을 반환하지 않는다.
- seal/consume/오류/OPTIONS 전부 `Cache-Control: no-store`. 외부 응답은 한정된 오류 코드와 새 로그인 안내뿐이다. 토큰·내부 오류·로그 원문을 출력하지 않는다.

### CORS

아래 세 문자열과 완전 일치만 허용한다. OPTIONS와 실제 POST 모두 검사하며 허용 응답은 해당 Origin 하나와 `Vary: Origin`을 돌려준다.

| Origin | 기존 코드 근거 |
| --- | --- |
| `https://desk.bokdoong.com` | Cloudflare router, 현재 origin 기반 auth-service APP_ROOT |
| `https://work.bokdoong.com` | router의 기존 `/work/app/` 운영 주소 |
| `https://mj880616.github.io` | Android HOME 및 기존 auth callback |

임의 하위도메인·유사 호스트·`null`·누락·file/custom scheme은 거부한다. CORS는 인증 수단이 아니다. GitHub Pages의 다른 프로젝트도 같은 origin이라는 범위는 남는다.

## 3. DB 후보와 권한

- 정식 후보: [`20260926154120_sec1_auth_handoff_once.sql`](../supabase/migrations/20260926154120_sec1_auth_handoff_once.sql). Supabase CLI **2.118.0**이 생성한 이름이며 임의 timestamp가 아니다.
- [`sec1-auth-handoff.sql`](security/sec1-auth-handoff.sql)은 검토용 동일 SQL 사본이다. 실제 적용 시에는 별도 merge 승인 후 **main의 migration 파일 원문**을 사용한다. 두 파일을 중복 실행하지 않는다.
- `begin;` → 새 표·RPC·ACL/RLS → 해당 version/name의 schema_migrations insert 1행 → 마지막 `commit;` 구조다. `db push`·`migration repair` 금지.
- `app_auth_handoff_consumptions`: nonce UUID PK, subject_id, expires_at, consumed_at만 저장한다. 실제 access/refresh/봉인 문자열을 저장하지 않는다. 만료+1분 지난 행만 정리한다.
- `SECURITY INVOKER`, 고정 빈 search_path, RLS 유지. PUBLIC/anon/authenticated 권한과 policy 없음. service_role에는 INSERT·DELETE, SELECT(nonce, expires_at), RPC EXECUTE만 준다. UPDATE/TRUNCATE/subject_id 조회는 허용하지 않는다. private schema 및 기존 객체 권한은 건드리지 않는다.
- hosted default ACL이 새 표와 함수를 anon/authenticated에 넓게 부여하는 상황을 로컬에서 재현한 뒤, migration의 REVOKE가 실제 호출을 막는지 검증했다. service_role BYPASSRLS는 기존 Supabase 역할 성질이며 새로 변경하지 않는다.
- [`rollback`](security/sec1-auth-handoff-rollback.sql)은 새 RPC·표와 이 migration 이력 1행만 제거한다. CASCADE 없음. v2 발급/소비를 중단하고 마지막 발급 후 6분 및 진행 요청 종료를 확인한 다음에만 별도 승인으로 실행한다. 조기 삭제는 재사용 방지 기록을 잃게 한다.

공식 근거: [Supabase 함수 권한/INVOKER](https://supabase.com/docs/guides/database/functions), [PostgreSQL INSERT conflict 처리](https://www.postgresql.org/docs/17/sql-insert.html). 정책 완화나 SECURITY DEFINER 우회를 사용하지 않는다.

## 4. 웹·Android·캐시

- native bridge는 hash/query 값을 메모리에 확보한 직후, DOM 재구성과 네트워크 요청 전에 OAuth 필드를 URL에서 지운다. seal 실패 시 앱 링크를 만들지 않고 새 로그인 안내로 끝낸다. callback 및 재구성 문서에 `no-referrer` meta, fetch에 `referrerPolicy:no-referrer`·`cache:no-store`를 적용했다.
- handoff client는 성공 여부와 무관하게 **첫 요청 전에** handoff 및 혼합된 OAuth 정보를 지운다. 실패한 전달표를 저장·자동 재시도하지 않고 upstream 메시지를 표시하지 않는다.
- loader는 handoff 소비/정리 완료 후 auth-bootstrap을 불러온다. 동시에 읽으면 혼합 URL의 원문 OAuth가 bootstrap에 의해 session으로 저장될 수 있어 순서를 명시했다. handoff 없는 desktop OAuth/RTW PKCE 복귀는 기존 경로를 유지한다.
- Android Java/Manifest/APK와 Windows 소스는 변경하지 않았다. 기존 `intent://auth?handoff=…` 및 Windows custom scheme query 계약을 유지한다. Java는 기존 query/fragment 전달 구조로 충분하다.
- **설치 APK 실물 호환은 미검증**이다. 구 APK나 구 캐시 브리지는 원문 payload를 받을 수 있는 기존 경로가 남는다. 새 웹은 이 값을 생성하지 않지만, 이미 설치된 수신기의 임의 payload 처리까지 제거하려면 별도 Android 결정이 필요하다.
- 봉인 handoff query는 최초 페이지 요청 로그에 남을 가능성이 있고 이미 발생한 요청은 JS 정리로 지울 수 없다. 이번 PR은 raw OAuth fallback 제거와 query 즉시 제거까지이며 fragment 전환은 하지 않는다.
- 캐시: native bridge **5**, handoff client **2**, loader **239**, app **127**. index preload와 native-callback, 기존 캐시 기대 테스트를 함께 갱신했다. view-loader 등 수정하지 않은 모듈에는 불필요한 버전 변경이 없다. native-callback.html 자체는 OAuth redirect로 직접 탐색하며 JS loader가 버전으로 불러오는 파일이 아니다.

## 5. 재현 가능한 검증

```powershell
node --test tests/security/*.test.mjs
node docs/security/sec1-auth-handoff-reproduce.mjs --enforce
npm.cmd ci --prefix tests/auth-handoff --no-audit --no-fund
npm.cmd test --prefix tests/auth-handoff
npx.cmd playwright test tests/app-e2e/auth-handoff.spec.mjs tests/app-e2e/public-workspace-auth.spec.mjs tests/app-e2e/google-tasks-push.spec.mjs tests/app-e2e/calendar-google-loading.spec.mjs --browser=chromium --workers=1 --reporter=line
```

- Node 24 필요. 로컬 Windows ARM64에서는 PostgreSQL 패키지의 Windows ARM 지원이 없어 **x64 Node 24.21.0**으로 설치/실행했다. PostgreSQL 17.6을 127.0.0.1의 동적 포트와 매번 새 임시 DB로 실행한다. 운영 PG 환경변수를 제거하고 연결값을 하드코딩한 loopback으로 제한한다. 테스트 종료 시 해당 임시 클러스터만 정리한다.
- 보안 전체 88/88, 새 실제 PG 검증 7/7 통과. 순차 2회, 독립 인스턴스 2개, 동시 20개, 만료·잘못된 nonce, 역할 거부, Auth/통신 실패 후 재사용 거부, rollback/reapply 포함.
- DB timeout·false·잘못된 JSON·불명확 값에서는 refresh 0회. 실제 DB commit 후 응답 유실을 흉내 낸 경우에도 재시도는 거부된다.
- 독립 리뷰에서 Calendar callback을 로그인 브리지가 가로채는 회귀를 발견해 조건을 좁혔다. 두 import 순서와 Android UA 테스트를 RED→GREEN으로 검증했다.
- 기존 세션 소유자 전환 E2E의 간헐 실패를 관찰했다. clean main 앱 파일 5회 반복에서도 1회 실패/4회 통과를 재현했다. 테스트는 삭제·완화하지 않았고, 관련 없는 세션 코드 수정은 하지 않았다.
- Chromium 및 최종 CI 결과는 같은 PR의 최신 검증 댓글에 기록한다. GitHub Actions Authorization security check에 실제 PG 시험을 추가했다. 전체 App browser E2E와 App smoke도 기존 CI에서 실행한다.
- 이 검증은 운영 로그인, 실제 여러 Edge 서버, PostgREST hosted 설정, 설치 APK를 직접 시험한 결과가 아니다. DB/RLS·Web1 public projection·RTW Auth 설정 및 Google Calendar/Tasks 함수는 변경하지 않았다. 기존 회귀 검사는 보존을 확인하는 근거이며 운영 무영향의 실측을 뜻하지 않는다.

## 6. 사용자 할 일과 운영 정지 지점

무엇이 바뀌나: 로그인 전달표의 사용 여부를 저장해 같은 전달표의 두 번째 사용을 막는다.
잘못되면: 앱 로그인 전달이 실패할 수 있고, 중간 통신 오류가 나면 새 로그인이 필요하다.
되돌리는 방법: 먼저 발급·소비를 안전하게 중단하고 수명/진행 요청 종료를 확인한 뒤 새 객체만 rollback한다.

아래는 **이번 세션에서 실행하지 않는다**. Claude Code 로컬 manual mode에서 각각 승인 후 진행한다.

1. PR diff/CI 검토와 별도 merge 승인. Draft는 유지한다.
2. 적용 직전 snapshot 재조회: 새 객체·migration version 부재, ACL·RLS·service_role 특성 확인. 다른 변경이 있으면 중단한다.
3. 사용자가 main의 migration 원문을 SQL Editor에서 직접 실행. 커맨드센터 실행 승인·끝의 `commit;`·결과 Success를 확인하고 조회로 사후 검증한다.
4. 원문 fallback을 제거한 웹을 먼저 배포하고 구 캐시/구 callback 여부를 확인한다. 기존 v1 handoff는 Edge 전환 후 거부되므로 진행 중 사용자는 새 로그인해야 한다.
5. Edge 원본 백업, 현재 version/verify_jwt/시각 기록 후 **배포 직전에 다시 정지**. 현재 false를 확인한 경우만 다음 명령을 승인받아 실행한다.

```powershell
npx.cmd supabase functions list --project-ref xmlkxfjeagycwttklxjw -o json
npx.cmd supabase functions deploy auth-handoff --project-ref xmlkxfjeagycwttklxjw --use-api --no-verify-jwt
```

백업은 저장소 밖 별도 디렉터리에서 `functions download auth-handoff --project-ref xmlkxfjeagycwttklxjw --use-api`로 받는다. 함수명 생략·prune 금지. verify_jwt가 다르면 이 명령을 그대로 실행하지 않는다.

6. 배포 후 버전 증가/설정 유지, 세 Origin·거부 Origin, OPTIONS, 비인증 seal 거부, 사용된/만료 handoff 거부를 확인한다. 실물 Android 로그인·중복 intent·뒤로가기·새로고침 및 desktop 로그인/로그아웃·Google Calendar/Tasks 복귀를 별도 승인 범위에서 확인한다.

복구: DB만 적용하고 Edge 미배포라면 새 표를 즉시 지울 필요가 없다. 이미 Edge를 전환했다면 전달 기능을 먼저 중단한 뒤 복구한다. 이전 v3 소스 재배포는 재사용/CORS 취약점을 재개방하므로 자동 복구로 사용하지 않는다. 별도 승인 시에만 백업 checkout에서 위와 동일 함수·옵션으로 재배포한다. 안전한 기능 중단용 Edge 빌드는 이번 PR에 포함하지 않았으므로 운영 전 복구 담당자가 준비해야 한다. 새 표는 최소 6분과 진행 요청 종료까지 유지한다.

잔여 결정: 실제 APK 호환 시험, 구 웹 캐시 퇴출 확인, 별도 Android 수신기 강화 필요 여부. 원래 handoff는 공유 Supabase Auth 사용자 인증이며 sole-owner 판정은 기존 Web2 DB/Edge 업무 권한 계층에서 한다. RTW 공유 Auth와 인증 설정은 바꾸지 않는다.

범위 밖 기존 발견: workspace-drive 다운로드 토큰의 동시 소비 점검 후보. 이번 PR에서 수정하거나 운영 재현하지 않았다.
