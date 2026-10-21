# DRV-요약 PR 1 · drive-summary

코드·테스트만. 배포·DB 쓰기·migration 없음. `app/**`, `.github/**`, 기존 함수 변경 없음. 새 앱 연결은 PR 2, 하루 1번 GitHub 예약 실행은 PR 3이다. Drive 장기기억 원장에 쓰지 않는다.

## 호출과 인증

- `POST /functions/v1/drive-summary`, 요청 본문·클라이언트 workspace/Drive ID는 사용하지 않는다.
- 사용자: `Authorization: Bearer <사용자 JWT>`를 `/auth/v1/user`로 검증한 뒤 서버가 slug `kptu-work`를 찾고 해당 작업공간의 `app_workspace_members.role = owner`만 허용한다. admin 등 다른 역할은 403, 비로그인은 401이다.
- 예약: `x-drive-summary-cron-secret` 헤더를 `DRIVE_SUMMARY_CRON_SECRET`과 SHA-256 고정 길이 버퍼 전체 XOR 비교한다. 미설정·빈값·틀린 값은 401이다. 헤더를 보내면 예약 경로만 검증하므로 잘못된 비밀값에서 JWT 경로로 fallback하지 않는다.
- `verify_jwt=false`: Supabase gateway가 JWT 없는 예약 요청을 함수 도달 전에 차단하지 않도록 한다. 함수 자체의 두 인증 경로는 항상 적용한다. OPTIONS는 데이터 접근 없는 CORS preflight이며 GET 등은 405다.
- 응답은 `ok`, `updated_at`(두 문서 상단과 같은 UTC ISO 시각), `documents.org/project` 링크만 제공한다. 실패는 안전한 단계 코드, `attempted_at`, `failure_recorded`, 이미 갱신한 문서 링크를 제공한다. 본문·외부 오류 원문·토큰은 반환하거나 기록하지 않는다.

## 읽기·문서 규칙

- 기간은 호출 시점 한국 날짜의 자정에서 28일을 뺀 시점부터 호출 시점까지다. 조직 `occurred_at`, 회의 `meeting_at`은 양 끝 포함, 진행 기록의 날짜 `effective_on`은 시작 날짜부터 오늘까지다. 주요 일정은 시작 경계 이후의 지난 일정과 모든 다가오는 일정이며 날짜 미정 일정은 제외한다. D-day는 한국 날짜 차이다.
- DB는 GET만 사용하고 `kptu-work`를 기준으로 범위를 제한한다. 작업공간 열이 없는 조직 기록·프로젝트 세부 표는 FK 명시 `!inner` 관계와 연결된 작업공간 조건으로 제한한다. 페이지별 안정된 정렬로 전체 행을 읽고 상한 초과는 실패한다.
- 조직은 앱의 13개 정의 및 미등록 이름 가나다순과 일치하는 테스트를 둔다. 현재 요약은 `recent_month_summary`다. `year_summary`·연혁·메모는 읽지 않는다.
- ORG-담당13기준: 조직 사본은 바구니 담당조직 목록과 같은 "내 담당 조직"(활성 + 소유자 담당 연결, 담당 0개·조회 실패면 활성 전체, 화면 원본 `app/my-organizations.js`)만 조직별 절로 싣는다. 다른 조직(담당 밖·비활성)의 최근 4주 기록은 버리지 않고 맨 끝 "그 외" 절 한 곳에 `시각 · 조직 이름 · 기록`으로 싣는다. 그 외 기록이 없으면 절도 없다.
- 프로젝트는 `app/project-catalog.js`와 같은 v2/management_version=2 및 하위 프로젝트 규칙으로 분류한다. 메타데이터는 분류용 두 scalar 키만 조회한다. 진행 기록은 summary/status_label/next_step, 단계는 workstream의 phase다. 미완료 할 일 수는 Google에 재조회하지 않은 `app_record_links`의 confirmed/미완료 상태 사본 기준이다. 자료는 개수만 제공한다.
- 회의는 이름·일시·회차·연결 프로젝트 이름만 포함한다. transcript_text·notes·decisions는 조회하지 않는다. 할 일 본문·자료 원문·메모·연혁도 조회하지 않는다.
- 기존 `public_policy_drive_config`의 Google 갱신 토큰을 쓴다. 새 OAuth 권한·scope 요청·토큰 저장을 추가하지 않는다. 기존 연결의 `drive.file`로 이 앱이 만든 파일만 다룬다.
- 내 Drive 최상위의 “Web2 읽기용 사본” 폴더와 Google 문서 2개는 `appProperties.kptu_summary=folder/org/project`, `kptu_workspace=kptu-work`로 찾는다. 문서는 그 폴더 안으로 제한한다. 중복 표시는 자동 선택하지 않고 실패한다. ID는 DB에 저장하지 않는다. HTML multipart를 Google 문서 MIME으로 생성하거나 같은 ID에 PATCH해 전체 내용을 교체한다.
- `permissions.create` 등 공유 생성·변경 호출은 없다. 폴더·기존 문서의 permissions를 읽고 anyone/domain이 있으면 내용 갱신을 거절한다. 업로드 직후와 완료 전에도 검사한다. 사용자의 개별 직접 공유를 변경하지 않는다. Drive UI의 “공유 → 일반 액세스: 제한됨”으로 폴더·두 문서를 확인하고, 로컬 사후 확인 시 permissions 목록에 anyone/domain이 없는지 재확인한다.
- 폴더 appProperties의 `last_success_at`은 두 문서 갱신·공유 검사 후에만 기록한다. 실패는 `last_failure_at`, `last_failure_summary`(안전한 단계 코드)에 기록하며 이전 성공/실패와 다른 속성은 보존한다. Drive 인증·발견 실패나 Drive 장애로 폴더 기록도 불가능하면 `failure_recorded=false`다. 두 문서 교체는 원자적이지 않아 부분 성공이 가능하지만 Web2 원본에는 영향이 없다.

## 검증

`node --test tests/security/drive-summary.test.mjs`

환경에서 파일 단위로만 출력되면 `node --test --test-isolation=none tests/security/drive-summary.test.mjs`로 개별 결과를 확인한다. HTTP는 전부 모의 응답이며 실제 Supabase·Google·production에 접근하지 않는다. 기존 Authorization security check의 `tests/security/*.test.mjs`에 자동 포함된다.

## 배포 계획 (실행 금지, Claude Code 로컬에서 별도 승인 후)

- 함수: `drive-summary`, `verify_jwt=false`.
- 기존 런타임 이름: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Google 연결 설정은 기존 DB 설정만 쓴다.
- 신규 비밀값 이름: `DRIVE_SUMMARY_CRON_SECRET` (PR 3 예약 호출 전에 필요). 미설정 상태에서도 소유자 JWT 경로는 가능하다. 값은 이 PR이나 웹 환경에 넣지 않는다.
- 사전 확인: 최신 main과 이 PR의 문서 충돌, 현재 함수 목록, 기존 Google `drive.file` 연결, FK/열/권한을 Claude Code 로컬의 읽기 전용 절차로 확인한다. 실제 API의 HTML→Google Docs 생성·같은 ID 전체 교체는 웹 모의 테스트로 입증하지 못한다.
- 명령안: `npx.cmd supabase functions deploy drive-summary --project-ref <ref> --no-verify-jwt --use-api`. 이 웹 작업에서 실행하지 않는다.
- 사후 확인: 비로그인 POST 401, 비소유자/틀린 비밀값 거절, 소유자 호출 1회로 폴더·문서 2개 및 상단 시각 확인, 재호출 시 같은 문서 ID와 전체 교체 확인, 폴더·두 문서의 공개 공유 없음 확인. 예약 비밀값 설정 뒤 올바른 예약 경로도 확인한다.
- 복구: Claude Code 로컬 별도 승인 후 대상 함수만 비활성화/삭제한다. 삭제 명령안은 `npx.cmd supabase functions delete drive-summary --project-ref <ref>`이다. 만들어진 읽기용 문서는 사용자가 Drive에서 삭제한다. DB 복구는 필요 없다.
- 남은 위험: 여러 호출이 동시에 최초 생성/교체하면 중복 파일 또는 오래된 사본으로 덮어쓰기가 가능하다. DB lock/write는 이 PR에서 금지되어 추가하지 않았다. PR 2 호출 몰아주기와 PR 3 실행 겹침 방지로 줄이고, 표시 중복은 이 함수가 실패로 보고한다. Drive 공유 변경과 읽기 검사 사이에도 외부 변경 경합은 가능하다.

## BASKET-3 (소스·검증, 운영 배포 없음)

프로젝트 사본 끝에만 바구니를 붙인다. 서버가 `kptu-work` workspace·최근 4주 KST·기존 폴더를 결정한다. `archived_at IS NULL`, `ai_export_allowed=true`이고 확정/제안 연결이 없는 메모만 포함한다. 업무일지에 남긴 업데이트(`metadata.journal_at`, 화면 `app/update-journal.js`의 `noteJournalAt`과 같은 판정)는 미분류가 아니므로 대상 건수·과거 미분류 건수·원문에서 모두 빠진다. 이 판정을 위해 메타데이터는 `journal_at:metadata->journal_at` 한 값만 조회한다. 과거 미분류 건수만 표시한다. 저장된 제안은 원문 버전 열이 없으므로 모두 보수적으로 유효하게 취급하며 화면 `noteState`와 같은 기준이다. BASKET-4의 버전 검증·무효화와 처리 결과 writer를 구현하지 않는다.

원문은 HTML escape만 하고 공백·개행을 보존한다. `<pre>` 첫 개행 제거를 방지하는 빈 span과 CR 문자 참조를 사용한다. 첨부는 파일명·MIME·byte 크기·검증된 Drive ID 링크만 출력하며 파일 읽기·OCR·AI 요청은 없다. 분류 목적지는 `app/project-catalog-model.mjs`를 기준으로 한 배포 내부 사본 `./project-catalog-model.mjs`의 동일한 분류·tree를 사용한다. 두 사본은 회귀에서 바이트 단위로 비교한다. v2/management_version=2 프로젝트와 후손 중 화면에 보이는 tree에서 완료(done/completed)·보관을 제외하고, 하위 이름은 “상위 › 하위” 경로로 제공한다. 완료 상위의 미완료 하위는 유지하고 보관 상위의 후손·순환 계층은 화면과 같이 숨긴다. 담당조직은 #500의 내 담당 활성 조직·담당 0개 대체 문구를 유지하며 목적지 kind는 organization·project다. 7.2 JSON 기술 초안 `schema_version=1`과 제안 전용 지침을 함께 제공한다.

상한: 메모 **100건**, 프로젝트 문서 전체 HTML **UTF-8 1 MiB**(정확한 상한 포함). 초과하면 바구니 본문 전체를 내보내지 않고 프로젝트 사본 상단에 **대상 축소 필요**를 표시한다. 기존 절이 단독으로 상한을 초과하면 해당 사본도 진단 문서로 대체한다. `BASKET_OUTPUT_LIMIT` 실패·`last_failure_at/summary`를 기록하고 `last_success_at`은 유지한다. 잘못된 첨부는 업로드 전 `BASKET_ATTACHMENT_INVALID`로 실패하며 민감 내용은 오류에 넣지 않는다. Drive 장애로 경고 문서/실패 기록 자체가 쓰이지 못할 때는 기존 실패 경로와 `failure_recorded=false`를 그대로 따른다.

Web2 링크는 `https://desk.bokdoong.com/work/app/?view=basket&note=<ID>`이며 로그인 후 owner API 조회 결과의 정확한 메모만 연다. 갱신 호출은 payload 없이 유지한다. 상세 검토·가짜 데이터·운영 SHA 추정 근거: [검토 기록](../../../docs/basket-3-drive-copy.md).

화면 기준 모듈은 브라우저가 제공받는 `app/` 경로에 두고 Edge 사본은 `supabase/functions/drive-summary/` 안에 둔다. 운영 workflow는 `supabase/functions`만 격리 복사하므로 Edge에서 `app/`를 import하지 않는다. `scripts/check-drive-summary-isolation.mjs`가 같은 functions-only 복사를 만든 뒤 Deno 의존 그래프의 모든 로컬 경로·심볼릭 링크가 functions 내부인지 검사하고 check·bundle한다. 자동 보안 CI는 Deno 2.9.6과 `tests/edge-isolation/*.test.mjs`로 이 검사를 실행한다. 배포 workflow는 수정하지 않았다. 파일·PR 준비만 했으며 운영 v5(source `8b91b60`)에서 재배포 전까지 사본 안내는 바뀌지 않는다.

## ORG-사본자동갱신 (버튼 없는 자동 갱신)

서버 코드는 바꾸지 않았다(운영 v12 소스 `ee030ea`와 같음). 기존 두 인증 경로를 그대로 쓴다.

- **저장 뒤 자동 갱신(앱, 소유자 JWT 경로)**: `app/drive-summary.js`가 사본에 들어가는 것(조직 기록·요약, 프로젝트·진행·단계·일정, 회의 이름·일시, 할 일 연결, 프로젝트 자료, 바구니 메모)의 성공 저장을 받아 마지막 저장 3분 뒤(처음 저장부터 최대 10분) 본문 없는 POST 한 번을 보낸다. 화면 표시·버튼은 없다. 화면이 가려지거나 닫히면 기다리던 갱신을 keepalive 요청으로 바로 보낸다.
- **하루 2번 예약 갱신(cron 경로)**: `.github/workflows/drive-summary-refresh.yml`이 06:17·13:17 KST에 `scripts/ops/drive-summary-cron.mjs`로 `x-drive-summary-cron-secret` 헤더만 보낸다. GitHub 비밀값이 없으면 "비밀값 미등록", 서버 401이면 "비밀값 불일치"로 workflow가 실패한다. 네트워크·5xx만 1분 뒤 한 번 더 시도한다. 수동 실행(workflow_dispatch)도 같다.
- 비밀값 `DRIVE_SUMMARY_CRON_SECRET`은 같은 값을 GitHub 저장소 Actions 비밀값과 Supabase Edge Function 비밀값 두 곳에 사용자가 등록한다. 값은 저장소·PR·로그에 남기지 않는다. Supabase 쪽 비밀값을 바꾼 뒤에는 함수 재배포 없이 다음 호출부터 적용된다.
- 서버 쪽 묶기(변경 표시 + 예약 처리)는 고르지 않았다: 새 DB 표·트리거·migration(§6 정지)과 새 상태 저장소가 필요하고, 예약 간격(GitHub 최소 5분·지연)만큼 늦다. 앱 묶기 + 하루 2번 예약으로 같은 효과를 서버 변경 없이 얻는다.
- 동시 호출: 앱은 한 탭에서 한 번에 하나만 부르고 workflow는 `concurrency`로 겹치지 않는다. 앱과 예약이 우연히 겹치면 두 호출이 같은 문서를 차례로 전체 교체하므로 나중 것이 남는다(둘 다 최신 원본 기준). 기존 "남은 위험"(최초 생성 경합)은 문서가 이미 있어 해당하지 않는다.

### 설계 메모 (이번 범위 아님)

- **원장 요약 포함(S7 뒤)**: Web2 원장 표가 생기면 프로젝트 사본 끝(또는 세 번째 문서 `kptu_summary=ledger`)에 사용자가 확정한 항목만 싣는다(AI 후보 제외). 읽기는 지금처럼 `kptu-work` 범위 GET·열 허용 목록·상한 초과 시 진단 문서. 앱 쪽은 `SUMMARY_FIELDS`에 원장 표·열을 더하면 같은 묶기·예약을 그대로 쓴다. 예약 workflow는 바꿀 필요 없다.
- **OPS-수집점검 연결("마지막 수집 시각")**: 지금 앱은 사본 마지막 갱신 시각을 읽을 수 없다. 시각은 Drive 폴더 `appProperties.last_success_at`·`last_failure_at`·`last_failure_summary`에만 있고, Drive 토큰은 서버에만 있으며, 이 함수는 POST(전체 재생성)만 받고 GET은 405다. DB에는 시각을 저장하지 않는다. 다음 과제 추천안: 이 함수에 소유자 JWT 전용 읽기 동작(예: POST `?action=status` 또는 GET)을 더해 폴더 appProperties의 세 값만 돌려준다(문서 재생성·쓰기 없음, drive.file·공유 금지 검사 유지). Edge 재배포가 필요하다.

## OPS-수집점검 (소유자 전용 상태 읽기)

- `GET /functions/v1/drive-summary?action=status`. 소유자 JWT 경로만 받는다. 예약 비밀값 헤더가 있으면(값과 무관) 401이고, 비로그인 401·비소유자 403이다. 다른 GET은 지금처럼 405이며 I/O가 없다.
- 하는 일: 기존 `drive.file` 토큰으로 "Web2 읽기용 사본" 폴더를 `appProperties`로 찾아 공유 검사(anyone/domain 거절) 뒤 폴더 속성 세 값만 돌려준다. 폴더가 없으면 만들지 않고 `state:'none'`이다. 문서 재생성·업로드·상태 기록·DB 쓰기는 없다. Web2 기록 표는 읽지 않는다(인증용 `app_workspaces`·`app_workspace_members`와 Drive 설정만).
- 응답: `{ok, checked_at, copy:{state, last_success_at, last_failure_at, last_failure_code}}`. 시각은 ISO 형식 검사, 코드는 `^[A-Z][A-Z0-9_]{0,63}$`(실패 시각이 있을 때만)를 통과한 값만 낸다. 폴더 이름·ID·문서 링크·다른 속성은 내지 않는다. 실패는 단계 코드만(`DRIVE_TOKEN_FAILED` 등), 실패 기록을 남기지 않는다.
- CORS `Access-Control-Allow-Methods`에 GET을 더했다. 배포 전 앱이 먼저 나가도 옛 함수는 preflight에서 GET을 허락하지 않거나 405를 주므로 홈 칸은 조용히 숨는다(옛 POST 재생성으로 잘못 가지 않게 POST가 아닌 GET을 골랐다).
- 화면: `app/collection-status.js`(홈 "마지막 수집 시각"). 텔레그램 수집·통화 전사는 바깥 프로그램이 만든 Drive 파일이라 `drive.file`로 못 읽으므로 "확인 불가"로만 표시한다. 권한을 넓히지 않는다.

## OPS-수집점검 2단계 (바깥 수집 점검 신호, heartbeat)

- `POST /functions/v1/drive-summary?action=heartbeat`. 통화 전사용 Google 앱 스크립트(사용자 계정, Drive 전체 접근)가 1시간마다 부른다. Web2는 `drive.file`로 바깥 프로그램 파일을 못 읽으므로 **반대 방향 신호**를 받는다. 권한은 넓히지 않는다.
- 인증: `x-collector-heartbeat-secret` 헤더를 새 비밀값 `COLLECTOR_HEARTBEAT_SECRET`과 기존 방식(SHA-256 고정 길이 전체 비교)으로 비교한다. 미설정·빈값·틀린 값 401. 예약 비밀값 헤더가 같이 오면 401, 사용자 JWT는 이 경로에서 받지 않는다. 반대로 이 헤더는 사본 재생성 POST·상태 읽기 GET에서 401이다(자격 섞임 방지). CORS 허용 헤더에 넣지 않는다(브라우저용 아님).
- 본문: 정확히 `{source:'telegram'|'transcript', last_at:ISO 시각, count?:0~100000 정수}`, 1 KiB 이하. 다른 키(파일 이름·ID·내용 등)가 있으면 400 `INVALID_BODY`. 시각은 2020년 이후·서버 시각보다 10분 넘게 미래면 거절.
- 하는 일은 하나: 기존 "Web2 읽기용 사본" 폴더(공유 검사 통과)의 `appProperties`에 그 출처 키 3개(`collector_<source>_at`·`_count`·`_reported_at`)만 PATCH한다(Drive는 appProperties를 키별로 합친다 → 사본 상태 키는 건드리지 않음). 폴더가 없으면 만들지 않고 409 `COPY_FOLDER_MISSING`. DB 쓰기·문서 재생성·Web2 기록 읽기 없음(DB는 기존과 같은 Drive 연결 설정 읽기만). **새 표·migration 없음.**
- 상태 읽기 `GET ?action=status` 응답에 `collectors:{telegram, transcript}`(각 `{last_at, count, reported_at}` 또는 `null`)를 더했다. 저장값도 같은 형식 검사를 통과한 것만 낸다.
- 화면 기준: 텔레그램 26시간(업무방 매일 07:30 1회 수집)·통화 전사 72시간(통화 없는 날·주말) 넘으면 주의, 신호(`reported_at`)가 3시간 넘게 없으면 "점검 신호 끊김"(`app/collection-status.js`).
- 앱 스크립트 코드·설정 안내: `docs/ops/collector-heartbeat.gs`, `docs/ops/collector-heartbeat.md`.
- 남은 위험: 사본 재생성(POST)의 `recordStatus`는 읽어 둔 폴더 속성 전체를 다시 보내므로, 재생성 도중(수 초) 신호가 들어오면 그 신호 하나가 옛 값으로 덮일 수 있다. 다음 시간 신호로 바로 회복된다. 비밀값이 새면 가짜 시각을 쓸 수 있을 뿐(읽기·내용·다른 키 쓰기 불가) — 비밀값 교체로 막는다.
